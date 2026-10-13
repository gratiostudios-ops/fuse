/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import { AuthenticationRequiredError } from '../auth/user';
import { queryTasks } from '../tasks/query';
import { querySchedules } from '../schedules/query';
import type { CatalogDatabase, Task, Schedule } from '../types';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
type Transport = NonNullable<NonNullable<SupabaseClientOptions<'public'>['realtime']>['transport']>;

function task(id: string, userId: string, completed = false): Task {
  return {
    id, user_id: userId, title: `Task ${id}`, description: null,
    due_date: '2026-10-13', due_time: null, mark_completed: completed,
    google_connection_id: null, google_task_id: null, sync_status: 'synced',
    created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
  };
}

async function clientFor(userId: string | null, rows: (Task | Schedule)[], cap = 100, table = 'tasks') {
  const requests: URL[] = [];
  let invalidSession = false;
  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (url.pathname === '/auth/v1/user') {
      if (invalidSession) return new Response(JSON.stringify({ message: 'Invalid token' }), { status: 401 });
      return new Response(JSON.stringify({
        id: userId, aud: 'authenticated', role: 'authenticated', email: 'demo@example.test',
        app_metadata: { provider: 'google' }, user_metadata: {}, created_at: '2026-10-13T00:00:00Z',
      }), { status: 200 });
    }
    assert.equal(url.pathname, `/rest/v1/${table}`);
    assert.equal(url.searchParams.get('user_id'), `eq.${userId}`);
    assert.equal(url.searchParams.get('order'), table === 'tasks' ? 'due_date.asc.nullslast,due_time.asc.nullslast,id.asc' : 'valid_from.asc,id.asc');
    assert(new Headers(init?.headers).get('Authorization')?.startsWith('Bearer '));
    const filtered = rows.filter(row => row.user_id === userId);
    const offset = Number(url.searchParams.get('offset'));
    const page = filtered.slice(offset, offset + Math.min(cap, Number(url.searchParams.get('limit'))));
    return new Response(JSON.stringify(page), {
      status: 200, headers: { 'Content-Range': `${page.length ? `${offset}-${offset + page.length - 1}` : '*'}/${filtered.length}` },
    });
  };
  const client = createClient<CatalogDatabase>('https://tasks.example.test', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: WebSocket as unknown as Transport },
    global: { fetch: mockFetch },
  });
  if (userId) {
    const token = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
      'mock-signature',
    ].join('.');
    const { error } = await client.auth.setSession({ access_token: token, refresh_token: 'mock-refresh-token' });
    if (error) throw error;
  }
  requests.length = 0;
  return { client, requests, invalidate: () => { invalidSession = true; } };
}

test('task reads reject without login and do not send a task query', async () => {
  const { client, requests } = await clientFor(null, []);
  await assert.rejects(queryTasks(client), AuthenticationRequiredError);
  assert.equal(requests.length, 0);
});

test('task reads use the verified user ID, include completed tasks, and page fully', async () => {
  const rows = [task('1', ALICE), task('2', BOB), task('3', ALICE, true), task('4', ALICE)];
  const { client, requests } = await clientFor(ALICE, rows, 2);
  const result = await queryTasks(client);
  assert.deepEqual(result.map(row => row.id), ['1', '3', '4']);
  assert.equal(result[1].mark_completed, true);
  assert.equal(requests[0].pathname, '/auth/v1/user');
  assert.deepEqual(requests.slice(1).map(url => url.searchParams.get('offset')), ['0', '2']);
});

test('a second user receives only their own tasks', async () => {
  const { client } = await clientFor(BOB, [task('1', ALICE), task('2', BOB)]);
  assert.deepEqual((await queryTasks(client)).map(row => row.id), ['2']);
});

test('users with no tasks receive an empty array', async () => {
  const { client } = await clientFor(ALICE, []);
  assert.deepEqual(await queryTasks(client), []);
});

test('invalid authenticated sessions are rejected before querying tasks', async () => {
  const { client, requests, invalidate } = await clientFor(ALICE, [task('1', ALICE)]);
  invalidate();
  await assert.rejects(queryTasks(client), AuthenticationRequiredError);
  assert.equal(requests.filter(url => url.pathname === '/rest/v1/tasks').length, 0);
});

test('signing out prevents subsequent task reads', async () => {
  const { client } = await clientFor(ALICE, []);
  const { error } = await client.auth.signOut({ scope: 'local' });
  assert.equal(error, null);
  await assert.rejects(queryTasks(client), AuthenticationRequiredError);
});

test('schedules reads require auth and paginate records scoped to the verified user', async () => {
  const anonymous = await clientFor(null, []);
  await assert.rejects(querySchedules(anonymous.client), AuthenticationRequiredError);
  const schedule = (id: string, user_id: string): Schedule => ({
    id, user_id, title: id, description: null, valid_from: '2026-10-14T10:00:00Z', valid_to: '2026-10-14T11:00:00Z',
    mark_completed: false, google_connection_id: null, cal_event_id: null, sync_status: 'synced',
    created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
  });
  const signedIn = await clientFor(ALICE, [schedule('a', ALICE), schedule('b', BOB), schedule('c', ALICE)], 1, 'schedules');
  assert.deepEqual((await querySchedules(signedIn.client)).map(s => s.id), ['a', 'c']);
  assert.deepEqual(signedIn.requests.slice(1).map(url => url.searchParams.get('offset')), ['0', '1']);
});
