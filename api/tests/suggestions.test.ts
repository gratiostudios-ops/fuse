/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import { validateSupabaseConfig } from '../config';
import { querySuggestions } from '../suggestions/query';
import type { CatalogDatabase, Suggestion } from '../types';

const TOPIC = '11111111-1111-4111-8111-111111111111';
const OTHER_TOPIC = '22222222-2222-4222-8222-222222222222';
type RealtimeTransport = NonNullable<NonNullable<SupabaseClientOptions<'public'>['realtime']>['transport']>;

type Fixture = Suggestion & { topics: string[] };

function fixture(index: number, topics = [TOPIC], active = true): Fixture {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    title: `Video ${index}`,
    youtube_video_id: `youtube-${index}`,
    video_url: `https://www.youtube.com/watch?v=youtube-${index}`,
    thumbnail_url: null,
    description: null,
    duration_minutes: null,
    created_at: '2026-10-13T00:00:00Z',
    updated_at: '2026-10-13T00:00:00Z',
    is_active: active,
    topics,
  };
}

function createTestClient(rows: Fixture[], cap = 100, failOnPage?: number) {
  const requests: URL[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    assert.equal(url.pathname, '/rest/v1/suggestions');
    assert.equal(init?.method, 'GET');
    assert.equal(url.searchParams.get('select'), '*,suggestion_topics!inner(topic_id)');
    assert.equal(url.searchParams.get('order'), 'created_at.desc,id.asc');
    assert.equal(url.searchParams.get('is_active'), 'eq.true');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('apikey'), 'sb_publishable_test');
    assert.equal(headers.get('prefer'), 'count=exact');

    if (requests.length === failOnPage) {
      return new Response(JSON.stringify({ code: '42501', message: 'permission denied', details: null, hint: null }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    const topic = url.searchParams.get('suggestion_topics.topic_id')?.replace(/^eq\./, '');
    const matches = rows.filter(row => row.is_active && row.topics.includes(topic ?? '')).sort((a, b) =>
      b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
    );
    const offset = Number(url.searchParams.get('offset'));
    const limit = Math.min(Number(url.searchParams.get('limit')), cap);
    const page = matches.slice(offset, offset + limit).map(({ topics, ...row }) => ({
      ...row, suggestion_topics: topics.filter(id => id === topic).map(topic_id => ({ topic_id })),
    }));

    return new Response(JSON.stringify(page), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Range': `${page.length ? `${offset}-${offset + page.length - 1}` : '*'}/${matches.length}`,
      },
    });
  };
  const client = createClient<CatalogDatabase>('https://catalog.example.test', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // ws supports the runtime contract; its overloaded constructor differs in @types/ws.
    realtime: { transport: WebSocket as unknown as RealtimeTransport },
    global: { fetch: mockFetch },
  });
  return { client, requests };
}

test('matches one topic, excludes inactive/unrelated rows, and removes join data', async () => {
  const { client, requests } = createTestClient([
    fixture(3), fixture(2, [OTHER_TOPIC]), fixture(4, [TOPIC], false), fixture(1, [TOPIC, OTHER_TOPIC]),
  ]);
  const result = await querySuggestions(client, { topicId: ` ${TOPIC.toUpperCase()} ` });
  assert.deepEqual(result.map(row => row.title), ['Video 1', 'Video 3']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('suggestion_topics.topic_id'), `eq.${TOPIC}`);
  assert.equal('suggestion_topics' in result[0], false);
  assert.equal(result[0].description, null);
  assert.equal(result[0].video_url, 'https://www.youtube.com/watch?v=youtube-1');
});

test('returns an empty array for a valid topic with no matches', async () => {
  const { client } = createTestClient([fixture(1)]);
  assert.deepEqual(await querySuggestions(client, { topicId: OTHER_TOPIC }), []);
});

test('rejects invalid topic UUIDs before making a request', async () => {
  const { client, requests } = createTestClient([]);
  for (const topicId of ['', 'React', '11111111-1111-4111-8111-11111111111Z']) {
    await assert.rejects(querySuggestions(client, { topicId }), /valid topic UUID/);
  }
  assert.equal(requests.length, 0);
});

test('fetches more than 1000 matches across result pages without duplicates', async () => {
  const { client, requests } = createTestClient(Array.from({ length: 1105 }, (_, i) => fixture(i)));
  const result = await querySuggestions(client, { topicId: TOPIC });
  assert.equal(result.length, 1105);
  assert.equal(new Set(result.map(row => row.id)).size, 1105);
  assert.equal(requests.length, 12);
});

test('continues fetching when Supabase caps responses below the requested page size', async () => {
  const { client, requests } = createTestClient(Array.from({ length: 25 }, (_, i) => fixture(i)), 7);
  const result = await querySuggestions(client, { topicId: TOPIC });
  assert.equal(result.length, 25);
  assert.deepEqual(requests.map(url => url.searchParams.get('offset')), ['0', '7', '14', '21']);
});

test('rejects a later page failure without returning partial results', async () => {
  const { client } = createTestClient(Array.from({ length: 110 }, (_, i) => fixture(i)), 100, 2);
  await assert.rejects(querySuggestions(client, { topicId: TOPIC }), error => {
    assert.equal((error as { code: string }).code, '42501');
    return true;
  });
});

test('checks configuration and rejects private keys', () => {
  assert.throws(() => validateSupabaseConfig({ url: undefined, publishableKey: undefined }), /not configured/);
  assert.throws(() => validateSupabaseConfig({ url: 'bad-url', publishableKey: 'sb_publishable_test' }), /valid HTTP/);
  assert.throws(() => validateSupabaseConfig({ url: 'ftp://example.test', publishableKey: 'sb_publishable_test' }), /valid HTTP/);
  assert.throws(() => validateSupabaseConfig({ url: 'https://example.test', publishableKey: 'sb_secret_test' }), /publishable key/);
  assert.deepEqual(validateSupabaseConfig({ url: ' https://example.test/ ', publishableKey: ' sb_publishable_test ' }), {
    url: 'https://example.test', publishableKey: 'sb_publishable_test',
  });
});
