import { getSupabaseClient } from '../supabase';
import type { GetSuggestionsParams, Suggestion } from '../types';
import { querySuggestions, validateTopicId } from './query';

/** Read all active catalog suggestions tagged with one topic. */
export function getSuggestions({ topicId }: GetSuggestionsParams): Promise<Suggestion[]> {
  // Return validation/configuration failures as rejected promises consistently.
  return Promise.resolve().then(() => {
    const id = validateTopicId(topicId);
    return querySuggestions(getSupabaseClient(), { topicId: id });
  });
}
