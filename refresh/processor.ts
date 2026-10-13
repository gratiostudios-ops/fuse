import type { ProcessingResult, RefreshSnapshot } from './types';

/** Replace this adapter with the AI integration later. No generated output yet. */
export async function processRefreshSnapshot(_snapshot: RefreshSnapshot): Promise<ProcessingResult> {
  return { status: 'not-configured' };
}
