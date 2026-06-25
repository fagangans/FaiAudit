import { supabase } from "../supabase.js";
import { computeLeadRisk, FUNNEL_STAGES } from "../ai/analyze.js";

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000; // WIB tetap UTC+7, tanpa DST — cukup untuk kebutuhan Indonesia

// Tanggal hari ini dalam WIB, dipakai scheduler sebagai key throttle "1x/hari".
export function wibDateKey(now = new Date()) {
  return new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

// Rentang satu hari WIB (daysAgo: 0 = hari ini, 1 = kemarin), dinyatakan
// sebagai batas UTC absolut supaya query Supabase (timestamptz) tetap benar
// terlepas timezone server.
function dayRangeWIB(now, daysAgo, periodLabel) {
  const wibNow = new Date(now.getTime() + WIB_OFFSET_MS);
  const target = new Date(wibNow);
  target.setUTCDate(target.getUTCDate() - daysAgo);
  const key = target.toISOString().slice(0, 10);
  return {
    label: key,
    periodLabel,
    start: new Date(`${key}T00:00:00.000+07:00`),
    end: new Date(`${key}T23:59:59.999+07:00`),
  };
}

// Rentang "hari ini" (WIB) — dipakai endpoint download manual di dashboard.
export function todayRangeWIB(now = new Date()) {
  return dayRangeWIB(now, 0, "Hari Ini");
}

// Rentang "kemarin" (WIB) — dipakai scheduler WA otomatis pagi (laporan
// kemarin baru lengkap setelah hari itu selesai).
export function yesterdayRangeWIB(now = new Date()) {
  return dayRangeWIB(now, 1, "Kemarin");
}

// Bentuk data laporan: snapshot funnel/risiko saat ini + detail lead yang
// punya chat di rentang tanggal `range`, lengkap dengan SELURUH pesan chat
// di rentang itu (bukan dipotong) — dipakai bersama oleh endpoint download
// manual (hari ini) dan scheduler WA otomatis pagi (kemarin). Pemanggil
// wajib menentukan `range` (todayRangeWIB / yesterdayRangeWIB) supaya jelas
// periode mana yang sedang dibangun.
export async function buildDailyReportData(ownerId, businessName, range) {
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
  let periodMessages = [];
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
    periodMessages = data || [];
  }

  const messagesByLead = new Map();
  for (const m of periodMessages) {
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
      // Seluruh chat di rentang tanggal ini, bukan dipotong, agar laporan
      // benar-benar lengkap sesuai isi percakapan asli.
      exampleMessages: msgs,
    });
  }
  activeLeads.sort((a, b) => (b.risk?.level === "tinggi" ? 1 : 0) - (a.risk?.level === "tinggi" ? 1 : 0));

  return {
    businessName,
    dateLabel: range.label,
    periodLabel: range.periodLabel || "Periode",
    summary: { activeLeadCount: activeLeads.length, highRiskCount, stageCounts },
    leads: activeLeads,
  };
}
