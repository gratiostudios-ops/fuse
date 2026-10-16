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

Home (`/`) and Suggestions (`/suggestions`) are Expo Router tabs. The hamburger toggles a compact account drawer, showing name/email and Sign out. The drawer shifts the app canvas so the hamburger stays visible. `/sign-in` remains available for OAuth and connection recovery; the Calendar disconnect control is hidden while its API remains supported. Organizer shows Google Tasks and Calendar events, with confirmed completion/reopening controls; Home and chat use server-verified Google activities. Suggestions shows the full saved recommendation collection, refreshed on focus and new receipts.

The layout follows the supplied 402 × 874 Figma reference. Wider windows center the 402-point shell; narrower devices use the available width. Bottom controls account for device safe areas. Fonts are bundled locally through the Expo Google Fonts packages; icons use Phosphor.

`src/theme.ts` contains shared colors and font families, including the Poppins and date fonts reserved for future suggestion rows. `OVERVIEW.md` describes the larger product.

The modular Supabase API lives in `api/`. Google setup and deployment requirements are below. Google Tasks and events are rendered by Organizer; suggestions are selected from the topic-matched catalog and saved upon frontend receipt.

The [background refresh framework](refresh/README.md) fetches Google Tasks and primary-calendar events in one backend response when connected, and public suggestions for locally selected topics in either state. It caches a typed snapshot and calls the Home AI selector. Home displays its local result first, refreshes every 15 minutes while active, and requests hourly native background refreshes. It catches up when the app resumes with overdue data. Topic selection is available in the account panel.


## Google setup and rollout

Enable Google Calendar and Google Tasks APIs. Configure a Web OAuth client with the exact Supabase callback `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. Enable that Google provider in Supabase. In **Authentication → URL Configuration**, set the Site URL to the deployed website (not `http://localhost:3000`) and add the exact `fuse://auth/callback` URI under Additional Redirect URLs, plus each exact web callback URL. The Android standalone app uses `fuse://auth/callback`; use a rebuilt APK after changing its native scheme or callback handling.

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

## Home interaction and navigation

Home uses at most two verified cards and fresh model-written copy. It prioritizes ongoing events or events within two hours until each has been displayed twice, then selects topic-matched suggestions. Suggestions never share an answer with tasks/events; chat allows up to five cards. Blocking Home/chat/recap failures appear as a compact error when no valid answer is available; background warnings stay in logs and not-found messages stay hidden. Recap and refresh use bold Phosphor icons; recap is fainter.

Focusing or editing the composer leaves Home visible. Send switches to the response view; Done appears two seconds after complete output or a terminal error and restores Home. Recap opens separately and offers Done when finished. Stop/Clear is available only during generation; the send arrow returns as soon as the answer arrives, before Done. It clears the view and ignores late responses. Client cancellation cannot undo a Google write already completed; activities refresh after an interrupted creation so saved items can appear. Never assume stopping means a write failed or automatically retry a creation.

Finger swipe directions: on Home, right-to-left opens Suggestions and left-to-right opens Accounts; on Suggestions, left-to-right returns Home; on Accounts, right-to-left closes the drawer. Hamburger toggles the drawer from either tab. Inputs, controls, and vertical scrolling do not trigger navigation. Escape/Android Back dismisses the drawer. Sign out clears private state, closes Accounts, and returns Home.

## Activity, refresh, and recap behavior

Organizer reads all task lists and primary-calendar event instances directly from Google with pagination. Calendar reads cover the previous 30 days and upcoming year. Completion/reopening patches Google; UI changes follow confirmed success, and errors remain retryable without an offline queue. Calendar completion uses private Fuse metadata and ETag conflict handling. Tasks have date-only deadlines.

Startup/resume, manual refresh, and the 15-minute foreground / hourly native background cadence fetch one organizer response with separate task/Calendar results. Successful sources remain usable when another fails. Home AI independently fetches current Google records for verified selections; confirmed completion and manual Organizer refresh regenerate Home. There is no Google-to-Supabase import or 30-second polling. Versioned local caches include user and Google connection identity; logout/disconnect/reconnect invalidate private results. External Google edits appear at manual or due refresh. Web needs an open/visible tab; native background work is OS-controlled.

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

For an event, use `kind: "schedule"`, `due_date: null`, and a start ISO timestamp with an offset. An omitted/null end defaults to 60 minutes after start; explicit end times or durations are preserved. All-day events use date strings and an exclusive end date, defaulting to one day if end is omitted/null. Chat asks for missing title, date, or start time, and clarifies task versus Calendar intent when needed. Google Tasks deadlines are date-only; exact time slots belong in Calendar. Chat supports one creation per turn; editing/deleting through chat is not included. Completion/reopening remains available in Organizer. Writes are never automatically retried; after an uncertain response, check Google before retrying to avoid duplicate items.

Deploy both `organizer` and `fuse-ai` to enable this flow; no new migration or OAuth scopes are required beyond the Google-direct setup.

## Verification

```sh
npm run typecheck
npm run test:refresh
npx tsx --test supabase/functions/tests/google.test.ts
npx tsx --test supabase/functions/tests/create.test.ts supabase/functions/tests/presentation.test.ts
node scripts/sync-ai-prompts.mjs --check
```

Mocks and local SQL checks cannot establish live OAuth, deployed migration/function behavior, Gemini quota, Google writes, native callbacks/storage, or OS scheduling. Test web/native cancellation, partial permissions, missing refresh credentials/retry, two-user isolation, pagination, recurring/all-day events, completion/reopening, deleted records, expired authorization, ETag conflicts, and logout/disconnect privacy against configured services.

Official references: [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [provider tokens](https://supabase.com/docs/guides/auth/social-login), [Calendar event-list metadata](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [private event properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties), [Google Tasks resource](https://developers.google.com/tasks/reference/rest/v1/tasks).


## Focused feed rollout

Apply `supabase/migrations/202610140003_user_suggestions_topics.sql` and `supabase/migrations/202610140004_suggestion_receipts.sql`, then deploy `fuse-ai` with its shared helpers. The receipt RPC authenticates the expected user, preserves historical recommendations/feedback, and inserts only missing assignments. Failed receipts persist locally and retry on app resume, tab focus, and later deliveries. Deploy the receipt migration before shipping this frontend.

The local display history stores two outputs per user and separate event display counts. Only focused, foreground rendering records a display; background generation and reopening the same response do not increment counts. Failed AI refreshes retain the last valid output. Home reuses its local result for 15 minutes in the foreground and an hour in native background work; failed attempts are also spaced to avoid repeated quota errors.

Home/Suggestions transitions follow horizontal drags and use a push animation for tab presses. The tab bar and footer slide with Home when Accounts opens. Opening Accounts darkens the displaced content by 25% using a black overlay; the backdrop closes it while the hamburger stays bright and clickable. Panel content starts 70px below the panel top, with logout pinned to its previous bottom position. The composer sits 10px above the keyboard; bottom navigation hides while typing. Reduced-motion settings disable transition movement.


## YouTube search demo

The app currently reads its Supabase suggestion catalog. To demo real videos yourself:

1. Enable YouTube Data API v3 in your Google Cloud project.
2. In Postman, send a GET to `https://www.googleapis.com/youtube/v3/search` with Params `part=snippet`, `type=video`, `q=technology`, `maxResults=5`, and `key=YOUR_API_KEY`.
3. In Supabase Table Editor, insert the chosen results into `suggestions`: `youtube_video_id` from `items[].id.videoId`, `title` and `description` from `snippet`, `thumbnail_url` from `snippet.thumbnails.medium.url`, `video_url` as `https://www.youtube.com/watch?v=VIDEO_ID`, and `is_active=true`. Duration can stay null.
4. Add a `suggestion_topics` row linking each new suggestion ID to the topic ID you chose.
5. Select that topic in the app account panel, refresh Home, or ask for suggestions. Received suggestions are saved into `user_suggestions` and appear in dated groups.

Keep a future automatic YouTube search key on the backend, rather than in an `EXPO_PUBLIC_` variable. Reference: https://developers.google.com/youtube/v3/docs/search/list

Suggestions also caches the complete dated collection locally per user. Tab focus displays cached cards immediately and revalidates in the background. Failed reads preserve the cache, and newly received cards are cached before their receipt is sent. Account changes never render another user's cached collection.
