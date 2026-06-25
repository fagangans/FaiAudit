-- Nomor WA pribadi owner/client untuk menerima reminder lead berisiko
-- tinggi (dikirim lewat sesi WA staff yang sedang terhubung, bukan sesi
-- baru — tetap "passive logger" plus satu pengecualian terbatas: pesan
-- reminder ke pemilik akun sendiri, bukan ke lead).
alter table public.owners
  add column if not exists notify_wa_number text;
