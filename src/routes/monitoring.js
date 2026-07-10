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
  const { is_active, url, name } = req.body || {};
  const patch = {};
  if (typeof is_active === "boolean") patch.is_active = is_active;
  if (typeof url === "string" && /^https?:\/\//.test(url)) patch.url = url.trim();
  if (typeof name === "string" && name.trim()) patch.name = name.trim();
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
