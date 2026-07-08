// Provider default ("AI Biasa/Cepat" di dropdown Pengaturan): Google Gemini
// (API key dari Google AI Studio, gratis dengan kuota harian). Kalau kuota
// harian Gemini habis (429 RESOURCE_EXHAUSTED), otomatis lanjut ke model
// OpenRouter termurah (Gemini Flash lewat OpenRouter) supaya audit tidak
// berhenti total di tengah hari — selama OPENROUTER_API_KEY juga diisi.
// Nama file/fungsi tetap "scraper" (bukan diganti) supaya nilai ai_provider
// di database & dropdown Pengaturan tidak perlu diubah.

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || "google/gemini-2.0-flash-001";
const TIMEOUT_MS = 20000;

function withTimeout(signalController) {
  return setTimeout(() => signalController.abort(), TIMEOUT_MS);
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY belum diisi di .env");

  const controller = new AbortController();
  const timer = withTimeout(controller);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`Gemini API gagal merespon (${res.status}): ${detail.slice(0, 200)}`);
      err.status = res.status;
      // Gemini balas 429 kalau kuota harian/rate-limit habis — ini sinyal
      // untuk pindah ke fallback, bukan sekadar error jaringan biasa.
      err.quotaExceeded = res.status === 429;
      throw err;
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } finally {
    clearTimeout(timer);
  }
}

// Fallback berbayar murah lewat OpenRouter — hanya dipakai kalau Gemini
// gratis benar-benar habis kuotanya, bukan pengganti utama.
async function callOpenRouterFallback(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Kuota Gemini habis dan OPENROUTER_API_KEY belum diisi untuk fallback");

  const controller = new AbortController();
  const timer = withTimeout(controller);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: FALLBACK_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenRouter fallback gagal merespon (${res.status}): ${detail.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

export async function complete(prompt) {
  try {
    return await callGemini(prompt);
  } catch (err) {
    if (!err.quotaExceeded) throw err;
    return callOpenRouterFallback(prompt);
  }
}
