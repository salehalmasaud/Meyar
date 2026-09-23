-- Add scoped read access for Relay V3 files without widening existing send-only grants.
begin;

alter table public.relay_v3_oauth_codes
  add column if not exists scope text not null default 'notes.write';

alter table public.relay_v3_oauth_tokens
  add column if not exists scope text not null default 'notes.write';

create or replace function public.relay_v3_oauth_redeem_scoped(
  p_hash text,
  p_client text,
  p_challenge text,
  p_redirect text,
  p_resource text
) returns text
language plpgsql
security invoker
set search_path=''
as $$
declare s text;
begin
  delete from public.relay_v3_oauth_codes
  where hash=p_hash
    and client_id=p_client
    and challenge=p_challenge
    and redirect_uri=p_redirect
    and resource=p_resource
    and expires_at>now()
  returning scope into s;
  return s;
end $$;

create or replace function public.relay_v3_oauth_refresh_scoped(
  p_hash text,
  p_client text,
  p_resource text
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare g uuid; s text;
begin
  delete from public.relay_v3_oauth_tokens
  where hash=p_hash
    and client_id=p_client
    and kind='refresh'
    and resource=p_resource
    and expires_at>now()
  returning grant_id,scope into g,s;

  if g is null then return null; end if;
  return jsonb_build_object('grant_id',g,'scope',s);
end $$;

revoke execute on function public.relay_v3_oauth_redeem_scoped(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.relay_v3_oauth_redeem_scoped(text,text,text,text,text) to service_role;

revoke execute on function public.relay_v3_oauth_refresh_scoped(text,text,text) from public,anon,authenticated;
grant execute on function public.relay_v3_oauth_refresh_scoped(text,text,text) to service_role;

commit;
