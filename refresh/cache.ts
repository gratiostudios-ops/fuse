import { authStorage } from '../api/storage';
import type { CachedRefresh } from './types';

const CACHE_KEY = 'fuse.refresh.snapshot';

export async function readRefreshCache(): Promise<CachedRefresh | null> {
  const value = await authStorage.getItem(CACHE_KEY);
  if (!value) return null;
  try {
    const record = JSON.parse(value) as CachedRefresh;
    if (record.version !== 1 || !record.snapshot || !Array.isArray(record.snapshot.topicIds) || !Number.isFinite(Date.parse(record.completedAt))) return null;
    return record;
  } catch { return null; }
}

export async function saveRefreshCache(record: CachedRefresh): Promise<void> {
  await authStorage.setItem(CACHE_KEY, JSON.stringify(record));
}

export async function clearRefreshCache(): Promise<void> {
  await authStorage.removeItem(CACHE_KEY);
}
