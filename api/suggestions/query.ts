import type { SupabaseClient } from '@supabase/supabase-js';
import type { CatalogDatabase, GetSuggestionsParams, Suggestion } from '../types';

const PAGE_SIZE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateTopicId(topicId: string): string {
  if (typeof topicId !== 'string' || !UUID.test(topicId.trim())) {
    throw new Error('topicId must be a valid topic UUID.');
  }
  return topicId.trim().toLowerCase();
}

/** Query implementation accepts a client so it can be checked independently of Expo. */
export async function querySuggestions(
  client: SupabaseClient<CatalogDatabase>,
  { topicId }: GetSuggestionsParams,
): Promise<Suggestion[]> {
  const id = validateTopicId(topicId);
  const suggestions: Suggestion[] = [];
  let offset = 0;

  for (;;) {
    const { data, error, count } = await client
      .from('suggestions')
      .select('*,suggestion_topics!inner(topic_id)', { count: 'exact' })
      .eq('suggestion_topics.topic_id', id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || count === null) {
      throw new Error('Supabase returned an incomplete suggestions response.');
    }

    for (const { suggestion_topics: _topicLinks, ...suggestion } of data) {
      suggestions.push(suggestion);
    }

    if (suggestions.length >= count) return suggestions;
    if (data.length === 0) {
      throw new Error('Suggestions changed while loading. Retry the request.');
    }
    // Advance by actual rows, even if the project has a lower response cap.
    offset += data.length;
  }
}
