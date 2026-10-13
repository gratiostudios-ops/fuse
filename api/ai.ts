import { FunctionsHttpError } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase';
import { parseFuseResponse, type FuseResponse } from '../supabase/functions/_shared/contract';
export type { FuseResponse, Block } from '../supabase/functions/_shared/contract';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function askAI(message: string, history: ChatTurn[] = []): Promise<FuseResponse> {
  const input = message.trim();
  if (!input || input.length > 2000) return Promise.reject(new Error('Enter a message between 1 and 2,000 characters.'));
  return invokeAI({ mode: 'chat', message: input, history: history.slice(-12).map(turn => ({ ...turn, text: turn.text.slice(0, 2000) })), timezone: timezone() });
}

export function decideHome(previous: { type: string; id: string }[] = []): Promise<FuseResponse> {
  return invokeAI({ mode: 'home', timezone: timezone(), previous });
}

async function invokeAI(body: object): Promise<FuseResponse> {
  const client = getSupabaseClient();
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) throw new Error('Please sign in using the account menu before asking Fuse AI.');

  const functionName = process.env.EXPO_PUBLIC_AI_FUNCTION_NAME?.trim() || 'fuse-ai';
  const { data, error } = await client.functions.invoke(functionName, {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error instanceof FunctionsHttpError) {
    let detail: unknown;
    try { detail = await error.context.json(); } catch { /* Response may not be JSON. */ }
    const reason = typeof detail === 'object' && detail !== null && 'error' in detail
      && typeof detail.error === 'string' ? detail.error : 'Check the Edge Function logs in Supabase.';
    throw new Error(`Fuse AI (${error.context.status}): ${reason}`);
  }
  if (error) throw error;
  return parseFuseResponse(data);
}
