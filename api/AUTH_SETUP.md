# Google authentication and private tasks

Suggestions remain public. Tasks require a Supabase Auth session established through Google. There is one Google connection flow and no password login.

## Supabase database

1. Confirm `public.tasks` and `public.users` match `OVERVIEW.md`; `tasks.user_id` references `users.id`, which references `auth.users.id`.
2. Run `api/sql/catalog-read.sql` if the public catalog policies are not already installed.
3. Run `api/sql/private-tasks.sql` in the Supabase SQL Editor. It grants authenticated task reads and applies both an owner policy and a restrictive owner policy, so broader SELECT policies cannot expose another user's tasks. Anonymous task SELECT privileges are revoked. SQL Editor and service-role administration still bypass RLS.
4. The script creates a profile trigger and backfills missing `public.users` rows from existing email-bearing auth users. Existing profiles and other triggers are preserved. Review any existing profile trigger before applying it to a schema that differs from the overview.

The scripts are repeatable and modify only their named policies, index, function, and trigger. They do not add task write permissions. Review the task policy listing returned by the script.

## Google Cloud

1. Create/select a Google Cloud project and enable **Google Calendar API**.
2. Configure the OAuth consent screen with the app name, support email, audience, and authorized domain needed for your Supabase project. If the app is in testing, add your Google account under test users.
3. Add the scopes `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/calendar.events.readonly`.
4. Create an OAuth client with application type **Web application**. The authorized redirect URI is `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` (copy the exact callback shown by Supabase).
5. Put this client's ID and secret in **Supabase Authentication → Sign In / Providers → Google**, and enable Google. The secret belongs in Supabase, never in Expo's public environment variables.

## Supabase redirects and app

- Under **Authentication → URL Configuration**, set your web Site URL and allow `fuse://auth/callback` plus your exact web callback, such as `http://localhost:8082/auth/callback`. Allow each origin/port you actually use; include your production web callback later.
- Configure the app's existing `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local` or `.env`. Restart Expo after changes.
- Web: run `npm run web -- --port 8082`. Open the hamburger icon, which now opens the account screen, and select **Continue with Google**. Google returns to `/auth/callback`; the app exchanges the PKCE code and displays the signed-in email.
- Mobile: use a development build because OAuth needs the app's `fuse://` scheme. Install Android Studio or Xcode (macOS for iOS), then use `npx expo run:android` or `npx expo run:ios`. Later start Metro with `npx expo start --dev-client`. Expo Go isn't the target for this native OAuth flow.
- Cancelling the native browser returns to the account screen; browser Back handles a cancelled web redirect. Sign out clears this device/browser session. Reconnect calendar access repeats the same Google flow.

If the app reports **Google sign-in is currently unavailable**, enable Google under Supabase Authentication → Sign In / Providers → Google and supply the client ID/secret. The app checks public provider settings before opening Google, avoiding an unsupported-provider JSON page.

## API usage

```ts
import { getSuggestions, getTasks, getCurrentUser, signInWithGoogle, signOut } from './api';

// Public: no session required.
const suggestions = await getSuggestions({ topicId: 'YOUR_TOPIC_UUID' });

// Launch Google sign-in from a button. Web redirects; mobile opens the auth browser.
await signInWithGoogle();

// After the Google callback has completed:
const user = await getCurrentUser(); // User | null, verified through Supabase Auth.
const tasks = await getTasks();      // Uses that verified user.id automatically.

await signOut();
```

`getTasks()` returns all owned tasks, including completed tasks, ordered by due date, due time (nulls last), and ID. It fetches successive pages like suggestions. Missing/invalid sessions reject with `AuthenticationRequiredError` (`code: AUTHENTICATION_REQUIRED`); network/database errors are propagated. No caller-supplied user ID is accepted.

The tasks Data API endpoint is `GET /rest/v1/tasks`. HTTP callers need both `apikey: <publishable-key>` and `Authorization: Bearer <Supabase-user-access-token>`. The SDK sends the user's session token automatically. The publishable key alone grants no task access. Filtering by another user ID cannot bypass RLS.

## Calendar access and sessions

The app requests read-only access to calendar events. The initial Supabase session includes Google's provider token for Calendar calls, separate from the Supabase access token used by the tasks API. No Calendar synchronization or event writes are implemented in this change.

Supabase sessions persist in SecureStore on mobile (chunked to accommodate large sessions) and localStorage in the browser. Supabase access tokens refresh automatically while the app is active. Supabase does not refresh the Google provider token; repeat Google connection if Calendar access is missing or expired. A signed-in Supabase session alone does not guarantee a current Google Calendar token.

## Verify

```sh
npm run typecheck
npm run test:api
npm run test:supabase
```

The public suggestions demo reads env files and needs no login. Tests verify API ownership and execute the SQL locally in PostgreSQL via PGlite, including a pre-existing broad policy. For real OAuth, complete login with two Google accounts: each account should only see its own task fixtures. Sign out and confirm `getTasks()` rejects while public suggestions still load. Also check cancellation, app restart/session restoration, and reconnecting Calendar permission.

The repository does not contain Google OAuth client credentials or Supabase administration access. Apply the SQL and configure Google/provider settings in your project before the live flow can work.
