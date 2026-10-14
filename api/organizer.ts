import { getSupabaseClient } from './supabase';
import { throwIfAborted } from './abort';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { Task, Schedule } from './types';

export type OrganizerConnection = {
  id: string; google_account_id?: string; updated_at?: string; google_acc: string | null; connection_status: string;
  last_calendar_sync_at: string | null; last_tasks_sync_at: string | null; last_error: string | null;
};
export type DailyRecap = {
  local_date: string; timezone: string; completed_today: string; tomorrow_plan: string;
  generated_at: string; source_status: Record<string, string>;
};
export type OrganizerState = { tasks: Task[]; schedules: Schedule[]; connection: OrganizerConnection | null; recap: DailyRecap | null; timezone: string; fetched_at: string; source_status: { tasks: 'ok' | 'error' | 'not_connected'; calendar: 'ok' | 'error' | 'not_connected' }; source_errors: { tasks?: string; calendar?: string } };
const listeners = new Set<(reason: string) => void>();
export const notifyOrganizerChanged = (reason = 'sync') => { for (const listener of listeners) listener(reason); };
export const subscribeOrganizer = (listener: (reason: string) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export async function organizerAction<T>(body: object, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  const client = getSupabaseClient();
  const { data: { session }, error: authError } = await client.auth.getSession();
  if (authError) throw authError;
  if (!session) throw new Error('Sign in to use your organizer.');
  throwIfAborted(signal);
  const { data, error } = await client.functions.invoke('organizer', { body, signal, headers: { Authorization: `Bearer ${session.access_token}` } });
  throwIfAborted(signal);
  if (error instanceof FunctionsHttpError) {
    const detail = await error.context.json().catch(() => null);
    throw new Error(typeof detail?.error === 'string' ? detail.error : 'Organizer is unavailable. Check backend setup.');
  }
  if (error) throw error;
  return data as T;
}
let latestOrganizer: { userId: string; state: OrganizerState } | null = null;
let organizerGeneration = 0;
let organizerRead: { userId: string; generation: number; promise: Promise<OrganizerState> } | null = null;
export function clearOrganizerCache() { latestOrganizer = null; organizerGeneration++; organizerRead = null; }
export async function loadOrganizer(force = false): Promise<OrganizerState> {
  const { data: { session }, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  if (!session) { clearOrganizerCache(); throw new Error('Sign in to use your organizer.'); }
  if (!force && latestOrganizer?.userId === session.user.id && Date.now() - Date.parse(latestOrganizer.state.fetched_at) < 30 * 60 * 1000) return latestOrganizer.state;
  const generation = organizerGeneration;
  if (organizerRead?.userId === session.user.id && organizerRead.generation === generation) return organizerRead.promise;
  const promise = (async () => {
    const state = await organizerAction<OrganizerState>({ action: 'activities' });
    const { data: { session: current } } = await getSupabaseClient().auth.getSession();
    if (current?.user.id !== session.user.id || generation !== organizerGeneration) throw new Error('Google connection changed. Refresh your organizer.');
    latestOrganizer = { userId: session.user.id, state };
    return state;
  })().finally(() => { if (organizerRead?.promise === promise) organizerRead = null; });
  organizerRead = { userId: session.user.id, generation, promise };
  return promise;
}
export async function retryGoogleRegistration() {
  const { data: { session }, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  if (!session) throw new Error('Sign in to connect Google Calendar.');
  return registerGoogleCredentials(session);
}

export async function registerGoogleCredentials(session: import('@supabase/supabase-js').Session) {
  const result = await organizerAction<{ status: string; connection?: OrganizerConnection }>({ action: 'register-google', provider_token: session.provider_token, provider_refresh_token: session.provider_refresh_token });
  clearOrganizerCache(); notifyOrganizerChanged('connection');
  if (result.status !== 'connected') throw new Error('Calendar connection incomplete. Reconnect Google Calendar to grant Calendar and Tasks access.');
  return result;
}
export async function initializeOrganizer() { await organizerAction({ action: 'initialize', timezone: deviceTimezone() }); }
export async function syncOrganizer(force = false, notify = true) {
  const result = await loadOrganizer(force);
  if (notify) notifyOrganizerChanged(force ? 'manual-refresh' : 'refresh');
  return result;
}
export async function setOrganizerCompletion(kind: 'task' | 'schedule', item: Task | Schedule, completed: boolean) {
  const source = kind === 'task'
    ? { taskListId: (item as Task).google_tasklist_id, taskId: (item as Task).google_task_id }
    : { calendarId: (item as Schedule).google_calendar_id, eventId: (item as Schedule).cal_event_id };
  const saved = await organizerAction<Task | Schedule>({ action: 'complete', kind, ...source, completed });
  clearOrganizerCache(); notifyOrganizerChanged('completion'); return saved;
}
export async function requestDailyRecap(signal?: AbortSignal) {
  const result = await organizerAction<{ recap: DailyRecap | null; message?: string }>({ action: 'recap' }, signal);
  throwIfAborted(signal);
  notifyOrganizerChanged(); return result;
}
export async function connectOrganizer() {
  // Keep the Google OAuth module out of the static import graph: it calls
  // registerGoogleCredentials below after completing the auth exchange.
  const { signInWithGoogle } = await import('./auth/google');
  return signInWithGoogle();
}
export async function disconnectOrganizer() { await organizerAction({ action: 'disconnect' }); clearOrganizerCache(); notifyOrganizerChanged('disconnect'); }
export async function saveOrganizerTimezone(timezone: string) { await organizerAction({ action: 'timezone', timezone }); notifyOrganizerChanged('timezone'); }
