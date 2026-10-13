import { getSupabaseClient } from '../supabase';
import type { Schedule } from '../types';
import { querySchedules } from './query';

export const SCHEDULES_IMPLEMENTED = true;

/** Read authenticated schedules from Supabase; Google synchronization is separate. */
export async function getSchedules(): Promise<Schedule[]> {
  return querySchedules(getSupabaseClient());
}
