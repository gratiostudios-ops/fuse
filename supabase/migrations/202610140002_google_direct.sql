-- Preserve legacy activity/history data while retiring every import/write-queue entry point.
begin;
-- Extend a pre-existing status constraint, retaining its original allowed values.
do $$
declare existing_rule text;
begin
  select pg_get_expr(conbin, conrelid) into existing_rule
  from pg_constraint
  where conrelid = 'public.calendar_connections'::regclass
    and conname = 'calendar_connections_connection_status_check' and contype = 'c';
  if existing_rule is not null then
    alter table public.calendar_connections drop constraint calendar_connections_connection_status_check;
    execute format('alter table public.calendar_connections add constraint calendar_connections_connection_status_check check ((%s) or connection_status = %L)', existing_rule, 'reconnect_required');
  end if;
end $$;
alter table public.calendar_connections add column if not exists updated_at timestamptz not null default now();
alter table public.organizer_credentials add column if not exists oauth_client_id text;
drop trigger if exists fuse_activity_history on public.tasks;
drop trigger if exists fuse_activity_history on public.schedules;
drop function if exists public.fuse_set_completion(text,uuid,boolean);
drop function if exists public.fuse_import_activity(uuid,text,jsonb);
drop function if exists public.fuse_ack_completion(text,uuid,uuid);
drop function if exists public.fuse_fail_completion(text,uuid,uuid);
drop function if exists public.fuse_delete_source(uuid,text,text,text);
drop function if exists public.fuse_track_activity();
drop function if exists public.fuse_recap_history(uuid,timestamptz,timestamptz);
drop function if exists public.fuse_claim_connection(uuid,uuid);
drop function if exists public.fuse_consume_oauth(text);
drop function if exists public.fuse_finish_oauth(uuid,bigint,text,text,text);
revoke all on public.tasks,public.schedules,public.organizer_oauth_states,public.organizer_sync_queue,public.organizer_completion_history from public,anon,authenticated,service_role;
revoke all on sequence public.organizer_completion_history_id_seq from public,anon,authenticated,service_role;
comment on table public.tasks is 'Archived legacy organizer data. Runtime activity comes directly from Google.';
comment on table public.schedules is 'Archived legacy organizer data. Runtime activity comes directly from Google.';

create or replace function public.fuse_register_google(owner_id uuid,expected_generation bigint,account_id text,account_email text,encrypted_token text,oauth_client text)
returns public.calendar_connections language plpgsql security definer set search_path='' as $$
declare generation bigint; existing public.calendar_connections; saved public.calendar_connections; begin
  if nullif(account_id,'') is null or nullif(encrypted_token,'') is null or nullif(oauth_client,'') is null then raise exception 'Invalid Google credentials'; end if;
  select connection_generation into generation from public.organizer_settings where user_id=owner_id for update;
  if generation is null or generation<>expected_generation then raise exception 'Connection authorization was cancelled or replaced'; end if;
  select * into existing from public.calendar_connections where user_id=owner_id for update;
  if existing.google_account_id is not null and existing.google_account_id<>account_id then raise exception 'Reconnect original Google account'; end if;
  insert into public.calendar_connections(user_id,google_account_id,google_acc,google_calendar_id,connection_status)
  values(owner_id,account_id,account_email,'primary','connected')
  on conflict(user_id) do update set google_account_id=excluded.google_account_id,google_acc=excluded.google_acc,
    connection_status='connected',updated_at=now(),last_error=null,calendar_sync_token=null,lease_token=null,lease_until=null returning * into saved;
  insert into public.organizer_credentials(connection_id,encrypted_refresh_token,oauth_client_id) values(saved.id,encrypted_token,oauth_client)
  on conflict(connection_id) do update set encrypted_refresh_token=excluded.encrypted_refresh_token,oauth_client_id=excluded.oauth_client_id;
  update public.organizer_settings set connection_generation=connection_generation+1,recap_lease_token=null,recap_lease_until=null where user_id=owner_id;
  return saved;
end $$;
create or replace function public.fuse_disconnect_google(owner_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare connection uuid; begin
  perform user_id from public.organizer_settings where user_id=owner_id for update;
  update public.organizer_settings set connection_generation=connection_generation+1,recap_lease_token=null,recap_lease_until=null where user_id=owner_id;
  update public.calendar_connections set connection_status='disconnected',updated_at=now(),calendar_sync_token=null,lease_token=null,lease_until=null,last_error=null
    where user_id=owner_id returning id into connection;
  delete from public.organizer_credentials where connection_id=connection;
end $$;
revoke all on function public.fuse_register_google(uuid,bigint,text,text,text,text) from public,anon,authenticated;
grant execute on function public.fuse_register_google(uuid,bigint,text,text,text,text) to service_role;
revoke all on function public.fuse_disconnect_google(uuid) from public,anon,authenticated;
grant execute on function public.fuse_disconnect_google(uuid) to service_role;
create or replace function public.fuse_save_google_recap(owner_id uuid,claim_token uuid,expected_generation bigint,expected_timezone text,payload jsonb)
returns setof public.organizer_daily_recaps language plpgsql security definer set search_path='' as $$
declare settings public.organizer_settings; begin
  select * into settings from public.organizer_settings where user_id=owner_id for update;
  if settings.recap_lease_token is distinct from claim_token or settings.connection_generation<>expected_generation or settings.timezone<>expected_timezone then return; end if;
  return query insert into public.organizer_daily_recaps(user_id,local_date,timezone,completed_today,tomorrow_plan,generated_at,input_revision,source_status)
  values(owner_id,(payload->>'local_date')::date,expected_timezone,payload->>'completed_today',payload->>'tomorrow_plan',(payload->>'generated_at')::timestamptz,0,payload->'source_status')
  on conflict(user_id,local_date) do update set timezone=excluded.timezone,completed_today=excluded.completed_today,
    tomorrow_plan=excluded.tomorrow_plan,generated_at=excluded.generated_at,input_revision=0,source_status=excluded.source_status returning *;
end $$;
revoke all on function public.fuse_save_google_recap(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.fuse_save_google_recap(uuid,uuid,bigint,text,jsonb) to service_role;
-- Old credentials cannot be assumed to share Supabase's OAuth client. Reauthorization verifies it.
update public.calendar_connections set connection_status='reconnect_required',last_error='Reconnect Google Calendar with the combined Google sign-in.'
where connection_status='connected' and id in (select connection_id from public.organizer_credentials where oauth_client_id is null);
commit;
