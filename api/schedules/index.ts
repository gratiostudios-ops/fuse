import { getSupabaseClient } from '../supabase';
import type { Schedule } from '../types';
import { querySchedules } from './query';

export const SCHEDULES_IMPLEMENTED = false;

/** Authenticated placeholder. No schedules table or Google API is queried yet. */
export async function getSchedules(): Promise<Schedule[]> {
  return querySchedules(getSupabaseClient());
}
