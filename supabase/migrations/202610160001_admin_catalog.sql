begin;

create table public.fuse_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.fuse_video_drafts (
  id uuid primary key default gen_random_uuid(),
  youtube_video_id text not null unique check (youtube_video_id ~ '^[a-zA-Z0-9_-]{11}$'),
  title text not null, description text, thumbnail_url text, channel_title text,
  duration_minutes integer, video_url text not null,
  topic_ids uuid[] not null default '{}', reason text not null default '',
  status text not null default 'draft' check (status in ('draft','rejected','published')),
  metadata_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.fuse_video_rejections (
  youtube_video_id text not null, topic_id uuid not null references public.topics(id),
  rejected_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  primary key(youtube_video_id,topic_id)
);
create table public.fuse_catalog_audit (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
  action text not null, suggestion_id uuid references public.suggestions(id),
  details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.fuse_catalog_schedule (
  id boolean primary key default true check (id),
  next_collection_at timestamptz not null default now(), next_maintenance_at timestamptz not null default now()
);
insert into public.fuse_catalog_schedule(id) values(true);
-- App clients only read the master catalog; all publication uses checked RPCs.
revoke insert,update,delete on public.suggestions,public.suggestion_topics,public.topics from anon,authenticated;
create table public.fuse_topic_collection (
  topic_id uuid primary key references public.topics(id), last_collected_at timestamptz not null
);
create table public.fuse_catalog_runs (
  id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('collection','maintenance')),
  status text not null default 'running' check(status in ('running','completed','partial')),
  items jsonb not null default '[]', cursor integer not null default 0,
  lease_token uuid, lease_until timestamptz, errors jsonb not null default '[]',
  created_at timestamptz not null default now(), finished_at timestamptz
);
create unique index fuse_catalog_one_running_kind on public.fuse_catalog_runs(kind) where status='running';
-- Track refresh state separately without changing the app's catalog wire format.
create table public.fuse_video_metadata (
  youtube_video_id text primary key, checked_at timestamptz not null default now(), available boolean not null default true
);

-- Administrative tables have no client policies. All access is through checked backend RPCs.
do $$ declare t text; begin
  foreach t in array array['fuse_admins','fuse_video_drafts','fuse_video_rejections','fuse_catalog_audit','fuse_catalog_schedule','fuse_topic_collection','fuse_catalog_runs','fuse_video_metadata'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create or replace function public.fuse_admin_execute(actor uuid, operation text, payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.fuse_video_drafts; s public.suggestions; result jsonb; tags uuid[];
begin
  if not exists(select 1 from public.fuse_admins where user_id=actor) then raise exception 'Admin access required' using errcode='42501'; end if;
  if operation='overview' then
    return jsonb_build_object(
      'skills', coalesce((select jsonb_agg(x order by x.users desc,x.name) from (
        select t.id,t.name,(select count(*) from public.user_topics u where u.topic_id=t.id) as users,
          (select count(*) from public.suggestion_topics st join public.suggestions v on v.id=st.suggestion_id where st.topic_id=t.id and v.is_active) as published,
          (select count(*) from public.fuse_video_drafts vd where vd.status='draft' and t.id=any(vd.topic_ids)) as drafts
        from public.topics t) x),'[]'),
      'schedule',(select to_jsonb(sc) from public.fuse_catalog_schedule sc),
      'runs',coalesce((select jsonb_agg(x) from (select id,kind,status,cursor,jsonb_array_length(items) as total,errors,created_at,finished_at from public.fuse_catalog_runs order by created_at desc limit 10) x),'[]'));
  elsif operation='drafts' then
    return coalesce((select jsonb_agg(x) from (select * from public.fuse_video_drafts
      where status='draft' and (nullif(payload->>'topic_id','') is null or (payload->>'topic_id')::uuid=any(topic_ids))
      order by created_at desc,id limit 50 offset greatest(0,coalesce((payload->>'offset')::int,0))) x),'[]');
  elsif operation='library' then
    return coalesce((select jsonb_agg(x) from (select v.*,array(select st.topic_id from public.suggestion_topics st where st.suggestion_id=v.id) as topic_ids
      from public.suggestions v where nullif(payload->>'topic_id','') is null or exists(select 1 from public.suggestion_topics st where st.suggestion_id=v.id and st.topic_id=(payload->>'topic_id')::uuid)
      order by v.created_at desc,v.id limit 50 offset greatest(0,coalesce((payload->>'offset')::int,0))) x),'[]');
  elsif operation='save_tags' then
    select array_agg(distinct value::uuid) into tags from jsonb_array_elements_text(payload->'topic_ids');
    if coalesce(array_length(tags,1),0)=0 or exists(select 1 from unnest(tags) t where not exists(select 1 from public.topics where id=t)) then raise exception 'Choose at least one existing skill'; end if;
    update public.fuse_video_drafts set topic_ids=tags,updated_at=now() where id=(payload->>'id')::uuid and status='draft' returning * into d;
    if d.id is null then raise exception 'Draft not found'; end if;
    return to_jsonb(d);
  elsif operation='reject' then
    select * into d from public.fuse_video_drafts where id=(payload->>'id')::uuid and status='draft' for update;
    if d.id is null then raise exception 'Draft not found'; end if;
    insert into public.fuse_video_rejections(youtube_video_id,topic_id,rejected_by)
      select d.youtube_video_id,tag,actor from unnest(d.topic_ids) tag on conflict do nothing;
    update public.fuse_video_drafts set status='rejected',updated_at=now() where id=d.id;
  elsif operation='publish' then
    select * into d from public.fuse_video_drafts where id=(payload->>'id')::uuid for update;
    if d.id is null or d.status='rejected' then raise exception 'Draft not found'; end if;
    if cardinality(d.topic_ids)=0 or exists(select 1 from unnest(d.topic_ids) t where not exists(select 1 from public.topics where id=t)) then raise exception 'Choose valid skills'; end if;
    if payload->'video' is null or payload->'video'->>'youtube_video_id' is distinct from d.youtube_video_id then raise exception 'Video verification required'; end if;
    insert into public.suggestions(youtube_video_id,title,description,video_url,thumbnail_url,duration_minutes,is_active)
      values(d.youtube_video_id,payload->'video'->>'title',payload->'video'->>'description',d.video_url,payload->'video'->>'thumbnail_url',(payload->'video'->>'duration_minutes')::int,true)
      on conflict(youtube_video_id) do update set title=excluded.title,description=excluded.description,thumbnail_url=excluded.thumbnail_url,duration_minutes=excluded.duration_minutes,is_active=true,updated_at=now() returning * into s;
    delete from public.suggestion_topics where suggestion_id=s.id;
    insert into public.suggestion_topics(suggestion_id,topic_id) select s.id,t from unnest(d.topic_ids) t;
    update public.fuse_video_drafts set status='published',updated_at=now(),metadata_checked_at=now() where id=d.id;
    insert into public.fuse_video_metadata(youtube_video_id) values(d.youtube_video_id)
      on conflict(youtube_video_id) do update set checked_at=now(),available=true;
    insert into public.fuse_catalog_audit(actor_id,action,suggestion_id,details) values(actor,'publish',s.id,jsonb_build_object('topic_ids',d.topic_ids));
    return to_jsonb(s);
  elsif operation='deactivate' then
    update public.suggestions set is_active=false,updated_at=now() where id=(payload->>'id')::uuid returning * into s;
    if s.id is null then raise exception 'Video not found'; end if;
    insert into public.fuse_catalog_audit(actor_id,action,suggestion_id) values(actor,'deactivate',s.id);
  elsif operation='revise' then
    select * into s from public.suggestions where id=(payload->>'id')::uuid;
    if s.id is null then raise exception 'Video not found'; end if;
    insert into public.fuse_video_drafts(youtube_video_id,title,description,video_url,thumbnail_url,duration_minutes,topic_ids,reason)
      values(s.youtube_video_id,s.title,s.description,s.video_url,s.thumbnail_url,s.duration_minutes,array(select topic_id from public.suggestion_topics where suggestion_id=s.id),'Revision of published video')
      on conflict(youtube_video_id) do update set status='draft',updated_at=now();
  elsif operation='retry' then
    -- Retry one failed item as its own job; never rerun successful items.
    select items->((payload->>'index')::int) into result from public.fuse_catalog_runs where id=(payload->>'run_id')::uuid and status in ('completed','partial')
      and errors @> jsonb_build_array(jsonb_build_object('index',(payload->>'index')::int));
    if result is null then raise exception 'Failed item not found'; end if;
    if exists(select 1 from public.fuse_catalog_runs where status='running' and kind=(select kind from public.fuse_catalog_runs where id=(payload->>'run_id')::uuid)) then raise exception 'A job is already running'; end if;
    insert into public.fuse_catalog_runs(kind,items) select kind,jsonb_build_array(result) from public.fuse_catalog_runs where id=(payload->>'run_id')::uuid;
  else raise exception 'Unknown admin operation'; end if;
  return '{"ok":true}'::jsonb;
end $$;

create or replace function public.fuse_catalog_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fuse_catalog_runs; sc public.fuse_catalog_schedule; work jsonb; token uuid:=gen_random_uuid();
begin
  select * into sc from public.fuse_catalog_schedule where id for update;
  -- Remove expired API metadata even during sustained provider failures.
  update public.suggestions s set title='Video metadata expired',description=null,thumbnail_url=null,duration_minutes=null,is_active=false
    where coalesce((select m.checked_at from public.fuse_video_metadata m where m.youtube_video_id=s.youtube_video_id),s.created_at)<now()-interval '30 days'
      and (s.title<>'Video metadata expired' or s.description is not null or s.thumbnail_url is not null or s.duration_minutes is not null or s.is_active);
  update public.fuse_video_drafts set title='Video metadata expired',description=null,thumbnail_url=null,channel_title=null,duration_minutes=null,reason='Refresh required before review'
    where metadata_checked_at<now()-interval '30 days';
  -- Collection jobs have ten skills maximum: two searches each, twenty per run.
  if sc.next_collection_at<=now() and not exists(select 1 from public.fuse_catalog_runs where kind='collection' and status='running') then
    select coalesce(jsonb_agg(jsonb_build_object('topic_id',id,'name',name)),'[]') into work from (
      select t.id,t.name from public.topics t left join public.fuse_topic_collection c on c.topic_id=t.id
      where exists(select 1 from public.user_topics u where u.topic_id=t.id)
      order by c.last_collected_at asc nulls first,
        (select count(*) from public.suggestion_topics st join public.suggestions v on v.id=st.suggestion_id where st.topic_id=t.id and v.is_active),
        (select count(*) from public.user_topics u where u.topic_id=t.id) desc,t.id limit 10) selected;
    insert into public.fuse_catalog_runs(kind,items) values('collection',work);
    update public.fuse_catalog_schedule set next_collection_at=next_collection_at + (floor(extract(epoch from(now()-next_collection_at))/259200)::int+1)*interval '72 hours' where id;
  end if;
  if sc.next_maintenance_at<=now() and not exists(select 1 from public.fuse_catalog_runs where kind='maintenance' and status='running') then
    select coalesce(jsonb_agg(batch),'[]') into work from (
      select jsonb_agg(video_id) as batch from (
        select video_id,(row_number() over(order by video_id)-1)/50 as batch_no from (
          select youtube_video_id as video_id from public.suggestions union select youtube_video_id from public.fuse_video_drafts where status='draft'
        ) ids
      ) numbered group by batch_no order by batch_no) batches;
    insert into public.fuse_catalog_runs(kind,items) values('maintenance',work);
    update public.fuse_catalog_schedule set next_maintenance_at=next_maintenance_at + (floor(extract(epoch from(now()-next_maintenance_at))/86400)::int+1)*interval '24 hours' where id;
  end if;
  update public.fuse_catalog_runs set status=case when errors='[]'::jsonb then 'completed' else 'partial' end,finished_at=now()
    where status='running' and cursor>=jsonb_array_length(items);
  select * into r from public.fuse_catalog_runs where status='running' and (lease_until is null or lease_until<now()) order by created_at limit 1 for update skip locked;
  if r.id is null then return null; end if;
  update public.fuse_catalog_runs set lease_token=token,lease_until=now()+interval '5 minutes' where id=r.id;
  return jsonb_build_object('id',r.id,'kind',r.kind,'index',r.cursor,'item',r.items->r.cursor,'token',token);
end $$;

create or replace function public.fuse_catalog_finish(run_id uuid, token uuid, outcome jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r public.fuse_catalog_runs; v jsonb; tags uuid[]; topic uuid;
begin
  select * into r from public.fuse_catalog_runs where id=run_id for update;
  if r.id is null or r.status<>'running' or r.lease_token is distinct from token or r.lease_until<now() then raise exception 'Worker lease expired'; end if;
  if outcome ? 'error' then
    update public.fuse_catalog_runs set errors=errors||jsonb_build_array(jsonb_build_object('index',cursor,'message',left(outcome->>'error',500))) where id=r.id;
    if r.kind='collection' then
      insert into public.fuse_topic_collection(topic_id,last_collected_at) values((r.items->r.cursor->>'topic_id')::uuid,now())
        on conflict(topic_id) do update set last_collected_at=now();
    end if;
  elsif r.kind='collection' then
    topic:=(r.items->r.cursor->>'topic_id')::uuid;
    for v in select value from jsonb_array_elements(outcome->'videos') loop
      select array_agg(distinct t) into tags from unnest(array(select value::uuid from jsonb_array_elements_text(v->'topic_ids'))) t
        where exists(select 1 from public.topics where id=t) and not exists(select 1 from public.fuse_video_rejections j where j.youtube_video_id=v->>'youtube_video_id' and j.topic_id=t);
      if coalesce(cardinality(tags),0)>0 and not exists(select 1 from public.suggestions where youtube_video_id=v->>'youtube_video_id') then
        insert into public.fuse_video_drafts(youtube_video_id,title,description,video_url,thumbnail_url,channel_title,duration_minutes,topic_ids,reason)
          values(v->>'youtube_video_id',v->>'title',v->>'description',v->>'video_url',v->>'thumbnail_url',v->>'channel_title',(v->>'duration_minutes')::int,tags,v->>'reason')
          on conflict(youtube_video_id) do update set topic_ids=array(select distinct x from unnest(public.fuse_video_drafts.topic_ids||excluded.topic_ids) x),updated_at=now()
            where public.fuse_video_drafts.status='draft';
      end if;
    end loop;
    insert into public.fuse_topic_collection(topic_id,last_collected_at) values(topic,now()) on conflict(topic_id) do update set last_collected_at=now();
  else
    for v in select value from jsonb_array_elements(outcome->'videos') loop
      insert into public.fuse_video_metadata(youtube_video_id,available) values(v->>'youtube_video_id',(v->>'available')::boolean)
        on conflict(youtube_video_id) do update set checked_at=now(),available=excluded.available;
      if (v->>'available')::boolean then
        update public.suggestions set title=v->>'title',description=v->>'description',thumbnail_url=v->>'thumbnail_url',duration_minutes=(v->>'duration_minutes')::int,updated_at=now() where youtube_video_id=v->>'youtube_video_id';
        update public.fuse_video_drafts set title=v->>'title',description=v->>'description',thumbnail_url=v->>'thumbnail_url',channel_title=v->>'channel_title',duration_minutes=(v->>'duration_minutes')::int,metadata_checked_at=now() where youtube_video_id=v->>'youtube_video_id';
      else
        update public.suggestions set title='Video unavailable',description=null,thumbnail_url=null,duration_minutes=null,is_active=false,updated_at=now() where youtube_video_id=v->>'youtube_video_id';
        -- Purge unavailable API metadata while retaining IDs, skill decisions and history.
        update public.fuse_video_drafts set title='Video unavailable',description=null,thumbnail_url=null,channel_title=null,duration_minutes=null,metadata_checked_at=now() where youtube_video_id=v->>'youtube_video_id';
      end if;
    end loop;
  end if;
  update public.fuse_catalog_runs set cursor=cursor+1,lease_token=null,lease_until=null,
    status=case when cursor+1>=jsonb_array_length(items) then case when errors='[]'::jsonb then 'completed' else 'partial' end else 'running' end,
    finished_at=case when cursor+1>=jsonb_array_length(items) then now() else null end where id=r.id;
end $$;

-- Anti-join on the server avoids truncating the unseen pool before receipt filtering.
create or replace function public.fuse_unseen_suggestions()
returns setof public.suggestions language sql stable security invoker set search_path='' as $$
  select s.* from public.suggestions s where s.is_active and auth.uid() is not null
    and exists(select 1 from public.suggestion_topics st join public.user_topics ut on ut.topic_id=st.topic_id where st.suggestion_id=s.id and ut.user_id=auth.uid())
    and not exists(select 1 from public.user_suggestions us where us.user_id=auth.uid() and us.suggestion_id=s.id)
  order by s.created_at desc,s.id;
$$;
revoke all on function public.fuse_unseen_suggestions() from public,anon;
grant execute on function public.fuse_unseen_suggestions() to authenticated;
revoke all on function public.fuse_admin_execute(uuid,text,jsonb), public.fuse_catalog_claim(), public.fuse_catalog_finish(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fuse_admin_execute(uuid,text,jsonb), public.fuse_catalog_claim(), public.fuse_catalog_finish(uuid,uuid,jsonb) to service_role;
commit;
