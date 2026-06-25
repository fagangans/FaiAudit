-- Master bisa atur per-client AI provider mana yang dipakai untuk analisis
-- lead: 'scraper' (AI biasa/cepat, default) atau 'qwen' (OpenRouter).
alter table public.owners
  add column ai_provider text not null default 'scraper'
  check (ai_provider in ('scraper', 'qwen'));
