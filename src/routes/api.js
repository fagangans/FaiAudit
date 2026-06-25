import express from "express";
import rateLimit from "express-rate-limit";
import { supabase, supabaseAuth } from "../supabase.js";
import { startStaffSession, stopStaffSession, getPairingState } from "../whatsapp/connector.js";
import { analyzeLead, computeLeadRisk, FUNNEL_STAGES } from "../ai/analyze.js";
import { requireOwner } from "../middleware/requireOwner.js";
import { buildLeadPdfBuffer } from "../reports/pdfBuilder.js";
import { buildDailyReportData, todayRangeWIB } from "../reports/dailyReportData.js";
import { buildDailyReportZipBuffer } from "../reports/dailyReportArchive.js";

export const router = express.Router();

const PAIR_TIMEOUT_MS = 15000;

// Mulai sesi WA lalu tunggu artefak pairing pertama (QR / kode) atau status
// "connected" muncul, supaya respons HTTP bisa langsung membawa sesuatu untuk
// ditampilkan. QR yang ter-refresh berikutnya diambil lewat /pair-status.
function beginPairing({ staffId, ownerId, phoneNumber, method }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ method, qr: null, pairing_code: null, ...payload });
    };
    const timer = setTimeout(() => finish({ pending: true }), PAIR_TIMEOUT_MS);

    startStaffSession({
      staffId,
      ownerId,
      phoneNumber,
      method,
      fresh: true,
      onQR: (qr) => finish({ qr }),
      onPairingCode: (code) => finish({ pairing_code: code }),
      onStatus: (status) => {
        if (status === "connected") finish({ connected: true });
      },
    }).catch((err) => finish({ error: err.message }));
  });
}

// Setiap panggilan AI provider berbayar per-token — batasi supaya klik
// berulang atau bug di frontend tidak membengkakkan tagihan OpenRouter.
// analyzeLead() sendiri juga skip kalau tidak ada chat baru, ini lapisan
// kedua untuk membatasi laju permintaan ke endpoint itu sendiri.
const analyzeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ownerId || req.ip,
});

const WA_NUMBER_RE = /^[1-9][0-9]{7,14}$/; // format internasional tanpa "+", mis. 62xxxxxxxxxx

router.get("/me", requireOwner, (req, res) => {
  res.json({
    name: req.owner.name,
    business_name: req.owner.business_name,
    is_master: req.owner.is_master,
    notify_wa_number: req.owner.notify_wa_number,
  });
});

// Nomor WA pribadi owner untuk reminder lead berisiko tinggi — diatur
// sendiri oleh tiap owner (bukan master), dikirim lewat sesi staff yang
// sedang terhubung lewat reminderScheduler.
router.patch("/me/notify-number", requireOwner, async (req, res) => {
  const { notify_wa_number } = req.body || {};
  if (notify_wa_number !== null && !WA_NUMBER_RE.test(notify_wa_number || "")) {
    return res.status(400).json({ error: "notify_wa_number harus format internasional tanpa '+', contoh 62812xxxxxxx (atau null untuk menonaktifkan)" });
  }

  const { error } = await supabase
    .from("owners")
    .update({ notify_wa_number })
    .eq("id", req.ownerId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, notify_wa_number });
});

// Ganti password sendiri (master & client) — wajib ada karena password
// dibuat otomatis dan dilihat-sekali; tanpa ini satu-satunya jalan ganti
// password adalah lewat Supabase dashboard manual.
router.post("/me/password", requireOwner, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof current_password !== "string" || typeof new_password !== "string") {
    return res.status(400).json({ error: "current_password dan new_password wajib diisi" });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: "Password baru minimal 8 karakter" });
  }

  // Verifikasi password lama dulu (re-auth) sebelum mengizinkan ganti password,
  // supaya token yang dicuri/disesi-tinggalkan tidak cukup untuk ambil alih akun.
  const { error: verifyError } = await supabaseAuth.auth.signInWithPassword({
    email: req.user.email,
    password: current_password,
  });
  if (verifyError) return res.status(401).json({ error: "Password saat ini salah" });

  const { error: updateError } = await supabase.auth.admin.updateUserById(req.user.id, {
    password: new_password,
  });
  if (updateError) return res.status(400).json({ error: updateError.message });

  res.json({ ok: true });
});

function normalizeMethod(value) {
  return value === "code" ? "code" : "qr"; // default QR
}

// Daftar staff/sales milik owner — dipakai halaman "Kelola Sales" terpisah dari dashboard lead.
router.get("/staff", requireOwner, async (req, res) => {
  const { data, error } = await supabase
    .from("staff")
    .select("id, name, wa_number, wa_session_status, created_at")
    .eq("owner_id", req.ownerId)
    .order("created_at", { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post("/staff", requireOwner, async (req, res) => {
  const { name, wa_number } = req.body || {};
  const method = normalizeMethod(req.body?.method);
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
  if (error) {
    // 23505 = unique_violation pada (owner_id, wa_number): nomor sudah pernah
    // didaftarkan. Jangan bocorkan error mentah Postgres; arahkan user untuk
    // menghubungkan ulang staff yang sudah ada (mis. pairing sebelumnya gagal).
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("staff")
        .select("id")
        .eq("owner_id", req.ownerId)
        .eq("wa_number", wa_number)
        .maybeSingle();
      return res.status(409).json({
        error: "Nomor WhatsApp ini sudah terdaftar di akun Anda.",
        staff_id: existing?.id || null,
      });
    }
    return res.status(400).json({ error: error.message });
  }

  const pairing = await beginPairing({ staffId: staff.id, ownerId: req.ownerId, phoneNumber: wa_number, method });
  res.json({ ...staff, ...pairing });
});

// Mulai/ulangi pairing untuk staff yang sudah ada — dipakai untuk re-pair
// (nomor duplikat / pairing gagal sebelumnya) dan untuk berganti metode
// QR <-> kode tanpa membuat baris staff baru.
router.post("/staff/:id/pair", requireOwner, async (req, res) => {
  const method = normalizeMethod(req.body?.method);
  const { data: staff, error: findError } = await supabase
    .from("staff")
    .select("id, owner_id, wa_number")
    .eq("id", req.params.id)
    .eq("owner_id", req.ownerId)
    .maybeSingle();
  if (findError || !staff) return res.status(404).json({ error: "Staff tidak ditemukan" });

  const pairing = await beginPairing({
    staffId: staff.id,
    ownerId: staff.owner_id,
    phoneNumber: staff.wa_number,
    method,
  });
  res.json({ staff_id: staff.id, ...pairing });
});

// Polling ringan dari dashboard: QR yang ter-refresh + status terkini.
router.get("/staff/:id/pair-status", requireOwner, async (req, res) => {
  const { data: staff, error } = await supabase
    .from("staff")
    .select("id, wa_session_status")
    .eq("id", req.params.id)
    .eq("owner_id", req.ownerId)
    .maybeSingle();
  if (error || !staff) return res.status(404).json({ error: "Staff tidak ditemukan" });

  const st = getPairingState(staff.id);
  res.json({
    status: st?.status || staff.wa_session_status,
    qr: st?.qr || null,
    pairing_code: st?.code || null,
  });
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
      `id, name, wa_jid, created_at, last_message_at, tags,
       staff:staff_id ( id, name, wa_number, wa_session_status ),
       lead_audits ( funnel_stage, previous_stage, score, analysis_notes, evaluation, analyzed_at )`,
    )
    .eq("owner_id", req.ownerId)
    .order("created_at", { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  const rows = data.map((lead) => {
    const funnel_stage = lead.lead_audits?.funnel_stage || "new";
    return {
      lead_id: lead.id,
      lead_name: lead.name || lead.wa_jid,
      staff_name: lead.staff?.name,
      wa_status: lead.staff?.wa_session_status,
      funnel_stage,
      previous_stage: lead.lead_audits?.previous_stage || "-",
      score: lead.lead_audits?.score ?? "-",
      analysis_notes: lead.lead_audits?.analysis_notes || "-",
      evaluation: lead.lead_audits?.evaluation || "-",
      analyzed_at: lead.lead_audits?.analyzed_at || null,
      tags: lead.tags || [],
      risk: computeLeadRisk({ funnel_stage, score: lead.lead_audits?.score, last_message_at: lead.last_message_at }),
    };
  });

  res.json(rows);
});

// Dipakai bersama oleh GET /leads/:id (JSON) dan GET /leads/:id/pdf (download)
// supaya bentuk data lead detail tidak terduplikasi di dua tempat.
async function loadLeadDetail(leadId, ownerId) {
  const { data: lead, error } = await supabase
    .from("leads")
    .select(
      `id, name, wa_jid, created_at, last_message_at, owner_note, tags,
       staff:staff_id ( id, name, wa_number, wa_session_status ),
       lead_audits ( funnel_stage, previous_stage, score, analysis_notes, evaluation, analyzed_at, buying_signals, objections )`,
    )
    .eq("id", leadId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!lead) return { notFound: true };

  const { data: messages, error: msgError } = await supabase
    .from("messages")
    .select("id, direction, body, sent_at")
    .eq("lead_id", lead.id)
    .order("sent_at", { ascending: true })
    .limit(500);
  if (msgError) return { error: msgError.message };

  const funnel_stage = lead.lead_audits?.funnel_stage || "new";
  return {
    lead_id: lead.id,
    lead_name: lead.name || lead.wa_jid,
    wa_jid: lead.wa_jid,
    staff_name: lead.staff?.name,
    wa_status: lead.staff?.wa_session_status,
    created_at: lead.created_at,
    owner_note: lead.owner_note || "",
    tags: lead.tags || [],
    funnel_stage,
    previous_stage: lead.lead_audits?.previous_stage || "-",
    score: lead.lead_audits?.score ?? null,
    analysis_notes: lead.lead_audits?.analysis_notes || "",
    evaluation: lead.lead_audits?.evaluation || "",
    buying_signals: lead.lead_audits?.buying_signals || [],
    objections: lead.lead_audits?.objections || [],
    analyzed_at: lead.lead_audits?.analyzed_at || null,
    risk: computeLeadRisk({ funnel_stage, score: lead.lead_audits?.score, last_message_at: lead.last_message_at }),
    messages: messages || [],
  };
}

// Halaman Detail Lead: info kontak, AI intelligence (skor, buying
// signal/objection, risiko heuristik), catatan manual owner, tag, dan
// timeline chat lengkap untuk satu lead.
router.get("/leads/:id", requireOwner, async (req, res) => {
  const detail = await loadLeadDetail(req.params.id, req.ownerId);
  if (detail.error) return res.status(400).json({ error: detail.error });
  if (detail.notFound) return res.status(404).json({ error: "Lead tidak ditemukan" });
  res.json(detail);
});

// Download laporan PDF lengkap satu lead (info, ringkasan AI, evaluasi,
// sinyal beli/keberatan, catatan manual, dan transkrip chat penuh) — dipakai
// owner untuk dokumentasi/arsip di luar dashboard.
router.get("/leads/:id/pdf", requireOwner, async (req, res) => {
  const detail = await loadLeadDetail(req.params.id, req.ownerId);
  if (detail.error) return res.status(400).json({ error: detail.error });
  if (detail.notFound) return res.status(404).json({ error: "Lead tidak ditemukan" });

  try {
    const buffer = await buildLeadPdfBuffer(detail);
    const safeName = (detail.lead_name || "lead").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "lead";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="FaiAudit-${safeName}.pdf"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: "Gagal membuat PDF: " + err.message });
  }
});

// Download manual laporan HARI INI dari dashboard: 1 ZIP berisi PDF
// ringkasan (snapshot funnel/risiko + diagram) + 1 PDF transkrip chat
// terpisah per lead di folder chat/ — dipisah per lead supaya tidak jadi
// satu PDF raksasa kalau lead aktifnya banyak. Laporan HARI KEMARIN dikirim
// otomatis oleh scheduler ke WA pribadi owner — bukan lewat endpoint ini —
// supaya tidak rancu dengan apa yang dilihat di dashboard saat ini juga.
router.get("/reports/daily/pdf", requireOwner, async (req, res) => {
  try {
    const range = todayRangeWIB();
    const data = await buildDailyReportData(req.ownerId, req.owner.business_name, range);
    const buffer = await buildDailyReportZipBuffer(data);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="FaiAudit-Laporan-HariIni-${data.dateLabel}.zip"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: "Gagal membuat laporan harian: " + err.message });
  }
});

// Catatan manual & tag owner — terpisah dari analysis_notes/evaluation AI
// supaya tidak pernah saling menimpa.
router.patch("/leads/:id", requireOwner, async (req, res) => {
  const update = {};
  if (typeof req.body?.owner_note === "string") {
    update.owner_note = req.body.owner_note.slice(0, 4000);
  }
  if (Array.isArray(req.body?.tags)) {
    update.tags = req.body.tags
      .filter((t) => typeof t === "string" && t.trim())
      .slice(0, 20)
      .map((t) => t.trim().slice(0, 40));
  }
  if (!Object.keys(update).length) {
    return res.status(400).json({ error: "Tidak ada field valid (owner_note/tags) untuk diubah" });
  }

  const { data, error } = await supabase
    .from("leads")
    .update(update)
    .eq("id", req.params.id)
    .eq("owner_id", req.ownerId)
    .select("id, owner_note, tags")
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Lead tidak ditemukan" });
  res.json(data);
});

// Ubah funnel stage secara manual (override hasil AI) — dipakai tombol "ubah
// stage cepat" di halaman detail lead.
router.patch("/leads/:id/stage", requireOwner, async (req, res) => {
  const { funnel_stage } = req.body || {};
  if (!FUNNEL_STAGES.includes(funnel_stage)) {
    return res.status(400).json({ error: `funnel_stage harus salah satu dari: ${FUNNEL_STAGES.join(", ")}` });
  }

  const { data: lead, error: findError } = await supabase
    .from("leads")
    .select("id, lead_audits(funnel_stage)")
    .eq("id", req.params.id)
    .eq("owner_id", req.ownerId)
    .maybeSingle();
  if (findError) return res.status(400).json({ error: findError.message });
  if (!lead) return res.status(404).json({ error: "Lead tidak ditemukan" });

  const previousStage = lead.lead_audits?.funnel_stage || "new";
  const { error } = await supabase.from("lead_audits").upsert(
    {
      lead_id: lead.id,
      funnel_stage,
      previous_stage: previousStage,
      ai_model: "manual",
      analyzed_at: new Date().toISOString(),
    },
    { onConflict: "lead_id" },
  );
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, funnel_stage, previous_stage: previousStage });
});

router.post("/leads/:id/analyze", requireOwner, analyzeLimiter, async (req, res) => {
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

// Sambungkan ulang staff yang creds-nya sudah ada (tidak perlu pairing code
// baru) — dipakai kalau auto-retry di connector.js sudah mencapai batas
// maksimum dan berhenti otomatis (lihat MAX_ATTEMPTS di connector.js).
router.post("/staff/:id/reconnect", requireOwner, async (req, res) => {
  const { data: staff, error: findError } = await supabase
    .from("staff")
    .select("id, owner_id")
    .eq("id", req.params.id)
    .eq("owner_id", req.ownerId)
    .single();
  if (findError || !staff) return res.status(404).json({ error: "Staff tidak ditemukan" });

  try {
    await startStaffSession({ staffId: staff.id, ownerId: staff.owner_id, phoneNumber: null });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Gagal menyambungkan ulang: ${err.message}` });
  }
});
