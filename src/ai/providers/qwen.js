// Provider berbayar (rekomendasi untuk produksi): Qwen lewat OpenRouter
// (API key berformat sk-or-v1-... adalah OpenRouter, bukan Dashscope langsung).
// Aktifkan dengan set AI_PROVIDER=qwen dan OPENROUTER_API_KEY di .env.

export async function complete(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY belum diisi di .env");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.QWEN_MODEL || "qwen/qwen-2.5-72b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter API gagal merespon (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}
