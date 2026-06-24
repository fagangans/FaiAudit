import path from "node:path";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import { supabase } from "../supabase.js";

/**
 * Passive WhatsApp audit logger.
 * Unlike a chatbot, this connector never sends replies — it only
 * observes messages on an existing staff/sales number and stores
 * them so the AI analysis module can audit conversations later.
 */

const activeSessions = new Map(); // staffId -> socket

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
  if (error) console.error("[FaiAudit] gagal menyimpan pesan:", error.message);
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

export async function startStaffSession({ staffId, ownerId, phoneNumber, onPairingCode, onStatus }) {
  const sessionDir = path.resolve(process.cwd(), "wa-sessions", staffId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  activeSessions.set(staffId, sock);
  sock.ev.on("creds.update", saveCreds);

  if (!sock.authState.creds.registered && phoneNumber) {
    const code = await sock.requestPairingCode(phoneNumber.trim());
    onPairingCode?.(code);
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "open") {
      onStatus?.("connected");
      await supabase.from("staff").update({ wa_session_status: "connected" }).eq("id", staffId);
    }
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      onStatus?.(shouldReconnect ? "reconnecting" : "disconnected");
      await supabase
        .from("staff")
        .update({ wa_session_status: shouldReconnect ? "reconnecting" : "disconnected" })
        .eq("id", staffId);
      if (shouldReconnect) {
        startStaffSession({ staffId, ownerId, phoneNumber: null, onPairingCode, onStatus });
      }
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
        console.error("[FaiAudit] gagal mencatat pesan audit:", err.message);
      }
    }
  });

  return sock;
}

export function stopStaffSession(staffId) {
  const sock = activeSessions.get(staffId);
  if (sock) {
    sock.end(undefined);
    activeSessions.delete(staffId);
  }
}
