/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRefreshCoordinator, REFRESH_INTERVAL_MS, type RefreshDependencies } from '../engine';
import type { CachedRefresh, RefreshSnapshot } from '../types';
import type { Task, Suggestion } from '../../api/types';

function video(id: string): Suggestion {
  return { id, title: id, youtube_video_id: id, video_url: 'https://example.test/video',
    thumbnail_url: null, description: null, duration_minutes: null, is_active: true,
    created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z' };
}

function ownedTask(userId: string): Task {
  return { id: `google:task:${userId}:task-1`, title: 'Task', description: null,
    due_date: '2026-10-13', mark_completed: false, google_tasklist_id: userId,
    google_task_id: 'task-1', source_updated_at: '2026-10-13T00:00:00Z' };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

function fixture(userId: string | null = null) {
  const state = { userId, topics: ['topic-a', 'topic-b'], time: Date.parse('2026-10-13T00:00:00Z'), cache: null as CachedRefresh | null };
  const calls = { tasks: 0, schedules: 0, suggestions: [] as string[], snapshots: [] as RefreshSnapshot[] };
  const deps: RefreshDependencies = {
    getUserId: async () => state.userId,
    getTopicIds: async () => state.topics,
    getConnectionId: async () => state.userId ? `connection:${state.userId}` : null,
    getOrganizer: async () => { calls.tasks++; calls.schedules++; return {
      tasks: { status: 'ok', data: [ownedTask(state.userId!)] }, schedules: { status: 'ok', data: [] }, connectionId: `connection:${state.userId}`,
    }; },
    getSuggestions: async topic => { calls.suggestions.push(topic); return [video('shared'), video(topic)]; },
    process: async snapshot => { calls.snapshots.push(snapshot); return { status: 'completed' }; },
    readCache: async () => state.cache,
    saveCache: async record => { state.cache = record; },
    clearCache: async () => { state.cache = null; },
    now: () => state.time,
  };
  return { state, calls, deps };
}

test('signed-out refresh collects only public suggestions and deduplicates topics/videos', async () => {
  const { state, calls, deps } = fixture();
  state.topics = ['topic-b', 'topic-a', 'topic-a'];
  const runner = createRefreshCoordinator(deps);
  const result = await runner.run();
  assert.equal(result.status, 'completed');
  assert.equal(calls.tasks, 0);
  assert.equal(calls.schedules, 0);
  assert.deepEqual(calls.suggestions, ['topic-a', 'topic-b']);
  assert.equal(result.record?.snapshot.suggestions.data.length, 3);
  assert.equal(result.record?.snapshot.tasks.status, 'skipped');
  assert.equal(result.record?.processing.status, 'completed');
});

test('signed-in refresh collects both Google sources in one response', async () => {
  const { calls, deps } = fixture('alice');
  const result = await createRefreshCoordinator(deps).run();
  assert.equal(calls.tasks, 1);
  assert.equal(calls.schedules, 1);
  assert.equal(result.record?.snapshot.tasks.data[0].google_tasklist_id, 'alice');
  assert.equal(result.record?.snapshot.schedules.status, 'ok');
});

test('fresh data skips refresh until 30 minutes have elapsed, unless forced', async () => {
  const { state, calls, deps } = fixture();
  const runner = createRefreshCoordinator(deps);
  await runner.run();
  assert.equal((await runner.run()).status, 'skipped');
  state.time += REFRESH_INTERVAL_MS;
  assert.equal((await runner.run()).status, 'completed');
  assert.equal((await runner.run({ force: true })).status, 'completed');
  assert.equal(calls.snapshots.length, 3);
});

test('overlapping foreground/background calls share one run', async () => {
  const { calls, deps } = fixture();
  const gate = deferred();
  const original = deps.getSuggestions;
  deps.getSuggestions = async topic => { await gate.promise; return original(topic); };
  const runner = createRefreshCoordinator(deps);
  const first = runner.run();
  const second = runner.run();
  assert.equal(first, second);
  gate.release();
  await first;
  assert.equal(calls.snapshots.length, 1);
});

test('logout during collection discards private data before processing or saving', async () => {
  const { state, calls, deps } = fixture('alice');
  const gate = deferred();
  const original = deps.getOrganizer; deps.getOrganizer = async () => { await gate.promise; return original(); };
  const runner = createRefreshCoordinator(deps);
  const pending = runner.run();
  await new Promise(resolve => setImmediate(resolve));
  state.userId = null;
  runner.invalidate();
  gate.release();
  assert.equal((await pending).status, 'discarded');
  assert.equal(calls.snapshots.length, 0);
  assert.equal(state.cache, null);
});

test('a forced login/topic refresh queues after an in-flight run without overlap', async () => {
  const { state, calls, deps } = fixture('alice');
  const gate = deferred();
  const original = deps.getOrganizer; deps.getOrganizer = async () => { await gate.promise; return original(); };
  const runner = createRefreshCoordinator(deps);
  const pending = runner.run();
  await new Promise(resolve => setImmediate(resolve));
  state.userId = null;
  runner.invalidate();
  const queued = runner.run({ force: true });
  assert.equal(pending, queued);
  gate.release();
  const result = await queued;
  assert.equal(result.status, 'completed');
  assert.equal(result.record?.snapshot.userId, null);
  assert.deepEqual(result.record?.snapshot.tasks.data, []);
  assert.equal(calls.tasks, 1);
  assert.equal(calls.snapshots.length, 1);
});

test('account/topic changes during AI processing discard its result', async () => {
  const { state, deps } = fixture('alice');
  const gate = deferred();
  const started = deferred();
  deps.process = async () => { started.release(); await gate.promise; return { status: 'completed' }; };
  const runner = createRefreshCoordinator(deps);
  const pending = runner.run();
  await started.promise;
  state.topics = ['new-topic'];
  runner.invalidate();
  gate.release();
  assert.equal((await pending).status, 'discarded');
  assert.equal(state.cache, null);
});

test('source failures keep successful data without treating network errors as logout', async () => {
  const { deps } = fixture('alice');
  deps.getOrganizer = async () => ({ tasks: { status: 'error', data: [], error: 'Network unavailable' }, schedules: { status: 'ok', data: [] }, connectionId: 'connection:alice' });
  deps.getSuggestions = async topic => {
    if (topic === 'topic-b') throw new Error('Topic fetch failed');
    return [video('successful')];
  };
  const result = await createRefreshCoordinator(deps).run();
  assert.equal(result.status, 'partial');
  assert.equal(result.record?.snapshot.userId, 'alice');
  assert.equal(result.record?.snapshot.tasks.status, 'error');
  assert.equal(result.record?.snapshot.suggestions.status, 'partial');
  assert.deepEqual(result.record?.snapshot.suggestions.failedTopicIds, ['topic-b']);
  assert.equal(result.record?.snapshot.suggestions.data[0].id, 'successful');
});

test('authentication failures are distinct from source/network failures', async () => {
  const { deps } = fixture('alice');
  deps.getOrganizer = async () => ({ tasks: { status: 'authentication-required', data: [], error: 'Reconnect Google' }, schedules: { status: 'ok', data: [] }, connectionId: 'connection:alice' });
  const result = await createRefreshCoordinator(deps).run();
  assert.equal(result.record?.snapshot.tasks.status, 'authentication-required');
  assert.deepEqual(result.record?.snapshot.tasks.data, []);
});

test('no topic selection produces an explicit empty suggestions source', async () => {
  const { state, calls, deps } = fixture();
  state.topics = [];
  const result = await createRefreshCoordinator(deps).run();
  assert.equal(result.record?.snapshot.suggestions.status, 'no-topics');
  assert.deepEqual(calls.suggestions, []);
});

test('cached private data is unavailable after changing accounts and is replaced', async () => {
  const { state, deps } = fixture('alice');
  const runner = createRefreshCoordinator(deps);
  await runner.run();
  state.userId = 'bob';
  assert.equal(await runner.latest(), null);
  const result = await runner.run();
  assert.equal(result.record?.snapshot.tasks.data[0].google_tasklist_id, 'bob');
});

test('session initialization errors abort rather than impersonating a signed-out user', async () => {
  const { calls, deps } = fixture('alice');
  deps.getUserId = async () => { throw new Error('Session refresh network failure'); };
  const result = await createRefreshCoordinator(deps).run();
  assert.equal(result.status, 'failed');
  assert.equal(calls.snapshots.length, 0);
  assert.deepEqual(calls.suggestions, []);
});

test('processor failure retains fetched data with an explicit processing error', async () => {
  const { deps } = fixture();
  deps.process = async () => { throw new Error('AI unavailable'); };
  const result = await createRefreshCoordinator(deps).run();
  assert.equal(result.status, 'partial');
  assert.equal(result.record?.processing.status, 'error');
  assert.equal(result.record?.snapshot.suggestions.data.length, 3);
});

test('logout while saving clears any private snapshot written by the old run', async () => {
  const { state, deps } = fixture('alice');
  const gate = deferred();
  const started = deferred();
  deps.saveCache = async record => {
    started.release();
    await gate.promise;
    state.cache = record;
  };
  const runner = createRefreshCoordinator(deps);
  const pending = runner.run();
  await started.promise;
  state.userId = null;
  runner.invalidate();
  gate.release();
  assert.equal((await pending).status, 'discarded');
  assert.equal(state.cache, null);
});

test('switching accounts and back still invalidates the original generation', async () => {
  const { state, deps } = fixture('alice');
  const gate = deferred();
  const started = deferred();
  deps.process = async () => { started.release(); await gate.promise; return { status: 'completed' }; };
  const runner = createRefreshCoordinator(deps);
  const pending = runner.run();
  await started.promise;
  state.userId = 'bob';
  runner.invalidate();
  state.userId = 'alice';
  runner.invalidate();
  gate.release();
  assert.equal((await pending).status, 'discarded');
  assert.equal(state.cache, null);
});


test('changing Google connections hides and replaces cached activity for the same app user', async () => {
  const { state, deps } = fixture('alice');
  let connection = 'google-one';
  deps.getConnectionId = async () => connection;
  deps.getOrganizer = async () => ({ tasks: { status: 'ok', data: [ownedTask(connection)] }, schedules: { status: 'ok', data: [] }, connectionId: connection });
  const runner = createRefreshCoordinator(deps);
  await runner.run();
  connection = 'google-two';
  assert.equal(await runner.latest(), null);
  assert.equal((await runner.run()).record?.snapshot.connectionId, 'google-two');
  assert.equal(state.cache?.snapshot.tasks.data[0].google_tasklist_id, 'google-two');
});

test('Calendar failure preserves tasks and suggestions from the same collection', async () => {
  const { deps } = fixture('alice');
  deps.getOrganizer = async () => ({ tasks: { status: 'ok', data: [ownedTask('alice')] }, schedules: { status: 'error', data: [], error: 'Calendar unavailable' }, connectionId: 'connection:alice' });
  const result = await createRefreshCoordinator(deps).run();
  assert.equal(result.status, 'partial');
  assert.equal(result.record?.snapshot.tasks.data.length, 1);
  assert.equal(result.record?.snapshot.schedules.error, 'Calendar unavailable');
  assert.equal(result.record?.snapshot.suggestions.data.length, 3);
});

test('connection lookup failure preserves suggestions and hides the earlier private feed', async () => {
  const { state, deps } = fixture('alice');
  const runner = createRefreshCoordinator(deps);
  await runner.run();
  deps.getConnectionId = async () => { throw new Error('Organizer transport unavailable'); };
  deps.getOrganizer = async () => { throw new Error('Organizer transport unavailable'); };
  assert.equal(await runner.latest(), null);
  const result = await runner.run();
  assert.equal(result.status, 'partial');
  assert.equal(result.record?.snapshot.connectionId, null);
  assert.equal(result.record?.snapshot.tasks.status, 'error');
  assert.deepEqual(result.record?.snapshot.tasks.data, []);
  assert.equal(result.record?.snapshot.suggestions.data.length, 3);
  assert.equal(state.cache?.snapshot.connectionId, null);
  assert.equal(await runner.latest(), null);
});


test('a transient AI failure retains the last valid output without refreshing its age', async () => {
  const { state, deps } = fixture('owner');
  const response = { schema_version: 1 as const, response_id: 'valid', message: 'A useful next step', blocks: [] };
  deps.process = async () => ({ status: 'completed', response });
  const runner = createRefreshCoordinator(deps);
  await runner.run();
  const previous = state.cache;
  state.time += REFRESH_INTERVAL_MS + 1;
  deps.process = async () => { throw new Error('Temporary outage'); };
  const result = await runner.run();
  assert.equal(result.status, 'partial');
  assert.equal(state.cache, previous);
  assert.equal((await runner.latest())?.processing.status, 'completed');
});
