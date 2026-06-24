# FaiAudit

Automasi audit performa sales/staff dari chat WhatsApp — bukan chatbot pembalas pesan.
FaiAudit hanya **membaca pasif** chat yang sudah ada di nomor WhatsApp sales/staff, lalu AI
menganalisis funnel stage, skor, dan evaluasi performa. Hasilnya ditampilkan di satu
dashboard berbentuk spreadsheet.

## Cara kerja

1. Owner mendaftarkan nomor WhatsApp tiap sales/staff (login via pairing code, seperti Baileys biasa).
2. FaiAudit menyimpan setiap chat masuk/keluar ke database (Supabase) — tanpa membalas apapun.
3. AI (default: scraper gratis, bisa diganti ke Qwen 3.5 Flash) membaca riwayat chat per lead dan menghasilkan:
   funnel stage, stage sebelumnya, skor, catatan analisis, evaluasi/rekomendasi.
4. Dashboard menampilkan satu baris per lead — mirip spreadsheet — bisa difilter per sales.

## Setup

```
npm install
cp .env.example .env
```

Isi `SUPABASE_SERVICE_ROLE_KEY` di `.env` (ambil dari Supabase Dashboard project **FaiAudit** >
Project Settings > API). Jangan commit nilai aslinya.

```
npm start
```

Buka `http://localhost:3000`, isi **Owner ID** (buat owner dulu lewat `POST /api/owners`),
lalu tambah sales dan tunggu chat masuk untuk dianalisis.

## Catatan penting (MVP)

- Auth saat ini memakai header `x-owner-id` sederhana untuk mempercepat MVP. **Sebelum
  disewakan ke banyak owner secara produksi**, ganti dengan Supabase Auth (verifikasi JWT)
  supaya satu owner tidak bisa mengakses data owner lain — RLS di database sudah disiapkan
  untuk pola ini.
- Provider AI default (`scraper`) gratis tapi tidak stabil untuk produksi. Set
  `AI_PROVIDER=qwen` + `QWEN_API_KEY` di `.env` saat siap.
- Sesi WhatsApp disimpan di folder `wa-sessions/` (otomatis dibuat, jangan dihapus kecuali ingin re-pairing).
