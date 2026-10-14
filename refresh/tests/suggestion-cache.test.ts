import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheUserSuggestions, getCachedUserSuggestions } from '../../api/suggestion-cache';
import type { UserSuggestion } from '../../api/user-suggestions';

test('suggestion cache persists complete rows, isolates accounts, and merges receipts', async () => {
  const storage = new Map<string, string>();
  Object.assign(globalThis, { window: { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } } });
  const card: UserSuggestion = { id: 'one', title: 'Learn design', video_url: 'https://example.com/video', thumbnail_url: null, description: 'A useful lesson', duration_minutes: 5, recommended_at: '2026-10-07T12:00:00Z' };
  try {
    await cacheUserSuggestions('a', [card]);
    assert.deepEqual(await getCachedUserSuggestions('a'), [card]);
    assert.deepEqual(await getCachedUserSuggestions('b'), []);
    await Promise.all([
      cacheUserSuggestions('a', [{ ...card, id: 'two', recommended_at: '2026-10-08T12:00:00Z' }], true),
      cacheUserSuggestions('a', [{ ...card, description: 'Updated description' }], true),
    ]);
    const cached = await getCachedUserSuggestions('a');
    assert.deepEqual(cached.map(item => item.id), ['two', 'one']);
    assert.equal(cached[1].description, 'Updated description');
    storage.set('fuse.user-suggestions.b', storage.get('fuse.user-suggestions.a')!);
    assert.deepEqual(await getCachedUserSuggestions('b'), []);
    await cacheUserSuggestions('a', []);
    assert.deepEqual(await getCachedUserSuggestions('a'), []);
    storage.set('fuse.user-suggestions.a', '{invalid');
    assert.deepEqual(await getCachedUserSuggestions('a'), []);
  } finally { Reflect.deleteProperty(globalThis, 'window'); }
});
