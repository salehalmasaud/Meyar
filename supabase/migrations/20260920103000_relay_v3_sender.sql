-- Additive sender credentials and temporary receipts. No plaintext note content.
begin;
create table public.relay_v3_oauth_clients(id text primary key,redirect_uri text not null,expires_at timestamptz not null default(now()+interval '90 days'));
create table public.relay_v3_oauth_codes(hash text primary key,client_id text not null,redirect_uri text not null,challenge text not null,resource text not null,expires_at timestamptz not null);
create table public.relay_v3_oauth_tokens(hash text primary key,grant_id uuid not null,client_id text not null,kind text not null check(kind in('access','refresh')),resource text not null,expires_at timestamptz not null);
create index on public.relay_v3_oauth_tokens(grant_id);
create table public.relay_v3_sender_control(id int primary key check(id=1),version bigint not null default 0,owner text,lease_until timestamptz);
insert into public.relay_v3_sender_control(id) values(1);
create table public.relay_v3_sender_jobs(key text primary key,grant_id uuid not null,digest text not null,object_id uuid not null,version bigint not null,status text not null default 'pending',note_id uuid,expires_at timestamptz not null default(now()+interval '12 hours'));
create index on public.relay_v3_sender_jobs(expires_at);
create function public.relay_v3_sender_claim(p_key text,p_grant uuid,p_digest text,p_object uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.relay_v3_sender_jobs; c public.relay_v3_sender_control; v bigint; begin
 select * into c from public.relay_v3_sender_control where id=1 for update;
 select * into j from public.relay_v3_sender_jobs where key=p_key;
 if found then
  if j.grant_id<>p_grant or j.digest<>p_digest then return jsonb_build_object('status','conflict');end if;
  if j.status='complete' then return to_jsonb(j);end if;
 end if;
 if c.lease_until>now() then return jsonb_build_object('status','busy');end if;
 if j.key is null then
  select greatest(version,c.version,floor(extract(epoch from clock_timestamp())*1000)::bigint)+1 into v from public.relay_v3_state where id=1;
  insert into public.relay_v3_sender_jobs(key,grant_id,digest,object_id,version) values(p_key,p_grant,p_digest,p_object,v) returning * into j;
  update public.relay_v3_sender_control set version=v where id=1;
 end if;
 update public.relay_v3_sender_control set owner=p_key,lease_until=now()+interval '90 seconds' where id=1;
 return to_jsonb(j);
end $$;
create function public.relay_v3_sender_release(p_key text,p_note uuid default null) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_note is not null then update public.relay_v3_sender_jobs set status='complete',note_id=p_note where key=p_key;end if;
 update public.relay_v3_sender_control set owner=null,lease_until=null where id=1 and owner=p_key;
end $$;
create function public.relay_v3_oauth_redeem(p_hash text,p_client text,p_challenge text,p_redirect text,p_resource text) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 delete from public.relay_v3_oauth_codes where hash=p_hash and client_id=p_client and challenge=p_challenge and redirect_uri=p_redirect and resource=p_resource and expires_at>now();return found;
end $$;
create function public.relay_v3_oauth_refresh(p_hash text,p_client text,p_resource text) returns uuid language plpgsql security invoker set search_path='' as $$
declare g uuid;begin
 delete from public.relay_v3_oauth_tokens where hash=p_hash and client_id=p_client and kind='refresh' and resource=p_resource and expires_at>now() returning grant_id into g;return g;
end $$;
create function public.relay_v3_rotate_session(p_old text,p_new text) returns timestamptz language plpgsql security invoker set search_path='' as $$
declare exp timestamptz;begin
 delete from public.relay_v3_sessions where hash=p_old and expires_at>now() returning expires_at into exp;
 if exp is not null then insert into public.relay_v3_sessions(hash,unlocked,expires_at) values(p_new,false,exp);end if;return exp;
end $$;
do $$ declare t text; f record;begin
 foreach t in array array['oauth_clients','oauth_codes','oauth_tokens','sender_control','sender_jobs'] loop
 execute format('alter table public.relay_v3_%I enable row level security',t);
 execute format('revoke all on public.relay_v3_%I from public,anon,authenticated',t);
 execute format('grant all on public.relay_v3_%I to service_role',t);
 end loop;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'relay_v3_%' loop
 execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
-- Independent expiry cleanup; existing inbox expiry and Storage sweeper are unchanged.
select cron.schedule('relay-v3-sender-expiry','* * * * *',$job$
 delete from public.relay_v3_oauth_codes where expires_at<=now();
 delete from public.relay_v3_oauth_tokens where expires_at<=now();
 delete from public.relay_v3_oauth_clients where expires_at<=now();
 delete from public.relay_v3_sender_jobs where expires_at<=now();
$job$);
commit;
