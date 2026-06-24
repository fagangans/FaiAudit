// Provider berbayar (rekomendasi untuk produksi): Qwen via OpenAI-compatible API.
// Aktifkan dengan set AI_PROVIDER=qwen dan QWEN_API_KEY di .env.

export async function complete(prompt) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) throw new Error("QWEN_API_KEY belum diisi di .env");

  const res = await fetch("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.QWEN_MODEL || "qwen-3.5-flash",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`Qwen API gagal merespon: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}
