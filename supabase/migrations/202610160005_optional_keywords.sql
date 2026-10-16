-- Skills are the default discovery source; saved keywords only refine selected skills.
-- No new tables. Compatible with both the original and consolidated metadata schema.
begin;
alter table public.fuse_catalog_schedule add column if not exists skill_settings jsonb not null default '{}';

create or replace function public.fuse_skill_search_settings(actor uuid, topic_ids uuid[] default null, auto_publish boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid; settings jsonb;
begin
  if not exists(select 1 from public.fuse_admins where user_id=actor) then raise exception 'Admin access required' using errcode='42501'; end if;
  select skill_settings into settings from public.fuse_catalog_schedule where id for update;
  if topic_ids is not null then
    if cardinality(topic_ids)=0 or exists(select 1 from unnest(topic_ids) requested where not exists(select 1 from public.topics where id=requested)) then raise exception 'Choose existing skills'; end if;
    foreach t in array topic_ids loop
      settings:=jsonb_set(settings,array[t::text],jsonb_build_object('auto_publish',auto_publish),true);
    end loop;
    update public.fuse_catalog_schedule set skill_settings=settings where id;
  end if;
  return settings;
end $$;

create or replace function public.fuse_catalog_search_items(requested_topics uuid[] default null, requested_keywords uuid[] default null)
returns jsonb language sql stable security definer set search_path='' as $$
  with selected_topics as (
    select t.id,t.name from public.topics t where
      (requested_topics is not null and t.id=any(requested_topics)) or
      (requested_topics is null and requested_keywords is not null and exists(select 1 from public.fuse_search_keywords k where k.enabled and k.id=any(requested_keywords) and t.id=any(k.topic_ids))) or
      (requested_topics is null and requested_keywords is null and (
        exists(select 1 from public.user_topics u where u.topic_id=t.id) or
        exists(select 1 from public.fuse_search_keywords k where k.enabled and t.id=any(k.topic_ids)) or
        exists(select 1 from public.fuse_catalog_schedule sc where sc.skill_settings ? t.id::text)
      ))
  ), items as (
    select 'skill:'||t.id::text as sort_key,jsonb_build_object('source','skill','topic_id',t.id,'keyword',t.name,'skill_name',t.name,'topic_ids',jsonb_build_array(t.id),
      'auto_publish',coalesce((select (sc.skill_settings->t.id::text->>'auto_publish')::boolean from public.fuse_catalog_schedule sc),true)) as item
      from selected_topics t where requested_keywords is null and not exists(select 1 from public.fuse_search_keywords k where k.enabled and t.id=any(k.topic_ids))
    union all
    select 'keyword:'||k.id::text,jsonb_build_object('source','keyword','keyword_id',k.id,'keyword',k.keyword,'topic_ids',
      (select jsonb_agg(t.id order by t.id) from selected_topics t where t.id=any(k.topic_ids)), 'auto_publish',k.auto_publish)
      from public.fuse_search_keywords k where k.enabled and (requested_keywords is null or k.id=any(requested_keywords))
      and exists(select 1 from selected_topics t where t.id=any(k.topic_ids))
  ) select coalesce(jsonb_agg(item order by sort_key),'[]') from items;
$$;

create or replace function public.fuse_collect_catalog(actor uuid, topic_ids uuid[] default null, keyword_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare work jsonb; existing uuid; saved uuid;
begin
  if not exists(select 1 from public.fuse_admins where user_id=actor) then raise exception 'Admin access required' using errcode='42501'; end if;
  perform 1 from public.fuse_catalog_schedule where id for update;
  if topic_ids is not null and (cardinality(topic_ids)=0 or exists(select 1 from unnest(topic_ids) requested where not exists(select 1 from public.topics where id=requested))) then raise exception 'Choose existing skills'; end if;
  if keyword_ids is not null and (cardinality(keyword_ids)=0 or exists(select 1 from unnest(keyword_ids) requested where not exists(select 1 from public.fuse_search_keywords where id=requested and enabled))) then raise exception 'Choose active keyword refinements'; end if;
  work:=public.fuse_catalog_search_items(topic_ids,keyword_ids);
  if jsonb_array_length(work)=0 then raise exception 'No skills to search. Select a skill here or in Fuse; keywords are optional.'; end if;
  select id into existing from public.fuse_catalog_runs where kind='collection' and status in ('queued','running') and items=work order by created_at desc limit 1;
  if existing is not null then return jsonb_build_object('run_id',existing,'already_running',true); end if;
  insert into public.fuse_catalog_runs(kind,status,items) values('collection','queued',work) returning id into saved;
  return jsonb_build_object('run_id',saved,'already_running',false);
end $$;

-- Preserve callers of the earlier keyword-only RPC, but give its default path skill fallback.
create or replace function public.fuse_collect_keywords(actor uuid, keyword_ids uuid[] default null)
returns jsonb language sql security definer set search_path='' as $$
  select public.fuse_collect_catalog(actor,null,keyword_ids);
$$;

create or replace function public.fuse_catalog_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fuse_catalog_runs; sc public.fuse_catalog_schedule; work jsonb; token uuid:=gen_random_uuid();
begin
  select * into sc from public.fuse_catalog_schedule where id for update;
  -- Support installations that have already consolidated metadata into suggestions.
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='suggestions' and column_name='metadata_checked_at') then
    execute $q$update public.suggestions s set title='Video metadata expired',description=null,thumbnail_url=null,duration_minutes=null,is_active=false
      where coalesce(s.metadata_checked_at,s.created_at)<now()-interval '30 days'
      and (s.title<>'Video metadata expired' or s.description is not null or s.thumbnail_url is not null or s.duration_minutes is not null or s.is_active)$q$;
  elsif to_regclass('public.fuse_video_metadata') is not null then
    execute $q$update public.suggestions s set title='Video metadata expired',description=null,thumbnail_url=null,duration_minutes=null,is_active=false
      where coalesce((select m.checked_at from public.fuse_video_metadata m where m.youtube_video_id=s.youtube_video_id),s.created_at)<now()-interval '30 days'
      and (s.title<>'Video metadata expired' or s.description is not null or s.thumbnail_url is not null or s.duration_minutes is not null or s.is_active)$q$;
  end if;
  update public.fuse_video_drafts set title='Video metadata expired',description=null,thumbnail_url=null,channel_title=null,duration_minutes=null,reason='Refresh required before review' where metadata_checked_at<now()-interval '30 days';
  if sc.next_collection_at<=now() then
    work:=public.fuse_catalog_search_items();
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
  update public.fuse_catalog_runs set status=case when errors='[]'::jsonb then 'completed' else 'partial' end,finished_at=now() where status in ('queued','running') and cursor>=jsonb_array_length(items);
  for r in select * from public.fuse_catalog_runs q where q.status='queued'
    and not exists(select 1 from public.fuse_catalog_runs active where active.kind=q.kind and active.status='running') order by created_at limit 1 for update skip locked loop
    update public.fuse_catalog_runs set status='running' where id=r.id;
  end loop;
  select * into r from public.fuse_catalog_runs where status='running' and (lease_until is null or lease_until<now()) order by case when kind='collection' then 0 else 1 end,created_at limit 1 for update skip locked;
  if r.id is null then return null; end if;
  update public.fuse_catalog_runs set lease_token=token,lease_until=now()+interval '5 minutes' where id=r.id;
  return jsonb_build_object('id',r.id,'kind',r.kind,'index',r.cursor,'item',r.items->r.cursor,'token',token);
end $$;

create or replace function public.fuse_catalog_mark_metadata(video_id text, available boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='suggestions' and column_name='metadata_checked_at') then
    execute 'update public.suggestions set metadata_checked_at=now(),youtube_available=$1 where youtube_video_id=$2' using available,video_id;
  elsif to_regclass('public.fuse_video_metadata') is not null then
    execute 'insert into public.fuse_video_metadata(youtube_video_id,available) values($1,$2) on conflict(youtube_video_id) do update set checked_at=now(),available=excluded.available' using video_id,available;
  end if;
end $$;

create or replace function public.fuse_catalog_finish(run_id uuid, token uuid, outcome jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r public.fuse_catalog_runs; k public.fuse_search_keywords; v jsonb; s_id uuid; tags uuid[]; item jsonb;
  published integer:=0; drafted integer:=0; skipped integer:=0; failure text; automatic boolean:=true; label text;
begin
  select * into r from public.fuse_catalog_runs where id=run_id for update;
  if r.id is null or r.status<>'running' or r.lease_token is distinct from token or r.lease_until<now() then raise exception 'Worker lease expired'; end if;
  item:=r.items->r.cursor;
  failure:=outcome->>'error';
  if r.kind='maintenance' then
    if failure is null then
      for v in select value from jsonb_array_elements(outcome->'videos') loop
        perform public.fuse_catalog_mark_metadata(v->>'youtube_video_id',(v->>'available')::boolean);
        if (v->>'available')::boolean then
          update public.suggestions set title=v->>'title',description=v->>'description',thumbnail_url=v->>'thumbnail_url',duration_minutes=(v->>'duration_minutes')::int,updated_at=now() where youtube_video_id=v->>'youtube_video_id';
          update public.fuse_video_drafts set title=v->>'title',description=v->>'description',thumbnail_url=v->>'thumbnail_url',channel_title=v->>'channel_title',duration_minutes=(v->>'duration_minutes')::int,metadata_checked_at=now() where youtube_video_id=v->>'youtube_video_id';
        else
          update public.suggestions set title='Video unavailable',description=null,thumbnail_url=null,duration_minutes=null,is_active=false,updated_at=now() where youtube_video_id=v->>'youtube_video_id';
          update public.fuse_video_drafts set title='Video unavailable',description=null,thumbnail_url=null,channel_title=null,duration_minutes=null,metadata_checked_at=now() where youtube_video_id=v->>'youtube_video_id';
        end if;
      end loop;
    end if;
  else
    label:=coalesce(item->>'keyword',item->>'name');
    if item ? 'keyword_id' then
      select * into k from public.fuse_search_keywords where id=(item->>'keyword_id')::uuid for update;
      if k.id is null or not k.enabled then skipped:=1;
      elsif k.keyword is distinct from label or not k.topic_ids @> array(select value::uuid from jsonb_array_elements_text(item->'topic_ids')) then failure:='Keyword settings changed. Search again.';
      else tags:=array(select value::uuid from jsonb_array_elements_text(item->'topic_ids')); automatic:=k.auto_publish;
      end if;
    elsif item->>'source'='skill' then
      tags:=array[(item->>'topic_id')::uuid];
      if not exists(select 1 from public.topics where id=tags[1] and name=label) then failure:='Skill changed. Search again.';
      elsif exists(select 1 from public.fuse_search_keywords where enabled and tags[1]=any(topic_ids)) then failure:='This skill now has keyword refinements. Search again.';
      else select coalesce((skill_settings->tags[1]::text->>'auto_publish')::boolean,true) into automatic from public.fuse_catalog_schedule where id;
      end if;
    else failure:='Old search format. Start a new skill search.';
    end if;
    if failure is null and skipped=0 then
      if jsonb_typeof(outcome->'videos') is distinct from 'array' or jsonb_array_length(outcome->'videos')>15 then raise exception 'Invalid search results'; end if;
      for v in select value from jsonb_array_elements(outcome->'videos') loop
        if v->>'youtube_video_id' !~ '^[a-zA-Z0-9_-]{11}$' or not coalesce((v->>'available')::boolean,false) then raise exception 'Unverified video'; end if;
        declare allowed uuid[]; begin
          select array_agg(t) into allowed from unnest(tags) t where not exists(select 1 from public.fuse_video_rejections j where j.youtube_video_id=v->>'youtube_video_id' and j.topic_id=t);
          if coalesce(cardinality(allowed),0)=0 or exists(select 1 from public.suggestions where youtube_video_id=v->>'youtube_video_id') then skipped:=skipped+1; continue; end if;
          if automatic then
            insert into public.suggestions(youtube_video_id,title,description,video_url,thumbnail_url,duration_minutes,is_active)
              values(v->>'youtube_video_id',v->>'title',v->>'description','https://www.youtube.com/watch?v='||(v->>'youtube_video_id'),v->>'thumbnail_url',(v->>'duration_minutes')::int,true)
              on conflict(youtube_video_id) do nothing returning id into s_id;
            if s_id is null then skipped:=skipped+1; continue; end if;
            insert into public.suggestion_topics(suggestion_id,topic_id) select s_id,t from unnest(allowed) t;
            perform public.fuse_catalog_mark_metadata(v->>'youtube_video_id',true);
            update public.fuse_video_drafts set status='published',updated_at=now() where youtube_video_id=v->>'youtube_video_id';
            published:=published+1;
          else
            insert into public.fuse_video_drafts(youtube_video_id,title,description,video_url,thumbnail_url,channel_title,duration_minutes,topic_ids,reason)
              values(v->>'youtube_video_id',v->>'title',v->>'description','https://www.youtube.com/watch?v='||(v->>'youtube_video_id'),v->>'thumbnail_url',v->>'channel_title',(v->>'duration_minutes')::int,allowed,v->>'reason')
              on conflict(youtube_video_id) do update set topic_ids=array(select distinct t from unnest(public.fuse_video_drafts.topic_ids||excluded.topic_ids) t),updated_at=now() where public.fuse_video_drafts.status='draft';
            drafted:=drafted+1;
          end if;
        end;
      end loop;
    end if;
    update public.fuse_catalog_runs set results=results||jsonb_build_array(jsonb_build_object('source',coalesce(item->>'source','keyword'),'keyword',label,'target',15,'published',published,'drafted',drafted,'skipped',skipped,'error',failure)) where id=r.id;
  end if;
  if failure is not null then update public.fuse_catalog_runs set errors=errors||jsonb_build_array(jsonb_build_object('index',cursor,'message',left(failure,500))) where id=r.id; end if;
  update public.fuse_catalog_runs set cursor=cursor+1,lease_token=null,lease_until=null,
    status=case when cursor+1>=jsonb_array_length(items) then case when errors='[]'::jsonb then 'completed' else 'partial' end else 'running' end,
    finished_at=case when cursor+1>=jsonb_array_length(items) then now() else null end where id=r.id;
end $$;

revoke all on function public.fuse_skill_search_settings(uuid,uuid[],boolean),public.fuse_catalog_search_items(uuid[],uuid[]),public.fuse_collect_catalog(uuid,uuid[],uuid[]),public.fuse_catalog_mark_metadata(text,boolean) from public,anon,authenticated;
grant execute on function public.fuse_skill_search_settings(uuid,uuid[],boolean),public.fuse_catalog_search_items(uuid[],uuid[]),public.fuse_collect_catalog(uuid,uuid[],uuid[]) to service_role;
-- Metadata helper is called only by the security-definer worker transaction.
commit;
