-- Requires existing tables and columns documented in OVERVIEW.md.
-- Run catalog-read.sql and private-tasks.sql first. This adds read access only.
begin;
do $$
declare t text;
begin
  foreach t in array array['schedules', 'preferences', 'user_topics', 'user_suggestions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke select on public.%I from anon, public', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists fuse_ai_read_own on public.%I', t);
    execute format('create policy fuse_ai_read_own on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('drop policy if exists fuse_ai_require_owner on public.%I', t);
    execute format('create policy fuse_ai_require_owner on public.%I as restrictive for select to public using ((select auth.uid()) is not null and user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Atomic per-user budget; clients cannot edit counters or impersonate a user.
create table if not exists public.ai_limits (
  user_id uuid references auth.users(id) on delete cascade,
  mode text check (mode in ('chat', 'home')),
  window_start timestamptz not null,
  request_count integer not null,
  primary key (user_id, mode)
);
alter table public.ai_limits enable row level security;
revoke all on public.ai_limits from public, anon, authenticated;
create or replace function public.fuse_ai_allow_request(request_mode text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  period interval;
  budget integer;
  accepted integer;
begin
  if owner_id is null or request_mode is null or request_mode not in ('chat', 'home') then return false; end if;
  period := case when request_mode = 'home' then interval '1 hour' else interval '10 minutes' end;
  budget := case when request_mode = 'home' then 6 else 20 end;
  insert into public.ai_limits as limits (user_id, mode, window_start, request_count)
    values (owner_id, request_mode, now(), 1)
  on conflict (user_id, mode) do update set
    window_start = case when limits.window_start <= now() - period then now() else limits.window_start end,
    request_count = case when limits.window_start <= now() - period then 1 else limits.request_count + 1 end
  where limits.window_start <= now() - period or limits.request_count < budget
  returning request_count into accepted;
  return accepted is not null;
end $$;
revoke all on function public.fuse_ai_allow_request(text) from public, anon;
grant execute on function public.fuse_ai_allow_request(text) to authenticated;
commit;
