begin;

create table public.fuse_search_keywords (
  id uuid primary key default gen_random_uuid(), keyword text not null check(length(btrim(keyword)) between 1 and 200),
  topic_ids uuid[] not null check(cardinality(topic_ids)>0),
  auto_publish boolean not null default true, enabled boolean not null default true,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index fuse_search_keywords_normalized on public.fuse_search_keywords(lower(keyword));
alter table public.fuse_search_keywords enable row level security;
revoke all on public.fuse_search_keywords from anon,authenticated;
grant all on public.fuse_search_keywords to service_role;
alter table public.fuse_catalog_runs drop constraint fuse_catalog_runs_status_check;
alter table public.fuse_catalog_runs add constraint fuse_catalog_runs_status_check check(status in ('queued','running','completed','partial'));
alter table public.fuse_catalog_runs add column results jsonb not null default '[]';

create or replace function public.fuse_keyword_admin(actor uuid, operation text, payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry jsonb; tags uuid[]; saved uuid; ids jsonb:='[]';
begin
  if not exists(select 1 from public.fuse_admins where user_id=actor) then raise exception 'Admin access required' using errcode='42501'; end if;
  if operation='keywords' then
    return coalesce((select jsonb_agg(k order by k.created_at,k.id) from public.fuse_search_keywords k),'[]');
  elsif operation='keyword_runs' then
    return coalesce((select jsonb_agg(r) from (
      select id,kind,status,cursor,jsonb_array_length(items) as total,errors,results,created_at,finished_at
      from public.fuse_catalog_runs order by created_at desc limit 20) r),'[]');
  elsif operation='save_keywords' then
    if jsonb_typeof(payload->'entries')<>'array' or jsonb_array_length(payload->'entries') not between 1 and 50 then raise exception 'Provide between 1 and 50 keywords'; end if;
    for entry in select value from jsonb_array_elements(payload->'entries') loop
      if length(btrim(entry->>'keyword')) not between 1 and 200 then raise exception 'Keyword must contain 1 to 200 characters'; end if;
      select array_agg(distinct value::uuid) into tags from jsonb_array_elements_text(entry->'topic_ids');
      if coalesce(cardinality(tags),0)=0 or cardinality(tags)>20 or exists(select 1 from unnest(tags) t where not exists(select 1 from public.topics where id=t)) then raise exception 'Choose existing skills for each keyword'; end if;
      if nullif(entry->>'id','') is not null then
        update public.fuse_search_keywords set keyword=btrim(regexp_replace(entry->>'keyword','\s+',' ','g')),topic_ids=tags,
          auto_publish=coalesce((entry->>'auto_publish')::boolean,true),enabled=coalesce((entry->>'enabled')::boolean,true),updated_at=now()
          where id=(entry->>'id')::uuid returning id into saved;
        if saved is null then raise exception 'Keyword not found'; end if;
      else
        insert into public.fuse_search_keywords(keyword,topic_ids,auto_publish,enabled,created_by)
          values(btrim(regexp_replace(entry->>'keyword','\s+',' ','g')),tags,coalesce((entry->>'auto_publish')::boolean,true),coalesce((entry->>'enabled')::boolean,true),actor)
          on conflict(lower(keyword)) do update set topic_ids=excluded.topic_ids,auto_publish=excluded.auto_publish,enabled=excluded.enabled,updated_at=now() returning id into saved;
      end if;
      ids:=ids||jsonb_build_array(saved);
    end loop;
    return ids;
  else raise exception 'Unknown keyword operation'; end if;
end $$;

create or replace function public.fuse_collect_keywords(actor uuid, keyword_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare work jsonb; existing uuid; saved uuid;
begin
  if not exists(select 1 from public.fuse_admins where user_id=actor) then raise exception 'Admin access required' using errcode='42501'; end if;
  perform 1 from public.fuse_catalog_schedule where id for update;
  if keyword_ids is not null and exists(select 1 from unnest(keyword_ids) requested where not exists(select 1 from public.fuse_search_keywords where id=requested and enabled)) then raise exception 'Choose active saved keywords'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('keyword_id',id,'keyword',keyword,'topic_ids',topic_ids,'auto_publish',auto_publish) order by id),'[]') into work
    from public.fuse_search_keywords where enabled and (keyword_ids is null or id=any(keyword_ids));
  if jsonb_array_length(work)=0 then raise exception 'Save at least one active keyword first'; end if;
  select id into existing from public.fuse_catalog_runs where kind='collection' and status in ('queued','running') and items=work order by created_at desc limit 1;
  if existing is not null then return jsonb_build_object('run_id',existing,'already_running',true); end if;
  insert into public.fuse_catalog_runs(kind,status,items) values('collection','queued',work) returning id into saved;
  insert into public.fuse_catalog_audit(actor_id,action,details) values(actor,'keyword_search',jsonb_build_object('run_id',saved));
  return jsonb_build_object('run_id',saved,'already_running',false);
end $$;

-- Replace skill-demand scheduling with saved, enabled keyword scheduling.
create or replace function public.fuse_catalog_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fuse_catalog_runs; sc public.fuse_catalog_schedule; work jsonb; token uuid:=gen_random_uuid();
begin
  select * into sc from public.fuse_catalog_schedule where id for update;
  update public.suggestions s set title='Video metadata expired',description=null,thumbnail_url=null,duration_minutes=null,is_active=false
    where coalesce((select m.checked_at from public.fuse_video_metadata m where m.youtube_video_id=s.youtube_video_id),s.created_at)<now()-interval '30 days'
      and (s.title<>'Video metadata expired' or s.description is not null or s.thumbnail_url is not null or s.duration_minutes is not null or s.is_active);
  update public.fuse_video_drafts set title='Video metadata expired',description=null,thumbnail_url=null,channel_title=null,duration_minutes=null,reason='Refresh required before review'
    where metadata_checked_at<now()-interval '30 days';
  if sc.next_collection_at<=now() then
    select coalesce(jsonb_agg(jsonb_build_object('keyword_id',id,'keyword',keyword,'topic_ids',topic_ids,'auto_publish',auto_publish) order by id),'[]') into work
      from public.fuse_search_keywords where enabled;
    if jsonb_array_length(work)>0 and not exists(select 1 from public.fuse_catalog_runs where kind='collection' and status in ('queued','running') and items=work) then
      insert into public.fuse_catalog_runs(kind,status,items) values('collection','queued',work);
    end if;
    update public.fuse_catalog_schedule set next_collection_at=next_collection_at+(floor(extract(epoch from(now()-next_collection_at))/259200)::int+1)*interval '72 hours' where id;
  end if;
  if sc.next_maintenance_at<=now() and not exists(select 1 from public.fuse_catalog_runs where kind='maintenance' and status in ('queued','running')) then
    select coalesce(jsonb_agg(batch),'[]') into work from (
      select jsonb_agg(video_id) as batch from (
        select video_id,(row_number() over(order by video_id)-1)/50 as batch_no from (
          select youtube_video_id as video_id from public.suggestions union select youtube_video_id from public.fuse_video_drafts where status='draft'
        ) ids
      ) numbered group by batch_no order by batch_no) batches;
    insert into public.fuse_catalog_runs(kind,status,items) values('maintenance','queued',work);
    update public.fuse_catalog_schedule set next_maintenance_at=next_maintenance_at+(floor(extract(epoch from(now()-next_maintenance_at))/86400)::int+1)*interval '24 hours' where id;
  end if;
  update public.fuse_catalog_runs set status=case when errors='[]'::jsonb then 'completed' else 'partial' end,finished_at=now()
    where status in ('queued','running') and cursor>=jsonb_array_length(items);
  -- Promote at most one run per kind; the existing unique index enforces this too.
  for r in select * from public.fuse_catalog_runs q where q.status='queued'
    and not exists(select 1 from public.fuse_catalog_runs active where active.kind=q.kind and active.status='running')
    order by created_at limit 1 for update skip locked loop
    update public.fuse_catalog_runs set status='running' where id=r.id;
  end loop;
  select * into r from public.fuse_catalog_runs where status='running' and (lease_until is null or lease_until<now())
    order by case when kind='collection' then 0 else 1 end,created_at limit 1 for update skip locked;
  if r.id is null then return null; end if;
  update public.fuse_catalog_runs set lease_token=token,lease_until=now()+interval '5 minutes' where id=r.id;
  return jsonb_build_object('id',r.id,'kind',r.kind,'index',r.cursor,'item',r.items->r.cursor,'token',token);
end $$;

-- Retain legacy work-item and maintenance completion for jobs already in flight.
alter function public.fuse_catalog_finish(uuid,uuid,jsonb) rename to fuse_catalog_finish_legacy;
create or replace function public.fuse_catalog_finish(run_id uuid, token uuid, outcome jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r public.fuse_catalog_runs; k public.fuse_search_keywords; v jsonb; s_id uuid; tags uuid[];
  published integer:=0; drafted integer:=0; skipped integer:=0; failure text; keyword_id uuid;
begin
  select * into r from public.fuse_catalog_runs where id=run_id for update;
  if r.id is null or r.status<>'running' or r.lease_token is distinct from token or r.lease_until<now() then raise exception 'Worker lease expired'; end if;
  if not (r.items->r.cursor ? 'keyword_id') then
    perform public.fuse_catalog_finish_legacy(run_id,token,outcome); return;
  end if;
  keyword_id:=(r.items->r.cursor->>'keyword_id')::uuid;
  select * into k from public.fuse_search_keywords where id=keyword_id for update;
  failure:=outcome->>'error';
  if k.id is null or not k.enabled then
    skipped:=1;
  elsif k.keyword is distinct from r.items->r.cursor->>'keyword' or to_jsonb(k.topic_ids) is distinct from r.items->r.cursor->'topic_ids' then
    failure:='Keyword settings changed during collection. Search this keyword again.';
  elsif failure is null then
    if jsonb_typeof(outcome->'videos') is distinct from 'array' or jsonb_array_length(outcome->'videos')>15 then raise exception 'Invalid keyword results'; end if;
    for v in select value from jsonb_array_elements(outcome->'videos') loop
      if v->>'youtube_video_id' !~ '^[a-zA-Z0-9_-]{11}$' or not coalesce((v->>'available')::boolean,false) then raise exception 'Unverified video'; end if;
      select array_agg(t) into tags from unnest(k.topic_ids) t where not exists(
        select 1 from public.fuse_video_rejections j where j.youtube_video_id=v->>'youtube_video_id' and j.topic_id=t);
      if coalesce(cardinality(tags),0)=0 or exists(select 1 from public.suggestions where youtube_video_id=v->>'youtube_video_id') then skipped:=skipped+1; continue; end if;
      if k.auto_publish then
        insert into public.suggestions(youtube_video_id,title,description,video_url,thumbnail_url,duration_minutes,is_active)
          values(v->>'youtube_video_id',v->>'title',v->>'description','https://www.youtube.com/watch?v='||(v->>'youtube_video_id'),v->>'thumbnail_url',(v->>'duration_minutes')::int,true)
          on conflict(youtube_video_id) do nothing returning id into s_id;
        if s_id is null then skipped:=skipped+1; continue; end if;
        insert into public.suggestion_topics(suggestion_id,topic_id) select s_id,t from unnest(tags) t;
        insert into public.fuse_video_metadata(youtube_video_id) values(v->>'youtube_video_id') on conflict(youtube_video_id) do update set checked_at=now(),available=true;
        update public.fuse_video_drafts set status='published',updated_at=now() where youtube_video_id=v->>'youtube_video_id';
        insert into public.fuse_catalog_audit(actor_id,action,suggestion_id,details) values(k.created_by,'auto_publish',s_id,jsonb_build_object('keyword_id',k.id,'run_id',r.id));
        published:=published+1;
      else
        insert into public.fuse_video_drafts(youtube_video_id,title,description,video_url,thumbnail_url,channel_title,duration_minutes,topic_ids,reason)
          values(v->>'youtube_video_id',v->>'title',v->>'description','https://www.youtube.com/watch?v='||(v->>'youtube_video_id'),v->>'thumbnail_url',v->>'channel_title',(v->>'duration_minutes')::int,tags,v->>'reason')
          on conflict(youtube_video_id) do update set topic_ids=array(select distinct t from unnest(public.fuse_video_drafts.topic_ids||excluded.topic_ids) t),updated_at=now()
            where public.fuse_video_drafts.status='draft';
        drafted:=drafted+1;
      end if;
    end loop;
  end if;
  if failure is not null then
    update public.fuse_catalog_runs set errors=errors||jsonb_build_array(jsonb_build_object('index',cursor,'message',left(failure,500))) where id=r.id;
  end if;
  update public.fuse_catalog_runs set results=results||jsonb_build_array(jsonb_build_object('keyword_id',keyword_id,'keyword',r.items->r.cursor->>'keyword','target',15,'published',published,'drafted',drafted,'skipped',skipped,'error',failure)),
    cursor=cursor+1,lease_token=null,lease_until=null,
    status=case when cursor+1>=jsonb_array_length(items) then case when errors='[]'::jsonb then 'completed' else 'partial' end else 'running' end,
    finished_at=case when cursor+1>=jsonb_array_length(items) then now() else null end where id=r.id;
end $$;

revoke all on function public.fuse_keyword_admin(uuid,text,jsonb),public.fuse_collect_keywords(uuid,uuid[]),public.fuse_catalog_finish(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fuse_keyword_admin(uuid,text,jsonb),public.fuse_collect_keywords(uuid,uuid[]),public.fuse_catalog_finish(uuid,uuid,jsonb) to service_role;
-- Remove the superseded on-demand path, which queued skill-only searches.
revoke all on function public.fuse_start_catalog_collection(uuid,uuid) from service_role;
commit;
