// Provider gratis: pakai endpoint scraper Ai4Chat yang sama dengan
// repo AiwhatsappbussinesFaganFaAl. Kualitas/stabilitas tidak terjamin,
// cocok untuk uji coba sebelum pindah ke provider berbayar (Qwen, dst).

export async function complete(prompt) {
  const res = await fetch("https://ai4chat.co/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: prompt }),
  });
  if (!res.ok) throw new Error(`Scraper AI gagal merespon: ${res.status}`);
  const data = await res.json();
  return data.message || data.result || data.text || "";
}
