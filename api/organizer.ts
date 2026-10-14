import { getSupabaseClient } from './supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { Task, Schedule } from './types';

export type OrganizerConnection = {
  id: string; google_acc: string | null; connection_status: string;
  last_calendar_sync_at: string | null; last_tasks_sync_at: string | null; last_error: string | null;
};
export type DailyRecap = {
  local_date: string; timezone: string; completed_today: string; tomorrow_plan: string;
  generated_at: string; source_status: Record<string, string>;
};
export type OrganizerState = { tasks: Task[]; schedules: Schedule[]; connection: OrganizerConnection | null; recap: DailyRecap | null; timezone: string };
const listeners = new Set<(reason: string) => void>();
export const notifyOrganizerChanged = (reason = 'sync') => { for (const listener of listeners) listener(reason); };
export const subscribeOrganizer = (listener: (reason: string) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export async function organizerAction<T>(body: object): Promise<T> {
  const client = getSupabaseClient();
  const { data: { session }, error: authError } = await client.auth.getSession();
  if (authError) throw authError;
  if (!session) throw new Error('Sign in to use your organizer.');
  const { data, error } = await client.functions.invoke('organizer', { body, headers: { Authorization: `Bearer ${session.access_token}` } });
  if (error instanceof FunctionsHttpError) {
    const detail = await error.context.json().catch(() => null);
    throw new Error(typeof detail?.error === 'string' ? detail.error : 'Organizer is unavailable. Check backend setup.');
  }
  if (error) throw error;
  return data as T;
}
// The public database types intentionally cover only existing catalog tables; these
// additions are read through the same authenticated REST API until generated types exist.
export async function loadOrganizer(): Promise<OrganizerState> {
  const client = getSupabaseClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error('Sign in to use your organizer.');
  const [{ getTasks }, { getSchedules }] = await Promise.all([import('./tasks'), import('./schedules')]);
  const rest = async (table: string, params: Record<string, string>) => {
    const { data: { session } } = await client.auth.getSession();
    if (!session || session.user.id !== user.id) throw new Error('Account changed. Refresh your organizer.');
    const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams({ select: '*', user_id: `eq.${user.id}`, ...params })}`, {
      headers: { apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${session.access_token}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Organizer setup is incomplete or temporarily unavailable.');
    const rows = await response.json(); if (!Array.isArray(rows)) throw new Error('Invalid organizer response'); return rows;
  };
  const [tasks, schedules, connections, recaps, settings] = await Promise.all([
    getTasks(), getSchedules(), rest('calendar_connections', { select: 'id,google_acc,connection_status,last_calendar_sync_at,last_tasks_sync_at,last_error', limit: '1' }),
    rest('organizer_daily_recaps', { order: 'local_date.desc', limit: '1' }), rest('organizer_settings', { select: 'timezone', limit: '1' }),
  ]);
  return { tasks: tasks.filter(t => !t.source_deleted), schedules: schedules.filter(s => !s.source_deleted),
    connection: connections[0] ?? null, recap: recaps[0] ?? null, timezone: settings[0]?.timezone ?? deviceTimezone() };
}
export async function initializeOrganizer() { await organizerAction({ action: 'initialize', timezone: deviceTimezone() }); }
export async function syncOrganizer(force = false, notify = true) {
  const result = await organizerAction<{ status: string; error?: string }>({ action: 'sync', force });
  if (notify) notifyOrganizerChanged();
  return result;
}
export async function setOrganizerCompletion(kind: 'task' | 'schedule', id: string, completed: boolean) {
  const item = await organizerAction<Task | Schedule>({ action: 'complete', kind, id, completed });
  notifyOrganizerChanged('completion'); return item;
}
export async function requestDailyRecap() {
  const result = await organizerAction<{ recap: DailyRecap | null; message?: string }>({ action: 'recap' });
  notifyOrganizerChanged(); return result;
}
export async function connectOrganizer() {
  // Open a blank tab synchronously on web to avoid popup blockers after the request.
  const popup = Platform.OS === 'web' ? window.open('about:blank', '_blank') : null;
  try {
    await initializeOrganizer();
    const { url } = await organizerAction<{ url: string }>({ action: 'connect' });
    const parsed = new URL(url);
    if (parsed.origin !== 'https://accounts.google.com') throw new Error('Invalid Google authorization URL');
    if (Platform.OS === 'web') {
      if (!popup) throw new Error('Allow popups to connect Google Calendar.');
      popup.opener = null; popup.location.href = url;
    } else { await WebBrowser.openBrowserAsync(url); notifyOrganizerChanged(); }
  } catch (error) { popup?.close(); throw error; }
}
export async function disconnectOrganizer() { await organizerAction({ action: 'disconnect' }); notifyOrganizerChanged('disconnect'); }
export async function saveOrganizerTimezone(timezone: string) { await organizerAction({ action: 'timezone', timezone }); notifyOrganizerChanged('timezone'); }
