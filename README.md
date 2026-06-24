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
