import { supabase } from "../supabase.js";
import { logger } from "../logger.js";

// Timeout pendek: satu target yang lambat/mati tidak boleh menahan seluruh
// siklus pengecekan target lain.
const CHECK_TIMEOUT_MS = 10_000;
const INTERVAL_MS = Number(process.env.UPTIME_CHECK_INTERVAL_MS) || 5 * 60 * 1000; // 5 menit

async function checkOne(target) {
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    const res = await fetch(target.url, { method: "GET", redirect: "follow", signal: controller.signal });
    clearTimeout(timer);
    return {
      target_id: target.id,
      is_up: res.status < 500,
      status_code: res.status,
      response_ms: Date.now() - startedAt,
      error: null,
    };
  } catch (err) {
    return {
      target_id: target.id,
      is_up: false,
      status_code: null,
      response_ms: Date.now() - startedAt,
      error: String(err?.message || err).slice(0, 500),
    };
  }
}

async function runCycle() {
  const { data: rows, error } = await supabase
    .from("monitor_targets")
    .select("id, name, url")
    .eq("is_active", true);
  if (error) {
    logger.error({ err: error.message }, "uptimeChecker: gagal memuat target");
    return;
  }
  const targets = (rows || []).filter((t) => !!t.url);
  if (!targets.length) return;

  const results = await Promise.all(targets.map(checkOne));
  const { error: insertError } = await supabase.from("monitor_uptime_checks").insert(results);
  if (insertError) {
    logger.error({ err: insertError.message }, "uptimeChecker: gagal menyimpan hasil");
    return;
  }
  const down = results.filter((r) => !r.is_up);
  if (down.length) {
    logger.warn({ down: down.map((d) => d.target_id) }, "uptimeChecker: ada target down");
  }
}

let timer = null;

export function startUptimeChecker() {
  if (timer) return;
  runCycle();
  timer = setInterval(runCycle, INTERVAL_MS);
}
