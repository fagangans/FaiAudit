-- Monitoring dashboard: uptime + security posture for all Fagan web projects.
-- Prefixed monitor_ to stay clearly separated from the FaiAudit product's own
-- tables (owners/staff/leads/messages/lead_audits) sharing this same project.
-- No RLS policies are defined (matches the rest of this schema): the server
-- only ever talks to these tables via the service-role client, gated by the
-- requireOwner + requireMaster middleware at the route layer.

create table public.monitor_targets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- Nullable on purpose: rows are seeded from the known repo list below
  -- before every project necessarily has a live public URL yet. Uptime
  -- checks are skipped for a target until its url is filled in via the
  -- dashboard (POST/PATCH /api/admin/monitoring/targets).
  url text,
  repo_full_name text, -- e.g. "fagangans/FaiAudit", for linking findings back to a repo
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.monitor_uptime_checks (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.monitor_targets(id) on delete cascade,
  checked_at timestamptz not null default now(),
  is_up boolean not null,
  status_code integer,
  response_ms integer,
  error text
);
create index on public.monitor_uptime_checks (target_id, checked_at desc);

create table public.monitor_security_findings (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.monitor_targets(id) on delete cascade,
  owasp_category text not null, -- e.g. "A02:2021 Cryptographic Failures"
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  summary text not null,
  file_ref text, -- e.g. "src/lib/auth.ts:14"
  status text not null default 'open' check (status in ('open', 'fixed', 'accepted_risk')),
  checked_at timestamptz not null default now()
);
create index on public.monitor_security_findings (target_id, checked_at desc);
create index on public.monitor_security_findings (status);

alter table public.monitor_targets enable row level security;
alter table public.monitor_uptime_checks enable row level security;
alter table public.monitor_security_findings enable row level security;

-- url sengaja dikosongkan (NULL) di sini — isi lewat dashboard (menu
-- Monitoring > tambah/edit target) dengan domain publik yang sebenarnya.
insert into public.monitor_targets (name, repo_full_name) values
  ('FAGANFAiAgent', 'fagangans/FAGANFAiAgent'),
  ('FAiAgentWebsite', 'fagangans/FAiAgentWebsite'),
  ('Scraper-scraping-fagan', 'fagangans/Scraper-scraping-fagan'),
  ('faganbelajarbahasainggris', 'fagangans/faganbelajarbahasainggris'),
  ('FaiAudit', 'fagangans/FaiAudit'),
  ('AiwhatsappbussinesFaganFaAl', 'fagangans/AiwhatsappbussinesFaganFaAl'),
  ('faicorouselmaker', 'fagangans/faicorouselmaker'),
  ('Faibleclip', 'fagangans/Faibleclip')
on conflict (name) do nothing;
