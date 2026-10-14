import { loadOrganizer } from '../organizer';
import type { Schedule } from '../types';
export async function getSchedules(): Promise<Schedule[]> {
  const state = await loadOrganizer();
  const source = state.source_status.calendar;
  if (source !== 'ok') throw new Error(state.source_errors.calendar ?? 'Connect Google Calendar and Tasks.');
  return state.schedules;
}
