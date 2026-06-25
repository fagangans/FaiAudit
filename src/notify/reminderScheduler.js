import { supabase } from "../supabase.js";
import { computeLeadRisk } from "../ai/analyze.js";
import { sendOwnerNotification } from "../whatsapp/connector.js";
import { logger } from "../logger.js";

// Sekali per owner per hari, bukan tiap siklus — supaya tidak spam meski
// scheduler jalan tiap beberapa jam. Disimpan in-memory: cukup untuk
// deployment single-process ini, reset saat restart (boleh kirim ulang
// hari itu, bukan masalah besar dibanding kompleksitas tabel/kolom baru).
const lastSentDateByOwner = new Map(); // ownerId -> "YYYY-MM-DD"
const INTERVAL_MS = Number(process.env.RISK_REMINDER_INTERVAL_MS) || 60 * 60 * 1000; // 1 jam

let timer = null;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function findHighRiskByOwner() {
  const { data, error } = await supabase
    .from("leads")
    .select("id, name, wa_jid, owner_id, last_message_at, owner:owner_id!inner(notify_wa_number), lead_audits(funnel_stage, score)")
    .not("owner.notify_wa_number", "is", null);
  if (error) {
    logger.error({ err: error.message }, "reminder: gagal memuat lead");
    return new Map();
  }

  const byOwner = new Map();
  for (const lead of data || []) {
    if (!lead.owner?.notify_wa_number) continue;
    const risk = computeLeadRisk({
      funnel_stage: lead.lead_audits?.funnel_stage || "new",
      score: lead.lead_audits?.score,
      last_message_at: lead.last_message_at,
    });
    if (risk.level !== "tinggi") continue;
    const list = byOwner.get(lead.owner_id) || { notifyNumber: lead.owner.notify_wa_number, leads: [] };
    list.leads.push({ name: lead.name || lead.wa_jid, reason: risk.reason });
    byOwner.set(lead.owner_id, list);
  }
  return byOwner;
}

async function runOnce() {
  const byOwner = await findHighRiskByOwner();
  const today = todayKey();

  for (const [ownerId, { notifyNumber, leads }] of byOwner) {
    if (lastSentDateByOwner.get(ownerId) === today) continue;

    const lines = leads.slice(0, 10).map((l) => `- ${l.name}: ${l.reason}`);
    const text = `*FaiAudit — Reminder Lead Berisiko Tinggi*\n${leads.length} lead butuh tindak lanjut segera:\n${lines.join("\n")}\n\nBuka dashboard untuk detail lengkap.`;

    const sent = await sendOwnerNotification(ownerId, notifyNumber, text);
    if (sent) {
      lastSentDateByOwner.set(ownerId, today);
      logger.info({ ownerId, count: leads.length }, "reminder lead berisiko tinggi terkirim via WA");
    }
  }
}

export function startRiskReminderScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => logger.error({ err: err.message }, "reminder scheduler: error tidak tertangani"));
  }, INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS }, "reminder lead berisiko tinggi aktif");
}

export function stopRiskReminderScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
