import { supabase } from "../supabase.js";
import { buildDailyReportData, yesterdayRangeWIB, wibDateKey } from "../reports/dailyReportData.js";
import { buildDailyReportPdfBuffer } from "../reports/pdfBuilder.js";
import { sendOwnerDocument } from "../whatsapp/connector.js";
import { logger } from "../logger.js";

// Sekali per owner per hari (WIB), dicek tiap siklus pendek supaya jam
// kirim cukup presisi tanpa perlu pg_cron — pola sama dengan
// reminderScheduler.js. Reset in-memory saat restart (boleh kirim ulang
// hari itu, bukan masalah besar dibanding kompleksitas tabel/kolom baru).
const lastSentDateByOwner = new Map(); // ownerId -> "YYYY-MM-DD" (WIB)
const CHECK_INTERVAL_MS = Number(process.env.DAILY_REPORT_CHECK_INTERVAL_MS) || 15 * 60 * 1000; // 15 menit
const TARGET_HOUR_WIB = Number(process.env.DAILY_REPORT_HOUR_WIB) || 8; // jam 08:00 WIB

let timer = null;

function currentHourWIB(now = new Date()) {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCHours();
}

async function runOnce() {
  const now = new Date();
  if (currentHourWIB(now) !== TARGET_HOUR_WIB) return;

  const todayKeyWIB = wibDateKey(now);
  const range = yesterdayRangeWIB(now);

  const { data: owners, error } = await supabase
    .from("owners")
    .select("id, business_name, notify_wa_number")
    .not("notify_wa_number", "is", null);
  if (error) {
    logger.error({ err: error.message }, "laporan harian: gagal memuat owner");
    return;
  }

  for (const owner of owners || []) {
    if (lastSentDateByOwner.get(owner.id) === todayKeyWIB) continue;

    try {
      const data = await buildDailyReportData(owner.id, owner.business_name, range);
      const buffer = await buildDailyReportPdfBuffer(data);
      const sent = await sendOwnerDocument(
        owner.id,
        owner.notify_wa_number,
        buffer,
        `FaiAudit-Laporan-Kemarin-${data.dateLabel}.pdf`,
        `*FaiAudit — Laporan Harian (${data.dateLabel})*\n${data.summary.activeLeadCount} lead aktif kemarin, ${data.summary.highRiskCount} lead berisiko tinggi saat ini. Buka file PDF terlampir: ringkasan + diagram + transkrip chat lengkap tiap lead (klik link di bagian "Detail Lead Aktif" untuk lompat ke transkripnya).`,
      );
      if (sent) {
        lastSentDateByOwner.set(owner.id, todayKeyWIB);
        logger.info({ ownerId: owner.id }, "laporan harian PDF terkirim via WA");
      }
    } catch (err) {
      logger.error({ ownerId: owner.id, err: err.message }, "laporan harian: gagal membuat/mengirim PDF");
    }
  }
}

export function startDailyReportScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => logger.error({ err: err.message }, "daily report scheduler: error tidak tertangani"));
  }, CHECK_INTERVAL_MS);
  logger.info({ targetHourWIB: TARGET_HOUR_WIB }, "laporan harian otomatis (WA PDF) aktif");
}

export function stopDailyReportScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
