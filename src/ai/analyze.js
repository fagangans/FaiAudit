import { supabase } from "../supabase.js";
import * as scraperProvider from "./providers/scraper.js";
import * as qwenProvider from "./providers/qwen.js";

const providers = { scraper: scraperProvider, qwen: qwenProvider };

const FUNNEL_STAGES = [
  "new",
  "contacted",
  "interested",
  "negotiation",
  "closed_won",
  "closed_lost",
];

function buildPrompt(history, previousStage) {
  const transcript = history
    .map((m) => `${m.direction === "outbound" ? "Sales" : "Lead"}: ${m.body}`)
    .join("\n");

  return `Kamu adalah auditor performa sales. Baca transkrip chat WhatsApp berikut antara seorang sales dan calon pembeli (lead), lalu evaluasi.

Stage funnel sebelumnya: ${previousStage || "new"}
Pilihan stage funnel yang valid: ${FUNNEL_STAGES.join(", ")}

Transkrip:
${transcript}

Balas HANYA dalam format JSON tanpa teks lain, dengan struktur:
{"funnel_stage": "...", "score": 0-100, "analysis_notes": "ringkasan singkat pola komunikasi & objection handling", "evaluation": "rekomendasi konkret untuk sales agar performa meningkat"}`;
}

function parseResult(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Respon AI tidak mengandung JSON yang valid");
  const parsed = JSON.parse(match[0]);
  if (!FUNNEL_STAGES.includes(parsed.funnel_stage)) {
    parsed.funnel_stage = "new";
  }
  return parsed;
}

export async function analyzeLead(leadId) {
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, lead_audits(funnel_stage)")
    .eq("id", leadId)
    .single();
  if (leadError) throw leadError;

  const { data: history, error: historyError } = await supabase
    .from("messages")
    .select("direction, body, sent_at")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: true })
    .limit(200);
  if (historyError) throw historyError;
  if (!history?.length) throw new Error("Belum ada riwayat chat untuk lead ini");

  const previousStage = lead.lead_audits?.funnel_stage || "new";
  const provider = providers[process.env.AI_PROVIDER || "scraper"];
  const raw = await provider.complete(buildPrompt(history, previousStage));
  const result = parseResult(raw);

  const { error: upsertError } = await supabase.from("lead_audits").upsert(
    {
      lead_id: leadId,
      funnel_stage: result.funnel_stage,
      previous_stage: previousStage,
      score: result.score,
      analysis_notes: result.analysis_notes,
      evaluation: result.evaluation,
      ai_model: process.env.AI_PROVIDER || "scraper",
      analyzed_at: new Date().toISOString(),
    },
    { onConflict: "lead_id" },
  );
  if (upsertError) throw upsertError;

  return result;
}
