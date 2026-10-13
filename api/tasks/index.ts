import { getSupabaseClient } from '../supabase';
import { queryTasks } from './query';
import type { Task } from '../types';

export async function getTasks(): Promise<Task[]> {
  return queryTasks(getSupabaseClient());
}
