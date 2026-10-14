import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt } from '../_shared/organizer-server.ts';
import { validateCreateParams } from '../_shared/organizer-create.ts';

const originalFetch = globalThis.fetch;
Object.assign(globalThis, { Deno: { serve: () => {}, env: { get: (key: string) => ({
  SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'service',
  GEMINI_API_KEY: 'model-secret', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret',
  ORGANIZER_TOKEN_KEY: Buffer.alloc(32, 4).toString('base64'),
})[key] } } });
let chat: (req: Request) => Promise<Response>;
let organizer: (req: Request) => Promise<Response>;
before(async () => {
  chat = (await import('../fuse-ai/index.ts')).handleRequest;
  organizer = (await import('../organizer/index.ts')).handleRequest;
});
afterEach(() => { globalThis.fetch = originalFetch; });
const json = (value: unknown, status = 200) => Response.json(value, { status });
const task = { kind: 'task', title: 'Finish report', description: 'Draft', due_date: '2026-10-15', start: null, end: null, all_day: false };
const event = { kind: 'schedule', title: 'Team meeting', description: null, due_date: null, start: '2026-10-15T09:00:00+05:30', end: '2026-10-15T10:00:00+05:30', all_day: false };

async function mock(decision: unknown, failWrite = false, failTaskReads = false) {
  const credential = { encrypted_refresh_token: await encrypt('refresh'), oauth_client_id: 'client' };
  const writes: { url: URL; body: any }[] = [], endpointBodies: any[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return json({ id: 'owner' });
    if (url.pathname === '/rest/v1/rpc/fuse_ai_allow_request') return json(true);
    if (url.pathname.startsWith('/rest/v1/')) {
      const rows = url.pathname.endsWith('calendar_connections') ? [{ id: 'connection', user_id: 'owner', connection_status: 'connected', google_account_id: 'account' }]
        : url.pathname.endsWith('organizer_credentials') ? [credential] : [];
      return Response.json(rows, { headers: { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` } });
    }
    if (url.hostname === 'oauth2.googleapis.com') return json({ access_token: 'access' });
    if (url.hostname === 'generativelanguage.googleapis.com') return json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(decision) }] } }] });
    if (url.pathname === '/functions/v1/organizer') {
      assert.equal((init?.headers as any).Authorization, 'Bearer app-user');
      endpointBodies.push(JSON.parse(String(init?.body)));
      return organizer(new Request(url, init));
    }
    if (url.hostname === 'www.googleapis.com') {
      if (failTaskReads && url.pathname.includes('tasks') && init?.method !== 'POST') return json({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 403);
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)); writes.push({ url, body });
        if (failWrite) return json({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 403);
        return url.pathname.includes('tasks') ? json({ id: 'new-task', ...body, status: 'needsAction' }) : json({ id: 'new-event', ...body });
      }
      if (url.searchParams.get('maxResults') === '1' && url.pathname.includes('tasks')) return json({ items: [{ id: 'actual-list' }] });
      return json({ items: [], timeZone: 'Asia/Kolkata' });
    }
    throw new Error('Unexpected request ' + url.pathname);
  };
  return { writes, endpointBodies };
}
const request = (body: unknown) => new Request('https://project.supabase.co/functions/v1/fuse-ai', {
  method: 'POST', headers: { Authorization: 'Bearer app-user' }, body: JSON.stringify(body),
});
test('chat fills parameters and invokes authenticated create API; saved task comes from Google', async () => {
  const { writes, endpointBodies } = await mock({ message: 'Creating', selections: [], create: task });
  const response = await chat(request({ mode: 'chat', message: 'Create task Finish report due tomorrow', timezone: 'Asia/Kolkata' }));
  const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.activity_changed, true);
  assert.equal(endpointBodies[0].action, 'create'); assert.equal(endpointBodies[0].timezone, 'Asia/Kolkata');
  assert.equal(writes.length, 1); assert.match(writes[0].url.pathname, /lists\/actual-list\/tasks$/);
  assert.equal(writes[0].body.due, '2026-10-15T00:00:00.000Z');
  assert.equal(result.blocks[0].data.id, 'google:task:actual-list:new-task');
  assert.equal(result.blocks[0].data.due_time, null);
});
test('Calendar creation preserves requested offsets and uses primary calendar', async () => {
  const { writes } = await mock({ message: 'Creating', selections: [], create: event });
  const result = await (await chat(request({ mode: 'chat', message: 'Schedule Team meeting tomorrow 9 to 10', timezone: 'Asia/Kolkata' }))).json();
  assert.equal(result.activity_changed, true); assert.equal(writes.length, 1);
  assert.equal(writes[0].url.pathname, '/calendar/v3/calendars/primary/events');
  assert.deepEqual(writes[0].body.start, { dateTime: event.start, timeZone: 'Asia/Kolkata' });
  assert.equal(result.blocks[0].data.start, '2026-10-15T03:30:00.000Z');
});
test('Calendar success excludes unrelated Tasks read warning, but queries retain missing-source notice', async () => {
  await mock({ message: 'Creating', selections: [], create: event }, false, true);
  const saved = await (await chat(request({ mode: 'chat', message: 'Schedule Team meeting tomorrow 9 to 10', timezone: 'Asia/Kolkata' }))).json();
  assert.equal(saved.activity_changed, true);
  assert.equal(saved.message, 'Scheduled “Team meeting”.');
  assert.equal(saved.blocks[0].type, 'schedule');
  await mock({ message: 'Your Tasks are unavailable.', selections: [], create: null }, false, true);
  const queried = await (await chat(request({ mode: 'chat', message: 'What are my tasks?', timezone: 'UTC' }))).json();
  assert.match(queried.message, /Some data could not be loaded \(tasks\)/);
});
test('all-day event uses exclusive dates and maps boundaries in user timezone', async () => {
  await mock({ message: '', selections: [], create: { ...event, all_day: true, start: '2026-10-15', end: '2026-10-16' } });
  const result = await (await chat(request({ mode: 'chat', message: 'Schedule all-day Team meeting tomorrow', timezone: 'Asia/Kolkata' }))).json();
  assert.equal(result.blocks[0].data.is_all_day, true); assert.equal(result.blocks[0].data.start_date, '2026-10-15');
  assert.equal(result.blocks[0].data.start, '2026-10-14T18:30:00.000Z');
});
test('Google rejection never confirms creation or returns a fabricated card', async () => {
  const { writes } = await mock({ message: 'Saved successfully!', selections: [], create: task }, true);
  const result = await (await chat(request({ mode: 'chat', message: 'Create task', timezone: 'UTC' }))).json();
  assert.equal(writes.length, 1); assert.match(result.message, /couldn't save.*API is disabled/);
  assert.equal(result.activity_changed, undefined); assert.deepEqual(result.blocks, []);
});
test('clarification and queries never call the creation endpoint; Home cannot write', async () => {
  const { writes, endpointBodies } = await mock({ message: 'What start and end time?', selections: [], create: null });
  const result = await (await chat(request({ mode: 'chat', message: 'Schedule a meeting', timezone: 'UTC' }))).json();
  assert.match(result.message, /start and end/); assert.equal(endpointBodies.length, 0);
  const home = await mock({ message: 'Home', selections: [], create: event });
  await chat(request({ mode: 'home', timezone: 'UTC' }));
  assert.equal(writes.length, 0); assert.equal(home.writes.length, 0); assert.equal(home.endpointBodies.length, 0);
});
test('create endpoint requires authentication and rejects forged ownership or invalid dates before any write', async () => {
  const { writes } = await mock({ message: '', selections: [], create: null });
  const denied = await organizer(new Request('https://project.supabase.co/functions/v1/organizer', { method: 'POST', body: JSON.stringify({ action: 'create', params: task, timezone: 'UTC' }) }));
  assert.equal(denied.status, 401);
  assert.throws(() => validateCreateParams({ ...task, user_id: 'another-user' }), /Invalid creation/);
  assert.throws(() => validateCreateParams({ ...task, due_date: '2026-02-30' }), /due date/);
  assert.throws(() => validateCreateParams({ ...task, start: event.start }), /not a scheduled time/);
  assert.throws(() => validateCreateParams({ ...event, end: event.start }), /end must follow/);
  assert.throws(() => validateCreateParams({ ...event, start: '2026-10-15T09:00:00' }), /offsets/);
  assert.equal(writes.length, 0);
});
