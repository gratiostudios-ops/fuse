import { authStorage } from '../api/storage';
import type { CachedRefresh } from './types';
import { parseFuseResponse } from '../supabase/functions/_shared/contract';

const listeners = new Set<() => void>();
export function subscribeRefresh(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const CACHE_KEY = 'fuse.refresh.snapshot';
const LAST_GOOD_HOME_KEY = 'fuse.home.last-good';

function usableHome(record: CachedRefresh | null, userId?: string): record is CachedRefresh {
  if (!record?.snapshot?.userId || (userId && record.snapshot.userId !== userId) || record.processing?.status !== 'completed' || !record.processing.response) return false;
  try {
    const response = parseFuseResponse(record.processing.response);
    return !!response.message.trim() || response.blocks.length > 0;
  } catch { return false; }
}

/** The last displayable Home survives failed/empty refreshes, regardless of age. */
export async function readLastGoodHome(userId: string): Promise<CachedRefresh | null> {
  try {
    const raw = await authStorage.getItem(LAST_GOOD_HOME_KEY);
    const saved = raw ? JSON.parse(raw) as CachedRefresh : null;
    if (usableHome(saved, userId)) return saved;
    // Also accept an older installed version's existing snapshot on first upgrade.
    const legacy = await readRefreshCache();
    return usableHome(legacy, userId) ? legacy : null;
  } catch { return null; }
}

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
  if (usableHome(record)) await authStorage.setItem(LAST_GOOD_HOME_KEY, JSON.stringify(record));
  await authStorage.setItem(CACHE_KEY, JSON.stringify(record));
  for (const listener of listeners) listener();
}

export async function clearRefreshCache({ clearLastGood = false }: { clearLastGood?: boolean } = {}): Promise<void> {
  if (clearLastGood) await authStorage.removeItem(LAST_GOOD_HOME_KEY);
  await authStorage.removeItem(CACHE_KEY);
  for (const listener of listeners) listener();
}
