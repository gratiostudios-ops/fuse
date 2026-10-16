-- Rename tables in place: preserve rows, foreign keys, grants, RLS and job state.
-- Missing optional tables (removed by cleanup) are skipped, never recreated.
begin;

do $rename$
declare old_name text; new_name text;
begin
  -- Check every destination first. Never overwrite or merge an existing table.
  foreach old_name in array array[
    'fuse_admins','fuse_search_keywords','fuse_catalog_runs','fuse_catalog_schedule',
    'fuse_video_drafts','fuse_video_rejections','fuse_catalog_audit',
    'fuse_topic_collection','fuse_video_metadata','fuse_ai_limits'
  ] loop
    new_name:=substring(old_name from 6);
    if to_regclass('public.'||old_name) is not null and to_regclass('public.'||new_name) is not null then
      raise exception 'Cannot rename public.%: public.% already exists',old_name,new_name;
    end if;
  end loop;
  foreach old_name in array array[
    'fuse_admins','fuse_search_keywords','fuse_catalog_runs','fuse_catalog_schedule',
    'fuse_video_drafts','fuse_video_rejections','fuse_catalog_audit',
    'fuse_topic_collection','fuse_video_metadata','fuse_ai_limits'
  ] loop
    new_name:=substring(old_name from 6);
    if to_regclass('public.'||old_name) is not null then
      execute format('alter table public.%I rename to %I',old_name,new_name);
    end if;
  end loop;
end $rename$;

-- PL/pgSQL bodies and dynamic SQL retain text references after ALTER TABLE.
-- Rewrite those table identifiers in-place, keeping RPC signatures and privileges.
do $functions$
declare routine record; definition text; updated text; old_name text;
begin
  for routine in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind in ('f','p')
      and p.prosrc ~ '\mfuse_(admins|search_keywords|catalog_runs|catalog_schedule|video_drafts|video_rejections|catalog_audit|topic_collection|video_metadata|ai_limits)\M'
  loop
    definition:=pg_get_functiondef(routine.oid);
    updated:=definition;
    foreach old_name in array array[
      'fuse_admins','fuse_search_keywords','fuse_catalog_runs','fuse_catalog_schedule',
      'fuse_video_drafts','fuse_video_rejections','fuse_catalog_audit',
      'fuse_topic_collection','fuse_video_metadata','fuse_ai_limits'
    ] loop
      updated:=regexp_replace(updated,'\m'||old_name||'\M',substring(old_name from 6),'g');
    end loop;
    if updated<>definition then execute updated; end if;
  end loop;
end $functions$;

-- Refresh REST relation metadata for the renamed tables.
notify pgrst,'reload schema';
commit;
