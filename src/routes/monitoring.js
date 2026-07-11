import express from "express";
import crypto from "node:crypto";
import { supabase } from "../supabase.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { logger } from "../logger.js";

export const router = express.Router();

function requireMaster(req, res, next) {
  if (!req.owner?.is_master) {
    return res.status(403).json({ error: "Hanya master yang boleh mengakses monitoring" });
  }
  next();
}

router.use(requireOwner, requireMaster);

// Daftar web yang dipantau.
router.get("/targets", async (req, res) => {
  const { data, error } = await supabase
    .from("monitor_targets")
    .select("id, name, url, repo_full_name, is_active, created_at")
    .order("name", { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Upsert berdasarkan name: kalau target dengan nama itu sudah ada (mis. dari
// 8 project yang di-seed lewat migration), url-nya di-update, bukan bikin
// baris duplikat.
router.post("/targets", async (req, res) => {
  const { name, url, repo_full_name } = req.body || {};
  if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "name wajib diisi" });
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return res.status(400).json({ error: "url tidak valid" });
  const payload = { name: name.trim(), url: url.trim() };
  if (repo_full_name) payload.repo_full_name = repo_full_name;
  const { data, error } = await supabase
    .from("monitor_targets")
    .upsert(payload, { onConflict: "name" })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  logger.info({ actor: req.owner.id, target: data.id }, "monitoring.target_upserted");
  res.status(201).json(data);
});

router.patch("/targets/:id", async (req, res) => {
  const { is_active, url, name, repo_full_name } = req.body || {};
  const patch = {};
  if (typeof is_active === "boolean") patch.is_active = is_active;
  if (typeof url === "string" && /^https?:\/\//.test(url)) patch.url = url.trim();
  if (typeof name === "string" && name.trim()) patch.name = name.trim();
  if (typeof repo_full_name === "string") patch.repo_full_name = repo_full_name.trim() || null;
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Tidak ada field valid untuk diubah" });

  const { data, error } = await supabase
    .from("monitor_targets")
    .update(patch)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  logger.info({ actor: req.owner.id, target: data.id, patch }, "monitoring.target_updated");
  res.json(data);
});

// Ringkasan uptime per target: status terakhir + persentase up dalam 24 jam terakhir.
router.get("/uptime/summary", async (req, res) => {
  const { data: targets, error: targetsError } = await supabase
    .from("monitor_targets")
    .select("id, name, url, is_active");
  if (targetsError) return res.status(400).json({ error: targetsError.message });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: checks, error: checksError } = await supabase
    .from("monitor_uptime_checks")
    .select("target_id, checked_at, is_up, status_code, response_ms, error")
    .gte("checked_at", since)
    .order("checked_at", { ascending: false });
  if (checksError) return res.status(400).json({ error: checksError.message });

  const summary = (targets || []).map((t) => {
    const targetChecks = (checks || []).filter((c) => c.target_id === t.id);
    const latest = targetChecks[0] || null;
    const upCount = targetChecks.filter((c) => c.is_up).length;
    return {
      ...t,
      latest_status: latest ? (latest.is_up ? "up" : "down") : "unknown",
      latest_response_ms: latest?.response_ms ?? null,
      latest_checked_at: latest?.checked_at ?? null,
      latest_error: latest?.error ?? null,
      uptime_pct_24h: targetChecks.length ? Math.round((upCount / targetChecks.length) * 1000) / 10 : null,
    };
  });
  res.json(summary);
});

// Ringkasan traffic per target: total pageview, unique visitor (perkiraan),
// halaman terpopuler, breakdown referrer/device/negara, dalam N hari terakhir.
router.get("/traffic/summary", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  const { data: targets, error: targetsError } = await supabase
    .from("monitor_targets")
    .select("id, name")
    .not("url", "is", null);
  if (targetsError) return res.status(400).json({ error: targetsError.message });

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data: views, error: viewsError } = await supabase
    .from("monitor_pageviews")
    .select("target_id, path, referrer, device_type, country, visitor_hash, created_at")
    .gte("created_at", since);
  if (viewsError) return res.status(400).json({ error: viewsError.message });

  function topEntries(rows, key, limit = 5) {
    const counts = new Map();
    for (const r of rows) {
      const k = r[key] || "(langsung/tidak diketahui)";
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));
  }

  const summary = (targets || []).map((t) => {
    const rows = (views || []).filter((v) => v.target_id === t.id);
    return {
      target_id: t.id,
      name: t.name,
      pageviews: rows.length,
      unique_visitors: new Set(rows.map((r) => r.visitor_hash).filter(Boolean)).size,
      top_paths: topEntries(rows, "path"),
      top_referrers: topEntries(rows, "referrer"),
      device_breakdown: topEntries(rows, "device_type"),
      country_breakdown: topEntries(rows, "country"),
    };
  });
  res.json({ days, summary });
});

// Ringkasan keamanan per target: temuan open terbaru + jumlah per severity.
router.get("/security/summary", async (req, res) => {
  const { data: targets, error: targetsError } = await supabase
    .from("monitor_targets")
    .select("id, name, repo_full_name");
  if (targetsError) return res.status(400).json({ error: targetsError.message });

  const { data: findings, error: findingsError } = await supabase
    .from("monitor_security_findings")
    .select("target_id, owasp_category, severity, summary, file_ref, status, checked_at")
    .eq("status", "open")
    .order("checked_at", { ascending: false });
  if (findingsError) return res.status(400).json({ error: findingsError.message });

  const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
  const summary = (targets || []).map((t) => {
    const targetFindings = (findings || []).filter((f) => f.target_id === t.id);
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of targetFindings) counts[f.severity] = (counts[f.severity] || 0) + 1;
    const worst = targetFindings.reduce(
      (acc, f) => (severityRank[f.severity] > severityRank[acc || "low"] ? f.severity : acc),
      null,
    );
    return {
      target_id: t.id,
      name: t.name,
      repo_full_name: t.repo_full_name,
      risk_level: worst || "low",
      counts,
      findings: targetFindings.slice(0, 20),
    };
  });
  res.json(summary);
});

// Endpoint ingest terpisah dari sesi login browser: dipakai oleh skrip audit
// terjadwal (Routine mingguan) untuk mendorong hasil temuan baru. Dilindungi
// oleh token statis (MONITOR_INGEST_TOKEN), bukan sesi owner, karena skrip
// itu jalan tanpa browser/cookie. requireOwner+requireMaster di atas tidak
// dilewati router ini — didaftarkan terpisah di server.js tanpa middleware
// itu, lihat catatan di server.js.
export const ingestRouter = express.Router();

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

ingestRouter.post("/security/ingest", async (req, res) => {
  const token = req.header("x-ingest-token");
  const expected = process.env.MONITOR_INGEST_TOKEN;
  if (!expected) return res.status(503).json({ error: "MONITOR_INGEST_TOKEN belum dikonfigurasi di server" });
  if (!timingSafeEqual(token, expected)) return res.status(401).json({ error: "Token ingest tidak valid" });

  const { repo_full_name, findings } = req.body || {};
  if (typeof repo_full_name !== "string" || !Array.isArray(findings)) {
    return res.status(400).json({ error: "repo_full_name (string) dan findings (array) wajib diisi" });
  }

  const { data: target, error: targetError } = await supabase
    .from("monitor_targets")
    .select("id")
    .eq("repo_full_name", repo_full_name)
    .single();
  if (targetError || !target) return res.status(404).json({ error: `Target dengan repo_full_name '${repo_full_name}' tidak ditemukan` });

  // Tutup semua temuan open lama untuk target ini, lalu masukkan hasil audit
  // terbaru — supaya dashboard selalu mencerminkan hasil audit paling akhir,
  // bukan akumulasi temuan basi dari minggu-minggu sebelumnya.
  const { error: closeError } = await supabase
    .from("monitor_security_findings")
    .update({ status: "fixed" })
    .eq("target_id", target.id)
    .eq("status", "open");
  if (closeError) return res.status(400).json({ error: closeError.message });

  const rows = findings
    .filter((f) => f && typeof f.owasp_category === "string" && typeof f.summary === "string")
    .map((f) => ({
      target_id: target.id,
      owasp_category: f.owasp_category,
      severity: ["low", "medium", "high", "critical"].includes(f.severity) ? f.severity : "low",
      summary: f.summary,
      file_ref: typeof f.file_ref === "string" ? f.file_ref : null,
      status: "open",
    }));

  if (rows.length) {
    const { error: insertError } = await supabase.from("monitor_security_findings").insert(rows);
    if (insertError) return res.status(400).json({ error: insertError.message });
  }

  logger.info({ repo_full_name, count: rows.length }, "monitoring.security_ingested");
  res.json({ ok: true, ingested: rows.length });
});

// Ping traffic publik: dipanggil langsung dari browser pengunjung tiap 4 web
// yang dipasangi beacon (lihat public/pageview-beacon.js). Sengaja TANPA
// token — datang dari browser sembarang orang, bukan skrip tepercaya — jadi
// diperlakukan sebagai analytics best-effort (bisa dipalsukan pengunjung usil),
// bukan data yang sensitif/butuh integritas tinggi. Dibatasi rate-limit di
// server.js dan divalidasi terhadap daftar target yang memang terdaftar.
export const pageviewRouter = express.Router();

const DEVICE_PATTERNS = [
  { type: "tablet", re: /iPad|Tablet|Nexus 7|Nexus 10/i },
  { type: "mobile", re: /Mobi|Android|iPhone|iPod|Windows Phone/i },
];

function detectDeviceType(userAgent) {
  const ua = String(userAgent || "");
  for (const { type, re } of DEVICE_PATTERNS) if (re.test(ua)) return type;
  return ua ? "desktop" : "unknown";
}

function hashVisitor(ip, userAgent) {
  // Salt harian: cukup untuk hitung "unique visitor per hari" tanpa
  // menyimpan IP mentah atau bisa dilacak lintas hari.
  const daySalt = new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(`${daySalt}|${ip}|${userAgent}`).digest("hex").slice(0, 32);
}

pageviewRouter.post("/pageview", async (req, res) => {
  const { site, path, referrer } = req.body || {};
  if (typeof site !== "string" || !site.trim()) return res.status(400).json({ error: "site wajib diisi" });
  if (typeof path !== "string" || path.length > 500) return res.status(400).json({ error: "path tidak valid" });

  const { data: target, error: targetError } = await supabase
    .from("monitor_targets")
    .select("id")
    .eq("name", site.trim())
    .maybeSingle();
  if (targetError) return res.status(400).json({ error: targetError.message });
  if (!target) return res.status(404).json({ error: `Target '${site}' tidak terdaftar` });

  const ip = req.ip || req.socket?.remoteAddress || "";
  const userAgent = req.header("user-agent") || "";
  const country = req.header("cf-ipcountry") || req.header("x-vercel-ip-country") || null;

  const { error: insertError } = await supabase.from("monitor_pageviews").insert({
    target_id: target.id,
    path: path.slice(0, 500),
    referrer: typeof referrer === "string" ? referrer.slice(0, 500) : null,
    device_type: detectDeviceType(userAgent),
    country,
    visitor_hash: hashVisitor(ip, userAgent),
  });
  if (insertError) return res.status(400).json({ error: insertError.message });

  res.status(204).end();
});
