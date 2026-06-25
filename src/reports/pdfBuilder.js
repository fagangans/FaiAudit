import PDFDocument from "pdfkit";

const STAGE_LABEL = {
  new: "Baru",
  contacted: "Kontak",
  interested: "Tertarik",
  negotiation: "Negosiasi",
  closed_won: "Closing",
  closed_lost: "Hilang",
};

const RISK_LABEL = { rendah: "Rendah", sedang: "Sedang", tinggi: "Tinggi", selesai: "Selesai" };

function stageLabel(stage) {
  return STAGE_LABEL[stage] || stage || "-";
}

function fmtDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

// Mengubah PDFDocument yang sedang dibangun jadi Buffer — dipakai baik untuk
// respons HTTP (download manual) maupun lampiran dokumen WhatsApp (laporan
// harian otomatis), supaya satu builder dipakai ulang di kedua jalur.
function collectToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function drawHeader(doc, title, subtitle) {
  doc.fillColor("#0f2547").fontSize(18).font("Helvetica-Bold").text("FaiAudit", { continued: false });
  doc.fontSize(13).font("Helvetica-Bold").fillColor("#15315f").text(title);
  if (subtitle) {
    doc.fontSize(10).font("Helvetica").fillColor("#5b6b85").text(subtitle);
  }
  doc.moveDown(0.5);
  doc
    .strokeColor("#c9a86a")
    .lineWidth(1.5)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(0.8);
}

function sectionTitle(doc, text) {
  doc.moveDown(0.3);
  doc.fontSize(12).font("Helvetica-Bold").fillColor("#0f2547").text(text);
  doc.moveDown(0.2);
}

function labelValue(doc, label, value) {
  doc
    .fontSize(10)
    .font("Helvetica-Bold")
    .fillColor("#15315f")
    .text(`${label}: `, { continued: true })
    .font("Helvetica")
    .fillColor("#1a1a1a")
    .text(value ?? "-");
}

function bulletList(doc, items) {
  if (!items?.length) {
    doc.fontSize(10).font("Helvetica-Oblique").fillColor("#7a7a7a").text("Tidak ada.");
    return;
  }
  doc.fontSize(10).font("Helvetica").fillColor("#1a1a1a");
  for (const item of items) {
    doc.text(`•  ${item}`, { indent: 8 });
  }
}

function paragraph(doc, text) {
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor("#1a1a1a")
    .text(text || "-", { align: "left" });
}

// --- Laporan satu lead lengkap, termasuk transkrip chat ---
export function buildLeadPdfBuffer(lead) {
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });

  drawHeader(doc, `Laporan Audit Lead — ${lead.lead_name}`, `Dibuat ${fmtDateTime(new Date())}`);

  sectionTitle(doc, "Informasi Lead");
  labelValue(doc, "Nama", lead.lead_name);
  labelValue(doc, "Sales", lead.staff_name);
  labelValue(doc, "Nomor WA", lead.wa_jid);
  labelValue(doc, "Status Sesi WA", lead.wa_status);
  labelValue(doc, "Masuk Sejak", fmtDateTime(lead.created_at));

  sectionTitle(doc, "Ringkasan AI");
  labelValue(doc, "Funnel Stage", stageLabel(lead.funnel_stage));
  labelValue(doc, "Stage Sebelumnya", stageLabel(lead.previous_stage));
  labelValue(doc, "Skor", lead.score != null ? String(lead.score) : "-");
  labelValue(doc, "Risiko", RISK_LABEL[lead.risk?.level] || "-");
  if (lead.risk?.reason) labelValue(doc, "Alasan Risiko", lead.risk.reason);
  labelValue(doc, "Dianalisis", fmtDateTime(lead.analyzed_at));

  sectionTitle(doc, "Catatan Analisis AI");
  paragraph(doc, lead.analysis_notes);

  sectionTitle(doc, "Evaluasi & Rekomendasi AI");
  paragraph(doc, lead.evaluation);

  sectionTitle(doc, "Sinyal Beli Terdeteksi");
  bulletList(doc, lead.buying_signals);

  sectionTitle(doc, "Keberatan Terdeteksi");
  bulletList(doc, lead.objections);

  if (lead.owner_note) {
    sectionTitle(doc, "Catatan Manual Owner");
    paragraph(doc, lead.owner_note);
  }

  if (lead.tags?.length) {
    sectionTitle(doc, "Tag");
    doc.fontSize(10).font("Helvetica").fillColor("#1a1a1a").text(lead.tags.join(", "));
  }

  sectionTitle(doc, `Riwayat Chat (${(lead.messages || []).length} pesan)`);
  if (!lead.messages?.length) {
    doc.fontSize(10).font("Helvetica-Oblique").fillColor("#7a7a7a").text("Belum ada chat tercatat.");
  } else {
    for (const m of lead.messages) {
      const who = m.direction === "outbound" ? "Sales" : "Lead";
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor(m.direction === "outbound" ? "#15315f" : "#7a1f1f")
        .text(`${who} · ${fmtDateTime(m.sent_at)}`);
      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor("#1a1a1a")
        .text(m.body || "", { indent: 10 });
      doc.moveDown(0.3);
    }
  }

  return collectToBuffer(doc);
}

// --- Laporan harian ringkas untuk owner: snapshot + chat contoh kemarin ---
export function buildDailyReportPdfBuffer({ businessName, dateLabel, summary, leads }) {
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });

  drawHeader(doc, `Laporan Harian — ${dateLabel}`, businessName ? `Untuk: ${businessName}` : undefined);

  sectionTitle(doc, "Ringkasan");
  labelValue(doc, "Lead dengan aktivitas chat kemarin", String(summary.activeLeadCount));
  labelValue(doc, "Total lead berisiko tinggi (saat ini)", String(summary.highRiskCount));
  doc.moveDown(0.2);
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#0f2547").text("Distribusi Funnel Stage (saat ini):");
  for (const stage of Object.keys(summary.stageCounts)) {
    labelValue(doc, stageLabel(stage), String(summary.stageCounts[stage]));
  }

  sectionTitle(doc, `Detail Lead Aktif Kemarin (${leads.length})`);
  if (!leads.length) {
    doc.fontSize(10).font("Helvetica-Oblique").fillColor("#7a7a7a").text("Tidak ada chat masuk kemarin.");
  } else {
    for (const lead of leads) {
      doc.moveDown(0.4);
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#15315f").text(lead.lead_name);
      labelValue(doc, "Sales", lead.staff_name);
      labelValue(doc, "Funnel Stage", stageLabel(lead.funnel_stage));
      labelValue(doc, "Skor", lead.score != null ? String(lead.score) : "-");
      labelValue(doc, "Risiko", RISK_LABEL[lead.risk?.level] || "-");
      if (lead.exampleMessages?.length) {
        doc.fontSize(9).font("Helvetica-Bold").fillColor("#0f2547").text("Contoh chat kemarin:");
        for (const m of lead.exampleMessages) {
          const who = m.direction === "outbound" ? "Sales" : "Lead";
          doc
            .fontSize(9)
            .font("Helvetica")
            .fillColor("#1a1a1a")
            .text(`${who} (${fmtDateTime(m.sent_at)}): ${m.body || ""}`, { indent: 10 });
        }
      }
      doc
        .strokeColor("#dfe4ee")
        .lineWidth(0.5)
        .moveTo(doc.page.margins.left, doc.y + 4)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y + 4)
        .stroke();
      doc.moveDown(0.4);
    }
  }

  doc.moveDown(0.5);
  doc.fontSize(9).font("Helvetica-Oblique").fillColor("#7a7a7a").text("Buka dashboard FaiAudit untuk detail lengkap & tindak lanjut.");

  return collectToBuffer(doc);
}
