import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordDisplayed, getDisplayHistory } from '../../api/display-history';
import type { FuseResponse } from '../../api/ai';

test('display history is persistent, scoped, bounded, and counts each response once', async () => {
  const values = new Map<string, string>();
  Object.assign(globalThis, { window: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } } });
  try {
    const start = new Date(Date.now() + 3600000).toISOString();
    const end = new Date(Date.now() + 7200000).toISOString();
    const response: FuseResponse = { schema_version: 1, response_id: 'one', message: 'Prepare', blocks: [
      { type: 'schedule', data: { id: 'event', title: 'Meeting', start, end } },
    ] };
    await Promise.all([recordDisplayed('a', response), recordDisplayed('a', response)]);
    assert.equal((await getDisplayHistory('a')).schedules.event.count, 1);
    assert.deepEqual((await getDisplayHistory('b')).outputs, []);
    await recordDisplayed('a', { ...response, response_id: 'two' });
    await recordDisplayed('a', { ...response, response_id: 'three' });
    const history = await getDisplayHistory('a');
    assert.deepEqual(history.outputs.map(item => item.id), ['two', 'three']);
    assert.equal(history.schedules.event.count, 2);
    await recordDisplayed('a', response);
    assert.deepEqual((await getDisplayHistory('a')).outputs.map(item => item.id), ['two', 'three']);
    await recordDisplayed('a', { ...response, response_id: 'changed', blocks: [{ type: 'schedule', data: { id: 'event', title: 'Moved', start: new Date(Date.now() + 1800000).toISOString(), end } }] });
    assert.equal((await getDisplayHistory('a')).schedules.event.count, 1);
  } finally { Reflect.deleteProperty(globalThis, 'window'); }
});
