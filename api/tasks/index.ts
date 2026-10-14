import { loadOrganizer } from '../organizer';
import type { Task } from '../types';
export async function getTasks(): Promise<Task[]> {
  const state = await loadOrganizer();
  const source = state.source_status.tasks;
  if (source !== 'ok') throw new Error(state.source_errors.tasks ?? 'Connect Google Calendar and Tasks.');
  return state.tasks;
}
