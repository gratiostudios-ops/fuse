import { getSupabaseClient } from './supabase';

export async function getUserTopicIds(userId: string): Promise<string[]> {
  const { data, error } = await getSupabaseClient().from('user_topics').select('topic_id').eq('user_id', userId);
  if (error) throw error;
  return (data ?? []).map(topic => topic.topic_id);
}

export async function setUserTopicIds(topicIds: string[]): Promise<void> {
  const { error } = await getSupabaseClient().rpc('fuse_set_user_topics', { topic_ids: topicIds });
  if (error) throw error;
}
