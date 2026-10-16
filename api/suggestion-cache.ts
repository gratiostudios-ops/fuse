import { authStorage } from './storage';
import type { UserSuggestion } from './user-suggestions';

const key = (userId: string) => `fuse.user-suggestions.${userId}`;
let pending: Promise<unknown> = Promise.resolve();

/** Partial AI cards must not erase a description already fetched from the catalog. */
export function mergeUserSuggestions(...groups: UserSuggestion[][]): UserSuggestion[] {
  const items = new Map<string, UserSuggestion>();
  for (const group of groups) for (const item of group) {
    const previous = items.get(item.id);
    items.set(item.id, { ...item, description: item.description?.trim() ? item.description : previous?.description ?? null });
  }
  return [...items.values()];
}

async function read(userId: string): Promise<UserSuggestion[]> {
  try {
    const raw = await authStorage.getItem(key(userId));
    const record = raw ? JSON.parse(raw) : null;
    if (!record || record.version !== 1 || record.userId !== userId || !Array.isArray(record.items)) return [];
    return record.items.filter((item: UserSuggestion) => item && typeof item.id === 'string'
      && typeof item.title === 'string' && typeof item.video_url === 'string'
      && typeof item.recommended_at === 'string').map((item: UserSuggestion) => ({ ...item, description: typeof item.description === 'string' ? item.description : null }));
  } catch { return []; }
}
export async function getCachedUserSuggestions(userId: string): Promise<UserSuggestion[]> {
  await pending;
  return read(userId);
}
export function cacheUserSuggestions(userId: string, items: UserSuggestion[], merge = false): Promise<void> {
  const operation = pending.then(async () => {
    const previous = await read(userId);
    const enriched = mergeUserSuggestions(previous, items);
    const incomingIds = new Set(items.map(item => item.id));
    const unique = enriched.filter(item => merge || incomingIds.has(item.id))
      .sort((a, b) => b.recommended_at.localeCompare(a.recommended_at));
    await authStorage.setItem(key(userId), JSON.stringify({ version: 1, userId, savedAt: new Date().toISOString(), items: unique }));
  });
  pending = operation.catch(() => {});
  return operation;
}
