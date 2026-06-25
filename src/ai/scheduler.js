import { supabase } from "../supabase.js";
import { analyzeLead } from "./analyze.js";
import { logger } from "../logger.js";

// Trade-off: setInterval polling vs pg_cron/queue. Dipilih setInterval karena
// deployment ini single-process (PM2 fork mode, bukan cluster) — tidak ada
// risiko duplikasi job antar-instance, dan tidak perlu infra tambahan
// (pg_cron extension, job table). Kalau nanti FaiAudit di-scale jadi banyak
// instance, pindahkan ke pg_cron + advisory lock supaya tidak dobel proses.
const INTERVAL_MS = Number(process.env.AUTO_ANALYZE_INTERVAL_MS) || 5 * 60 * 1000; // 5 menit
const BATCH_SIZE = Number(process.env.AUTO_ANALYZE_BATCH_SIZE) || 10;

let timer = null;

async function findLeadsNeedingAnalysis() {
  const { data, error } = await supabase
    .from("leads")
    .select("id, last_message_at, lead_audits(analyzed_at)")
    .not("last_message_at", "is", null)
    .limit(200);
  if (error) {
    logger.error({ err: error.message }, "gagal memuat lead untuk auto-analyze");
    return [];
  }

  return data
    .filter((lead) => !lead.lead_audits?.analyzed_at || lead.lead_audits.analyzed_at < lead.last_message_at)
    .slice(0, BATCH_SIZE);
}

async function runOnce() {
  const leads = await findLeadsNeedingAnalysis();
  if (!leads.length) return;

  logger.info({ count: leads.length }, "auto-analyze: memproses lead dengan chat baru");
  for (const lead of leads) {
    try {
      await analyzeLead(lead.id);
    } catch (err) {
      logger.error({ leadId: lead.id, err: err.message }, "auto-analyze gagal untuk satu lead, lanjut ke berikutnya");
    }
  }
}

// Memastikan audit funnel/skor selalu terbarui otomatis tanpa harus diklik
// manual — ini bagian inti dari nilai jual "automasi audit", bukan cuma
// alat analisis manual.
export function startAutoAnalyzeScheduler() {
  if (timer) return;
  if (!process.env.OPENROUTER_API_KEY && (process.env.AI_PROVIDER || "scraper") === "qwen") {
    logger.warn("auto-analyze: AI_PROVIDER=qwen tapi OPENROUTER_API_KEY belum diisi, scheduler tetap jalan tapi setiap batch akan gagal");
  }
  timer = setInterval(() => {
    runOnce().catch((err) => logger.error({ err: err.message }, "auto-analyze: error tidak tertangani"));
  }, INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS, batchSize: BATCH_SIZE }, "auto-analyze scheduler aktif");
}

export function stopAutoAnalyzeScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
