# Background refresh

One shared pipeline runs on startup, when the app resumes with overdue data, approximately every 30 minutes while visible, and when the OS launches the registered native background task. Login, logout, account changes, and topic changes force a fresh run. An in-flight run is invalidated and its replacement queued when context changes.

## Data flow

- Signed in: fetch owned tasks, call the authenticated schedules placeholder, and fetch public suggestions for selected local topics.
- Signed out: skip tasks/schedules and fetch only public suggestions.
- No topics selected: suggestions are empty with `no-topics` status. Topic selection defaults to an empty array; a selection screen is not included yet.
- Each source is fetched independently. Suggestions are deduplicated across topics; source errors are recorded alongside successful data. Failed source data is empty rather than reused from an old account/snapshot.
- Pass the snapshot to `processRefreshSnapshot()` in `processor.ts`. It currently returns `not-configured`; there is no AI request or generated answer.
- Cache the snapshot, processing status, and completion time locally. Private cache reads verify the current account and selected topics. Logout/account changes clear the cache; user/topic changes during collection, processing, or saving discard the old run.

The 30-minute age is measured from the last saved attempt, including partial results, to avoid repeated request storms on resume. `refreshNow()` bypasses it. Authentication/session initialization failure aborts a run; it is not treated as anonymous access. A source's authentication rejection is distinct from its network/query failure.

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

Data is not yet rendered in the existing screens. `getSchedules()` in `api/schedules` verifies sign-in and returns `[]` without calling a schedules database/API. Implement that module later and change `SCHEDULES_IMPLEMENTED` to true.

## Background setup

`index.ts` imports the task definition before Expo Router. Metro uses `background/task.native.ts` for Android/iOS and the web stub for browser builds. The native task is `fuse-background-refresh` with `minimumInterval: 30`. The Expo background-task config plugin sets iOS processing mode and the permitted scheduler identifier when a native build is generated.

Rebuild the native development app after installing these modules:

```sh
npx expo run:android
# Or on macOS:
npx expo run:ios
```

Use a physical iOS device for background-task testing. Background registration may be unavailable/restricted on unsupported environments; startup and foreground refresh still work. Web refresh only runs while the tab is visible and resumes when it becomes visible again.

Native session/cache storage uses SecureStore with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` so a task can read it after the phone has been unlocked once since reboot. Existing sessions written with the old accessibility setting should be renewed by signing out/in after rebuilding. Browser data uses localStorage.

Android/iOS choose when to execute background work; 30 minutes is not an exact timer. Force-quitting can stop execution until reopening the app. This is refresh from Supabase, not Google Calendar/Tasks synchronization.

## Verify

```sh
npm run test:refresh
npm run test:api
npm run typecheck
```

The coordinator tests cover anonymous/authenticated runs, partial failures, deduplication, throttling, overlap, and changing accounts/topics mid-run. For manual native testing, select a real topic, run `refreshNow()`, and inspect `getLatestRefresh()`. After the task has registered, trigger Expo's worker from development-only code:

```ts
import * as BackgroundTask from 'expo-background-task';
await BackgroundTask.triggerTaskWorkerForTestingAsync();
```

If the cache is younger than 30 minutes, the worker will correctly skip fetching. To test a due run without waiting, remove the development cache key `fuse.refresh.snapshot` using the local storage adapter first. Sign in and check that only owned tasks are cached; sign out and check private data is gone. Real OS scheduling and locked-device storage access require a native device and cannot be verified through a web preview.
