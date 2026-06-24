import express from "express";
import { supabase } from "../supabase.js";
import { startStaffSession, stopStaffSession } from "../whatsapp/connector.js";
import { analyzeLead } from "../ai/analyze.js";

export const router = express.Router();

// NOTE (MVP): owner diidentifikasi lewat header X-Owner-Id apa adanya.
// Sebelum dipakai produksi multi-tenant sungguhan, ganti dengan Supabase Auth
// (verifikasi JWT) supaya satu owner tidak bisa membaca data owner lain.
function requireOwner(req, res, next) {
  const ownerId = req.header("x-owner-id");
  if (!ownerId) return res.status(401).json({ error: "Header x-owner-id wajib diisi" });
  req.ownerId = ownerId;
  next();
}

router.post("/owners", async (req, res) => {
  const { name, business_name } = req.body;
  const { data, error } = await supabase
    .from("owners")
    .insert({ name, business_name })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post("/staff", requireOwner, async (req, res) => {
  const { name, wa_number } = req.body;
  if (!name || !wa_number) {
    return res.status(400).json({ error: "name dan wa_number wajib diisi" });
  }

  const { data: staff, error } = await supabase
    .from("staff")
    .insert({ owner_id: req.ownerId, name, wa_number, wa_session_status: "pairing" })
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
  stopStaffSession(req.params.id);
  const { error } = await supabase
    .from("staff")
    .delete()
    .eq("id", req.params.id)
    .eq("owner_id", req.ownerId);
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
  try {
    const result = await analyzeLead(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
