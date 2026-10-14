import { cacheUserSuggestions } from './suggestion-cache';
import { getSupabaseClient } from './supabase';
import { authStorage } from './storage';
import type { Suggestion } from './types';
import type { FuseResponse } from './ai';

export type UserSuggestion = Pick<Suggestion, 'id' | 'title' | 'video_url' | 'thumbnail_url' | 'duration_minutes' | 'description'> & { recommended_at: string };
type SavedSuggestion = { suggestions: Suggestion | null; recommended_at: string };
type Received = UserSuggestion;
const listeners = new Set<() => void>();
const received = new Map<string, Map<string, Received>>();
let queue: Promise<unknown> = Promise.resolve();
export function subscribeUserSuggestions(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const notify = () => { for (const listener of listeners) listener(); };
export function getReceivedSuggestions(userId: string): Received[] { return [...(received.get(userId)?.values() ?? [])].reverse(); }
const key = (userId: string) => `fuse.suggestion-receipts.${userId}`;
async function readQueue(userId: string): Promise<Received[]> {
  try { return (JSON.parse(await authStorage.getItem(key(userId)) ?? '[]') as Received[]).map(item => ({ ...item, description: item.description ?? null, recommended_at: item.recommended_at ?? new Date().toISOString() })); } catch { return []; }
}
export function receiveSuggestions(userId: string, response: FuseResponse): Promise<void> {
  const items = response.blocks.flatMap(block => block.type === 'suggestion' ? [{ ...block.data, description: block.data.description ?? null, recommended_at: new Date().toISOString() }] : []);
  if (!items.length) return Promise.resolve();
  const memory = received.get(userId) ?? new Map<string, Received>();
  for (const item of items) memory.set(item.id, item);
  received.set(userId, memory); notify();
  const operation = queue.then(async () => {
    const stored = new Map((await readQueue(userId)).map(item => [item.id, item]));
    for (const item of items) stored.set(item.id, item);
    await authStorage.setItem(key(userId), JSON.stringify([...stored.values()]));
    await cacheUserSuggestions(userId, items, true).catch(error => console.warn('Suggestion cache write deferred', error));
    await flush(userId);
  });
  queue = operation.catch(error => console.warn('Suggestion receipt deferred', error));
  return queue as Promise<void>;
}
async function flush(userId: string) {
  const client = getSupabaseClient();
  const { data: { session } } = await client.auth.getSession();
  if (session?.user.id !== userId) return;
  const items = await readQueue(userId);
  if (!items.length) return;
  const memory = received.get(userId) ?? new Map<string, Received>();
  const newlyHydrated = items.some(item => !memory.has(item.id));
  for (const item of items) memory.set(item.id, item);
  received.set(userId, memory);
  if (newlyHydrated) notify();
  for (let offset = 0; offset < items.length; offset += 100) {
    const { data: { session: current } } = await client.auth.getSession();
    if (current?.user.id !== userId) return;
    const { error } = await client.rpc('fuse_receive_suggestions', { suggestion_ids: items.slice(offset, offset + 100).map(item => item.id), expected_user_id: userId });
    if (error) throw error;
  }
  await authStorage.removeItem(key(userId));
  notify();
}
export function retrySuggestionReceipts(userId: string): Promise<void> {
  const operation = queue.then(() => flush(userId));
  queue = operation.catch(error => console.warn('Suggestion receipt retry deferred', error));
  return queue as Promise<void>;
}
export async function getUserSuggestions(userId: string): Promise<UserSuggestion[]> {
  const client = getSupabaseClient();
  const { data: { session } } = await client.auth.getSession();
  if (session?.user.id !== userId) throw new Error('Account changed while loading suggestions');
  const items: UserSuggestion[] = [];
  for (let offset = 0;;) {
    const { data, error, count } = await getSupabaseClient().from('user_suggestions')
      .select('recommended_at,suggestions!inner(*)', { count: 'exact' }).eq('user_id', userId)
      .order('recommended_at', { ascending: false }).order('suggestion_id').range(offset, offset + 99);
    if (error) throw error;
    if (!data || count === null) throw new Error('Incomplete saved suggestions');
    items.push(...(data as unknown as SavedSuggestion[]).flatMap(row => row.suggestions ? [{ ...row.suggestions, recommended_at: row.recommended_at }] : []));
    offset += data.length;
    if (offset >= count) {
      const { data: { session: current } } = await client.auth.getSession();
      if (current?.user.id !== userId) throw new Error('Account changed while loading suggestions');
      const complete = [...new Map([...getReceivedSuggestions(userId), ...items].map(item => [item.id, item])).values()];
      await cacheUserSuggestions(userId, complete).catch(error => console.warn('Suggestion cache unavailable', error));
      return items;
    }
    if (!data.length) throw new Error('Saved suggestions changed during loading');
  }
}
