import type { Schedule, Suggestion, Task } from '../api/types';
import type { CachedRefresh, ProcessingResult, RefreshRunResult, RefreshSnapshot, SourceResult } from './types';

export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export type RefreshDependencies = {
  getUserId(): Promise<string | null>;
  getTopicIds(): Promise<string[]>;
  getTasks(): Promise<Task[]>;
  getSchedules(): Promise<Schedule[]>;
  schedulesImplemented: boolean;
  getSuggestions(topicId: string): Promise<Suggestion[]>;
  process(snapshot: RefreshSnapshot): Promise<ProcessingResult>;
  readCache(): Promise<CachedRefresh | null>;
  canReuseCache?(record: CachedRefresh): boolean;
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

function contextKey(userId: string | null, topicIds: string[]): string {
  return JSON.stringify([userId, normalizeTopics(topicIds)]);
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

  async function latest(): Promise<CachedRefresh | null> {
    const startGeneration = generation;
    const userId = await deps.getUserId();
    const topicIds = await deps.getTopicIds();
    const record = await deps.readCache();
    if (!record || startGeneration !== generation) return null;
    if (contextKey(record.snapshot.userId, record.snapshot.topicIds) !== contextKey(userId, topicIds)) return null;
    if (await deps.getUserId() !== userId || startGeneration !== generation) return null;
    return record;
  }

  async function once(force: boolean): Promise<RefreshRunResult> {
    const startGeneration = generation;
    const userId = await deps.getUserId(); // Network/session failures abort, never imply logout.
    const topicIds = normalizeTopics(await deps.getTopicIds());
    const scope = contextKey(userId, topicIds);
    const cached = await deps.readCache();
    if (cached && contextKey(cached.snapshot.userId, cached.snapshot.topicIds) !== scope) await deps.clearCache();
    if (!force && cached && (deps.canReuseCache?.(cached) ?? true) && contextKey(cached.snapshot.userId, cached.snapshot.topicIds) === scope) {
      const age = deps.now() - Date.parse(cached.completedAt);
      if (age >= 0 && age < REFRESH_INTERVAL_MS) return { status: 'skipped', reason: 'not-due' };
    }

    const unchanged = async () => startGeneration === generation && scope === contextKey(await deps.getUserId(), await deps.getTopicIds()) && startGeneration === generation;

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

    const [tasks, schedules, suggestions] = await Promise.all([
      userId ? collect(deps.getTasks) : Promise.resolve<SourceResult<Task>>({ status: 'skipped', data: [] }),
      userId ? collect(deps.getSchedules, deps.schedulesImplemented ? 'ok' : 'not-implemented') : Promise.resolve<SourceResult<Schedule>>({ status: 'skipped', data: [] }),
      publicSuggestions(),
    ]);
    if (!await unchanged()) return { status: 'discarded', reason: 'context-changed' };

    const snapshot: RefreshSnapshot = { userId, topicIds, collectedAt: new Date(deps.now()).toISOString(), tasks, schedules, suggestions };
    let processing: ProcessingResult;
    try { processing = await deps.process(snapshot); }
    catch (error) { processing = { status: 'error', error: errorMessage(error) }; }
    if (!await unchanged()) return { status: 'discarded', reason: 'context-changed' };

    const record: CachedRefresh = { version: 1, completedAt: new Date(deps.now()).toISOString(), snapshot, processing };
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
