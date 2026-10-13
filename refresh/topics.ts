import { authStorage } from '../api/storage';
import { validateTopicId } from '../api/suggestions/query';

const TOPIC_KEY = 'fuse.refresh.topics';
const listeners = new Set<() => void>();

export async function getRefreshTopicIds(): Promise<string[]> {
  const value = await authStorage.getItem(TOPIC_KEY);
  if (!value) return [];
  const ids: unknown = JSON.parse(value);
  if (!Array.isArray(ids)) throw new Error('Stored refresh topics are invalid. Set your topics again.');
  return [...new Set(ids.map(validateTopicId))].sort();
}

export async function setRefreshTopicIds(topicIds: string[]): Promise<void> {
  if (!Array.isArray(topicIds)) throw new Error('topicIds must be an array of topic UUIDs.');
  const ids = [...new Set(topicIds.map(validateTopicId))].sort();
  let previous: string[] | null;
  try { previous = await getRefreshTopicIds(); }
  catch { previous = null; }
  if (previous && JSON.stringify(previous) === JSON.stringify(ids)) return;
  await authStorage.setItem(TOPIC_KEY, JSON.stringify(ids));
  for (const listener of listeners) listener();
}

export function subscribeTopicChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
