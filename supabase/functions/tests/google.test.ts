import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store, encrypt } from '../_shared/organizer-server.ts';
import { pages, readGoogleActivities, registerGoogle, requiredScopes, setGoogleCompletion } from '../_shared/organizer-google.ts';
import { mapTask, recapActivities } from '../_shared/organizer-domain.ts';

const originalFetch = globalThis.fetch;
Object.assign(globalThis, { Deno: { env: { get: (key: string) => ({ GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', ORGANIZER_TOKEN_KEY: Buffer.alloc(32, 4).toString('base64') })[key] } } });
afterEach(() => { globalThis.fetch = originalFetch; });
const connection = { id: 'connection', user_id: 'owner', google_account_id: 'account', connection_status: 'connected' };
const json = (value: unknown, status = 200) => Response.json(value, { status });
async function database() {
  const reads: string[] = [], calls: { name: string; body: any }[] = [];
  const credential = { encrypted_refresh_token: await encrypt('refresh'), oauth_client_id: 'client' };
  const db = {
    rows: async (table: string) => { reads.push(table); if (table === 'calendar_connections') return [connection]; if (table === 'organizer_credentials') return [credential]; if (table === 'organizer_settings') return [{ connection_generation: 5 }]; throw new Error('Unexpected DB table ' + table); },
    patch: async () => [],
    upsert: async () => [],
    rpc: async (name: string, body: any) => { calls.push({ name, body }); return { ...connection, connection_status: 'connected' }; },
  } as unknown as Store;
  return { db, reads, calls };
}
function authorizedFetch(route: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') return json({ access_token: 'refreshed' });
    return route(url, init);
  };
}
test('pagination follows nextPageToken and rejects loops', async () => {
  const visited: string[] = [];
  const items = await pages(async path => { visited.push(path); return path.includes('pageToken') ? { items: [{ id: 'second' }] } : { items: [{ id: 'first' }], nextPageToken: 'next' }; }, 'test', { maxResults: '100' });
  assert.equal(items.length, 2); assert.match(visited[1], /pageToken=next/);
  await assert.rejects(pages(async () => ({ nextPageToken: 'same' }), 'test', {}), /processing limit/);
});
test('Tasks 403 distinguishes disabled API, missing permission, and quota while Calendar loads', async () => {
  const { db } = await database();
  for (const [reason, expected] of [['SERVICE_DISABLED', /API is disabled/], ['ACCESS_TOKEN_SCOPE_INSUFFICIENT', /permission is missing/], ['rateLimitExceeded', /usage limit reached/]]) {
    authorizedFetch(url => url.pathname.includes('tasks')
      ? json({ error: { details: [{ reason }] } }, 403)
      : json({ timeZone: 'UTC', items: [] }));
    const result = await readGoogleActivities(db, 'owner');
    assert.deepEqual(result.source_status, { tasks: 'error', calendar: 'ok' });
    assert.match(result.source_errors.tasks, expected);
  }
});
test('Google reads all task lists/pages and preserves independent Calendar failure', async () => {
  const { db, reads } = await database();
  authorizedFetch(url => {
    if (url.pathname.includes('calendar')) return json({}, 403);
    if (url.pathname.endsWith('/lists')) return json(url.searchParams.has('pageToken') ? { items: [{ id: 'list2' }] } : { items: [{ id: 'list1' }], nextPageToken: 'next' });
    assert.equal(url.searchParams.get('showCompleted'), 'true'); assert.equal(url.searchParams.get('showHidden'), 'true');
    return json({ items: [{ id: 'task', title: url.pathname, status: 'completed', completed: '2026-10-14T07:00:00Z' }] });
  });
  const result = await readGoogleActivities(db, 'owner');
  assert.equal(result.tasks.length, 2); assert.notEqual(result.tasks[0].id, result.tasks[1].id);
  assert.deepEqual(result.source_status, { tasks: 'ok', calendar: 'error' });
  assert.ok(reads.every(t => !['tasks', 'schedules', 'organizer_completion_history'].includes(t)));
});
test('registration isolates Google identities and rejects missing scope/offline credentials', async () => {
  const { db, calls } = await database();
  let scopes = requiredScopes.join(' '), account = 'account';
  authorizedFetch(url => url.pathname === '/tokeninfo' ? json({ aud: 'client', scope: scopes }) : json({ sub: account, email: 'person@example.com' }));
  const user = { id: 'owner', identities: [{ provider: 'google', identity_data: { sub: 'other' } }] };
  await assert.rejects(registerGoogle(db, user, { provider_token: 'access', provider_refresh_token: 'refresh' }), /does not match/);
  user.identities[0].identity_data.sub = 'account'; scopes = requiredScopes[0];
  await assert.rejects(registerGoogle(db, user, { provider_token: 'access', provider_refresh_token: 'refresh' }), /permissions/);
  scopes = requiredScopes.join(' ');
  const result = await registerGoogle(db, user, { provider_token: 'access', provider_refresh_token: 'refresh' });
  assert.equal(result.status, 'connected'); assert.equal(calls[0].body.expected_generation, 5);
  assert.notEqual(calls[0].body.encrypted_token, 'refresh'); assert.equal(calls[0].name, 'fuse_register_google');
  assert.ok(!JSON.stringify(result).includes('refresh'));
  const noExisting = { ...db, rows: async (table: string) => table === 'organizer_settings' ? [{ connection_generation: 0 }] : [] } as unknown as Store;
  await assert.rejects(registerGoogle(noExisting, user, { provider_token: 'access' }), /offline access/);
  account = 'other';
  await assert.rejects(registerGoogle(db, user, { provider_token: 'access', provider_refresh_token: 'refresh' }), /does not match/);
});
test('Calendar ETag conflict rereads current metadata and retries confirmed write', async () => {
  const { db } = await database(); let attempts = 0, reads = 0;
  authorizedFetch((url, init) => {
    if (url.pathname === '/calendar/v3/calendars/primary/events') return json({ timeZone: 'UTC' });
    if (init?.method === 'PATCH') {
      attempts++; const patch = JSON.parse(String(init.body));
      assert.equal((init.headers as Record<string, string>)['If-Match'], 'version' + reads);
      assert.equal(patch.extendedProperties.private.unrelated, 'preserve');
      if (attempts === 1) return json({}, 412);
      return json({ id: 'event', ...patch, start: { date: '2026-10-14' }, end: { date: '2026-10-15' } });
    }
    reads++; return json({ id: 'event', etag: 'version' + reads, summary: 'Meeting', extendedProperties: { private: { unrelated: 'preserve' } } });
  });
  const result = await setGoogleCompletion(db, 'owner', { kind: 'schedule', calendarId: 'primary', eventId: 'event', completed: true });
  assert.equal(attempts, 2); assert.equal(result.mark_completed, true); assert.equal(result.is_all_day, true);
});
test('Task reopen waits for Google and deleted Google items reject', async () => {
  const { db } = await database();
  authorizedFetch((url, init) => {
    const patch = JSON.parse(String(init?.body)); assert.equal(patch.status, 'needsAction'); assert.equal(patch.completed, null);
    return json({ id: 'task', title: 'Work', ...patch });
  });
  assert.equal((await setGoogleCompletion(db, 'owner', { kind: 'task', taskListId: 'list', taskId: 'task', completed: false })).mark_completed, false);
  authorizedFetch(() => json({}, 404));
  await assert.rejects(setGoogleCompletion(db, 'owner', { kind: 'task', taskListId: 'list', taskId: 'deleted', completed: true }), /no longer exists/);
});
test('Google-only recap uses current completion timestamps and task date only', () => {
  const complete = mapTask({ id: 'done', status: 'completed', completed: '2026-10-14T10:00:00Z', due: '2026-10-15T00:00:00Z' }, 'list');
  const reopened = mapTask({ id: 'reopened', status: 'needsAction', completed: '2026-10-14T10:00:00Z', due: '2026-10-15T00:00:00Z' }, 'list');
  const result = recapActivities([complete, reopened], [], '2026-10-14', 'UTC');
  assert.equal(result.completed_today.length, 1); assert.equal(result.tomorrow_tasks.length, 1); assert.ok(!('due_time' in result.tomorrow_tasks[0]));
});
test('Calendar pagination maps recurring and all-day events with events.list scope only', async () => {
  const { db } = await database(); let pagesRead = 0;
  authorizedFetch(url => {
    assert.notEqual(url.pathname, '/calendar/v3/calendars/primary', 'calendar metadata needs an unrequested scope');
    if (url.pathname.includes('tasks')) return json({ items: [] });
    if (url.searchParams.get('maxResults') === '1') return json({ timeZone: 'Asia/Kolkata' });
    pagesRead++;
    return json(url.searchParams.has('pageToken') ? { items: [{ id: 'instance', recurringEventId: 'series', start: { dateTime: '2026-10-14T09:00:00+05:30' }, end: { dateTime: '2026-10-14T10:00:00+05:30' } }] } : { items: [{ id: 'all-day', start: { date: '2026-10-14' }, end: { date: '2026-10-15' } }], nextPageToken: 'next' });
  });
  const result = await readGoogleActivities(db, 'owner');
  assert.equal(pagesRead, 2); assert.equal(result.schedules[0].valid_from, '2026-10-13T18:30:00.000Z');
  assert.equal(result.schedules[1].recurring_event_id, 'series');
});
test('new-user registration initializes settings and validates OAuth client/refresh identity', async () => {
  const { db } = await database(); let initialized = false, client = 'client';
  const firstUser = { ...db,
    upsert: async () => { initialized = true; return []; },
    rows: async (table: string) => table === 'organizer_settings' && initialized ? [{ connection_generation: 0 }] : [],
  } as unknown as Store;
  authorizedFetch(url => url.pathname === '/tokeninfo' ? json({ aud: client, scope: requiredScopes.join(' ') }) : json({ sub: 'account', email: 'person@example.com' }));
  const user = { id: 'new-user', identities: [{ provider: 'google', identity_data: { sub: 'account' } }] };
  assert.equal((await registerGoogle(firstUser, user, { provider_token: 'access', provider_refresh_token: 'refresh' })).status, 'connected');
  assert.equal(initialized, true);
  client = 'different-client';
  await assert.rejects(registerGoogle(firstUser, user, { provider_token: 'access', provider_refresh_token: 'refresh' }), /OAuth client/);
});
test('expired Google authorization exposes reconnect status for both independent sources', async () => {
  const { db } = await database();
  globalThis.fetch = async () => json({ error: 'invalid_grant' }, 400);
  const result = await readGoogleActivities(db, 'owner');
  assert.equal(result.connection?.connection_status, 'reconnect_required');
  assert.deepEqual(result.source_status, { tasks: 'error', calendar: 'error' });
  assert.equal(result.tasks.length, 0);
});
