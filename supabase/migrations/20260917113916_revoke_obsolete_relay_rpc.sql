-- Explicitly requested security repair. Keep the function and V1 workflow intact.
-- Audited push-note/work-relay use service-role table writes, never this public RPC.
begin;
revoke execute on function public.relay_set_note(text) from public,anon,authenticated;
grant execute on function public.relay_set_note(text) to service_role;
commit;
