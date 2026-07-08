// Provider gratis: pakai endpoint scraper Ai4Chat yang sama dengan
// repo AiwhatsappbussinesFaganFaAl. Kualitas/stabilitas tidak terjamin,
// cocok untuk uji coba sebelum pindah ke provider berbayar (Qwen, dst).

const TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 2;

async function callOnce(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://ai4chat.co/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: prompt }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Scraper AI gagal merespon: ${res.status}`);
    const data = await res.json();
    return data.message || data.result || data.text || "";
  } finally {
    clearTimeout(timer);
  }
}

// Provider gratis ini kadang gagal sesaat (timeout jaringan/HTML error page)
// lalu normal lagi di percobaan berikutnya — retry sekali sebelum menyerah
// supaya kedipan jaringan singkat tidak langsung menggagalkan analisis.
export async function complete(prompt) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callOnce(prompt);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
