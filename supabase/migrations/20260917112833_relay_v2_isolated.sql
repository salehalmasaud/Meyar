-- Additive V2 namespace only. Does not alter V1 tables, functions, grants or data.
begin;
create table public.relay_v2_state (
  id integer primary key check(id=1), version bigint not null default 0,
  revision bigint not null default 0, note_id uuid, received_at timestamptz,
  expires_at timestamptz
);
insert into public.relay_v2_state(id) values(1);
create table public.relay_v2_objects (
  id uuid primary key, kind text not null check(kind in ('note','file')),
  mime text not null, size integer not null check(size between 1 and 20971520),
  source text not null check(source in ('Phone','Work computer','Device','ChatGPT')),
  ready boolean not null default false,
  created_at timestamptz not null default now(), expires_at timestamptz not null
);
create index on public.relay_v2_objects(expires_at);
create table public.relay_v2_nonces(hash text primary key, expires_at timestamptz not null);
create table public.relay_v2_devices(hash text primary key, expires_at timestamptz not null);
create table public.relay_v2_sessions(id uuid primary key, device text not null references public.relay_v2_devices(hash) on delete cascade, expires_at timestamptz not null);
create table public.relay_v2_invites(hash text primary key, expires_at timestamptz not null);
create table public.relay_v2_limits(key text primary key, started_at timestamptz not null, attempts integer not null);
create table public.relay_v2_health(id integer primary key check(id=1), cleanup_at timestamptz, cleanup_ok boolean);
insert into public.relay_v2_health(id) values(1);
do $$ declare t text; begin
 foreach t in array array['state','objects','nonces','devices','sessions','invites','limits','health'] loop
  execute format('alter table public.relay_v2_%I enable row level security', t);
  execute format('revoke all on public.relay_v2_%I from public, anon, authenticated', t);
  execute format('grant all on public.relay_v2_%I to service_role', t);
 end loop;
end $$;

create function public.relay_v2_limit(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 insert into public.relay_v2_limits as l(key,started_at,attempts) values(p_key,now(),1)
 on conflict(key) do update set
 attempts=case when l.started_at < now()-make_interval(secs=>p_seconds) then 1 else l.attempts+1 end,
 started_at=case when l.started_at < now()-make_interval(secs=>p_seconds) then now() else l.started_at end
 returning attempts into n;
 return n<=p_limit;
end $$;
create function public.relay_v2_pair(p_invite text, p_device text, p_expires timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
declare found_hash text;
begin
 delete from public.relay_v2_invites where hash=p_invite and expires_at>now() returning hash into found_hash;
 if found_hash is null then return false; end if;
 insert into public.relay_v2_devices(hash,expires_at) values(p_device,p_expires);
 return true;
end $$;
create function public.relay_v2_reserve(p_id uuid, p_kind text, p_mime text, p_size integer, p_source text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare bytes bigint; items integer;
begin
 perform 1 from public.relay_v2_state where id=1 for update;
 select coalesce(sum(size),0),count(*) into bytes,items from public.relay_v2_objects where kind='file' and expires_at>now();
 if p_kind='file' and (bytes+p_size>209715200 or items>=40) then return false; end if;
 insert into public.relay_v2_objects(id,kind,mime,size,source,expires_at) values(p_id,p_kind,p_mime,p_size,p_source,now()+interval '10 minutes');
 return true;
end $$;
create function public.relay_v2_publish(p_id uuid,p_version bigint,p_nonce text,p_expires timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
declare current_version bigint; old_id uuid;
begin
 select version,note_id into current_version,old_id from public.relay_v2_state where id=1 for update;
 if p_version<=current_version or exists(select 1 from public.relay_v2_nonces where hash=p_nonce) then return false; end if;
 if not exists(select 1 from public.relay_v2_objects where id=p_id and kind='note' and expires_at>now()) then return false; end if;
 insert into public.relay_v2_nonces(hash,expires_at) values(p_nonce,now()+interval '10 minutes');
 update public.relay_v2_objects set ready=true,expires_at=p_expires where id=p_id;
 update public.relay_v2_objects set expires_at=now() where id=old_id;
 update public.relay_v2_state set version=p_version,revision=revision+1,note_id=p_id,received_at=now(),expires_at=p_expires where id=1;
 return true;
end $$;
create function public.relay_v2_finish_file(p_id uuid,p_expires timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.relay_v2_state where id=1 for update;
 update public.relay_v2_objects set ready=true,expires_at=p_expires where id=p_id and kind='file' and not ready and expires_at>now();
 if not found then return false; end if;
 update public.relay_v2_state set revision=revision+1 where id=1; return true;
end $$;
create function public.relay_v2_clear(p_version bigint)
returns boolean language plpgsql security invoker set search_path='' as $$
declare old_id uuid; current_version bigint;
begin
 select note_id,version into old_id,current_version from public.relay_v2_state where id=1 for update;
 if current_version<>p_version then return false; end if;
 update public.relay_v2_objects set expires_at=now() where id=old_id;
 update public.relay_v2_state set note_id=null,expires_at=null,received_at=null,revision=revision+1 where id=1;
 return true;
end $$;
create function public.relay_v2_delete_files(p_ids uuid[])
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.relay_v2_state where id=1 for update;
 update public.relay_v2_objects set expires_at=now() where id=any(p_ids) and kind='file';
 update public.relay_v2_state set revision=revision+1 where id=1;
end $$;
create function public.relay_v2_expire()
returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.relay_v2_state set note_id=null,received_at=null,expires_at=null,revision=revision+1 where id=1 and expires_at<=now();
 delete from public.relay_v2_nonces where expires_at<=now();
 delete from public.relay_v2_sessions where expires_at<=now();
 delete from public.relay_v2_devices where expires_at<=now();
 delete from public.relay_v2_invites where expires_at<=now();
 delete from public.relay_v2_limits where started_at<now()-interval '1 day';
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'relay_v2_%' loop
  execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('relay-v2-private','relay-v2-private',false,20971520,array['application/octet-stream','application/json','application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']);
commit;
