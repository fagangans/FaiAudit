-- Trigger functions must not be callable via PostgREST RPC by unprivileged roles.
-- touch_lead_last_message is an AFTER INSERT trigger on public.messages;
-- it references NEW.sent_at / NEW.lead_id which are only valid inside a trigger context.
-- Revoking PUBLIC (which includes anon + authenticated) prevents misuse via
-- POST /rest/v1/rpc/touch_lead_last_message while keeping the trigger itself working
-- (triggers execute as the table owner / postgres role, not as anon/authenticated).
REVOKE EXECUTE ON FUNCTION public.touch_lead_last_message() FROM PUBLIC;
