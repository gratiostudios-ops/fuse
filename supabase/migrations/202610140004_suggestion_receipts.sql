begin;
-- Preserve historical repeated assignments and feedback. Serialize new receipts
-- per user so concurrent delivery/retry inserts only an absent assignment.
create index if not exists fuse_user_suggestion_lookup on public.user_suggestions(user_id, suggestion_id);
create or replace function public.fuse_receive_suggestions(suggestion_ids uuid[], expected_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); begin
  if owner_id is null or owner_id <> expected_user_id or expected_user_id is null then raise exception 'Sign in required'; end if;
  if coalesce(array_length(suggestion_ids, 1), 0) > 100 then raise exception 'Too many receipts'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  insert into public.user_suggestions(user_id, suggestion_id, recommended_at)
  select owner_id, s.id, now() from public.suggestions s
  where s.id = any(coalesce(suggestion_ids, '{}'::uuid[]))
    and not exists (select 1 from public.user_suggestions saved where saved.user_id = owner_id and saved.suggestion_id = s.id);
end $$;
revoke all on function public.fuse_receive_suggestions(uuid[],uuid) from public, anon;
grant execute on function public.fuse_receive_suggestions(uuid[],uuid) to authenticated;
commit;
