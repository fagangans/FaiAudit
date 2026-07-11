import sodium from "libsodium-wrappers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GITHUB_API = "https://api.github.com";

function ghHeaders() {
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_PAT belum dikonfigurasi di server FaiAudit");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...ghHeaders(), ...(options.headers || {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} ${url}: ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// Encrypt a secret value with the repo's Actions public key (libsodium sealed
// box) — this is GitHub's required scheme for setting secrets via API; the
// value is never sent in plaintext.
async function encryptSecret(publicKeyBase64, value) {
  await sodium.ready;
  const keyBytes = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const messageBytes = sodium.from_string(value);
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}

async function setRepoSecret(owner, repo, secretName, secretValue) {
  const { key, key_id } = await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/secrets/public-key`);
  const encrypted_value = await encryptSecret(key, secretValue);
  await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/secrets/${secretName}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ encrypted_value, key_id }),
  });
}

async function putFile(owner, repo, filePath, content, message) {
  let sha;
  try {
    const existing = await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`);
    sha = existing?.sha;
  } catch {
    // File belum ada — wajar untuk pemasangan pertama kali, buat baru tanpa sha.
  }
  await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${filePath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha,
    }),
  });
}

// Memasang self-audit-kit ke repo target lewat GitHub API (file + secrets),
// tanpa perlu clone/akses filesystem repo itu dari sini.
export async function activateSelfAudit(repoFullName, ingestUrl, ingestToken) {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new Error(`repo_full_name tidak valid: "${repoFullName}" (harus format owner/repo)`);

  const scriptContent = fs.readFileSync(path.join(__dirname, "..", "..", "self-audit-kit", "audit-and-report.mjs"), "utf8");
  const workflowContent = fs.readFileSync(path.join(__dirname, "..", "..", "self-audit-kit", "security-audit.yml"), "utf8");

  await setRepoSecret(owner, repo, "MONITOR_INGEST_URL", ingestUrl);
  await setRepoSecret(owner, repo, "MONITOR_INGEST_TOKEN", ingestToken);
  await putFile(owner, repo, "self-audit-kit/audit-and-report.mjs", scriptContent, "Add self-service weekly OWASP self-audit script (via FaiAudit)");
  await putFile(owner, repo, ".github/workflows/security-audit.yml", workflowContent, "Add self-service weekly OWASP self-audit workflow (via FaiAudit)");
}
