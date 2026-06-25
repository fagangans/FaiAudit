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

const CHART_BAR_COLORS = ["#15315f", "#2d5a9e", "#c9a86a", "#7a1f1f", "#3f8f5f", "#7a7a7a"];

// Diagram batang horizontal digambar langsung dengan primitif vektor pdfkit
// (rect/text) — tanpa lib chart/gambar raster tambahan, supaya tetap ringan
// (alasan yang sama kenapa pdfkit dipilih di awal) sambil tetap menampilkan
// data nyata (jumlah lead per stage/risiko) secara akurat & proporsional.
function horizontalBarChart(doc, items, { maxBarWidth = 260 } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const barHeight = 14;
  const gap = 7;
  const labelWidth = 100;
  const startX = doc.page.margins.left + labelWidth;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const y = doc.y;
    const barWidth = item.value > 0 ? Math.max(2, (item.value / max) * maxBarWidth) : 0;
    const color = CHART_BAR_COLORS[i % CHART_BAR_COLORS.length];

    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#1a1a1a")
      .text(item.label, doc.page.margins.left, y + 2, { width: labelWidth - 6, align: "left" });

    if (barWidth > 0) doc.rect(startX, y, barWidth, barHeight).fill(color);

    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("#1a1a1a")
      .text(String(item.value), startX + barWidth + 6, y + 2);

    doc.y = y + barHeight + gap;
    doc.x = doc.page.margins.left;
  }
  doc.moveDown(0.3);
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

export function safeFileName(name) {
  return (name || "lead").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "lead";
}

// File transkrip chat khusus 1 lead — dipisah dari laporan harian utama
// karena kalau seluruh chat semua lead digabung jadi 1 PDF, file itu bisa
// jadi sangat panjang/berat (puluhan-ratusan halaman untuk lead aktif).
// Laporan utama hanya menaruh ringkasan + pointer ke file ini.
export function buildLeadChatPdfBuffer(lead, periodLabelLower) {
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  const messages = lead.exampleMessages || [];

  drawHeader(
    doc,
    `Transkrip Chat — ${lead.lead_name}`,
    `${periodLabelLower || "periode ini"} · ${messages.length} pesan · Sales: ${lead.staff_name || "-"}`,
  );

  if (!messages.length) {
    doc.fontSize(10).font("Helvetica-Oblique").fillColor("#7a7a7a").text("Belum ada chat tercatat di periode ini.");
  } else {
    for (const m of messages) {
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

// --- Laporan harian lengkap untuk owner: snapshot + diagram + ringkasan lead ---
// Transkrip chat penuh TIDAK dicetak di sini (lihat buildLeadChatPdfBuffer)
// — kalau ada banyak lead aktif, laporan ini akan tetap ringkas & cepat
// dibaca, sementara percakapan lengkap per lead ada di file terpisah.
export function buildDailyReportPdfBuffer({ businessName, dateLabel, periodLabel, summary, leads }) {
  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
  const period = periodLabel || "Periode";
  const periodLower = period.toLowerCase();

  drawHeader(doc, `Laporan Harian — ${period} (${dateLabel})`, businessName ? `Untuk: ${businessName}` : undefined);

  sectionTitle(doc, "Ringkasan");
  labelValue(doc, `Lead dengan aktivitas chat ${periodLower}`, String(summary.activeLeadCount));
  labelValue(doc, "Total lead berisiko tinggi (saat ini)", String(summary.highRiskCount));

  const riskCounts = { tinggi: 0, sedang: 0, rendah: 0, selesai: 0 };
  for (const lead of leads) {
    const level = lead.risk?.level;
    if (level && riskCounts[level] != null) riskCounts[level] += 1;
  }

  sectionTitle(doc, "Diagram Distribusi Funnel Stage (saat ini, seluruh lead)");
  horizontalBarChart(
    doc,
    Object.keys(summary.stageCounts).map((stage) => ({ label: stageLabel(stage), value: summary.stageCounts[stage] })),
  );

  sectionTitle(doc, `Diagram Distribusi Risiko (lead aktif ${periodLower})`);
  horizontalBarChart(
    doc,
    Object.keys(riskCounts).map((level) => ({ label: RISK_LABEL[level], value: riskCounts[level] })),
  );

  sectionTitle(doc, `Detail Lead Aktif ${period} (${leads.length})`);
  if (!leads.length) {
    doc.fontSize(10).font("Helvetica-Oblique").fillColor("#7a7a7a").text(`Tidak ada chat masuk ${periodLower}.`);
  } else {
    doc
      .fontSize(9)
      .font("Helvetica-Oblique")
      .fillColor("#5b6b85")
      .text(`Transkrip chat ${periodLower} setiap lead ada di file PDF terpisah dalam folder "chat/" pada arsip ZIP ini.`);
    for (const lead of leads) {
      doc.moveDown(0.4);
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#15315f").text(lead.lead_name);
      labelValue(doc, "Sales", lead.staff_name);
      labelValue(doc, "Funnel Stage", stageLabel(lead.funnel_stage));
      labelValue(doc, "Skor", lead.score != null ? String(lead.score) : "-");
      labelValue(doc, "Risiko", RISK_LABEL[lead.risk?.level] || "-");
      labelValue(doc, `Jumlah chat ${periodLower}`, String(lead.exampleMessages?.length || 0));
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#0f2547")
        .text(`Transkrip lengkap: chat/${safeFileName(lead.lead_name)}.pdf`);
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
