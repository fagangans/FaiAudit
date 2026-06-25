import { supabase } from "../supabase.js";
import { computeLeadRisk, FUNNEL_STAGES } from "../ai/analyze.js";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // WIB tetap UTC+7, tanpa DST — cukup untuk kebutuhan Indonesia

// Tanggal "kemarin" dalam waktu WIB, dinyatakan sebagai batas UTC absolut
// supaya query Supabase (timestamptz) tetap benar terlepas timezone server.
export function yesterdayRangeWIB(now = new Date()) {
  const wibNow = new Date(now.getTime() + WIB_OFFSET_MS);
  const todayKey = wibNow.toISOString().slice(0, 10);
  const yesterday = new Date(wibNow);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const key = yesterday.toISOString().slice(0, 10);
  return {
    label: key,
    todayKeyWIB: todayKey,
    start: new Date(`${key}T00:00:00.000+07:00`),
    end: new Date(`${key}T23:59:59.999+07:00`),
  };
}

// Bentuk data laporan harian: snapshot funnel/risiko saat ini + detail lead
// yang punya chat kemarin lengkap dengan contoh pesan — dipakai bersama oleh
// endpoint download manual dan scheduler WA otomatis pagi.
export async function buildDailyReportData(ownerId, businessName, now = new Date()) {
  const range = yesterdayRangeWIB(now);

  const { data: allLeads, error } = await supabase
    .from("leads")
    .select(
      `id, name, wa_jid, last_message_at,
       staff:staff_id ( name ),
       lead_audits ( funnel_stage, score )`,
    )
    .eq("owner_id", ownerId);
  if (error) throw new Error(error.message);

  const stageCounts = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
  let highRiskCount = 0;
  for (const lead of allLeads || []) {
    const funnel_stage = lead.lead_audits?.funnel_stage || "new";
    stageCounts[funnel_stage] = (stageCounts[funnel_stage] || 0) + 1;
    const risk = computeLeadRisk({ funnel_stage, score: lead.lead_audits?.score, last_message_at: lead.last_message_at });
    if (risk.level === "tinggi") highRiskCount += 1;
  }

  const leadIds = (allLeads || []).map((l) => l.id);
  let yesterdayMessages = [];
  if (leadIds.length) {
    // messages tidak punya owner_id langsung — filter lewat lead_id milik
    // owner ini (sudah dimuat di atas), bukan query owner_id yang tidak ada.
    const { data, error: msgError } = await supabase
      .from("messages")
      .select("id, lead_id, direction, body, sent_at")
      .in("lead_id", leadIds)
      .gte("sent_at", range.start.toISOString())
      .lte("sent_at", range.end.toISOString())
      .order("sent_at", { ascending: true });
    if (msgError) throw new Error(msgError.message);
    yesterdayMessages = data || [];
  }

  const messagesByLead = new Map();
  for (const m of yesterdayMessages) {
    const list = messagesByLead.get(m.lead_id) || [];
    list.push(m);
    messagesByLead.set(m.lead_id, list);
  }

  const leadsById = new Map((allLeads || []).map((l) => [l.id, l]));
  const activeLeads = [];
  for (const [leadId, msgs] of messagesByLead) {
    const lead = leadsById.get(leadId);
    if (!lead) continue;
    const funnel_stage = lead.lead_audits?.funnel_stage || "new";
    activeLeads.push({
      lead_name: lead.name || lead.wa_jid,
      staff_name: lead.staff?.name,
      funnel_stage,
      score: lead.lead_audits?.score ?? null,
      risk: computeLeadRisk({ funnel_stage, score: lead.lead_audits?.score, last_message_at: lead.last_message_at }),
      exampleMessages: msgs.slice(0, 5),
    });
  }
  activeLeads.sort((a, b) => (b.risk?.level === "tinggi" ? 1 : 0) - (a.risk?.level === "tinggi" ? 1 : 0));

  return {
    businessName,
    dateLabel: range.label,
    summary: { activeLeadCount: activeLeads.length, highRiskCount, stageCounts },
    leads: activeLeads,
  };
}
