import { decideHome } from '../api/ai';
import type { ProcessingResult, RefreshSnapshot } from './types';

export async function processRefreshSnapshot(snapshot: RefreshSnapshot): Promise<ProcessingResult> {
  if (!snapshot.userId) return { status: 'not-configured' };
  return { status: 'completed', response: await decideHome() };
}
