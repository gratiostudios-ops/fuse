begin;

create or replace function public.fuse_set_user_topics(topic_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); begin
  if owner_id is null then raise exception 'Sign in required'; end if;
  if exists (select 1 from unnest(coalesce(topic_ids, '{}'::uuid[])) topic_id where not exists (select 1 from public.topics where id = topic_id)) then
    raise exception 'Unknown topic';
  end if;
  delete from public.user_topics where user_id = owner_id;
  insert into public.user_topics(user_id, topic_id)
  select owner_id, topic_id from unnest(coalesce(topic_ids, '{}'::uuid[])) topic_id;
end $$;

revoke all on function public.fuse_set_user_topics(uuid[]) from public, anon;
grant execute on function public.fuse_set_user_topics(uuid[]) to authenticated;
commit;
