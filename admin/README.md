# Fuse Studio

Standalone administration website for Fuse's existing Supabase project. The React/Vite frontend contains only public Supabase settings; all collection, AI requests, publishing, statistics and privileged database access run in Supabase Edge Functions.

## Local development

Use Node 22 or newer.

```sh
cd admin
npm ci
cp .env.example .env
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the **same project used by Fuse**. Never put the service-role key, YouTube API key, Gemini key or worker secret in a `VITE_` variable. The unconfigured website shows setup instructions instead of fictional data.

```sh
npm run build
npm run preview
```

The production artifact is `admin/dist`. Deploy it to a static host with HTTPS. Configure the exact deployed origin and the exact local origin you use (for example, `http://localhost:5174`) in Supabase Authentication → URL Configuration → Additional Redirect URLs. Keep the existing app URLs and Google callback intact. This website uses the existing Google provider, requesting identity only, without Calendar/Tasks access. For a public static host, the sign-in page is public but all admin operations remain protected by Supabase authentication and admin membership.

## Supabase setup and rollout

1. Back up and inspect the live schema. This migration assumes the documented catalog exists, including a unique `suggestions.youtube_video_id` and `suggestion_topics(suggestion_id, topic_id)` key. Apply earlier app migrations first, then the admin migrations in order: `202610160001_admin_catalog.sql`, `202610160002_collect_now.sql`, `202610160003_keyword_discovery.sql`, `202610160005_optional_keywords.sql`, and `202610160006_rename_catalog_tables.sql`. Apply only migrations that have not already been applied.
2. Enable YouTube Data API v3 in Google Cloud and create an API key restricted to that API. Set backend secrets with Supabase's secret manager: `YOUTUBE_API_KEY`, existing `GEMINI_API_KEY`, and a new randomly generated `CATALOG_WORKER_SECRET`. Functions also require the existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and public/anon key. Optional `CATALOG_GEMINI_MODEL` overrides `GEMINI_MODEL` for collection only. Never commit secrets.
3. Deploy all three functions **after applying the migration**:

   ```sh
   npx supabase functions deploy admin-catalog --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy catalog-worker --project-ref YOUR_PROJECT_REF
   npx supabase functions deploy fuse-ai --project-ref YOUR_PROJECT_REF
   ```

4. Have an administrator sign in once, then grant membership through trusted SQL administration:

   ```sql
   insert into public.admins(user_id)
   select id from auth.users where lower(email)=lower('admin@example.com')
   on conflict do nothing;
   ```

   Revoke access with `delete from public.admins where user_id = 'USER_UUID'`. Membership is checked on every API request and again by the mutation RPC. There is no client-accessible membership policy or self-enrollment endpoint.
5. Enable the Supabase Cron, pg_net and Vault extensions. In Vault, create `fuse_catalog_worker_url` containing `https://YOUR_PROJECT_REF.supabase.co/functions/v1/catalog-worker` and `fuse_catalog_worker_secret` containing the **same** worker secret configured above. Apply `admin/schedule.sql` after creating those secrets. The schedule contains no credentials. Do not configure the job using a service-role key as its bearer token.
6. Set the public website environment, build, deploy and allow its OAuth redirect origin. Sign in with an approved admin and verify the end-to-end checklist below.

No local source edit applies a migration, configures a cloud scheduler or deploys Supabase functions. Existing app deployments must not switch to the new `fuse-ai` before the migration is present.

## Skill searches with optional keyword refinements

**Keywords are optional.** Choose one or more existing skills, leave the keyword box blank, and click **Search selected skills now**. Each skill targets 15 new matching videos. The app’s predefined skill list is unchanged.

For example:

| Skill | Active optional keywords | Search work |
| --- | --- | --- |
| Python | None | Python: target 15 videos |
| Communication | None | Communication: target 15 videos |
| Tech | `car, digital tech, aerodynamics` | Three keyword searches: target 15 each, all tagged Tech |

To refine Tech, select Tech and enter the comma-separated keywords. Commas and new lines both separate keywords; phrases such as “digital tech” stay intact. Save or search immediately. Only that skill’s general search is replaced; Python and Communication continue their normal searches. Pause all refinements for Tech to restore its general Tech search. No empty or synthetic keyword records are created for general skill searches.

Choose **Publish automatically** (default) or **Save for human review**. With blank keywords, this preference is saved for the selected skills in the existing scheduling record. With keywords, it is saved per refinement. Review-mode results appear in Review queue; automatically published results appear in Published library.

**Search all skills now** covers users’ selected skills, explicitly saved skill settings, and skills with active saved refinements. It works when there are no keyword records. The same selection runs automatically every **72 hours**, anchored in UTC. Searches requested by an admin leave the automatic schedule unchanged. You may also search selected saved refinements individually. Identical pending work is reused; another request after completion starts a new search without a cooldown.

Each skill/refinement uses two AI-generated YouTube queries and ranks verified results for a target of 15 new matching videos. Searches can return fewer when there are not enough relevant, available, previously uncollected videos; the activity log reports actual counts. Videos remain tagged with existing skills and the app filters previously received recommendations.

The backend wakes a worker immediately on demand when supported by the hosted runtime; the existing one-minute Cron tick continues the remaining work. Cron is required for multi-item completion and the three-day schedule. Provider failures are recorded for retry. Gemini evaluates metadata relevance; it does not verify teaching accuracy by watching videos.

For an existing installation, apply **202610160005_optional_keywords.sql** after migrations 001–003, then redeploy **admin-catalog** and **catalog-worker**. This migration adds no tables and also supports databases where the earlier optional cleanup consolidated metadata. Keep existing Cron and Vault configuration. An “Invalid operation” error means the deployed function is older than the frontend.

Jobs persist their items, cursor, errors and five-minute leases. A lost worker is reclaimed after its lease expires; stale workers cannot commit. Each batch commits candidate changes and progress together. API failures produce a partial run; approved admins can retry failed batches after that run completes. The dashboard refreshes every 30 seconds while jobs are queued or running. Check Edge Function logs when a worker stops before checkpointing.

Daily metadata maintenance is separate from discovery. It processes up to fifty IDs per work item, refreshes metadata and deactivates confirmed unavailable videos without deleting historical assignments. Transient API errors do not imply a video was deleted. Review failed maintenance jobs promptly: refresh scheduling alone cannot guarantee freshness during sustained provider outages. Operationally alert on repeated worker errors and metadata not refreshed within 30 days; refresh or remove expired API-derived metadata before that deadline.

## Database changes for optional keywords

The optional-keywords update creates no tables. It adds `skill_settings` JSON to the existing `catalog_schedule` record for each skill’s default publishing preference, and replaces search-planning/worker RPCs. Existing saved refinements, drafts, published videos and user recommendation history remain in place.

## Table names

Apply `supabase/migrations/202610160006_rename_catalog_tables.sql` after the preceding admin migrations. It renames tables in place, preserving data, table identities, foreign keys, RLS and privileges; no tables are recreated. It updates stored function bodies and dynamic SQL references while keeping existing RPC names compatible. Optional tables already removed by cleanup stay absent. Existing application `fuse_ai_limits`, if present, becomes `ai_limits` too.

| Previous table | Current table |
| --- | --- |
| `fuse_admins` | `admins` |
| `fuse_search_keywords` | `search_keywords` |
| `fuse_catalog_runs` | `catalog_runs` |
| `fuse_catalog_schedule` | `catalog_schedule` |
| `fuse_video_drafts` | `video_drafts` |
| `fuse_video_rejections` | `video_rejections` |
| `fuse_catalog_audit` | `catalog_audit` (if still present) |
| `fuse_topic_collection` | `topic_collection` (if still present) |
| `fuse_video_metadata` | `video_metadata` (if still present) |
| `fuse_ai_limits` | `ai_limits` (if present) |

Apply the rename migration, then deploy the matching `admin-catalog` and `catalog-worker` source together. Their direct table requests use the new names. Existing Cron/Vault configuration and app RPC calls continue to use their existing names. If an unprefixed destination table already exists alongside its prefixed source, the migration stops and rolls back instead of overwriting it. Previously applied migration files retain their historical names and definitions.

## App delivery

Both Home and chat call `fuse_unseen_suggestions()` with the user's session. The database filters active videos by at least one selected skill and excludes all IDs already in that user's `user_suggestions` **before pagination and AI selection**. No available unseen candidates means no video cards. Existing receipts, local retries, cache, dated Suggestions groups and historical assignments remain intact.

“Unseen” means not previously received/saved in `user_suggestions`, not watched on YouTube. Simultaneous requests or a receipt that has not reached the server yet can still select the same candidate; this is not an exactly-once delivery queue. Opening the Suggestions tab loads saved recommendations; publishing does not immediately assign every video to every matching user.

## Verification

From the repository root:

```sh
npm run typecheck
npm run test:refresh
npx tsx --test supabase/functions/tests/*.test.ts
npm run build --prefix admin
```

Live acceptance:

- Approved Google admin opens the dashboard; another account is denied; revoked admins cannot mutate.
- With no keywords saved, search Python and verify a general skill batch targeting 15 videos.
- Add `car, digital tech, aerodynamics` under Tech. Verify three refinement batches plus general searches for other selected skills.
- Pause Tech refinements and verify fallback to a general Tech search.
- Automatic mode publishes matching results with Tech tags; review mode keeps them as private drafts until approved.
- Search immediately, search again after completion, pause keywords, and verify the three-day schedule.
- Test fewer-than-15 results, duplicate IDs across keywords, failed provider calls and per-keyword publication counts.
- A Python user can receive a Python video; an unrelated-skill user cannot. Once its receipt is saved, the Python user cannot receive it again.
- Check batch failure reporting, retry, duplicate publication, metadata refresh and deactivation. Historical receipts remain saved.
- Test Google callback URLs and previews on desktop/mobile. Provider restrictions may require opening a video on YouTube.

Unit/integration tests use mocked providers and local PostgreSQL; they cannot verify live OAuth, API quotas, deployed RLS, real teaching quality or a configured scheduler.
