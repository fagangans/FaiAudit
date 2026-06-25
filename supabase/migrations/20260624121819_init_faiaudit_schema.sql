create extension if not exists "pgcrypto";

-- Owners (tenants who rent/use FaiAudit)
create table public.owners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  business_name text,
  plan text not null default 'trial',
  created_at timestamptz not null default now()
);

-- Staff / sales WhatsApp accounts being audited
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  name text not null,
  wa_number text not null,
  wa_session_status text not null default 'disconnected', -- disconnected | pairing | connected
  created_at timestamptz not null default now(),
  unique (owner_id, wa_number)
);

-- Leads / contacts that staff talk to
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  wa_jid text not null,
  name text,
  created_at timestamptz not null default now(),
  unique (staff_id, wa_jid)
);

-- Raw chat log captured passively for audit (no auto-reply)
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text,
  wa_message_id text,
  sent_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on public.messages (lead_id, sent_at);

-- Latest AI audit result per lead (funnel stage, score, evaluation)
create table public.lead_audits (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade unique,
  funnel_stage text not null default 'new', -- new | contacted | interested | negotiation | closed_won | closed_lost
  previous_stage text,
  score numeric(5,2),
  analysis_notes text,
  evaluation text,
  ai_model text,
  analyzed_at timestamptz not null default now()
);

alter table public.owners enable row level security;
alter table public.staff enable row level security;
alter table public.leads enable row level security;
alter table public.messages enable row level security;
alter table public.lead_audits enable row level security;

create policy "Owners manage own row" on public.owners
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Owners manage own staff" on public.staff
  for all using (owner_id in (select id from public.owners where user_id = auth.uid()))
  with check (owner_id in (select id from public.owners where user_id = auth.uid()));

create policy "Owners manage own leads" on public.leads
  for all using (owner_id in (select id from public.owners where user_id = auth.uid()))
  with check (owner_id in (select id from public.owners where user_id = auth.uid()));

create policy "Owners manage own messages" on public.messages
  for all using (lead_id in (
    select l.id from public.leads l
    join public.owners o on o.id = l.owner_id
    where o.user_id = auth.uid()
  ));

create policy "Owners manage own audits" on public.lead_audits
  for all using (lead_id in (
    select l.id from public.leads l
    join public.owners o on o.id = l.owner_id
    where o.user_id = auth.uid()
  ));
