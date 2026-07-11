#!/usr/bin/env node
// Self-service OWASP-lite audit: jalan di dalam repo target sendiri (lewat
// GitHub Actions terjadwal), lalu kirim hasilnya ke dashboard Monitoring
// FaiAudit. Tidak butuh akses dari FaiAudit ke repo ini — sebaliknya, repo
// ini yang aktif "lapor diri sendiri" tiap minggu.
//
// Env var wajib:
//   MONITOR_INGEST_URL    contoh: https://audit.faiagent.my.id/api/monitoring-ingest/security/ingest
//   MONITOR_INGEST_TOKEN  token sama dengan MONITOR_INGEST_TOKEN di .env FaiAudit
//   MONITOR_REPO_FULL_NAME contoh: fagangans/FaiSearch (harus SAMA PERSIS dengan
//                          kolom "Repo GitHub" di halaman Kelola Target FaiAudit)

import { execSync } from "node:child_process";
import fs from "node:fs";

const INGEST_URL = process.env.MONITOR_INGEST_URL;
const INGEST_TOKEN = process.env.MONITOR_INGEST_TOKEN;
const REPO_FULL_NAME = process.env.MONITOR_REPO_FULL_NAME;

if (!INGEST_URL || !INGEST_TOKEN || !REPO_FULL_NAME) {
  console.error(
    "Env var wajib belum lengkap: MONITOR_INGEST_URL, MONITOR_INGEST_TOKEN, MONITOR_REPO_FULL_NAME",
  );
  process.exit(1);
}

const findings = [];

function addFinding(owasp_category, severity, summary, file_ref) {
  findings.push({ owasp_category, severity, summary, file_ref: file_ref || null });
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (err) {
    // Banyak tool (npm audit, grep) keluar dengan exit code non-zero saat
    // MENEMUKAN sesuatu (itu justru hasil yang kita mau baca), bukan gagal.
    return err.stdout?.toString() || "";
  }
}

// ---- A06: dependency vulnerabilities lewat npm audit ----
if (fs.existsSync("package.json")) {
  const raw = safeExec("npm audit --json 2>/dev/null");
  try {
    const report = JSON.parse(raw || "{}");
    const vulns = report.vulnerabilities || {};
    for (const [pkg, info] of Object.entries(vulns)) {
      if (info.severity === "high" || info.severity === "critical") {
        addFinding(
          "A06:2021 Vulnerable and Outdated Components",
          info.severity === "critical" ? "critical" : "high",
          `Dependency "${pkg}" punya kerentanan level ${info.severity} (npm audit) — jalankan "npm audit fix" atau upgrade manual.`,
          "package.json",
        );
      }
    }
  } catch {
    // npm audit tidak mengembalikan JSON valid (mis. tidak ada lockfile) — lewati diam-diam, bukan kegagalan fatal.
  }
}

// ---- A02/A05: pola secret/kredensial hardcoded di source yang di-track git ----
const trackedFiles = safeExec("git ls-files")
  .split("\n")
  .filter((f) => f && /\.(js|ts|jsx|tsx|mjs|cjs|json|env)$/.test(f) && !f.includes("node_modules"));

const secretPatterns = [
  { re: /sk-[a-zA-Z0-9]{16,}/, label: "kemiripan OpenAI/Anthropic-style API key" },
  { re: /AKIA[0-9A-Z]{16}/, label: "kemiripan AWS Access Key ID" },
  { re: /ghp_[a-zA-Z0-9]{30,}/, label: "kemiripan GitHub Personal Access Token" },
  { re: /xox[baprs]-[a-zA-Z0-9-]{10,}/, label: "kemiripan Slack token" },
  { re: /password\s*[:=]\s*["'][^"'\s]{4,}["']/i, label: "password ter-hardcode di source" },
];

for (const file of trackedFiles.slice(0, 500)) {
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { re, label } of secretPatterns) {
    if (re.test(content)) {
      addFinding("A02:2021 Cryptographic Failures", "high", `Ditemukan ${label} di source yang ter-commit.`, file);
      break;
    }
  }
}

// ---- A05: CORS wildcard ----
for (const file of trackedFiles.slice(0, 500)) {
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (/app\.use\(\s*cors\(\)\s*\)/.test(content) || /Access-Control-Allow-Origin['"]?\s*,\s*['"]\*/.test(content)) {
    addFinding("A05:2021 Security Misconfiguration", "medium", "CORS terbuka untuk semua origin (wildcard) tanpa allowlist.", file);
  }
}

// ---- A05: .env ter-commit ----
const envTracked = safeExec("git ls-files")
  .split("\n")
  .filter((f) => /(^|\/)\.env(\.[a-z]+)?$/.test(f) && !f.endsWith(".env.example"));
for (const f of envTracked) {
  addFinding("A05:2021 Security Misconfiguration", "critical", "File .env ter-commit ke git (kemungkinan bocor secret asli).", f);
}

// ---- A03: eval/new Function ----
for (const file of trackedFiles.slice(0, 500)) {
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (/\beval\s*\(/.test(content) || /new\s+Function\s*\(/.test(content)) {
    addFinding("A03:2021 Injection", "medium", "Penggunaan eval()/new Function() — risiko code injection kalau input tidak dikontrol ketat.", file);
  }
}

console.log(`Ditemukan ${findings.length} temuan untuk ${REPO_FULL_NAME}.`);
findings.forEach((f) => console.log(`  [${f.severity}] ${f.owasp_category} — ${f.summary} (${f.file_ref || "-"})`));

const res = await fetch(INGEST_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-ingest-token": INGEST_TOKEN },
  body: JSON.stringify({ repo_full_name: REPO_FULL_NAME, findings }),
});

if (!res.ok) {
  console.error(`Gagal kirim ke dashboard: HTTP ${res.status} — ${await res.text()}`);
  process.exit(1);
}
console.log("Berhasil dikirim ke dashboard Monitoring FaiAudit.");
