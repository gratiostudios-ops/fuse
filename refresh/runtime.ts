import { getSupabaseClient } from '../api/supabase';
import { getTasks } from '../api/tasks';
import { getSchedules, SCHEDULES_IMPLEMENTED } from '../api/schedules';
import { getSuggestions } from '../api/suggestions';
import { clearRefreshCache, readRefreshCache, saveRefreshCache } from './cache';
import { createRefreshCoordinator } from './engine';
import { processRefreshSnapshot } from './processor';
import { getRefreshTopicIds, subscribeTopicChanges } from './topics';

const coordinator = createRefreshCoordinator({
  async getUserId() {
    const { data, error } = await getSupabaseClient().auth.getSession();
    if (error) throw error;
    return data.session?.user.id ?? null;
  },
  getTopicIds: getRefreshTopicIds,
  getTasks,
  getSchedules,
  schedulesImplemented: SCHEDULES_IMPLEMENTED,
  getSuggestions: topicId => getSuggestions({ topicId }),
  process: processRefreshSnapshot,
  readCache: readRefreshCache,
  canReuseCache(cached) {
    // Old text-only/unconfigured caches must not postpone the first AI decision.
    return !cached.snapshot.userId || (cached.processing.status === 'completed' && !!cached.processing.response);
  },
  saveCache: saveRefreshCache,
  clearCache: clearRefreshCache,
  now: Date.now,
});

let initialized = false;

/** Also called by the headless worker; no dependency on mounted React components. */
export function initializeRefreshRuntime() {
  if (initialized) return coordinator;
  const client = getSupabaseClient();
  let previousUserId: string | null | undefined;
  const reset = () => {
    coordinator.invalidate();
    // Do not call async Supabase auth methods inside onAuthStateChange's lock.
    queueMicrotask(() => {
      void clearRefreshCache().then(() => coordinator.run({ force: true })).catch(() => {
        console.warn('Could not clear the refresh cache. Cached results remain unavailable for the changed account.');
      });
    });
  };
  client.auth.onAuthStateChange((_event, session) => {
    const userId = session?.user.id ?? null;
    if (previousUserId !== undefined && userId !== previousUserId) reset();
    previousUserId = userId;
  });
  subscribeTopicChanges(reset);
  initialized = true;
  return coordinator;
}

export function refreshNow() {
  return initializeRefreshRuntime().run({ force: true });
}

export function getLatestRefresh() {
  return initializeRefreshRuntime().latest();
}
