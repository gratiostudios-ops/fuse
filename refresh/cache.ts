import { authStorage } from '../api/storage';
import type { CachedRefresh } from './types';

const listeners = new Set<() => void>();
export function subscribeRefresh(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const CACHE_KEY = 'fuse.refresh.snapshot';

export async function readRefreshCache(): Promise<CachedRefresh | null> {
  const value = await authStorage.getItem(CACHE_KEY);
  if (!value) return null;
  try {
    const record = JSON.parse(value) as CachedRefresh;
    if (record.version !== 2 || !record.snapshot || !Array.isArray(record.snapshot.topicIds) || !Number.isFinite(Date.parse(record.completedAt))) { await authStorage.removeItem(CACHE_KEY); return null; }
    return record;
  } catch { return null; }
}

export async function saveRefreshCache(record: CachedRefresh): Promise<void> {
  await authStorage.setItem(CACHE_KEY, JSON.stringify(record));
  for (const listener of listeners) listener();
}

export async function clearRefreshCache(): Promise<void> {
  await authStorage.removeItem(CACHE_KEY);
  for (const listener of listeners) listener();
}
