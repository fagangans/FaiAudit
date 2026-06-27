# Ringkasan Project FaiAudit — untuk sesi Claude Desktop baru

## Tentang Project
FaiAudit adalah aplikasi audit performa sales berbasis WhatsApp. Sistem membaca
chat WhatsApp staff sales secara pasif (via Baileys), menganalisisnya dengan AI
(funnel stage, skor, risiko, sinyal beli, objection), dan menampilkannya di
dashboard web untuk owner bisnis. Mendukung multi-client (model master/client),
laporan harian otomatis via WA (PDF), dan beberapa view: Dashboard (tabel),
Kanban, Analitik, Kelola Sales, Pengaturan.

## Repo & Branch
- Repo utama: `fagangans/FaiAudit` (juga ada `fagangans/aiwhatsappbussinesfaganfaal`)
- Branch kerja aktif: `claude/funny-brown-q2y1gj`
- Commit terbaru di branch ini: perbaikan responsivitas mobile dashboard (meta
  viewport, @media breakpoint, tabel jadi tampilan card di HP).

## Stack Teknis
- Backend: Node.js (Express), ESM (`import`/`export`)
- WhatsApp: Baileys (passive logger, auto-reconnect dengan exponential backoff)
- Database: Supabase (Postgres)
- AI: ada 2 provider — "scraper" (AI biasa/cepat, default hemat biaya) dan
  "qwen" (OpenRouter, kualitas lebih tinggi) — provider diatur per-client oleh
  master, bukan oleh client sendiri.
- PDF: `pdfkit` (laporan per-lead dan laporan harian gabungan + diagram batang
  vektor + internal navigation pakai named destination/GoTo, BUKAN Launch
  action ke file lain — itu sudah dicoba dan gagal karena PDF viewer modern
  blokir Launch action ke file eksternal demi keamanan).
- Frontend: vanilla HTML/CSS/JS (`public/index.html`, `public/style.css`,
  `public/app.js`) — tidak ada framework, DOM dibangun manual.

## Deployment / VPS (PENTING)
- VPS: `43.129.55.131`
- Path project di VPS: `/home/ubuntu/FaiAudit`
- Dijalankan via PM2 dengan nama proses **`faiaudit`** (PM2 id 3)
- **JANGAN PERNAH** ganggu 2 proses PM2 lain yang juga jalan di VPS yang sama:
  - id 0: `wabot`
  - id 1: `webchat-backend`
- Dashboard diakses di: `http://43.129.55.131:3002`
- Command deploy standar setiap ada update kode:
  ```
  cd /home/ubuntu/FaiAudit
  git pull
  pm2 restart faiaudit --update-env
  ```
- User menjalankan semua command VPS SENDIRI via SSH — kalau Claude punya akses
  shell langsung ke VPS (misal lewat Desktop Commander), tetap konfirmasi dulu
  sebelum eksekusi apapun yang berisiko (restart proses lain, migrasi DB, dst).

## Preferensi & Standar Kerja (selalu berlaku, tanpa perlu diminta ulang)
1. **Selalu balas dalam Bahasa Indonesia.**
2. **Terapkan standar `/loop`** di setiap perbaikan/upgrade: analisis root
   cause dulu (jangan asal tambal), pertimbangkan lebih dari 1 solusi,
   bandingkan trade-off, baru implementasikan yang terbaik — target akhir:
   "no bug, no error, no masalah, no mistakes".
3. Selalu kasih command **persis/nyata** (bukan placeholder) dengan path asli
   `/home/ubuntu/FaiAudit` saat minta user jalankan sesuatu di VPS.
4. Verifikasi sebelum commit: `node --check` untuk file JS yang diubah, smoke
   test fungsional untuk logic backend (terutama PDF builder), review CSS/HTML
   untuk konsistensi sebelum push.

## Riwayat Pekerjaan Besar yang Sudah Selesai
- Schema Supabase, passive WA logger, modul analisis AI, REST API + dashboard
  routes, dashboard UI ala spreadsheet, lalu di-redesign jadi tema navy premium.
- Supabase Auth, security review, model master/client (replace registrasi publik).
- Deploy ke VPS via PM2 sebagai proses terpisah, terverifikasi tidak mengganggu
  `wabot`/`webchat-backend`.
- Auto-reconnect WA session saat server boot + backoff/retry.
- Auto-analyze terjadwal untuk lead dengan chat baru, dengan rate-limit dan
  skip-jika-tidak-ada-chat-baru (hemat biaya AI).
- Ganti password endpoint, migration SQL versioned, health endpoint + logging.
- Laporan harian otomatis: dikirim via WA ke nomor pribadi owner (PDF, jam 08:00
  WIB, sekali per hari, dicek tiap 15 menit) — berisi ringkasan, diagram funnel/
  risiko, dan transkrip chat lengkap tiap lead aktif.
  - PDF laporan harian sempat dicoba sebagai ZIP berisi file PDF per-lead +
    link "Launch" antar file — GAGAL karena PDF viewer modern (termasuk Adobe
    Acrobat baru) memblokir Launch action ke file eksternal demi keamanan.
  - **Solusi final (sudah diimplementasi & dikonfirmasi user)**: 1 PDF tunggal,
    transkrip tiap lead di halaman terpisah pada dokumen yang sama, link
    navigasi pakai named destination internal (`doc.goTo` / `addNamedDestination`)
    — 100% bisa diklik di semua PDF viewer karena tidak ada cross-file link.
- **Terbaru**: perbaikan responsivitas mobile dashboard — root cause: tidak ada
  `<meta name="viewport">` dan tidak ada `@media` query sama sekali. Sudah
  diperbaiki: viewport meta, breakpoint `@media (max-width: 768px)` untuk
  header/nav/toolbar/filter/legend/intro-card/modal/auth-card/settings-form,
  dan semua tabel data (`#sheet`, `#staffTable`, `#clientTable`,
  `.leaderboard-table`) diubah jadi tampilan "card" bertumpuk di HP (pakai
  `data-label` attribute + CSS `td::before`) supaya tidak perlu scroll
  horizontal. Sudah commit & push ke `claude/funny-brown-q2y1gj`, BELUM di-pull
  & restart di VPS — user perlu jalankan command deploy di atas.

## File Kunci
- `src/notify/dailyReportScheduler.js` — scheduler laporan harian otomatis ke WA.
- `src/reports/pdfBuilder.js` — builder PDF (per-lead & laporan harian gabungan).
- `src/reports/dailyReportData.js` — query data untuk laporan harian.
- `src/whatsapp/connector.js` — koneksi WA, termasuk `sendOwnerDocument`.
- `src/routes/api.js` — semua REST endpoint.
- `public/index.html`, `public/style.css`, `public/app.js` — frontend dashboard
  (vanilla JS, tanpa framework; cache-bust version saat ini: v21).

## Yang Belum Dikerjakan / Perlu Ditindaklanjuti
- User belum konfirmasi sudah `git pull` + restart PM2 di VPS untuk perbaikan
  mobile terbaru.
- Belum ada testing visual nyata di browser/HP asli untuk perubahan CSS mobile
  (hanya diverifikasi lewat review statis CSS/HTML, bukan render browser).
