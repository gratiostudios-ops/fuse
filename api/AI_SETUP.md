# Deploy Fuse AI and test it

The app now calls one authenticated Supabase Edge Function, `fuse-ai`, in two modes:

- `chat`: bundled `ref/md files/ai_chat.md`, temporary recent turns, server-fetched tasks/events/assigned suggestions/preferences, and a validated `{ schema_version: 1, message, blocks }` response.
- `home`: bundled `ref/md files/home_decision.md`, current server time and device timezone, verified pending tasks and ongoing/upcoming events, assigned suggestions, preferences, priority scores, and previous selected IDs. The model selects up to four records; the backend builds cards from actual rows and attaches short reasons.

The Gemini key stays in Supabase secrets. No new chat-history database is required. Supabase must already contain the tables and columns documented in `OVERVIEW.md`. Deleting the old function does not delete its secrets, but secrets alone cannot run AI.

## 1. Prepare database access

In Supabase SQL Editor, run these scripts in order (skip previously applied scripts only after checking their policies):

1. `api/sql/catalog-read.sql`
2. `api/sql/private-tasks.sql`
3. `api/sql/ai-setup.sql`

The third script requires `schedules`, `preferences`, `user_topics`, and `user_suggestions` to exist. It adds SELECT ownership policies and an atomic request budget (20 chat requests per 10 minutes and 6 Home decisions per hour per user). It does not create the app's domain tables or give AI write access. Restrictive SELECT policies intentionally prevent reading other users' rows even when older broad SELECT policies exist. Review that change for other consumers of the same tables.

If your tables do not exist yet, create them according to `OVERVIEW.md` before running these scripts. No SQL has been applied to your live project by these repository changes.

## 2. Deploy the replacement function

From the repository root:

```sh
npx supabase login
npm run ai:prompts
npx supabase functions deploy fuse-ai --project-ref YOUR_PROJECT_REF
```

The project reference is the subdomain in `https://YOUR_PROJECT_REF.supabase.co`.

`ai:prompts` generates `supabase/functions/_shared/prompts.ts` from the two Markdown sources. The generated module is bundled with the Edge Function; the app does not send system prompts. After editing either Markdown file, rerun the generation command and redeploy. Do not paste just `index.ts` into the Dashboard: it imports shared modules that must be deployed too.

The checked-in `supabase/config.toml` disables gateway JWT verification for compatibility with modern signing keys. **The handler still requires a Bearer token and verifies it with Supabase Auth before any database or Gemini call.** Do not remove this check.

In Dashboard → Edge Functions → Secrets, confirm:

- `GEMINI_API_KEY`: your Google AI Studio API key.
- Optional `GEMINI_MODEL`: defaults to `gemini-2.5-flash`; your Google AI Studio project needs access and available quota for that model.
- `FUSE_SUPABASE_PUBLISHABLE_KEY`: your project's `sb_publishable_...` key if the legacy `SUPABASE_ANON_KEY` is unavailable. The handler uses this key with the verified user's Authorization token; it never uses a service-role key.

`SUPABASE_URL` is provided by the Supabase runtime.

## 3. Configure and open the app

Set `.env.local`:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
EXPO_PUBLIC_AI_FUNCTION_NAME=fuse-ai
```

```sh
npm run web
```

Restart Expo whenever environment variables change. Open the top-left account menu, sign in with Google, and return Home. The shared Supabase client sends your user token with function requests.

## 4. Verify actual behavior

1. In Table Editor, create one task and one future event for the signed-in user's `auth.users.id`, matching the existing schema. Populate `due_date`/`due_time`, `valid_from`/`valid_to` (with timezone), `mark_completed=false`, and other required fields. Use real records; examples in the prompt files are not fixtures.
2. Home should show relevant selected cards. Press Refresh to force a new decision. Foreground refresh checks run every 30 minutes and when the app becomes active; OS background scheduling is best effort, not an exact timer.
3. Ask `What tasks and events do I have tomorrow?` Expect concise text and red task / blue event cards for matching records. Ask a general question to verify a text-only answer.
4. Ask a follow-up such as `Which of those is earliest?` Recent text turns are supplied in memory; no chat-history rows are saved. Changing accounts clears visible chat and Home data.
5. Sign out: Home must stop showing private cards and chat must request sign-in. Sign in as another user: only their records may appear.
6. Mark a task complete directly in Supabase, then press Refresh. It should no longer be a pending Home candidate.
7. Assigned active videos require `user_suggestions` rows linked to real `suggestions`. An empty assignment table means there are no personalized suggestion cards; the model must not invent videos.
8. In Dashboard → Edge Functions → fuse-ai → Logs/Invocations, find the corresponding requests. Browser Network should show `/functions/v1/fuse-ai` with `{mode:"chat", message:...}` or `{mode:"home", timezone:...}`. Never copy or share user tokens.

## Current limits

This implementation answers questions and displays verified records. Create/update/delete/complete actions and Google Calendar/Tasks synchronization are not implemented. The runtime prompt explicitly requires the assistant to explain that it cannot save changes yet. Supabase schedules are the only calendar source; it must not claim complete knowledge of external calendars or that the user is definitively free.

Source failures are marked as unavailable, not empty. The response reports the failed sources; no suggestion is selected for Home when tasks or schedules failed to load. If all reads fail, configure tables and policies before relying on personalization.

Use Refresh after external database edits. Future app mutation handlers should call `refreshNow()` after a confirmed successful change. AI response generation alone does not trigger record changes.

Home decision results and the existing refresh snapshot use the app's existing local cache; private records are scoped to the signed-in user. Recent chat turns remain in memory. Structured outputs constrain selection shape, and both server and client validate cards; that cannot guarantee every sentence generated by a model is factually correct.

## Troubleshooting and checks

- **404:** deploy the function and confirm the exact name/project.
- **401:** sign in again; ensure frontend and function use the same Supabase project.
- **503 setup SQL:** run `ai-setup.sql`; the request-budget RPC is required.
- **Failed data sources:** check table names, columns, relationships, ownership IDs, RLS and SELECT grants. A successful empty RLS query does not prove there are no stored records; check fixtures with Table Editor.
- **429:** wait for the user budget to reset; provider 429s also require checking Gemini billing/rate limits.
- **502/provider error:** inspect logs and model access. Incomplete outputs or refusals are handled as errors rather than successful empty replies. The output budget includes reasoning tokens.

```sh
npm run ai:prompts
node scripts/sync-ai-prompts.mjs --check
npm run typecheck
npm run test:api
npm run test:refresh
```

Tests mock AI and Supabase HTTP responses and exercise PostgreSQL policies with PGlite. They do not call Gemini or prove a live deployment works.

Official references: [Supabase deployment](https://supabase.com/docs/guides/functions/deploy), [Supabase authentication](https://supabase.com/docs/guides/functions/auth), and [Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).
