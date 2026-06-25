-- Halaman Detail Lead (native CRM v1): catatan manual owner, tag, dan
-- sinyal beli/keberatan yang dideteksi AI dari transkrip (terpisah dari
-- analysis_notes/evaluation yang sudah ada supaya tidak menimpa makna lama).
alter table public.leads
  add column owner_note text,
  add column tags text[] not null default '{}';

alter table public.lead_audits
  add column buying_signals text[] not null default '{}',
  add column objections text[] not null default '{}';
