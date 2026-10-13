-- Run in the Supabase SQL Editor after confirming the documented catalog schema.
-- Rerunnable: replaces only this script's named policies, preserving admin policies.
-- Existing permissive policies can broaden access: inspect them before running.
begin;

alter table public.suggestions enable row level security;
alter table public.suggestion_topics enable row level security;
alter table public.topics enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.suggestions, public.suggestion_topics, public.topics
  to anon, authenticated;

drop policy if exists fuse_catalog_read_active_suggestions on public.suggestions;
create policy fuse_catalog_read_active_suggestions
  on public.suggestions for select to anon, authenticated
  using (is_active = true);

drop policy if exists fuse_catalog_read_active_topic_links on public.suggestion_topics;
create policy fuse_catalog_read_active_topic_links
  on public.suggestion_topics for select to anon, authenticated
  using (
    exists (
      select 1 from public.suggestions s
      where s.id = suggestion_topics.suggestion_id and s.is_active = true
    )
  );

drop policy if exists fuse_catalog_read_topics on public.topics;
create policy fuse_catalog_read_topics
  on public.topics for select to anon, authenticated
  using (true);

-- Supports filtering by topic; the documented composite PK starts with suggestion_id.
create index if not exists fuse_suggestion_topics_topic_id_idx
  on public.suggestion_topics (topic_id, suggestion_id);

commit;

-- Review all existing policies: public roles should not have catalog write policies.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('suggestions', 'suggestion_topics', 'topics')
order by tablename, policyname;
