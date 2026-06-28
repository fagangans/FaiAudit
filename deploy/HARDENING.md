# Hardening Keamanan FaiAudit (Produksi)

Panduan ini menutup celah keamanan tingkat infrastruktur yang TIDAK bisa
diperbaiki dari dalam kode aplikasi saja. Jalankan setelah FaiAudit sudah
berjalan via PM2 (lihat `SETUP-VPS.md`).

> VPS `43.129.55.131` berbagi dengan `wabot` (PM2 id 0) dan
> `webchat-backend` (id 1). Semua langkah di bawah dirancang agar **tidak
> mengganggu** kedua app itu. Nginx dipasang sebagai file config TERPISAH,
> dan hanya port FaiAudit yang disentuh.

---

## Apa yang sudah aman di level kode (tidak perlu tindakan)

- **SQL Injection**: nihil — semua query lewat Supabase query builder
  terparameterisasi, tidak ada string SQL yang dirangkai manual.
- **Stored XSS**: ditutup — data dari chat lead (untrusted) dirender via
  `textContent`/DOM, bukan `innerHTML`.
- **Prompt injection ke AI**: dimitigasi — transkrip ditandai sebagai DATA,
  output AI disanitasi (batas panjang & jumlah) sebelum disimpan.
- **Broken access control**: `requireOwner` memverifikasi JWT Supabase asli &
  memetakan ke `owner_id`; client tidak pernah mengirim `owner_id` sendiri.
  RLS Supabase aktif di semua tabel sebagai pertahanan kedua di level DB.
- **Rate-limit aplikasi**: global 120 req/menit/IP untuk `/api`, ketat
  6 req/menit untuk endpoint berat (PDF, pairing WA), 20/15menit untuk login.

---

## 1. TLS + reverse proxy (menutup plaintext HTTP) — PRIORITAS UTAMA

Saat ini login dilayani lewat `http://43.129.55.131:3002` → password & token
dikirim **telanjang** di jaringan, bisa disadap. Wajib dipasang TLS.

**Prasyarat**: sebuah domain/subdomain (mis. `faiaudit.domain-kamu.com`) yang
A record-nya sudah diarahkan ke `43.129.55.131`. (Tanpa domain, TLS gratis
Let's Encrypt tidak bisa diterbitkan — alternatifnya pakai Cloudflare, lihat §4.)

```bash
# Install Nginx + Certbot
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

# Salin config FaiAudit (file terpisah, tidak menimpa app lain)
sudo cp /home/ubuntu/FaiAudit/deploy/nginx-faiaudit.conf /etc/nginx/sites-available/faiaudit
sudo ln -sf /etc/nginx/sites-available/faiaudit /etc/nginx/sites-enabled/faiaudit

# Ganti domain placeholder dengan domain asli kamu
sudo sed -i 's/faiaudit.domain-kamu.com/DOMAIN-ASLI-KAMU/g' /etc/nginx/sites-available/faiaudit
```

Tambahkan 2 baris zona rate-limit ke dalam blok `http { ... }` di
`/etc/nginx/nginx.conf` (sekali saja; cek dulu belum ada):

```
limit_req_zone  $binary_remote_addr zone=faiaudit_req:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=faiaudit_conn:10m;
```

Lalu terbitkan sertifikat & aktifkan:

```bash
sudo nginx -t                      # cek config valid SEBELUM reload
sudo certbot --nginx -d DOMAIN-ASLI-KAMU
sudo systemctl reload nginx
```

Aktifkan flag TLS di FaiAudit (mengaktifkan HSTS + perbaikan rate-limit di
belakang proxy yang sudah disiapkan di kode):

```bash
cd /home/ubuntu/FaiAudit
# Tambahkan ke .env:
echo "ENABLE_HTTPS=1" >> .env
echo "TRUST_PROXY=1"  >> .env
pm2 restart faiaudit --update-env
```

## 2. Tutup port 3002 dari internet (akses hanya via proxy)

Setelah Nginx jalan, Node cukup diakses dari localhost. Pastikan FaiAudit
listen di `127.0.0.1` (cek `.env`/`ecosystem.config.cjs`), lalu tutup 3002:

```bash
sudo ufw deny 3002
sudo ufw allow 'Nginx Full'        # buka 80 & 443
sudo ufw status
```

> Jangan tutup port yang dipakai `wabot`/`webchat-backend`. Cek dulu
> `sudo ufw status` & `pm2 status` sebelum mengubah aturan firewall.

## 3. Backup data otomatis

Supabase plan berbayar punya Point-in-Time Recovery bawaan — aktifkan di
Dashboard Supabase → Database → Backups bila tersedia. Untuk backup logis
tambahan (gratis), jadwalkan `pg_dump` harian via cron:

```bash
# Ambil connection string dari Supabase → Project Settings → Database
# (mode "Session"/direct). Simpan sebagai variabel, JANGAN commit ke git.
crontab -e
# Tambahkan (backup tiap 03:00, simpan 7 hari terakhir):
0 3 * * * pg_dump "$SUPABASE_DB_URL" | gzip > /home/ubuntu/backups/faiaudit-$(date +\%F).sql.gz && find /home/ubuntu/backups -name 'faiaudit-*.sql.gz' -mtime +7 -delete
```

## 4. (Alternatif/tambahan) Cloudflare di depan domain

Untuk meredam DDoS volumetrik (banjir bandwidth besar) yang tidak bisa
ditangani satu VPS, arahkan DNS domain ke Cloudflare (plan gratis sudah
membantu): aktifkan proxy (ikon awan oranye), mode SSL "Full (strict)", dan
aturan rate-limiting dasar. Cloudflare menyerap traffic jahat sebelum sampai
ke VPS sekaligus menyembunyikan IP asli server.

---

## Ringkasan prioritas

| Prioritas | Tindakan | Menutup celah |
|-----------|----------|---------------|
| 1 (wajib) | TLS + reverse proxy (§1) | Penyadapan password/token (plaintext HTTP) |
| 2 | Tutup port 3002 (§2) | Bypass proxy & rate-limit |
| 3 | Backup otomatis (§3) | Kehilangan data |
| 4 | Cloudflare (§4) | DDoS volumetrik jaringan |
