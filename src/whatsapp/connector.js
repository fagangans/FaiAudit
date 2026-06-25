import path from "node:path";
import makeWASocket, {
  useMultiFileAuthState,
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

const activeSessions = new Map(); // staffId -> socket
const retryState = new Map(); // staffId -> { attempt, timer }
// Artefak pairing terbaru per staff supaya endpoint /pair-status bisa
// mengirim QR yang ter-refresh & status terkini ke dashboard tanpa membuka
// soket baru tiap polling.
const pairingState = new Map(); // staffId -> { method, qr, code, status }

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
}) {
  clearRetry(staffId);
  const sessionDir = path.resolve(process.cwd(), "wa-sessions", staffId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  activeSessions.set(staffId, sock);
  sock.ev.on("creds.update", saveCreds);

  // Metode "code": minta pairing code via nomor telepon (tanpa QR).
  // Metode "qr" (default): jangan minta code, biarkan Baileys memancarkan
  // string QR lewat connection.update di bawah, lalu kita render jadi gambar.
  if (!sock.authState.creds.registered && method === "code" && phoneNumber) {
    const code = await sock.requestPairingCode(phoneNumber.trim());
    pairingState.set(staffId, { method: "code", code, qr: null, status: "pairing" });
    onPairingCode?.(code);
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

      const timer = setTimeout(() => {
        startStaffSession({ staffId, ownerId, phoneNumber: null, onPairingCode, onStatus }).catch((err) =>
          logger.error({ staffId, err: err.message }, "gagal reconnect sesi WA"),
        );
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
