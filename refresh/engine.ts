import type { Schedule, Suggestion, Task } from '../api/types';
import type { CachedRefresh, ProcessingResult, RefreshRunResult, RefreshSnapshot, SourceResult } from './types';

export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export type RefreshDependencies = {
  getUserId(): Promise<string | null>;
  getTopicIds(): Promise<string[]>;
  getOrganizer(): Promise<{ tasks: SourceResult<Task>; schedules: SourceResult<Schedule>; connectionId: string | null }>;
  getConnectionId(): Promise<string | null>;
  getSuggestions(topicId: string): Promise<Suggestion[]>;
  process(snapshot: RefreshSnapshot): Promise<ProcessingResult>;
  readCache(): Promise<CachedRefresh | null>;
  saveCache(record: CachedRefresh): Promise<void>;
  clearCache(): Promise<void>;
  now(): number;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Refresh source failed.';
}

function normalizeTopics(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

function contextKey(userId: string | null, topicIds: string[], connectionId: string | null = null): string {
  return JSON.stringify([userId, connectionId, normalizeTopics(topicIds)]);
}

async function collect<T>(operation: () => Promise<T[]>, status: 'ok' | 'not-implemented' = 'ok'): Promise<SourceResult<T>> {
  try { return { status, data: await operation() }; }
  catch (error) {
    const authentication = error && typeof error === 'object' && 'code' in error && error.code === 'AUTHENTICATION_REQUIRED';
    return { status: authentication ? 'authentication-required' : 'error', data: [], error: errorMessage(error) };
  }
}

/** One shared runner for foreground and headless background execution. */
export function createRefreshCoordinator(deps: RefreshDependencies) {
  let generation = 0;
  let active: Promise<RefreshRunResult> | undefined;
  let forceAgain = false;
  let acceptingForce = false;

  async function connectionScope(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    try { return await deps.getConnectionId(); }
    catch { return null; }
  }

  async function latest(): Promise<CachedRefresh | null> {
    const startGeneration = generation;
    const userId = await deps.getUserId();
    const topicIds = await deps.getTopicIds();
    let connectionId: string | null;
    try { connectionId = userId ? await deps.getConnectionId() : null; }
    catch { return null; } // An unverified connection must never expose an earlier private feed.
    const record = await deps.readCache();
    if (!record || startGeneration !== generation) return null;
    if (contextKey(record.snapshot.userId, record.snapshot.topicIds, record.snapshot.connectionId) !== contextKey(userId, topicIds, connectionId)) return null;
    if (await deps.getUserId() !== userId || startGeneration !== generation) return null;
    return record;
  }

  async function once(force: boolean): Promise<RefreshRunResult> {
    const startGeneration = generation;
    const userId = await deps.getUserId(); // Network/session failures abort, never imply logout.
    const topicIds = normalizeTopics(await deps.getTopicIds());
    const connectionId = await connectionScope(userId);
    const scope = contextKey(userId, topicIds, connectionId);
    const cached = await deps.readCache();
    if (cached && contextKey(cached.snapshot.userId, cached.snapshot.topicIds, cached.snapshot.connectionId) !== scope) await deps.clearCache();
    if (!force && cached && contextKey(cached.snapshot.userId, cached.snapshot.topicIds, cached.snapshot.connectionId) === scope) {
      const age = deps.now() - Date.parse(cached.completedAt);
      if (age >= 0 && age < REFRESH_INTERVAL_MS) return { status: 'skipped', reason: 'not-due' };
    }

    const unchanged = async () => startGeneration === generation && scope === contextKey(await deps.getUserId(), await deps.getTopicIds(), await connectionScope(userId)) && startGeneration === generation;

    const publicSuggestions = async (): Promise<SourceResult<Suggestion>> => {
      if (topicIds.length === 0) return { status: 'no-topics', data: [] };
      const sources = await Promise.all(topicIds.map(async topicId => ({
        topicId, result: await collect(() => deps.getSuggestions(topicId)),
      })));
      const videos = new Map<string, Suggestion>();
      const failedTopicIds: string[] = [];
      const errors: string[] = [];
      for (const { topicId, result } of sources) {
        for (const suggestion of result.data) videos.set(suggestion.id, suggestion);
        if (result.status === 'error' || result.status === 'authentication-required') {
          failedTopicIds.push(topicId);
          errors.push(result.error ?? 'Could not load suggestions.');
        }
      }
      const data = [...videos.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
      return {
        status: failedTopicIds.length === 0 ? 'ok' : failedTopicIds.length === topicIds.length ? 'error' : 'partial',
        data,
        ...(failedTopicIds.length ? { failedTopicIds, error: errors.join('; ') } : {}),
      };
    };

    const organizer = async () => {
      if (!userId) return { tasks: { status: 'skipped', data: [] } as SourceResult<Task>, schedules: { status: 'skipped', data: [] } as SourceResult<Schedule>, connectionId: null };
      try { return await deps.getOrganizer(); }
      catch (error) { return { tasks: { status: 'error', data: [], error: errorMessage(error) } as SourceResult<Task>, schedules: { status: 'error', data: [], error: errorMessage(error) } as SourceResult<Schedule>, connectionId }; }
    };
    const [activity, suggestions] = await Promise.all([organizer(), publicSuggestions()]);
    const { tasks, schedules } = activity;
    if (!await unchanged()) return { status: 'discarded', reason: 'context-changed' };

    const snapshot: RefreshSnapshot = { userId, connectionId: activity.connectionId, topicIds, collectedAt: new Date(deps.now()).toISOString(), tasks, schedules, suggestions };
    let processing: ProcessingResult;
    try { processing = await deps.process(snapshot); }
    catch (error) { processing = { status: 'error', error: errorMessage(error) }; }
    if (!await unchanged()) return { status: 'discarded', reason: 'context-changed' };

    // Keep the last valid output available after a transient AI failure. Its old
    // timestamp keeps it eligible for retry rather than caching a failure for 30 minutes.
    if (processing.status === 'error' && cached?.processing.status === 'completed'
      && contextKey(cached.snapshot.userId, cached.snapshot.topicIds, cached.snapshot.connectionId) === scope) {
      return { status: 'partial', record: cached };
    }

    const record: CachedRefresh = { version: 2, completedAt: new Date(deps.now()).toISOString(), snapshot, processing };
    await deps.saveCache(record);
    if (!await unchanged()) {
      await deps.clearCache();
      return { status: 'discarded', reason: 'context-changed' };
    }
    const failed = [tasks, schedules, suggestions].some(source => ['error', 'partial', 'authentication-required'].includes(source.status)) || processing.status === 'error';
    return { status: failed ? 'partial' : 'completed', record };
  }

  function run({ force = false }: { force?: boolean } = {}): Promise<RefreshRunResult> {
    if (active) {
      // A force request arriving after the loop has ended must start a new run.
      if (force && !acceptingForce) return active.then(() => run({ force: true }));
      if (force) forceAgain = true;
      return active;
    }
    acceptingForce = true;
    active = (async () => {
      let result: RefreshRunResult;
      let forced = force;
      do {
        forceAgain = false;
        try { result = await once(forced); }
        catch (error) { result = { status: 'failed', reason: errorMessage(error) }; }
        forced = forceAgain;
      } while (forced);
      acceptingForce = false;
      return result;
    })().finally(() => { active = undefined; });
    return active;
  }

  return {
    run,
    latest,
    // Call synchronously on identity/topic changes, before any async cache work.
    invalidate(): void { generation++; },
  };
}
