import { ZipArchive } from "archiver";
import { buildDailyReportPdfBuffer, buildLeadChatPdfBuffer, safeFileName } from "./pdfBuilder.js";

// Owner ingin laporan harian + transkrip chat per lead TIDAK digabung jadi
// satu PDF raksasa (bisa puluhan/ratusan halaman kalau lead aktifnya
// banyak/ramai) — melainkan satu file ringkasan + satu file chat terpisah
// per lead, dibungkus dalam satu ZIP supaya tetap satu kali download/kirim.
// archiver dipilih karena pure-JS, streaming, tanpa dependency native.
export function buildDailyReportZipBuffer(data) {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks = [];
    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("warning", () => {});
    archive.on("error", reject);

    Promise.resolve()
      .then(async () => {
        const periodLower = (data.periodLabel || "Periode").toLowerCase();

        const mainBuffer = await buildDailyReportPdfBuffer(data);
        archive.append(mainBuffer, { name: `Laporan-Harian-${data.dateLabel}.pdf` });

        const usedNames = new Map();
        for (const lead of data.leads) {
          let baseName = safeFileName(lead.lead_name);
          const count = usedNames.get(baseName) || 0;
          usedNames.set(baseName, count + 1);
          const fileName = count > 0 ? `${baseName}-${count + 1}` : baseName;

          const chatBuffer = await buildLeadChatPdfBuffer(lead, periodLower);
          archive.append(chatBuffer, { name: `chat/${fileName}.pdf` });
        }

        archive.finalize();
      })
      .catch(reject);
  });
}
