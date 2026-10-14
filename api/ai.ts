import { getDisplayHistory } from './display-history';
import { receiveSuggestions } from './user-suggestions';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { throwIfAborted } from './abort';
import { getSupabaseClient } from './supabase';
import { parseFuseResponse, type FuseResponse } from '../supabase/functions/_shared/contract';
import { clearOrganizerCache, notifyOrganizerChanged } from './organizer';
export type { FuseResponse, Block } from '../supabase/functions/_shared/contract';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function askAI(message: string, history: ChatTurn[] = [], signal?: AbortSignal): Promise<FuseResponse> {
  const input = message.trim();
  if (!input || input.length > 2000) return Promise.reject(new Error('Enter a message between 1 and 2,000 characters.'));
  return invokeAI({ mode: 'chat', message: input, history: history.slice(-12).map(turn => ({ ...turn, text: turn.text.slice(0, 2000) })), timezone: timezone() }, signal);
}

export function decideHome(previous: { type: string; id: string }[] = []): Promise<FuseResponse> {
  return invokeAI({ mode: 'home', timezone: timezone(), previous });
}

async function invokeAI(body: object, signal?: AbortSignal): Promise<FuseResponse> {
  throwIfAborted(signal);
  const client = getSupabaseClient();
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) throw new Error('Please sign in using the account menu before asking Fuse AI.');

  throwIfAborted(signal);
  const functionName = process.env.EXPO_PUBLIC_AI_FUNCTION_NAME?.trim() || 'fuse-ai';
  const { data, error } = await client.functions.invoke(functionName, {
    body: { ...body, display_history: await getDisplayHistory(session.user.id).then(({ outputs, schedules }) => ({ outputs, schedules })) }, signal,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  throwIfAborted(signal);
  if (error instanceof FunctionsHttpError) {
    let detail: unknown;
    try { detail = await error.context.json(); } catch { /* Response may not be JSON. */ }
    const reason = typeof detail === 'object' && detail !== null && 'error' in detail
      && typeof detail.error === 'string' ? detail.error : 'Check the Edge Function logs in Supabase.';
    throw new Error(`Fuse AI (${error.context.status}): ${reason}`);
  }
  if (error) throw error;
  const response = parseFuseResponse(data);
  if (body && 'mode' in body && body.mode === 'chat' && data?.activity_changed === true) {
    const { data: { session: current } } = await client.auth.getSession();
    throwIfAborted(signal);
    if (current?.user.id === session.user.id) {
      clearOrganizerCache();
      notifyOrganizerChanged('creation');
    }
  }
  const { data: { session: recipient } } = await client.auth.getSession();
  throwIfAborted(signal);
  if (recipient?.user.id !== session.user.id) throw new Error('Account changed');
  void receiveSuggestions(session.user.id, response);
  return response;
}
