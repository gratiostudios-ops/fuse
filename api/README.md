# Suggestions, Tasks, and AI APIs

Chat and Home AI setup is documented in [AI_SETUP.md](AI_SETUP.md); it requires deploying the `fuse-ai` Edge Function.

The catalog/task portion of this folder is a client module for Supabase's Data API. It needs no custom backend or Edge Function deployment. The Expo `/suggestions` route remains the UI screen; the data endpoint is `GET https://<project>.supabase.co/rest/v1/suggestions`.

## Supabase setup

1. In Table Editor, confirm the `suggestions`, `suggestion_topics`, and `topics` columns match `OVERVIEW.md`. Confirm the junction table has foreign keys to `suggestions.id` and `topics.id`, plus its composite primary key `(suggestion_id, topic_id)`.
2. Review existing policies for these three tables under Authentication → Policies. Public roles must not have catalog write access, and broader SELECT policies may expose inactive rows. The supplied SQL preserves existing policies; reconcile any conflicting policies explicitly.
3. Open SQL Editor and run `api/sql/catalog-read.sql`. It enables RLS, grants SELECT to `anon`/`authenticated`, and allows reads of active suggestions, links to active suggestions, and predefined topics. Check the policy listing returned by the script.
4. Ensure the public schema is exposed through Supabase's Data API settings.
5. Copy the project URL from the project connection settings and a **publishable** key (`sb_publishable_...`) from Settings → API Keys. Put them in a root `.env.local` using the variable names in `.env.example`:

   ```dotenv
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
   ```

   Expo public variables are included in the app bundle. Use the publishable key; do not put a secret/service-role key in this file. `.env.local` is git-ignored.

6. Add an active suggestion, an existing topic, and a `suggestion_topics` row linking their UUIDs. Make a second inactive suggestion linked to the same topic for verification.
7. Restart Expo (`npm start`) after configuring the environment. The existing UI does not automatically fetch suggestions.

## App usage

```ts
import { getSuggestions } from './api'; // Adjust relative path to the calling module.

try {
  const suggestions = await getSuggestions({
    topicId: '11111111-1111-4111-8111-111111111111', // Replace with a real topics.id.
  });
  // suggestions is Suggestion[]; render/use it when UI integration is added.
} catch (error) {
  // Handle configuration, invalid input, permission, network, or database errors.
}
```

The function accepts one UUID, matches `suggestion_topics.topic_id`, filters `suggestions.is_active = true`, and returns every suggestion column without nested join data. It returns `[]` for no visible matches. It does not use user topics or write `user_suggestions`.

Rows are ordered by `created_at` descending, then `id` ascending. The client requests 100 rows at a time and uses the exact count and actual received length to fetch all matches, including when the project has a lower response cap. A failed page rejects the whole request rather than returning partial results. Separate pages do not form a database snapshot; concurrent catalog edits can change results while loading.

The client initializes lazily. Suggestions remain public even without a session. Google sign-in and private `getTasks()` are documented in [AUTH_SETUP.md](AUTH_SETUP.md); mobile/browser sessions persist on the shared client.

## HTTP equivalent

The SDK sends GET requests with these query parameters:

```text
select=*,suggestion_topics!inner(topic_id)
suggestion_topics.topic_id=eq.<TOPIC_UUID>
is_active=eq.true
order=created_at.desc,id.asc
offset=0
limit=100
```

Headers include `apikey: <PUBLISHABLE_KEY>` and `Prefer: count=exact`. A GET request has no JSON body. The raw HTTP response includes nested `suggestion_topics`; the app module removes it.

## Verify

```sh
npm run test:api
npm run typecheck
```

Local tests exercise SDK requests with a simulated Data API. To query every readable topic in the live project, run:

```sh
npm run test:supabase
```

The smoke test reads `.env.local` (falling back to `.env`), calls Supabase through the same `getSuggestions` API, and prints topic names and matching IDs/titles. To query one topic only, pass its UUID: `npm run test:supabase -- YOUR_TOPIC_UUID`. An unmatched valid topic UUID should report zero results. To verify topic filtering and the active filter, link an active and an inactive suggestion to one topic and an active suggestion to a different topic; only the first should print. With the publishable key, verify writes to these catalog tables are denied. An empty result can also mean RLS blocked reads: confirm known fixture rows and policy configuration.

No live database changes have been applied by this repository setup. The SQL must be run in your Supabase project.
