/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRefreshCoordinator, REFRESH_INTERVAL_MS, type RefreshDependencies } from '../engine';
import { processRefreshSnapshot } from '../processor';
import type { CachedRefresh, RefreshSnapshot } from '../types';
import type { Task, Suggestion } from '../../api/types';

function video(id: string): Suggestion {
  return { id, title: id, youtube_video_id: id, video_url: 'https://example.test/video',
    thumbnail_url: null, description: null, duration_minutes: null, is_active: true,
    created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z' };
}

function ownedTask(userId: string): Task {
  return { id: 'task-1', user_id: userId, title: 'Task', description: null,
    due_date: '2026-10-13', due_time: null, mark_completed: false, google_connection_id: null,
    google_task_id: null, sync_status: 'synced', created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z' };
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
    getTasks: async () => { calls.tasks++; return [ownedTask(state.userId!)]; },
    getSchedules: async () => { calls.schedules++; return []; },
    schedulesImplemented: false,
    getSuggestions: async topic => { calls.suggestions.push(topic); return [video('shared'), video(topic)]; },
    process: async snapshot => { calls.snapshots.push(snapshot); return processRefreshSnapshot(snapshot); },
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
  assert.equal(result.record?.processing.status, 'not-configured');
});

test('signed-in refresh collects owned tasks and marks the schedules placeholder', async () => {
  const { calls, deps } = fixture('alice');
  const result = await createRefreshCoordinator(deps).run();
  assert.equal(calls.tasks, 1);
  assert.equal(calls.schedules, 1);
  assert.equal(result.record?.snapshot.tasks.data[0].user_id, 'alice');
  assert.equal(result.record?.snapshot.schedules.status, 'not-implemented');
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
  deps.getTasks = async () => { await gate.promise; return [ownedTask('alice')]; };
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
  deps.getTasks = async () => { calls.tasks++; await gate.promise; return [ownedTask('alice')]; };
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
  deps.getTasks = async () => { throw new Error('Network unavailable'); };
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
  deps.getTasks = async () => { throw Object.assign(new Error('Login required'), { code: 'AUTHENTICATION_REQUIRED' }); };
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
  assert.equal(result.record?.snapshot.tasks.data[0].user_id, 'bob');
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
