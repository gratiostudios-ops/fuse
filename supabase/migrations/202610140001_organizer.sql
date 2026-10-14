-- Additive migration. Requires existing users/tasks/schedules from OVERVIEW.md.
begin;
create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  google_account_id text, google_acc text, google_calendar_id text not null default 'primary',
  connection_status text not null default 'connected', calendar_sync_token text,
  last_calendar_sync_at timestamptz, last_tasks_sync_at timestamptz, created_at timestamptz not null default now()
);
alter table public.calendar_connections add column if not exists google_account_id text;
alter table public.calendar_connections add column if not exists google_acc text;
alter table public.calendar_connections add column if not exists google_calendar_id text default 'primary';
alter table public.calendar_connections add column if not exists connection_status text default 'connected';
alter table public.calendar_connections add column if not exists calendar_sync_token text;
alter table public.calendar_connections add column if not exists last_calendar_sync_at timestamptz;
alter table public.calendar_connections add column if not exists last_tasks_sync_at timestamptz;
alter table public.calendar_connections add column if not exists calendar_window_date date;
alter table public.calendar_connections add column if not exists last_error text;
alter table public.calendar_connections add column if not exists next_sync_at timestamptz default now();
alter table public.calendar_connections add column if not exists lease_token uuid;
alter table public.calendar_connections add column if not exists lease_until timestamptz;
-- Deliberately fails on duplicate existing accounts: inspect/consolidate before deploying.
create unique index if not exists fuse_one_google_account on public.calendar_connections(user_id);

alter table public.tasks alter column due_date drop not null;
alter table public.tasks add column if not exists google_tasklist_id text;
alter table public.tasks add column if not exists completed_at timestamptz;
alter table public.tasks add column if not exists source_updated_at timestamptz;
alter table public.tasks add column if not exists source_deleted boolean not null default false;
alter table public.schedules add column if not exists completed_at timestamptz;
alter table public.schedules add column if not exists source_updated_at timestamptz;
alter table public.schedules add column if not exists source_deleted boolean not null default false;
alter table public.schedules add column if not exists is_all_day boolean not null default false;
alter table public.schedules add column if not exists start_date date;
alter table public.schedules add column if not exists end_date date;
alter table public.schedules add column if not exists source_timezone text;
alter table public.schedules add column if not exists google_calendar_id text not null default 'primary';
alter table public.schedules add column if not exists recurring_event_id text;
create unique index if not exists fuse_google_task_key on public.tasks(google_connection_id,google_tasklist_id,google_task_id);
create unique index if not exists fuse_google_event_key on public.schedules(google_connection_id,google_calendar_id,cal_event_id);

create table if not exists public.organizer_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  timezone text not null default 'UTC', timezone_initialized boolean not null default false, connection_generation bigint not null default 0, revision bigint not null default 0,
  created_at timestamptz not null default now(), next_recap_at timestamptz not null default now(),
  recap_lease_token uuid, recap_lease_until timestamptz
);
create table if not exists public.organizer_credentials (
  connection_id uuid primary key references public.calendar_connections(id) on delete cascade,
  encrypted_refresh_token text not null
);
create table if not exists public.organizer_oauth_states (
  state text primary key, user_id uuid not null references public.users(id) on delete cascade,
  verifier text not null, connection_generation bigint not null, expires_at timestamptz not null
);
create table if not exists public.organizer_sync_queue (
  kind text not null check(kind in ('task','schedule')), item_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null references public.calendar_connections(id) on delete cascade,
  completed boolean not null, completed_at timestamptz, version uuid not null default gen_random_uuid(),
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(), last_error text,
  primary key(kind,item_id)
);
create table if not exists public.organizer_completion_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null, item_id uuid not null, completed boolean not null,
  completed_at timestamptz, recorded_at timestamptz not null default now(),
  source text not null, snapshot jsonb not null
);
create index if not exists fuse_completion_day on public.organizer_completion_history(user_id,completed_at);
create table if not exists public.organizer_daily_recaps (
  user_id uuid not null references public.users(id) on delete cascade, local_date date not null,
  timezone text not null, completed_today text not null, tomorrow_plan text not null,
  generated_at timestamptz not null default now(), input_revision bigint not null,
  source_status jsonb not null default '{}', primary key(user_id,local_date)
);

-- Explicitly remove client writes, including legacy grants/policies.
do $$ declare t text; begin
  foreach t in array array['calendar_connections','organizer_settings','organizer_completion_history','organizer_daily_recaps'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    if t='calendar_connections' then
      execute 'grant select(id,user_id,google_acc,google_account_id,google_calendar_id,connection_status,last_calendar_sync_at,last_tasks_sync_at,last_error) on public.calendar_connections to authenticated';
    elsif t='organizer_settings' then
      execute 'grant select(user_id,timezone,revision,created_at) on public.organizer_settings to authenticated';
    else execute format('grant select on public.%I to authenticated',t); end if;
    execute format('drop policy if exists fuse_organizer_read on public.%I',t);
    execute format('create policy fuse_organizer_read on public.%I for select to authenticated using (user_id = (select auth.uid()))',t);
    execute format('drop policy if exists fuse_organizer_owner on public.%I',t);
    execute format('create policy fuse_organizer_owner on public.%I as restrictive for all to public using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  foreach t in array array['organizer_credentials','organizer_oauth_states','organizer_sync_queue'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('drop policy if exists fuse_backend_only on public.%I',t);
    execute format('create policy fuse_backend_only on public.%I as restrictive for all to public using (false) with check (false)',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  foreach t in array array['tasks','schedules'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke insert,update,delete on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('drop policy if exists fuse_organizer_read on public.%I',t);
    execute format('create policy fuse_organizer_read on public.%I for select to authenticated using (user_id = (select auth.uid()))',t);
    execute format('drop policy if exists fuse_organizer_owner on public.%I',t);
    execute format('create policy fuse_organizer_owner on public.%I as restrictive for all to public using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant usage,select on sequence public.organizer_completion_history_id_seq to service_role;

create or replace function public.fuse_track_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare changed boolean; begin
  changed := TG_OP='INSERT';
  if TG_OP='UPDATE' then changed := (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at'); end if;
  if not changed then return new; end if;
  new.updated_at := now();
  insert into public.organizer_settings(user_id) values(new.user_id) on conflict do nothing;
  update public.organizer_settings set revision=revision+1 where user_id=new.user_id;
  if (TG_OP='INSERT' and new.mark_completed) or
     (TG_OP='UPDATE' and (new.mark_completed is distinct from old.mark_completed or new.completed_at is distinct from old.completed_at)) then
    insert into public.organizer_completion_history(user_id,kind,item_id,completed,completed_at,source,snapshot)
    values(new.user_id,case when TG_TABLE_NAME='tasks' then 'task' else 'schedule' end,new.id,
      new.mark_completed,new.completed_at,coalesce(nullif(current_setting('fuse.completion_source',true),''),'google'),to_jsonb(new));
  end if;
  return new;
end $$;
drop trigger if exists fuse_activity_history on public.tasks;
create trigger fuse_activity_history before insert or update on public.tasks for each row execute function public.fuse_track_activity();
drop trigger if exists fuse_activity_history on public.schedules;
create trigger fuse_activity_history before insert or update on public.schedules for each row execute function public.fuse_track_activity();

create or replace function public.fuse_set_completion(item_kind text, target_id uuid, desired_completed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); t text; r jsonb; stamp timestamptz; begin
  if owner_id is null or desired_completed is null or item_kind is null or item_kind not in ('task','schedule') then raise exception 'Invalid completion request'; end if;
  t:=case when item_kind='task' then 'tasks' else 'schedules' end;
  execute format('select to_jsonb(x) from public.%I x where id=$1 and user_id=$2 and not source_deleted for update',t) into r using target_id,owner_id;
  if r is null then raise exception 'Activity not found'; end if;
  if (r->>'mark_completed')::boolean = desired_completed then return r; end if;
  stamp:=case when desired_completed then now() else null end;
  perform set_config('fuse.completion_source','app',true);
  execute format('update public.%I set mark_completed=$1,completed_at=$2,sync_status=$3 where id=$4 returning to_jsonb(%I.*)',t,t)
    into r using desired_completed,stamp,case when r->>'google_connection_id' is null then 'synced' else 'pending' end,target_id;
  if r->>'google_connection_id' is not null then
    insert into public.organizer_sync_queue(kind,item_id,user_id,connection_id,completed,completed_at)
    values(item_kind,target_id,owner_id,(r->>'google_connection_id')::uuid,desired_completed,stamp)
    on conflict(kind,item_id) do update set completed=excluded.completed,completed_at=excluded.completed_at,
      version=gen_random_uuid(),attempts=0,next_attempt_at=now(),last_error=null;
    update public.calendar_connections set next_sync_at=now() where id=(r->>'google_connection_id')::uuid;
  end if;
  return r;
end $$;
revoke all on function public.fuse_set_completion(text,uuid,boolean) from public,anon;
grant execute on function public.fuse_set_completion(text,uuid,boolean) to authenticated;

-- All worker RPCs below are service-role only; imports and acknowledgements lock the item.
create or replace function public.fuse_import_activity(connection uuid,item_kind text,payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid; t text; r jsonb; pending boolean; data jsonb; item uuid; begin
  select user_id into owner_id from public.calendar_connections where id=connection and connection_status='connected';
  if owner_id is null then raise exception 'Connection unavailable'; end if;
  t:=case when item_kind='task' then 'tasks' when item_kind='schedule' then 'schedules' end;
  if t is null then raise exception 'Invalid kind'; end if;
  if item_kind='task' then
    select to_jsonb(x) into r from public.tasks x where google_connection_id=connection and google_tasklist_id=payload->>'google_tasklist_id' and google_task_id=payload->>'google_task_id' for update;
  else
    select to_jsonb(x) into r from public.schedules x where google_connection_id=connection and google_calendar_id=payload->>'google_calendar_id' and cal_event_id=payload->>'cal_event_id' for update;
  end if;
  if r is null and coalesce((payload->>'source_deleted')::boolean,false) then return; end if;
  item:=coalesce((r->>'id')::uuid,gen_random_uuid());
  select exists(select 1 from public.organizer_sync_queue where kind=item_kind and item_id=item) into pending;
  data:=coalesce(r,'{}')||payload||jsonb_build_object('id',item,'user_id',owner_id,'google_connection_id',connection,
    'sync_status',case when pending then coalesce(r->>'sync_status','pending') else 'synced' end,
    'created_at',coalesce(r->>'created_at',now()::text),'updated_at',now());
  if item_kind='task' and r is not null then data:=data||jsonb_build_object('due_time',r->'due_time'); end if;
  if pending then data:=data||jsonb_build_object('mark_completed',r->'mark_completed','completed_at',r->'completed_at'); end if;
  perform set_config('fuse.completion_source','google',true);
  if item_kind='task' then
    insert into public.tasks select * from jsonb_populate_record(null::public.tasks,data)
    on conflict(id) do update set title=excluded.title,description=excluded.description,due_date=excluded.due_date,
      due_time=excluded.due_time,mark_completed=excluded.mark_completed,completed_at=excluded.completed_at,
      source_deleted=excluded.source_deleted,source_updated_at=excluded.source_updated_at,sync_status=excluded.sync_status;
  else
    insert into public.schedules select * from jsonb_populate_record(null::public.schedules,data)
    on conflict(id) do update set title=excluded.title,description=excluded.description,valid_from=excluded.valid_from,
      valid_to=excluded.valid_to,mark_completed=excluded.mark_completed,completed_at=excluded.completed_at,
      source_deleted=excluded.source_deleted,source_updated_at=excluded.source_updated_at,sync_status=excluded.sync_status,
      is_all_day=excluded.is_all_day,start_date=excluded.start_date,end_date=excluded.end_date,
      source_timezone=excluded.source_timezone,recurring_event_id=excluded.recurring_event_id;
  end if;
end $$;

create or replace function public.fuse_ack_completion(item_kind text,target_id uuid,expected_version uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare t text; removed uuid; begin
  t:=case when item_kind='task' then 'tasks' when item_kind='schedule' then 'schedules' end;
  if t is null then raise exception 'Invalid kind'; end if;
  execute format('select id from public.%I where id=$1 for update',t) using target_id;
  delete from public.organizer_sync_queue where kind=item_kind and item_id=target_id and version=expected_version returning item_id into removed;
  if removed is null then return false; end if;
  execute format('update public.%I set sync_status=$1 where id=$2',t) using 'synced',target_id;
  return true;
end $$;

create or replace function public.fuse_claim_connection(target_id uuid,claim_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed uuid; begin
  update public.calendar_connections set lease_token=claim_token,lease_until=now()+interval '5 minutes'
  where id=target_id and connection_status='connected' and (lease_until is null or lease_until<now()) returning id into claimed;
  return claimed is not null;
end $$;
create or replace function public.fuse_claim_recap(owner_id uuid,claim_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed uuid; begin
  update public.organizer_settings set recap_lease_token=claim_token,recap_lease_until=now()+interval '3 minutes'
  where user_id=owner_id and (recap_lease_until is null or recap_lease_until<now()) returning user_id into claimed;
  return claimed is not null;
end $$;
create or replace function public.fuse_consume_oauth(oauth_state text)
returns setof public.organizer_oauth_states language sql security definer set search_path='' as $$
  delete from public.organizer_oauth_states where state=oauth_state and expires_at>now() returning *;
$$;
create or replace function public.fuse_fail_completion(item_kind text,target_id uuid,expected_version uuid)
returns void language plpgsql security definer set search_path='' as $$
declare t text; begin
  t:=case when item_kind='task' then 'tasks' when item_kind='schedule' then 'schedules' end;
  if t is null then raise exception 'Invalid kind'; end if;
  execute format('select id from public.%I where id=$1 for update',t) using target_id;
  if exists(select 1 from public.organizer_sync_queue where kind=item_kind and item_id=target_id and version=expected_version) then
    execute format('update public.%I set sync_status=$1 where id=$2',t) using 'error',target_id;
  end if;
end $$;
create or replace function public.fuse_delete_source(connection uuid,item_kind text,source_id text,list_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if item_kind='task' then
    update public.tasks set source_deleted=true where google_connection_id=connection and google_task_id=source_id and google_tasklist_id=list_id;
  elsif item_kind='schedule' then
    update public.schedules set source_deleted=true where google_connection_id=connection and cal_event_id=source_id and google_calendar_id='primary';
  else raise exception 'Invalid kind'; end if;
end $$;

create or replace function public.fuse_recap_history(owner_id uuid,day_start timestamptz,day_end timestamptz)
returns setof public.organizer_completion_history language sql security definer set search_path='' as $$
  select latest.* from (
    select distinct on (kind,item_id) * from public.organizer_completion_history
    where user_id=owner_id order by kind,item_id,id desc
  ) latest where completed and completed_at>=day_start and completed_at<day_end;
$$;
create or replace function public.fuse_finish_oauth(owner_id uuid,expected_generation bigint,account_id text,account_email text,encrypted_token text)
returns public.calendar_connections language plpgsql security definer set search_path='' as $$
declare generation bigint; existing public.calendar_connections; saved public.calendar_connections; begin
  select connection_generation into generation from public.organizer_settings where user_id=owner_id for update;
  if generation is null or generation<>expected_generation then raise exception 'Connection authorization was cancelled'; end if;
  select * into existing from public.calendar_connections where user_id=owner_id for update;
  if existing.google_account_id is not null and existing.google_account_id<>account_id then raise exception 'Reconnect original Google account'; end if;
  insert into public.calendar_connections(user_id,google_account_id,google_acc,google_calendar_id,connection_status,next_sync_at)
  values(owner_id,account_id,account_email,'primary','connected',now())
  on conflict(user_id) do update set google_account_id=excluded.google_account_id,google_acc=excluded.google_acc,
    connection_status='connected',next_sync_at=now(),last_error=null returning * into saved;
  insert into public.organizer_credentials(connection_id,encrypted_refresh_token) values(saved.id,encrypted_token)
  on conflict(connection_id) do update set encrypted_refresh_token=excluded.encrypted_refresh_token;
  update public.organizer_settings set connection_generation=connection_generation+1,revision=revision+1 where user_id=owner_id;
  return saved;
end $$;
create or replace function public.fuse_disconnect_google(owner_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare connection uuid; begin
  perform user_id from public.organizer_settings where user_id=owner_id for update;
  update public.organizer_settings set connection_generation=connection_generation+1,revision=revision+1 where user_id=owner_id;
  update public.calendar_connections set connection_status='disconnected',calendar_sync_token=null,lease_token=null,
    lease_until=null,last_error=null where user_id=owner_id returning id into connection;
  delete from public.organizer_credentials where connection_id=connection;
  delete from public.organizer_oauth_states where user_id=owner_id;
end $$;
-- Revoke PostgreSQL's default PUBLIC function execution.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('fuse_import_activity','fuse_ack_completion','fuse_claim_connection','fuse_claim_recap','fuse_consume_oauth','fuse_track_activity','fuse_fail_completion','fuse_delete_source','fuse_recap_history','fuse_finish_oauth','fuse_disconnect_google') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
insert into public.organizer_settings(user_id) select id from public.users on conflict do nothing;
commit;
