import { getSupabaseClient } from './supabase';
import type { Suggestion } from './types';

type SavedSuggestion = { suggestions: Suggestion | null };

export async function getUserSuggestions(userId: string): Promise<Suggestion[]> {
  const { data, error } = await getSupabaseClient().from('user_suggestions')
    .select('suggestions!inner(*)').eq('user_id', userId).order('recommended_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as SavedSuggestion[] ?? []).flatMap(row => row.suggestions ? [row.suggestions] : []);
}
