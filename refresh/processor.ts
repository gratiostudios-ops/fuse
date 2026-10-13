import { decideHome } from '../api/ai';
import { readRefreshCache } from './cache';
import type { ProcessingResult, RefreshSnapshot } from './types';

export async function processRefreshSnapshot(snapshot: RefreshSnapshot): Promise<ProcessingResult> {
  if (!snapshot.userId) return { status: 'not-configured' };
  const previous = await readRefreshCache();
  const response = previous?.snapshot.userId === snapshot.userId && previous.processing.status === 'completed'
    ? previous.processing.response : undefined;
  const selections = response?.blocks.flatMap(block => block.type === 'text' ? [] : [{ type: block.type, id: block.data.id }]) ?? [];
  return { status: 'completed', response: await decideHome(selections) };
}
