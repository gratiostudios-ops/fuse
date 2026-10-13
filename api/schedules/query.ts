import type { SupabaseClient } from '@supabase/supabase-js';
import { requireCurrentUser } from '../auth/user';
import type { CatalogDatabase, Schedule } from '../types';

export async function querySchedules(client: SupabaseClient<CatalogDatabase>): Promise<Schedule[]> {
  const user = await requireCurrentUser(client);
  const schedules: Schedule[] = [];
  for (let offset = 0;;) {
    const { data, error, count } = await client.from('schedules').select('*', { count: 'exact' })
      .eq('user_id', user.id).order('valid_from').order('id').range(offset, offset + 99);
    if (error) throw error;
    if (!data || count === null) throw new Error('Incomplete schedules response.');
    schedules.push(...data);
    if (schedules.length >= count) return schedules;
    if (!data.length) throw new Error('Schedules changed while loading. Retry.');
    offset += data.length;
  }
}
