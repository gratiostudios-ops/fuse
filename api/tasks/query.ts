import type { SupabaseClient } from '@supabase/supabase-js';
import { requireCurrentUser } from '../auth/user';
import type { CatalogDatabase, Task } from '../types';

/** Fetch all of the verified user's tasks; RLS also enforces ownership server-side. */
export async function queryTasks(client: SupabaseClient<CatalogDatabase>): Promise<Task[]> {
  const user = await requireCurrentUser(client);
  const tasks: Task[] = [];
  let offset = 0;
  for (;;) {
    const { data, error, count } = await client
      .from('tasks')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('due_time', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + 99);
    if (error) throw error;
    if (!data || count === null) throw new Error('Supabase returned an incomplete tasks response.');
    tasks.push(...data);
    if (tasks.length >= count) return tasks;
    if (data.length === 0) throw new Error('Tasks changed while loading. Retry the request.');
    offset += data.length;
  }
}
