import "dotenv/config";
import dns from "node:dns";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { router as apiRouter } from "./routes/api.js";
import { router as authRouter } from "./routes/auth.js";
import { router as adminRouter } from "./routes/admin.js";
import {
  router as monitoringRouter,
  ingestRouter as monitoringIngestRouter,
  pageviewRouter as monitoringPageviewRouter,
} from "./routes/monitoring.js";
import { bootstrapMasterAccount } from "./bootstrapMaster.js";
import { reconnectAllStaffSessions } from "./whatsapp/connector.js";
import { startAutoAnalyzeScheduler } from "./ai/scheduler.js";
import { startRiskReminderScheduler } from "./notify/reminderScheduler.js";
import { startDailyReportScheduler } from "./notify/dailyReportScheduler.js";
import { startUptimeChecker } from "./monitoring/uptimeChecker.js";
import { logger } from "./logger.js";

// Banyak VPS punya rute IPv6 yang "setengah jalan" (DNS balikin AAAA record,
// tapi paket keluar lewat IPv6 tidak sampai) — Node lalu mencoba IPv6 dulu,
// menggantung sampai timeout, baru gagal total tanpa sempat coba IPv4 yang
// sebetulnya jalan normal. Ini menyebabkan fetch() ke domain eksternal
// (provider AI, dll) gagal dengan ETIMEDOUT walau domain itu sendiri sehat.
// Memaksa urutan resolusi IPv4 dulu menghindari jebakan ini secara global.
dns.setDefaultResultOrder("ipv4first");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable("x-powered-by");
// FaiAudit dilayani lewat http://IP:port murni (tanpa TLS di depannya).
// Default helmet menambah `upgrade-insecure-requests` di CSP + HSTS, yang
// memaksa browser meng-upgrade semua request (style.css, app.js, fetch ke
// /api/...) ke https:// — padahal tidak ada listener https di port ini, jadi
// halaman jadi tak ber-style DAN login gagal di browser (curl tetap jalan
// karena mengabaikan CSP). Matikan kedua direktif itu; aktifkan lagi kalau
// kelak ditaruh di belakang reverse-proxy TLS (set ENABLE_HTTPS=1).
const behindTls = process.env.ENABLE_HTTPS === "1";
app.use(
  helmet({
    hsts: behindTls,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: behindTls ? {} : { upgradeInsecureRequests: null },
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// Hanya percaya header X-Forwarded-For/IP kalau memang ada reverse-proxy
// tepercaya di depan (Nginx/Cloudflare) yang sudah menimpa header itu dengan
// IP klien asli. Tanpa flag ini, mengaktifkan trust proxy secara membabi buta
// justru membuka celah pemalsuan IP (header X-Forwarded-For dikirim langsung
// oleh klien) yang bisa melumpuhkan seluruh rate-limit di bawah ini.
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// Lapisan pertahanan dasar terhadap flood request (DDoS application-layer)
// untuk SEMUA endpoint /api — sebelumnya hanya /api/auth dan
// /api/leads/:id/analyze yang dibatasi, sehingga endpoint berat seperti
// generate PDF (PDFKit, CPU-intensif) dan pembuatan sesi WA (buka socket
// baru) bisa dibanjiri tanpa batas oleh satu klien.
// keyGenerator default (berbasis req.ip) dipakai apa adanya di sini karena
// req.ownerId belum ada saat limiter ini jalan — requireOwner baru dijalankan
// belakangan, di dalam masing-masing route handler.
const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/api/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.use("/api/auth", authLimiter, authRouter);
app.use("/api/admin", globalApiLimiter, adminRouter);
app.use("/api/admin/monitoring", globalApiLimiter, monitoringRouter);
// Terpisah dari /api/admin: dipakai skrip audit terjadwal lewat token statis
// (MONITOR_INGEST_TOKEN), bukan sesi browser owner — lihat routes/monitoring.js.
app.use("/api/monitoring-ingest", authLimiter, monitoringIngestRouter);

// Endpoint traffic-beacon dipanggil lintas-origin langsung dari browser
// pengunjung 4 website lain (domain berbeda dari FaiAudit sendiri), jadi
// butuh CORS terbuka — tapi HANYA untuk path ini, bukan seluruh /api. Tidak
// pakai cookie/kredensial apa pun di sini, jadi wildcard origin aman (data
// yang masuk memang best-effort analytics publik, lihat routes/monitoring.js).
const pageviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/monitoring-beacon", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use("/api/monitoring-beacon", pageviewLimiter, monitoringPageviewRouter);

app.use("/api", globalApiLimiter, apiRouter);

const port = process.env.PORT || 3000;
// Saat di belakang reverse proxy (Nginx), set HOST=127.0.0.1 supaya Node hanya
// bisa diakses dari localhost — lapisan kedua kalau aturan firewall port ini
// salah/terlewat, server tetap tidak terekspos langsung ke internet. Default
// tetap mendengarkan di semua interface untuk akses langsung saat dev/awal.
const host = process.env.HOST || "0.0.0.0";

bootstrapMasterAccount().finally(() => {
  app.listen(port, host, () => {
    logger.info({ port, host }, "FaiAudit dashboard berjalan");
    // Sambungkan ulang sesi WA staff yang sudah pernah pairing — tanpa ini,
    // setiap restart server diam-diam menghentikan audit sampai staff dihapus
    // dan ditambahkan ulang manual.
    reconnectAllStaffSessions();
    startAutoAnalyzeScheduler();
    startRiskReminderScheduler();
    startDailyReportScheduler();
    startUptimeChecker();
  });
});

process.on("unhandledRejection", (err) => {
  logger.error({ err: err?.message || err }, "unhandled rejection");
});
