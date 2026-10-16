# Background refresh

One shared pipeline runs on startup, when the app resumes with overdue data, every 15 minutes while visible and at an hourly minimum interval in native background work, and when the OS launches the registered native background task. Login, logout, account changes, and topic changes force a fresh run. An in-flight run is invalidated and its replacement queued when context changes.

## Data flow

- Signed in: fetch Google Tasks and primary-calendar events through one authenticated organizer backend response, and fetch public suggestions for selected local topics.
- Signed out: skip tasks/schedules and fetch only public suggestions.
- No topics selected: suggestions are empty with `no-topics` status. Topic selection defaults to an empty array; a selection screen is not included yet.
- The combined organizer request preserves independent task/event success and error statuses. Suggestions are deduplicated across topics; source errors are recorded alongside successful data. Failed source data is empty rather than reused from an old account/snapshot.
- Pass the snapshot to `processRefreshSnapshot()` in `processor.ts`. For signed-in users it calls `fuse-ai` in Home mode and stores a validated card response. The server independently fetches verified records; it does not trust the client snapshot as Google activity evidence. Signed-out processing returns `not-configured`. See [Google setup](../README.md#google-setup-and-rollout) for deployment.
- Cache the snapshot, processing status, AI response, and completion time locally. Private cache reads verify the current account, Google connection, and selected topics. Logout/account changes clear the cache; user/topic changes during collection, processing, or saving discard the old run.

Foreground freshness is 15 minutes; native background freshness is one hour. The locally persisted attempt timestamp spaces retries after failures, while the previous successful response and its original completion time remain available. Home renders the account/topic-scoped cache without waiting for a network connection check; explicit account, topic, or Google connection changes invalidate it immediately. Due refreshes verify the Google connection before replacing the result. Legacy unconfigured cache entries do not postpone the first decision. `refreshNow()` bypasses it. Authentication/session initialization failure aborts a run; it is not treated as anonymous access. A source's authentication rejection is distinct from its network/query failure.

## Module usage

```ts
import { setRefreshTopicIds, getRefreshTopicIds, refreshNow, getLatestRefresh } from './refresh';

// Use real topics.id UUIDs. The selected topics persist across login/logout.
await setRefreshTopicIds(['YOUR_TOPIC_UUID']);
const selected = await getRefreshTopicIds();
const result = await refreshNow();
const cached = await getLatestRefresh();
// cached.snapshot: userId, collectedAt, topicIds, tasks, schedules, suggestions.
// Each data source includes status, data, and optional error details.
```

Home renders AI-selected verified Google cards and short reasons. There is no activity-table query or Google-to-database import. Assigned AI suggestions are read server-side from `user_suggestions`, while the local snapshot retains the existing public topic catalog reads. Call `refreshNow()` after confirmed app mutations; external Google changes require Refresh or the next scheduled run.

## Background setup

`index.ts` imports the task definition before Expo Router. Metro uses `background/task.native.ts` for Android/iOS and the web stub for browser builds. The native task is `fuse-background-refresh` with `minimumInterval: 60`. The Expo background-task config plugin sets iOS processing mode and the permitted scheduler identifier when a native build is generated.

Rebuild the native development app after installing these modules:

```sh
npx expo run:android
# Or on macOS:
npx expo run:ios
```

Use a physical iOS device for background-task testing. Background registration may be unavailable/restricted on unsupported environments; startup and foreground refresh still work. Web refresh only runs while the tab is visible and resumes when it becomes visible again.

Native session/cache storage uses SecureStore with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` so a task can read it after the phone has been unlocked once since reboot. Existing sessions written with the old accessibility setting should be renewed by signing out/in after rebuilding. Browser data uses localStorage.

Android/iOS choose when to execute background work; one hour is not an exact timer. Force-quitting can stop execution until reopening the app. Activities are read directly from Google through the backend; no imported copies or offline completion queue are stored in Supabase. Organizer no longer polls every 30 seconds.

## Verify

```sh
npm run test:refresh
npm run typecheck
```

The coordinator tests cover anonymous/authenticated runs, partial failures, deduplication, throttling, overlap, and changing accounts/topics mid-run. For manual native testing, select a real topic, run `refreshNow()`, and inspect `getLatestRefresh()`. After the task has registered, trigger Expo's worker from development-only code:

```ts
import * as BackgroundTask from 'expo-background-task';
await BackgroundTask.triggerTaskWorkerForTestingAsync();
```

If the cache is younger than one hour, the worker will correctly skip fetching. To test a due run without waiting, remove the development cache key `fuse.refresh.snapshot` using the local storage adapter first. Sign in and check that only the connected account’s Google activities are cached; sign out and check private data is gone. Real OS scheduling and locked-device storage access require a native device and cannot be verified through a web preview.
