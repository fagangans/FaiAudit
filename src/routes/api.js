import express from "express";
import { supabase } from "../supabase.js";
import { startStaffSession, stopStaffSession } from "../whatsapp/connector.js";
import { analyzeLead } from "../ai/analyze.js";
import { requireOwner } from "../middleware/requireOwner.js";

export const router = express.Router();

const WA_NUMBER_RE = /^[1-9][0-9]{7,14}$/; // format internasional tanpa "+", mis. 62xxxxxxxxxx

router.get("/me", requireOwner, (req, res) => {
  res.json({
    name: req.owner.name,
    business_name: req.owner.business_name,
    is_master: req.owner.is_master,
  });
});

router.post("/staff", requireOwner, async (req, res) => {
  const { name, wa_number } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name wajib diisi" });
  }
  if (!WA_NUMBER_RE.test(wa_number || "")) {
    return res.status(400).json({ error: "wa_number harus format internasional tanpa '+', contoh 62812xxxxxxx" });
  }

  const { data: staff, error } = await supabase
    .from("staff")
    .insert({ owner_id: req.ownerId, name: name.trim(), wa_number, wa_session_status: "pairing" })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  try {
    let pairingCode = null;
    await startStaffSession({
      staffId: staff.id,
      ownerId: req.ownerId,
      phoneNumber: wa_number,
      onPairingCode: (code) => {
        pairingCode = code;
      },
    });
    res.json({ ...staff, pairing_code: pairingCode });
  } catch (err) {
    res.status(500).json({ error: `Gagal memulai sesi WhatsApp: ${err.message}` });
  }
});

router.delete("/staff/:id", requireOwner, async (req, res) => {
  const { data: staff, error: findError } = await supabase
    .from("staff")
    .select("id")
    .eq("id", req.params.id)
    .eq("owner_id", req.ownerId)
    .single();
  if (findError || !staff) return res.status(404).json({ error: "Staff tidak ditemukan" });

  stopStaffSession(staff.id);
  const { error } = await supabase.from("staff").delete().eq("id", staff.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// Tabel utama dashboard: satu baris per lead, gabungan staff + hasil audit AI.
router.get("/dashboard", requireOwner, async (req, res) => {
  const { data, error } = await supabase
    .from("leads")
    .select(
      `id, name, wa_jid, created_at,
       staff:staff_id ( id, name, wa_number, wa_session_status ),
       lead_audits ( funnel_stage, previous_stage, score, analysis_notes, evaluation, analyzed_at )`,
    )
    .eq("owner_id", req.ownerId)
    .order("created_at", { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  const rows = data.map((lead) => ({
    lead_id: lead.id,
    lead_name: lead.name || lead.wa_jid,
    staff_name: lead.staff?.name,
    wa_status: lead.staff?.wa_session_status,
    funnel_stage: lead.lead_audits?.funnel_stage || "new",
    previous_stage: lead.lead_audits?.previous_stage || "-",
    score: lead.lead_audits?.score ?? "-",
    analysis_notes: lead.lead_audits?.analysis_notes || "-",
    evaluation: lead.lead_audits?.evaluation || "-",
    analyzed_at: lead.lead_audits?.analyzed_at || null,
  }));

  res.json(rows);
});

router.post("/leads/:id/analyze", requireOwner, async (req, res) => {
  const { data: lead, error: findError } = await supabase
    .from("leads")
    .select("id")
    .eq("id", req.params.id)
    .eq("owner_id", req.ownerId)
    .single();
  if (findError || !lead) return res.status(404).json({ error: "Lead tidak ditemukan" });

  try {
    const result = await analyzeLead(lead.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
