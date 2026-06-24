# Setup FaiAudit di VPS

Panduan menjalankan FaiAudit (dashboard audit performa sales/staff via WhatsApp) di VPS sendiri.

## 1. Prasyarat

- VPS Linux (Ubuntu/Debian disarankan) dengan akses SSH
- Node.js 18+ dan npm
- PM2 (`npm install -g pm2`)
- Akses internet penuh ke github.com (dibutuhkan untuk instalasi dependency `@whiskeysockets/baileys`)
- Project Supabase untuk FaiAudit sudah dibuat (lihat langkah 3)

## 2. Clone & install

```bash
git clone https://github.com/fagangans/FaiAudit.git
cd FaiAudit
git checkout claude/funny-brown-q2y1gj
npm install
```

## 3. Konfigurasi `.env`

```bash
cp .env.example .env
nano .env
```

Isi nilai berikut:

- `SUPABASE_URL` — URL project Supabase FaiAudit (`https://xovcyjpxynewruixpdbp.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` — ambil dari Supabase Dashboard project FaiAudit → Project Settings → API → `service_role` key. **Jangan pernah commit nilai ini ke git.**
- `SUPABASE_ANON_KEY` — anon/publishable key dari halaman yang sama
- `MASTER_EMAIL` / `MASTER_PASSWORD` — kredensial satu-satunya akun master (kamu). Ganti password default.
- `OPENROUTER_API_KEY` — API key OpenRouter kamu (untuk provider `qwen`)
- `AI_PROVIDER` — `qwen` (pakai OpenRouter) atau `scraper` (fallback gratis, tidak stabil)
- `QWEN_MODEL` — default `qwen/qwen-2.5-72b-instruct`, bisa diganti model OpenRouter lain
- `PORT` — default `3000`

File `.env` sudah ada di `.gitignore`, jadi aman dari commit tidak sengaja.

## 4. Jalankan dengan PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Jalankan command terakhir yang ditampilkan `pm2 startup` (biasanya perlu `sudo`) supaya FaiAudit otomatis start setiap reboot VPS.

Cek status & log:

```bash
pm2 status
pm2 logs faiaudit
```

## 5. Buka firewall

```bash
sudo ufw allow 3000
```

Dashboard bisa diakses di `http://<ip-vps>:3000`.

### Opsional: reverse proxy + HTTPS (Nginx + Certbot)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Buat config Nginx mengarah ke `localhost:3000`, lalu:

```bash
sudo certbot --nginx -d domain-kamu.com
```

## 6. Login sebagai master & daftarkan client

Tidak ada pendaftaran publik. Akun master dibuat otomatis saat server pertama kali start
dari `MASTER_EMAIL`/`MASTER_PASSWORD` di `.env` — login langsung di dashboard dengan
kredensial itu. Setelah login, buka menu **Pengaturan** untuk mendaftarkan client
(penyewa) — sistem membuat akun + password sementara yang ditampilkan sekali untuk
disampaikan ke client tersebut.

## 7. Tambah sales/staff & pairing WhatsApp

Setelah login ke dashboard, klik **+ Tambah Sales**, isi nama dan nomor WhatsApp (format `62xxxxxxxxxx`, tanpa `+`). Sistem akan mengembalikan **pairing code** — masukkan code tersebut di WhatsApp staff: **Perangkat Tertaut → Tautkan dengan nomor telepon**.

Sesi WhatsApp tersimpan di folder `wa-sessions/` (sudah di `.gitignore`, jangan dibackup ke git karena berisi kredensial sesi).

## Perintah PM2 yang sering dipakai

```bash
pm2 restart faiaudit
pm2 stop faiaudit
pm2 logs faiaudit --lines 100
```
