import { createClient } from '@supabase/supabase-js';
import { googleSignInUrl, oauthCallbackError } from './auth';
// Capture provider errors before the auth client processes the callback URL.
export const callbackError = oauthCallbackError(window.location.search, window.location.hash);
export const configured = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const googleLoginUrl = configured ? googleSignInUrl(import.meta.env.VITE_SUPABASE_URL, window.location.origin) : '';
export const supabase = configured ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { flowType: 'implicit' },
  global: {
    fetch: (input, init) => fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    }),
  },
}) : null;
export type Skill = { id: string; name: string; users: number; published: number; drafts: number };
export type Run = { id: string; kind: string; status: string; cursor: number; total: number; created_at: string; errors: { index: number; message: string }[]; results?: { source?: 'skill' | 'keyword'; keyword: string; target: number; published: number; drafted: number; skipped: number; error: string | null }[] };
export type Keyword = { id: string; keyword: string; topic_ids: string[]; auto_publish: boolean; enabled: boolean };
export type Overview = { skills: Skill[]; schedule: { next_collection_at: string; next_maintenance_at: string }; runs: Run[] };
export type Video = { id: string; youtube_video_id: string; title: string; description: string | null; thumbnail_url: string | null; duration_minutes: number | null; channel_title?: string; topic_ids: string[]; reason?: string; is_active?: boolean; created_at: string };
export async function api<T>(operation: string, payload: object = {}): Promise<T> {
  if (!supabase) throw new Error('Configure the public Supabase settings first.');
  const { data, error } = await supabase.functions.invoke('admin-catalog', { body: { operation, payload } });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message || 'The request could not be completed.');
  }
  if (data?.error) throw new Error(data.error);
  return data.data as T;
}
