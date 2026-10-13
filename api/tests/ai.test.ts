import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResponse, parseFuseResponse, type Candidate } from '../../supabase/functions/_shared/contract';

const candidate: Candidate = { type: 'task', id: 'real-task', priority: 90, block: { type: 'task', data: {
  id: 'real-task', title: 'Actual database title', due_date: '2026-10-14', due_time: null, is_completed: false,
} } };
test('cards use verified database fields and ordered reasons', () => {
  const result = buildResponse({ message: 'Focus on this task.', selections: [{ type: 'task', id: 'real-task', reason: 'Due tomorrow.' }] }, [candidate], true);
  assert.deepEqual(result.blocks, [candidate.block, { type: 'text', data: { content: 'Due tomorrow.' } }]);
});
test('unknown IDs, wrong types, duplicates and more than four Home cards are rejected', () => {
  const select = { type: 'task', id: candidate.id, reason: '' };
  for (const selections of [[{ ...select, id: 'invented' }], [{ ...select, type: 'schedule' }], [select, select], Array(5).fill(select)]) {
    assert.throws(() => buildResponse({ message: '', selections }, [candidate], true));
  }
});
test('general answers and no relevant Home items need no invented cards', () => {
  assert.deepEqual(buildResponse({ message: 'Take a short break.', selections: [] }, [], false), {
    schema_version: 1, message: 'Take a short break.', blocks: [],
  });
});
test('client boundary rejects unsupported versions, malformed blocks and dangerous links', () => {
  for (const value of [
    { message: 'old endpoint' },
    { schema_version: 2, message: '', blocks: [] },
    { schema_version: 1, message: '', blocks: [{ type: 'html', data: { content: '<script>' } }] },
    { schema_version: 1, message: '', blocks: [{ type: 'task', data: { ...candidate.block.data, due_date: 'tomorrow' } }] },
    { schema_version: 1, message: '', blocks: [{ type: 'suggestion', data: { id: 's', title: 'Video', video_url: 'javascript:alert(1)', thumbnail_url: null, duration_minutes: 10 } }] },
  ]) assert.throws(() => parseFuseResponse(value));
});

// Exercise the deployable handler without network calls or real credentials.
let serveHandler: ((req: Request) => Promise<Response>) | undefined;
Object.assign(globalThis, { Deno: { env: { get: (name: string) => ({ SUPABASE_URL: 'https://project.test', SUPABASE_ANON_KEY: 'test-key', GEMINI_API_KEY: 'test-secret' }[name]) }, serve: (handler: typeof serveHandler) => { serveHandler = handler; } } });
const handlerPath = '../../supabase/functions/fuse-ai/index.ts';
const load = async () => { await import(handlerPath); return serveHandler!; };
const request = (body: unknown) => new Request('https://project.test/functions/v1/fuse-ai', {
  method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('handler enforces login and validates requests before AI calls', async () => {
  const handler = await load();
  assert.equal((await handler(new Request('https://test', { method: 'POST' }))).status, 401);
  assert.equal((await handler(new Request('https://test', { method: 'OPTIONS' }))).status, 200);
  assert.equal((await handler(new Request('https://test'))).status, 405);
});
test('handler fetches owner-scoped records and uses bundled prompts with structured outputs', async () => {
  const original = globalThis.fetch;
  let aiBody: any;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'verified-user' });
    if (url.includes('/rpc/')) return Response.json(true);
    if (url.includes('/rest/v1/')) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('user_id'), 'eq.verified-user');
      assert.equal((init?.headers as any).Authorization, 'Bearer user-token');
      const rows = parsed.pathname.endsWith('/tasks') ? [{ id: 'real-task', title: 'Actual database title', due_date: '2026-10-14', due_time: null, mark_completed: false }] : [];
      return Response.json(rows, { headers: { 'Content-Range': rows.length ? '0-0/1' : '*/0' } });
    }
    assert.match(url, /generativelanguage.googleapis.com.*gemini-2.5-flash:generateContent/);
    assert.equal((init?.headers as any)['x-goog-api-key'], 'test-secret');
    assert.equal(new URL(url).search, '');
    aiBody = JSON.parse(init?.body as string);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ message: 'One task.', selections: [{ type: 'task', id: 'real-task', reason: 'Due soon.' }] }) }] } }] });
  }) as typeof fetch;
  try {
    const handler = await load();
    const response = await handler(request({ mode: 'chat', message: 'What are my tasks?', timezone: 'Asia/Kolkata' }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.blocks[0].data.title, 'Actual database title');
    assert.match(aiBody.systemInstruction.parts[0].text, /Fuse — AI Assistant System Instructions/);
    assert.equal(aiBody.generationConfig.responseMimeType, 'application/json');
    const home = await handler(request({ mode: 'home', timezone: 'UTC' }));
    assert.equal(home.status, 200);
    assert.match(aiBody.systemInstruction.parts[0].text, /Home Screen Decision Engine/);
    assert.equal(aiBody.generationConfig.responseJsonSchema.properties.selections.maxItems, 4);
  } finally { globalThis.fetch = original; }
});
test('rate limit stops provider calls and malformed input returns 400', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).endsWith('/auth/v1/user')) return Response.json({ id: 'verified-user' });
    if (String(input).includes('/rpc/')) return Response.json(false);
    throw new Error('Must not call data or AI after rate limit');
  }) as typeof fetch;
  try {
    const handler = await load();
    assert.equal((await handler(request({ mode: 'chat', message: 'hello' }))).status, 429);
    assert.equal((await handler(request({ mode: 'chat', message: '' }))).status, 400);
    assert.equal((await handler(request({ mode: 'home', timezone: 'invalid-zone' }))).status, 400);
  } finally { globalThis.fetch = original; }
});

test('failed reads stay unavailable and invented IDs or incomplete output never become cards', async () => {
  const original = globalThis.fetch;
  let outcome = 'partial';
  let providerInput: any;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: 'verified-user' });
    if (url.includes('/rpc/')) return Response.json(true);
    if (url.includes('/rest/v1/')) return url.includes('/schedules?')
      ? Response.json({ error: 'denied' }, { status: 403 })
      : Response.json([], { headers: { 'Content-Range': '*/0' } });
    providerInput = JSON.parse(init?.body as string);
    return Response.json({ candidates: [{ finishReason: outcome === 'incomplete' ? 'MAX_TOKENS' : 'STOP', content: { parts: [{
      text: JSON.stringify({ message: 'I could not verify events.', selections: outcome === 'invented' ? [{ type: 'task', id: 'fake', reason: '' }] : [] }),
    }] } }] });
  }) as typeof fetch;
  try {
    const handler = await load();
    const response = await handler(request({ mode: 'home' }));
    assert.equal(response.status, 200);
    assert.match((await response.json()).message, /could not be loaded \(schedules\)/);
    assert.match(providerInput.contents[0].parts[0].text, /"schedules":"error"/);
    outcome = 'invented';
    assert.equal((await handler(request({ mode: 'chat', message: 'My tasks?' }))).status, 500);
    outcome = 'incomplete';
    assert.equal((await handler(request({ mode: 'chat', message: 'My tasks?' }))).status, 502);
  } finally { globalThis.fetch = original; }
});
