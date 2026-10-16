import { loadOrganizer, clearOrganizerCache, subscribeOrganizer } from '../api/organizer';
import { getSupabaseClient } from '../api/supabase';
import { getSuggestions } from '../api/suggestions';
import { clearRefreshCache, readLastGoodHome, readRefreshCache, saveRefreshCache } from './cache';
import { createRefreshCoordinator } from './engine';
import { processRefreshSnapshot } from './processor';
import { getRefreshTopicIds, subscribeTopicChanges } from './topics';

const coordinator = createRefreshCoordinator({
  useCachedContext: true,
  async getUserId() {
    const { data, error } = await getSupabaseClient().auth.getSession();
    if (error) throw error;
    return data.session?.user.id ?? null;
  },
  getTopicIds: getRefreshTopicIds,
  async getConnectionId() {
    const state = await loadOrganizer();
    return state.connection?.connection_status === 'connected' ? `${state.connection.id}:${state.connection.google_account_id ?? state.connection.google_acc ?? ''}:${state.connection.updated_at ?? ''}` : null;
  },
  async getOrganizer() {
    const state = await loadOrganizer();
    const source = <T,>(name: 'tasks' | 'calendar', data: T[]): import('./types').SourceResult<T> => ({
      status: state.source_status[name] === 'ok' ? 'ok' : state.source_status[name] === 'not_connected' ? 'authentication-required' : 'error',
      data, ...(state.source_errors[name] ? { error: state.source_errors[name] } : {}),
    });
    return { tasks: source('tasks', state.tasks), schedules: source('calendar', state.schedules), connectionId: state.connection?.connection_status === 'connected' ? `${state.connection.id}:${state.connection.google_account_id ?? state.connection.google_acc ?? ''}:${state.connection.updated_at ?? ''}` : null };
  },
  getSuggestions: topicId => getSuggestions({ topicId }),
  process: processRefreshSnapshot,
  async readCache() {
    const cached = await readRefreshCache();
    // Old text-only/unconfigured caches must not postpone the first AI decision.
    if (cached?.snapshot.userId && !cached.attemptedAt && (cached.processing.status !== 'completed' || !cached.processing.response?.response_id)) return null;
    return cached;
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
  const reset = (keepOrganizer = false, clearLastGood = false) => {
    coordinator.invalidate();
    if (!keepOrganizer) clearOrganizerCache();
    // Do not call async Supabase auth methods inside onAuthStateChange's lock.
    queueMicrotask(() => {
      void clearRefreshCache({ clearLastGood }).then(() => coordinator.run({ force: true })).catch(() => {
        console.warn('Could not clear the refresh cache. Cached results remain unavailable for the changed account.');
      });
    });
  };
  client.auth.onAuthStateChange((_event, session) => {
    const userId = session?.user.id ?? null;
    if (previousUserId !== undefined && userId !== previousUserId) reset(false, true);
    previousUserId = userId;
  });
  subscribeTopicChanges(() => reset());
  subscribeOrganizer(reason => { if (['creation', 'completion', 'disconnect', 'timezone', 'connection', 'signout', 'manual-refresh'].includes(reason)) reset(reason === 'manual-refresh', ['disconnect', 'connection', 'signout'].includes(reason)); });
  initialized = true;
  return coordinator;
}

export function refreshNow() {
  clearOrganizerCache();
  return initializeRefreshRuntime().run({ force: true });
}

export async function getLatestRefresh(userId?: string) {
  const runtime = initializeRefreshRuntime();
  if (userId) {
    const saved = await readLastGoodHome(userId);
    if (saved) return saved;
  }
  return runtime.latest({ localOnly: true });
}
