# Fuse

An Expo React Native UI shell for Android, iOS, and web, written in TypeScript.

## Run

```sh
npm install
npm start
```

Use a native development build for Google OAuth, or use `npm run android`, `npm run ios` (macOS with Xcode), or `npm run web`.

## Check

```sh
npm run typecheck
npm run export
```

Home (`/`) and Suggestions (`/suggestions`) are Expo Router tabs. The hamburger opens the Google account screen (`/sign-in`). Organizer shows Google Tasks and Calendar events, with confirmed completion/reopening controls; Home and chat use server-verified Google activities. Suggestions contains its heading and one neutral demo thumbnail, ready for future content.

The layout follows the supplied 402 × 874 Figma reference. Wider windows center the 402-point shell; narrower devices use the available width. Bottom controls account for device safe areas. Fonts are bundled locally through the Expo Google Fonts packages; icons use Phosphor.

`src/theme.ts` contains shared colors and font families, including the Poppins and date fonts reserved for future suggestion rows. `OVERVIEW.md` describes the larger product.

The modular Supabase API lives in `api/`. Google setup and deployment requirements are below. Google Tasks and events are rendered by Organizer; suggestions remain a placeholder screen.

The [background refresh framework](refresh/README.md) fetches Google Tasks and primary-calendar events in one backend response when connected, and public suggestions for locally selected topics in either state. It caches a typed snapshot and calls the Home AI selector. It refreshes approximately every 30 minutes and catches up on app resume. Topic selection is available through the `refresh/` module; no selection screen is included yet.


## Google setup and rollout

Enable Google Calendar and Google Tasks APIs. Configure a Web OAuth client with the exact Supabase callback `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. Enable that Google provider in Supabase, and allow `fuse://auth/callback` plus each exact web callback URL in its redirect allowlist. Use a native development build for the app callback scheme.

The single **Connect Google Calendar** flow requests `openid email profile`, `https://www.googleapis.com/auth/calendar.events`, and `https://www.googleapis.com/auth/tasks`, with offline access and consent. After Supabase sign-in, authenticated backend registration verifies Google identity, OAuth client, scopes, and refresh credentials, then stores an encrypted refresh token atomically. If registration fails, the app retains its session and shows an incomplete connection with retry/reconnect. Backend Google token refresh is separate from Supabase session refresh.

Backend secrets: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must match the client configured in Supabase; retain the existing `ORGANIZER_TOKEN_KEY`. Both functions need Supabase runtime URL, publishable/anon key, service-role access for protected credentials, and Gemini configuration (`GEMINI_API_KEY`, optional `GEMINI_MODEL`). Scheduled recap calls require `ORGANIZER_CRON_SECRET`. Remove obsolete `GOOGLE_ORGANIZER_REDIRECT_URI`. App environment contains only public Supabase URL/key and optional AI function name.

Apply the original organizer migration followed by [the Google-direct migration](supabase/migrations/202610140002_google_direct.sql). It preserves archived task/event/OAuth/queue/history data while revoking obsolete access and removing import/write-queue RPCs/triggers. It adds atomic credential registration and lease-checked recap save. Keep profile creation, AI budgets, recap leases, and disconnect. Existing credentials issued for a different client must reconnect.

Deploy both functions and their shared helpers after applying migrations:

```sh
npm run ai:prompts
npx supabase functions deploy organizer --project-ref YOUR_PROJECT_REF
npx supabase functions deploy fuse-ai --project-ref YOUR_PROJECT_REF
```

Switch all activity consumers together; no repository edit deploys functions or applies production SQL. Normal function actions verify the Supabase user; scheduled work verifies the cron secret even though gateway JWT verification is disabled. Configure an external recurring POST to organizer with `{ "action": "scheduled" }` and `Authorization: Bearer ORGANIZER_CRON_SECRET` for daily recaps. No scheduler or push delivery is installed here.

## Activity, refresh, and recap behavior

Organizer reads all task lists and primary-calendar event instances directly from Google with pagination. Calendar reads cover the previous 30 days and upcoming year. Completion/reopening patches Google; UI changes follow confirmed success, and errors remain retryable without an offline queue. Calendar completion uses private Fuse metadata and ETag conflict handling. Tasks have date-only deadlines.

Startup/resume, manual refresh, and the shared approximately 30-minute cadence fetch one organizer response with separate task/Calendar results. Successful sources remain usable when another fails. Home AI independently fetches current Google records for verified selections; confirmed completion and manual Organizer refresh regenerate Home. There is no Google-to-Supabase import or 30-second polling. Versioned local caches include user and Google connection identity; logout/disconnect/reconnect invalidate private results. External Google edits appear at manual or due refresh. Web needs an open/visible tab; native background work is OS-controlled.

Recaps use current Google task completion timestamps and Calendar private completion metadata. Reopening/deleting items can remove evidence of earlier completion, so new recap text explains incomplete history and unavailable sources. Saved recap text stays in Supabase. Chat keeps recent text in memory and creates tasks/events through the endpoint below; Home AI remains read-only.

## Chat creation endpoint

Chat fills a restricted creation parameter object; the server sends it to `POST /functions/v1/organizer` with the user's Supabase bearer token. The endpoint verifies the user independently, validates parameters, obtains that user's Google credentials, writes to Google, and returns the saved card. AI never supplies credentials, user IDs, arbitrary URLs, or raw Google payloads. Created tasks go to the first available Google task list; events use the primary Calendar. Confirmed creation invalidates Organizer and Home caches.

Example request body for a task:

```json
{
  "action": "create",
  "timezone": "Asia/Kolkata",
  "params": {
    "kind": "task",
    "title": "Finish report",
    "description": null,
    "due_date": "2026-10-15",
    "start": null,
    "end": null,
    "all_day": false
  }
}
```

For an event, use `kind: "schedule"`, `due_date: null`, and explicit start/end ISO timestamps with offsets. All-day events use date strings and an exclusive end date. Chat asks for missing title or event timing/duration rather than inventing them, and clarifies task versus Calendar intent when needed. Google Tasks deadlines are date-only; exact time slots belong in Calendar. Chat supports one creation per turn; editing/deleting through chat is not included. Completion/reopening remains available in Organizer. Writes are never automatically retried; after an uncertain response, check Google before retrying to avoid duplicate items.

Deploy both `organizer` and `fuse-ai` to enable this flow; no new migration or OAuth scopes are required beyond the Google-direct setup.

## Verification

```sh
npm run typecheck
npm run test:refresh
npx tsx --test supabase/functions/tests/google.test.ts
npx tsx --test supabase/functions/tests/create.test.ts
node scripts/sync-ai-prompts.mjs --check
```

Mocks and local SQL checks cannot establish live OAuth, deployed migration/function behavior, Gemini quota, Google writes, native callbacks/storage, or OS scheduling. Test web/native cancellation, partial permissions, missing refresh credentials/retry, two-user isolation, pagination, recurring/all-day events, completion/reopening, deleted records, expired authorization, ETag conflicts, and logout/disconnect privacy against configured services.

Official references: [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [provider tokens](https://supabase.com/docs/guides/auth/social-login), [Calendar event-list metadata](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [private event properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties), [Google Tasks resource](https://developers.google.com/tasks/reference/rest/v1/tasks).
