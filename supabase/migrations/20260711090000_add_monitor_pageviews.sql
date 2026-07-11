-- Traffic tracking for the 4 public-facing websites (not the API/bot targets,
-- those don't have "page views" in a meaningful sense — deferred to a later
-- phase). Ingested via the public, unauthenticated /api/monitoring-ingest/pageview
-- endpoint (called from visitor browsers via the beacon snippet), so this is
-- basic best-effort analytics, not a security control — data can be spoofed
-- by a motivated visitor, same trust level as any client-side analytics beacon.

create table public.monitor_pageviews (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.monitor_targets(id) on delete cascade,
  path text not null,
  referrer text,
  device_type text not null default 'unknown' check (device_type in ('mobile', 'tablet', 'desktop', 'unknown')),
  country text, -- ISO country code, best-effort from hosting provider's geo header; null if unavailable
  visitor_hash text, -- salted hash of IP+UA for rough unique-visitor counting, not raw PII
  created_at timestamptz not null default now()
);
create index on public.monitor_pageviews (target_id, created_at desc);
create index on public.monitor_pageviews (target_id, path);

alter table public.monitor_pageviews enable row level security;
