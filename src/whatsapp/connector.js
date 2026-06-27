import path from "node:path";
import fs from "node:fs/promises";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { supabase } from "../supabase.js";
import { logger } from "../logger.js";

/**
 * Passive WhatsApp audit logger.
 * Unlike a chatbot, this connector never sends replies — it only
 * observes messages on an existing staff/sales number and stores
 * them so the AI analysis module can audit conversations later.
 */

const waLogger = logger.child({ module: "baileys" });
waLogger.level = process.env.BAILEYS_LOG_LEVEL || "warn";

// Versi protokol WhatsApp Web ikut di-bundle di rilis Baileys dan jadi basi
// setiap kali WhatsApp memperbarui server mereka (rutin, di luar kendali
// kita). Soket yang dibuat dengan versi basi langsung ditolak server WA —
// koneksi ditutup SEBELUM QR/pairing code sempat terkirim. Inilah sumber
// "Connection Closed" & QR yang tak pernah muncul. Ambil versi terbaru sekali
// per proses lalu cache, supaya tidak fetch berulang tapi selalu valid.
let cachedVersion = null;
async function getWaVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    cachedVersion = version;
  } catch (err) {
    logger.warn({ err: err.message }, "gagal mengambil versi WA Web terbaru, pakai default Baileys");
    cachedVersion = undefined;
  }
  return cachedVersion;
}

const activeSessions = new Map(); // staffId -> socket
const retryState = new Map(); // staffId -> { attempt, timer }
// Artefak pairing terbaru per staff supaya endpoint /pair-status bisa
// mengirim QR yang ter-refresh & status terkini ke dashboard tanpa membuka
// soket baru tiap polling.
const pairingState = new Map(); // staffId -> { method, qr, code, status }
// Parameter sesi asli (method, callback) per staff — dipakai ulang saat
// auto-reconnect supaya method "code" & callback onQR/onPairingCode tidak
// hilang begitu retry pertama terjadi (lihat scheduleReconnect).
const sessionParams = new Map(); // staffId -> { method, phoneNumber, onPairingCode, onQR, onStatus }

export function getPairingState(staffId) {
  return pairingState.get(staffId) || null;
}

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 10; // after this, stop auto-retrying and mark as failed

function clearRetry(staffId) {
  const state = retryState.get(staffId);
  if (state?.timer) clearTimeout(state.timer);
  retryState.delete(staffId);
}

// Pesan mentah dari Baileys (mis. "Connection Closed") tidak informatif buat
// user dashboard. Terjemahkan ke bahasa yang jelas + actionable.
function friendlyConnectError(err) {
  const msg = String(err?.message || err || "");
  if (/connection closed/i.test(msg)) {
    return "Koneksi ke WhatsApp terputus saat memulai pairing. Sistem akan mencoba lagi otomatis — kalau masih gagal setelah beberapa kali, cek koneksi internet server atau coba ulang beberapa saat lagi.";
  }
  if (/timed ?out/i.test(msg)) {
    return "Permintaan ke WhatsApp tidak mendapat balasan (timeout). Coba ulangi pairing.";
  }
  return msg || "Gagal memulai pairing WhatsApp.";
}

async function upsertLead(staffId, ownerId, jid, name) {
  const { data, error } = await supabase
    .from("leads")
    .upsert(
      { staff_id: staffId, owner_id: ownerId, wa_jid: jid, name },
      { onConflict: "staff_id,wa_jid" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function logMessage(leadId, direction, body, waMessageId, sentAt) {
  const { error } = await supabase.from("messages").insert({
    lead_id: leadId,
    direction,
    body,
    wa_message_id: waMessageId,
    sent_at: sentAt,
  });
  if (error) logger.error({ err: error.message, leadId }, "gagal menyimpan pesan");
}

function extractText(message) {
  return (
    message?.message?.conversation ||
    message?.message?.extendedTextMessage?.text ||
    message?.message?.imageMessage?.caption ||
    message?.message?.videoMessage?.caption ||
    null
  );
}

export async function startStaffSession({
  staffId,
  ownerId,
  phoneNumber,
  method = "qr",
  onPairingCode,
  onQR,
  onStatus,
  // true hanya saat user secara eksplisit memulai/mengulang pairing lewat
  // dashboard (POST /staff, POST /staff/:id/pair) — BUKAN saat reconnect
  // otomatis (boot / auto-retry / endpoint /reconnect) yang harus tetap
  // memakai creds tersimpan apa adanya.
  fresh = false,
}) {
  clearRetry(staffId);
  sessionParams.set(staffId, { method, phoneNumber, onPairingCode, onQR, onStatus });

  const sessionDir = path.resolve(process.cwd(), "wa-sessions", staffId);

  // Percobaan pairing yang gagal sebelum perbaikan versi protokol bisa
  // menyisakan creds.json/file kunci yang setengah-jadi/korup di folder ini.
  // Soket yang dibuat di atas creds rusak gagal di tahap noise-handshake
  // (statusCode 401 "Connection Failure") berulang-ulang, tidak peduli versi
  // protokol sudah benar. Setiap kali user EKSPLISIT memulai pairing baru,
  // mulai dari nol: hapus folder sesi lama dulu.
  if (fresh) {
    await fs.rm(sessionDir, { recursive: true, force: true });
    logger.info({ staffId }, "menghapus sesi WA lama sebelum pairing baru");
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const version = await getWaVersion();

  // Server WhatsApp memvalidasi fingerprint browser secara berbeda untuk
  // tiap metode pairing. Untuk QR, fingerprint Linux/Ubuntu diterima normal.
  // Untuk flow "link with phone number" (kode pairing), fingerprint non-macOS
  // (termasuk Ubuntu/Chrome yang dipakai sebelumnya di sini untuk SEMUA
  // metode) sering ditolak/diam-diam timeout oleh server WA saat
  // requestPairingCode dipanggil — inilah sebabnya QR berhasil tapi kode
  // pairing selalu gagal. macOS Desktop adalah fingerprint paling stabil
  // untuk flow ini menurut pengalaman komunitas Baileys.
  const browserFingerprint =
    method === "code" ? Browsers.macOS("Desktop") : Browsers.ubuntu("Chrome");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    version,
    browser: browserFingerprint,
    logger: waLogger,
  });

  activeSessions.set(staffId, sock);
  sock.ev.on("creds.update", saveCreds);

  // Metode "code": minta pairing code via nomor telepon (tanpa QR).
  // Metode "qr" (default): jangan minta code, biarkan Baileys memancarkan
  // string QR lewat connection.update di bawah, lalu kita render jadi gambar.
  if (!sock.authState.creds.registered && method === "code" && phoneNumber) {
    try {
      const code = await sock.requestPairingCode(phoneNumber.trim());
      pairingState.set(staffId, { method: "code", code, qr: null, status: "pairing" });
      onPairingCode?.(code);
    } catch (err) {
      logger.error({ staffId, err: err.message }, "gagal meminta pairing code");
      pairingState.set(staffId, { method: "code", code: null, qr: null, status: "pairing" });
      throw new Error(friendlyConnectError(err));
    }
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR baru dari Baileys (di-refresh berkala). Render ke data URL PNG supaya
    // bisa langsung ditampilkan sebagai <img src="data:..."> di dashboard.
    if (qr && method === "qr") {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 264 });
        pairingState.set(staffId, { method: "qr", qr: dataUrl, code: null, status: "pairing" });
        onQR?.(dataUrl);
      } catch (err) {
        logger.error({ staffId, err: err.message }, "gagal membuat QR pairing");
      }
    }

    if (connection === "open") {
      clearRetry(staffId);
      pairingState.set(staffId, { method, qr: null, code: null, status: "connected" });
      onStatus?.("connected");
      await supabase.from("staff").update({ wa_session_status: "connected" }).eq("id", staffId);
    }
    if (connection === "close") {
      activeSessions.delete(staffId);
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      // Selalu catat alasan putus — sebelumnya hanya dicatat di cabang
      // loggedOut/max-attempts, jadi "Connection Closed" yang dialami user
      // tidak pernah terlihat di pm2 logs untuk didiagnosis.
      logger.warn(
        { staffId, statusCode, err: lastDisconnect?.error?.message },
        "sesi WA terputus",
      );

      if (loggedOut) {
        // Akun di-unlink dari WhatsApp (pairing dicabut manual) — jangan retry,
        // perlu pairing ulang oleh master/client lewat dashboard.
        clearRetry(staffId);
        onStatus?.("disconnected");
        await supabase.from("staff").update({ wa_session_status: "disconnected" }).eq("id", staffId);
        logger.warn({ staffId }, "sesi WA logged out, perlu pairing ulang");
        return;
      }

      const prev = retryState.get(staffId) || { attempt: 0 };
      const attempt = prev.attempt + 1;
      if (attempt > MAX_ATTEMPTS) {
        clearRetry(staffId);
        onStatus?.("disconnected");
        await supabase.from("staff").update({ wa_session_status: "disconnected" }).eq("id", staffId);
        logger.error({ staffId, attempt }, "sesi WA gagal reconnect setelah batas percobaan, berhenti otomatis");
        return;
      }

      // Exponential backoff dengan batas atas, supaya tidak membombardir WhatsApp
      // dan memicu rate-limit/blokir nomor saat koneksi tidak stabil.
      const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      onStatus?.("reconnecting");
      await supabase.from("staff").update({ wa_session_status: "reconnecting" }).eq("id", staffId);
      logger.warn({ staffId, attempt, delayMs: delay }, "sesi WA putus, reconnect terjadwal");

      // Pakai parameter sesi ASLI yang disimpan saat sesi ini dimulai, bukan
      // hanya sebagian field — sebelumnya `method` & `onQR` ikut hilang di
      // sini, jadi reconnect pertama kali diam-diam balik ke metode "qr" dan
      // berhenti memanggil onQR (artefak QR di pairingState tetap ke-update,
      // tapi konsistensi parameter tetap penting untuk method "code").
      const original = sessionParams.get(staffId) || {};
      const timer = setTimeout(() => {
        startStaffSession({
          staffId,
          ownerId,
          phoneNumber: null,
          method: original.method,
          onPairingCode: original.onPairingCode,
          onQR: original.onQR,
          onStatus: original.onStatus,
        }).catch((err) => logger.error({ staffId, err: err.message }, "gagal reconnect sesi WA"));
      }, delay);
      retryState.set(staffId, { attempt, timer });
    }
  });

  // Audit-only listener: capture and store, never reply.
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      const text = extractText(msg);
      if (!text || !msg.key?.remoteJid) continue;
      if (msg.key.remoteJid.endsWith("@g.us")) continue; // skip groups for now

      try {
        const leadId = await upsertLead(
          staffId,
          ownerId,
          msg.key.remoteJid,
          msg.pushName || null,
        );
        const direction = msg.key.fromMe ? "outbound" : "inbound";
        const sentAt = new Date((msg.messageTimestamp || Date.now() / 1000) * 1000).toISOString();
        await logMessage(leadId, direction, text, msg.key.id, sentAt);
      } catch (err) {
        logger.error({ staffId, err: err.message }, "gagal mencatat pesan audit");
      }
    }
  });

  return sock;
}

export function stopStaffSession(staffId) {
  clearRetry(staffId);
  const sock = activeSessions.get(staffId);
  if (sock) {
    sock.end(undefined);
    activeSessions.delete(staffId);
  }
}

// Cari satu sock staff milik owner yang sedang connected — dipakai bersama
// oleh pengiriman teks (reminder) dan dokumen (laporan harian) ke nomor
// pribadi owner, supaya tidak ada duplikasi pencarian sesi.
async function findConnectedOwnerSock(ownerId) {
  const { data: staffRows, error } = await supabase
    .from("staff")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("wa_session_status", "connected");
  if (error || !staffRows?.length) return null;
  for (const staff of staffRows) {
    const sock = activeSessions.get(staff.id);
    if (sock) return { sock, staffId: staff.id };
  }
  return null;
}

// Satu-satunya pengecualian terhadap "audit-only, tidak pernah balas":
// reminder lead berisiko tinggi dikirim ke NOMOR PRIBADI OWNER SENDIRI
// (bukan ke lead), lewat sesi staff milik owner itu yang sedang terhubung
// — tidak membuka sesi baru. Kalau owner tidak punya staff yang sedang
// connected, reminder otomatis dilewati (dicoba lagi di siklus berikutnya).
export async function sendOwnerNotification(ownerId, notifyWaNumber, text) {
  if (!notifyWaNumber) return false;
  const found = await findConnectedOwnerSock(ownerId);
  if (!found) return false;
  const jid = `${notifyWaNumber}@s.whatsapp.net`;
  try {
    await found.sock.sendMessage(jid, { text });
    return true;
  } catch (err) {
    logger.error({ ownerId, staffId: found.staffId, err: err.message }, "gagal mengirim reminder WA ke owner");
    return false;
  }
}

// Sama seperti sendOwnerNotification tapi untuk lampiran dokumen (laporan
// harian, PDF atau ZIP) — tetap hanya ke nomor pribadi owner, lewat sesi
// yang sudah terhubung, tidak pernah membuka sesi baru.
export async function sendOwnerDocument(ownerId, notifyWaNumber, buffer, fileName, caption, mimetype = "application/pdf") {
  if (!notifyWaNumber) return false;
  const found = await findConnectedOwnerSock(ownerId);
  if (!found) return false;
  const jid = `${notifyWaNumber}@s.whatsapp.net`;
  try {
    await found.sock.sendMessage(jid, {
      document: buffer,
      fileName,
      mimetype,
      caption,
    });
    return true;
  } catch (err) {
    logger.error({ ownerId, staffId: found.staffId, err: err.message }, "gagal mengirim laporan WA ke owner");
    return false;
  }
}

// Dipanggil sekali saat server start: sambungkan kembali semua staff yang
// sudah pernah pairing (creds tersimpan di wa-sessions/), supaya restart
// server/VPS tidak diam-diam menghentikan audit tanpa staff/owner sadar.
export async function reconnectAllStaffSessions() {
  const { data: staffRows, error } = await supabase
    .from("staff")
    .select("id, owner_id, wa_session_status")
    .neq("wa_session_status", "disconnected");
  if (error) {
    logger.error({ err: error.message }, "gagal memuat daftar staff untuk reconnect");
    return;
  }
  if (!staffRows?.length) return;

  logger.info({ count: staffRows.length }, "menyambungkan ulang sesi WA staff setelah restart");
  for (const staff of staffRows) {
    startStaffSession({ staffId: staff.id, ownerId: staff.owner_id, phoneNumber: null }).catch((err) =>
      logger.error({ staffId: staff.id, err: err.message }, "gagal menyambungkan ulang sesi WA saat boot"),
    );
  }
}
