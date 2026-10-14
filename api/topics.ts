import { getSupabaseClient } from './supabase';
import type { Topic } from './types';

export async function getTopics(): Promise<Topic[]> {
  const { data, error } = await getSupabaseClient().from('topics').select('*').order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
