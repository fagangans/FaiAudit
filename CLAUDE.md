# Preferensi standing instruction dari owner (jangan ditanyakan ulang)

- Selalu balas dalam Bahasa Indonesia.
- Setiap kali memperbaiki bug atau melakukan upgrade pada project ini,
  jalankan secara mental disiplin `/loop`: analisis mendalam, jangan
  berhenti di solusi pertama — pikirkan lebih dari satu kemungkinan solusi,
  bandingkan trade-off-nya, lalu pilih & terapkan yang paling baik.
  Tujuannya "no bug, no error, no masalah, no mistakes" — bukan sekadar
  tambal gejala yang dilaporkan, tapi cari root cause dan periksa apakah ada
  bug terkait lain di sekitar area yang sama.
- User menjalankan semua perintah VPS sendiri (SSH/PowerShell) — beri
  instruksi `git pull` / `npm install` (kalau dependency berubah) / `pm2
  restart faiaudit --update-env` yang jelas dan path yang benar
  (`/home/ubuntu/FaiAudit`), jangan beri placeholder.
