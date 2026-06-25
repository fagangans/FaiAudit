# FaiAudit

Automasi audit performa sales/staff dari chat WhatsApp — bukan chatbot pembalas pesan.
FaiAudit hanya **membaca pasif** chat yang sudah ada di nomor WhatsApp sales/staff, lalu AI
menganalisis funnel stage, skor, dan evaluasi performa. Hasilnya ditampilkan di satu
dashboard berbentuk spreadsheet.

## Cara kerja

1. Owner mendaftarkan nomor WhatsApp tiap sales/staff (login via pairing code, seperti Baileys biasa).
2. FaiAudit menyimpan setiap chat masuk/keluar ke database (Supabase) — tanpa membalas apapun.
3. AI (default: OpenRouter/Qwen) membaca riwayat chat per lead dan menghasilkan:
   funnel stage, stage sebelumnya, skor, catatan analisis, evaluasi/rekomendasi.
4. Dashboard menampilkan satu baris per lead — mirip spreadsheet.

## Model akses: master & client

Tidak ada pendaftaran publik. Hanya satu akun **master** (kamu, pemilik produk) yang bisa
login langsung — dibuat otomatis dari `MASTER_EMAIL`/`MASTER_PASSWORD` di `.env` saat server
pertama kali start. Master mendaftarkan **client** (penyewa) lewat menu **Pengaturan** di
dashboard; sistem membuat akun client + password sementara yang ditampilkan sekali ke master
untuk disampaikan ke client. Setiap client hanya bisa melihat data miliknya sendiri (RLS di
database dipisah per `owner`).

## Setup

```
npm install
cp .env.example .env
```

Isi di `.env`:
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase Dashboard project **FaiAudit** > Project Settings > API. Jangan commit nilai aslinya.
- `MASTER_EMAIL` / `MASTER_PASSWORD` — kredensial login satu-satunya master. Ganti dari nilai default.
- `OPENROUTER_API_KEY` — untuk provider AI `qwen`.

```
npm start
```

Buka `http://localhost:3000`, login dengan `MASTER_EMAIL`/`MASTER_PASSWORD`, lalu buka
**Pengaturan** untuk mendaftarkan client pertama.

## Catatan

- Sesi WhatsApp disimpan di folder `wa-sessions/` (otomatis dibuat, jangan dihapus kecuali ingin re-pairing).
- Lihat `SETUP-VPS.md` untuk panduan deploy di VPS dengan PM2.
- Sesi WA staff yang sudah pernah pairing otomatis tersambung ulang saat server start/restart
  (lihat `reconnectAllStaffSessions` di `src/whatsapp/connector.js`), dengan exponential backoff
  (maks. 10 percobaan, delay naik 2s→5 menit) supaya tidak membombardir WhatsApp saat koneksi
  tidak stabil. Kalau auto-retry menyerah, staff berstatus `disconnected` dan bisa disambungkan
  ulang manual lewat `POST /api/staff/:id/reconnect` tanpa pairing code baru (creds masih ada).
- Audit funnel/skor diperbarui otomatis tiap beberapa menit oleh scheduler (`src/ai/scheduler.js`)
  untuk lead yang punya chat baru sejak analisis terakhir — bukan cuma saat tombol "Analisis"
  diklik manual. `analyzeLead()` melewati pemanggilan AI kalau tidak ada chat baru, supaya
  scheduler dan klik manual berulang tidak membayar ulang OpenRouter untuk transkrip yang sama.

## Keterbatasan yang disengaja (trade-off, bukan bug)

Bagian ini didokumentasikan secara sadar supaya tidak "diperbaiki" secara diam-diam dengan cara
yang justru menambah risiko baru. Tiap baris: keterbatasan → kenapa dibiarkan → kapan harus diubah.

- **Akses data lewat service-role key, bukan token user-per-request** (`src/supabase.js`). RLS di
  database tetap aktif sebagai jaring pengaman, tapi jalur baca/tulis utama melewatinya — isolasi
  antar-client saat ini bergantung pada filter `eq("owner_id", ...)` di setiap route. Alternatifnya
  (bikin client Supabase baru per-request dengan JWT user) lebih aman tapi menambah kompleksitas dan
  butuh audit ulang semua query. **Ubah kalau**: jumlah developer yang menyentuh `routes/` bertambah
  dan risiko "lupa filter owner_id" pada PR baru naik.
- **Tidak ada backfill riwayat chat lama.** Baileys cuma menangkap pesan yang lewat *setelah*
  pairing — chat sebelum itu tidak ikut diaudit. Backfill butuh akses API resmi WhatsApp Business
  (Baileys/Web protokol tidak expose history lama dengan andal). **Ubah kalau**: client komplain
  audit "kosong" di awal — beri tahu di onboarding bahwa audit mulai berjalan dari titik pairing.
- **Media (voice note, gambar, dokumen) diabaikan**, hanya teks & caption yang diekstrak
  (`extractText` di `connector.js`). Banyak sales pakai voice note untuk closing. Menambah
  transkripsi audio = biaya & latensi tambahan per pesan. **Ubah kalau**: data menunjukkan porsi
  signifikan percakapan penting ada di voice note — baru investasi ke speech-to-text.
- **Tidak ada retensi/arsip pesan.** Tabel `messages` tumbuh selamanya. Untuk skala saat ini
  (single VPS, beberapa client) belum jadi masalah; auto-pruning berisiko menghapus data yang
  justru dibutuhkan client untuk audit historis. **Ubah kalau**: ukuran database mulai memengaruhi
  biaya Supabase — baru tambahkan kebijakan retensi yang jelas (mis. arsip ke storage dingin,
  bukan hapus).
- **Tidak ada consent/notice eksplisit ke pihak lead** bahwa chat mereka direkam & dianalisis AI.
  Ini bukan keputusan teknis — perlu keputusan bisnis/legal dari pemilik produk (kamu) tentang
  bagaimana memberi tahu lead, karena beda yurisdiksi beda aturan. **Tidak diubah lewat kode.**
- **`setInterval` di proses, bukan `pg_cron`/job queue**, untuk scheduler auto-analyze
  (`src/ai/scheduler.js`). Aman selama deployment 1 instance (PM2 fork mode). **Ubah kalau**:
  FaiAudit di-scale ke >1 instance — setInterval di tiap instance akan dobel proses lead yang sama.
- **Belum ada test otomatis.** Untuk MVP single-developer ini trade-off waktu vs cakupan; risiko
  regresi ditahan dengan `node --check` + review manual tiap perubahan. **Ubah kalau**: ada
  kontributor lain atau frekuensi perubahan naik — baru investasi ke test suite.
