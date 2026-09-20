-- Additive V3 only. Content lives encrypted in private Storage, outside DB backups.
begin;
create table public.relay_v3_state(id int primary key check(id=1),version bigint not null default 0,revision bigint not null default 0,cleanup_at timestamptz);
insert into public.relay_v3_state(id) values(1);
create table public.relay_v3_objects(id uuid primary key,kind text not null check(kind in('note','file')),mime text not null,size int not null check(size between 1 and 20971520),source text not null check(source in('Phone','Workstation','ChatGPT')),ready boolean not null default false,created_at timestamptz not null default now(),expires_at timestamptz not null);
create index on public.relay_v3_objects(expires_at);
create table public.relay_v3_notes(id uuid primary key references public.relay_v3_objects(id) on delete cascade,version bigint not null unique,sequence bigint generated always as identity unique,received_at timestamptz not null default now(),expires_at timestamptz not null default(now()+interval '12 hours'));
create index on public.relay_v3_notes(expires_at);
create table public.relay_v3_nonces(hash text primary key,digest text not null,note_id uuid not null,expires_at timestamptz not null);
create table public.relay_v3_sessions(hash text primary key,unlocked boolean not null default false,expires_at timestamptz not null);
create index on public.relay_v3_sessions(expires_at);
create table public.relay_v3_limits(key text primary key,started_at timestamptz not null,attempts int not null);
do $$ declare t text; begin
foreach t in array array['state','objects','notes','nonces','sessions','limits'] loop
 execute format('alter table public.relay_v3_%I enable row level security',t);
 execute format('revoke all on public.relay_v3_%I from public,anon,authenticated',t);
 execute format('grant all on public.relay_v3_%I to service_role',t);
end loop; end $$;
revoke all on sequence public.relay_v3_notes_sequence_seq from public,anon,authenticated;
grant usage,select on sequence public.relay_v3_notes_sequence_seq to service_role;
create function public.relay_v3_limit(p_key text,p_limit int,p_seconds int) returns boolean language plpgsql security invoker set search_path='' as $$
declare n int; begin
 insert into public.relay_v3_limits as l(key,started_at,attempts) values(p_key,now(),1)
 on conflict(key) do update set attempts=case when l.started_at<now()-make_interval(secs=>p_seconds) then 1 else l.attempts+1 end,started_at=case when l.started_at<now()-make_interval(secs=>p_seconds) then now() else l.started_at end returning attempts into n;
 return n<=p_limit;
end $$;
create function public.relay_v3_reserve(p_id uuid,p_kind text,p_mime text,p_size int,p_source text) returns boolean language plpgsql security invoker set search_path='' as $$
declare bytes bigint; items int; begin
 perform 1 from public.relay_v3_state where id=1 for update;
 select coalesce(sum(size),0),count(*) into bytes,items from public.relay_v3_objects where kind=p_kind and expires_at>now();
 if (p_kind='file' and(bytes+p_size>419430400 or items>=100)) or(p_kind='note' and (items>=500 or bytes+p_size>524288)) then return false;end if;
 insert into public.relay_v3_objects(id,kind,mime,size,source,expires_at) values(p_id,p_kind,p_mime,p_size,p_source,now()+interval '10 minutes');return true;
end $$;
create function public.relay_v3_append(p_id uuid,p_version bigint,p_nonce text,p_digest text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare latest bigint; prior public.relay_v3_nonces; deadline timestamptz:=now()+interval '12 hours'; begin
 select version into latest from public.relay_v3_state where id=1 for update;
 select * into prior from public.relay_v3_nonces where hash=p_nonce;
 if found then
   if prior.digest=p_digest then return jsonb_build_object('status','replayed','id',prior.note_id);end if;
   return jsonb_build_object('status','nonce_reused');
 end if;
 if p_version<=latest then return jsonb_build_object('status','duplicate_or_stale_version');end if;
 if not exists(select 1 from public.relay_v3_objects where id=p_id and kind='note' and not ready and expires_at>now()) then return jsonb_build_object('status','upload_expired');end if;
 insert into public.relay_v3_nonces(hash,digest,note_id,expires_at) values(p_nonce,p_digest,p_id,now()+interval '10 minutes');
 update public.relay_v3_objects set ready=true,expires_at=deadline where id=p_id;
 insert into public.relay_v3_notes(id,version,received_at,expires_at) values(p_id,p_version,now(),deadline);
 update public.relay_v3_state set version=p_version,revision=revision+1 where id=1;
 return jsonb_build_object('status','accepted','id',p_id);
end $$;
create function public.relay_v3_finish_file(p_id uuid,p_ttl int) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_ttl<60 or p_ttl>604800 then return false;end if;
 perform 1 from public.relay_v3_state where id=1 for update;
 update public.relay_v3_objects set ready=true,expires_at=now()+make_interval(secs=>p_ttl) where id=p_id and kind='file' and not ready and expires_at>now();
 if not found then return false;end if;
 update public.relay_v3_state set revision=revision+1 where id=1;return true;
end $$;
create function public.relay_v3_delete_items(p_ids uuid[],p_kind text) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.relay_v3_state where id=1 for update;
 update public.relay_v3_objects set expires_at=now() where id=any(p_ids) and kind=p_kind;
 if p_kind='note' then delete from public.relay_v3_notes where id=any(p_ids);end if;
 update public.relay_v3_state set revision=revision+1 where id=1;
end $$;
create function public.relay_v3_expire() returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.relay_v3_state where id=1 for update;
 delete from public.relay_v3_notes where expires_at<=now();
 if found or exists(select 1 from public.relay_v3_objects where expires_at<=now()) then update public.relay_v3_state set revision=revision+1 where id=1;end if;
 delete from public.relay_v3_nonces where expires_at<=now();
 delete from public.relay_v3_sessions where expires_at<=now();
 delete from public.relay_v3_limits where started_at<now()-interval '1 day';
end $$;
do $$ declare f record;begin
for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'relay_v3_%' loop
 execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
end loop;end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('relay-v3-private','relay-v3-private',false,20971548,array['application/octet-stream']);
-- Preview schedulers must be in Supabase: Netlify draft schedules do not execute.
select cron.schedule('relay-v3-expiry-sweep','* * * * *',$job$
 select net.http_post(url:='https://gvuuiazenabtsbmozrbk.supabase.co/functions/v1/relay-v3/sweep',headers:='{"Content-Type":"application/json"}'::jsonb,body:='{}'::jsonb,timeout_milliseconds:=25000);
$job$);
commit;
