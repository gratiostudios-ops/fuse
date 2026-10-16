begin;

-- Queue discovery from the website without exposing the worker secret to it.
-- Manual runs leave the automatic 72-hour schedule unchanged.
create or replace function public.fuse_start_catalog_collection(actor uuid, topic_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing uuid; run_id uuid; work jsonb; requested_topic uuid:=topic_id;
begin
  if not exists(select 1 from public.fuse_admins where user_id=actor) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  -- Same mutex used by scheduled claims: concurrent clicks cannot duplicate work.
  perform 1 from public.fuse_catalog_schedule where id for update;
  select id into existing from public.fuse_catalog_runs where kind='collection' and status='running';
  if existing is not null then
    return jsonb_build_object('run_id',existing,'already_running',true);
  end if;
  if topic_id is not null and not exists(select 1 from public.topics t where t.id=topic_id) then
    raise exception 'Unknown skill';
  end if;
  if exists(select 1 from public.fuse_catalog_audit where action='collect_now' and created_at>now()-interval '10 minutes') then
    raise exception 'Discovery was recently started. Wait ten minutes between manual collections, or retry a failed batch.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('topic_id',id,'name',name)),'[]') into work from (
    select t.id,t.name from public.topics t left join public.fuse_topic_collection c on c.topic_id=t.id
    where (requested_topic is null or t.id=requested_topic) and exists(select 1 from public.user_topics u where u.topic_id=t.id)
    order by c.last_collected_at asc nulls first,
      (select count(*) from public.suggestion_topics st join public.suggestions s on s.id=st.suggestion_id where st.topic_id=t.id and s.is_active),
      (select count(*) from public.user_topics u where u.topic_id=t.id) desc,t.id limit 10
  ) selected;
  if jsonb_array_length(work)=0 then
    raise exception 'No users have selected these skills yet. Select a skill in Fuse first.';
  end if;
  insert into public.fuse_catalog_runs(kind,items) values('collection',work) returning id into run_id;
  insert into public.fuse_catalog_audit(actor_id,action,details) values(actor,'collect_now',jsonb_build_object('run_id',run_id,'topic_id',topic_id));
  return jsonb_build_object('run_id',run_id,'already_running',false);
end $$;
revoke all on function public.fuse_start_catalog_collection(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fuse_start_catalog_collection(uuid,uuid) to service_role;
commit;
