import { authStorage } from '../api/storage';
import { validateTopicId } from '../api/suggestions/query';

const TOPIC_KEY = 'fuse.refresh.topics';
// Existing catalog topics used until the user chooses their own topics.
const DEFAULT_TOPIC_IDS = [
  '416c812f-78ae-4359-b800-c14a4652032a', // Technology
  'd9c796e9-5939-4b21-a057-7056e2ef052d', // Artificial Intelligence
  'ebf45065-7679-40ab-9a8b-60cfd236c6be', // Programming
];
const listeners = new Set<() => void>();

export async function getRefreshTopicIds(): Promise<string[]> {
  const value = await authStorage.getItem(TOPIC_KEY);
  if (!value) return [...DEFAULT_TOPIC_IDS];
  const ids: unknown = JSON.parse(value);
  if (!Array.isArray(ids)) throw new Error('Stored refresh topics are invalid. Set your topics again.');
  return ids.length ? [...new Set(ids.map(validateTopicId))].sort() : [...DEFAULT_TOPIC_IDS];
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
