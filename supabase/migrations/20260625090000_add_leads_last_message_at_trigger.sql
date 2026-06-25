alter table public.leads add column if not exists last_message_at timestamptz;

create or replace function public.touch_lead_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leads
  set last_message_at = new.sent_at
  where id = new.lead_id and (last_message_at is null or last_message_at < new.sent_at);
  return new;
end;
$$;

drop trigger if exists trg_touch_lead_last_message on public.messages;
create trigger trg_touch_lead_last_message
  after insert on public.messages
  for each row execute function public.touch_lead_last_message();
