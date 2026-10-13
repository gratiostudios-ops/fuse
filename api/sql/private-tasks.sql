-- Run AFTER catalog-read.sql. Public suggestions policies are unchanged.
-- Requires the tasks/users columns documented in OVERVIEW.md.
begin;

alter table public.tasks enable row level security;
revoke select on public.tasks from anon, public;
grant usage on schema public to authenticated;
grant select on public.tasks to authenticated;

drop policy if exists fuse_tasks_read_own on public.tasks;
create policy fuse_tasks_read_own
  on public.tasks for select to authenticated
  using (user_id = (select auth.uid()));

-- Restrictive policies AND with existing permissive ones, including PUBLIC policies.
drop policy if exists fuse_tasks_require_owner on public.tasks;
create policy fuse_tasks_require_owner
  on public.tasks as restrictive for select to public
  using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create index if not exists fuse_tasks_user_due_idx
  on public.tasks (user_id, due_date, due_time, id);

-- Google sign-in creates auth.users. Populate public.users for task FK ownership.
create or replace function public.fuse_create_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null then
    insert into public.users (id, name, email_id, created_at)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
      new.email,
      new.created_at
    ) on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.fuse_create_user_profile() from public, anon, authenticated;
drop trigger if exists fuse_auth_user_profile on auth.users;
create trigger fuse_auth_user_profile
  after insert on auth.users for each row
  execute function public.fuse_create_user_profile();

-- Also cover Google users created before this trigger was installed.
insert into public.users (id, name, email_id, created_at)
select id, coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', email), email, created_at
from auth.users where email is not null
on conflict (id) do nothing;

commit;

select policyname, roles, cmd, permissive, qual
from pg_policies where schemaname = 'public' and tablename = 'tasks';
