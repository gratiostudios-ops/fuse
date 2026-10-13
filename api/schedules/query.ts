import type { SupabaseClient } from '@supabase/supabase-js';
import { requireCurrentUser } from '../auth/user';
import type { CatalogDatabase, Schedule } from '../types';

export async function querySchedules(client: SupabaseClient<CatalogDatabase>): Promise<Schedule[]> {
  await requireCurrentUser(client);
  return [];
}
