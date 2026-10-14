import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckIcon } from 'phosphor-react-native';
import { colors, fonts } from './theme';
import { loadOrganizer, initializeOrganizer, syncOrganizer, setOrganizerCompletion, requestDailyRecap, subscribeOrganizer, type OrganizerState } from '../api/organizer';
import { addDays } from '../supabase/functions/_shared/organizer-domain';
import type { Task, Schedule } from '../api/types';

export function useOrganizer(userId: string | null) {
  const [state, setState] = useState<OrganizerState | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const owner = useRef(userId); owner.current = userId;
  const request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  const isOwner = (id: string | null) => mounted.current && id === owner.current;
  const reload = useCallback(async () => {
    if (!userId) return;
    const generation = ++request.current;
    try {
      const data = await loadOrganizer();
      if (isOwner(userId) && generation === request.current) setState(data);
    } catch (reason) { if (isOwner(userId)) setError(reason instanceof Error ? reason.message : 'Could not load organizer'); }
  }, [userId]);
  useEffect(() => {
    request.current++; setState(null); setError(''); setBusy(null); setLoading(!!userId);
    if (!userId) return;
    let alive = true;
    const initial = async () => {
      try { await initializeOrganizer(); await reload(); }
      catch (reason) { if (alive && isOwner(userId)) setError(reason instanceof Error ? reason.message : 'Could not initialize organizer'); }
      finally { if (alive && isOwner(userId)) setLoading(false); }
    };
    void initial();
    const unsubscribe = subscribeOrganizer(() => { if (alive) void reload(); });
    const resume = async () => {
      if (!alive || !isOwner(userId) || AppState.currentState !== 'active') return;
      try { await syncOrganizer(false); await reload(); }
      catch (reason) { if (alive && isOwner(userId)) setError(reason instanceof Error ? reason.message : 'Could not refresh Google'); }
    };
    const timer = setInterval(() => { void resume(); }, 30000);
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') void resume(); });
    const focus = () => { void resume(); };
    if (typeof window !== 'undefined') window.addEventListener('focus', focus);
    return () => { alive = false; unsubscribe(); clearInterval(timer); subscription.remove(); if (typeof window !== 'undefined') window.removeEventListener('focus', focus); };
  }, [userId, reload]);
  async function refresh() {
    if (busy || !userId) return;
    setBusy('refresh'); setError('');
    try { const result = await syncOrganizer(true); if (isOwner(userId) && result.error) setError(result.error); await reload(); }
    catch (reason) { if (isOwner(userId)) setError(reason instanceof Error ? reason.message : 'Refresh failed'); }
    finally { if (isOwner(userId)) setBusy(null); }
  }
  async function toggle(kind: 'task' | 'schedule', item: Task | Schedule) {
    if (busy || !userId) return;
    setBusy(item.id); setError('');
    try {
      const saved = await setOrganizerCompletion(kind, item.id, !item.mark_completed);
      if (isOwner(userId)) setState(previous => previous ? { ...previous,
        tasks: previous.tasks.map(t => kind === 'task' && t.id === saved.id ? saved as Task : t),
        schedules: previous.schedules.map(s => kind === 'schedule' && s.id === saved.id ? saved as Schedule : s) } : previous);
    } catch (reason) { if (isOwner(userId)) setError(reason instanceof Error ? reason.message : 'Could not save completion'); }
    finally { if (isOwner(userId)) setBusy(null); }
  }
  async function recap() {
    if (busy || !userId) return;
    setBusy('recap'); setError('');
    try {
      const result = await requestDailyRecap();
      if (isOwner(userId)) {
        if (result.recap) setState(previous => previous ? { ...previous, recap: result.recap } : previous);
        else setError(result.message || 'Recap is being prepared. Refresh shortly.');
      }
    } catch (reason) { if (isOwner(userId)) setError(reason instanceof Error ? reason.message : 'Could not generate recap'); }
    finally { if (isOwner(userId)) setBusy(null); }
  }
  return { state, error, loading, busy, refresh, toggle, recap, reload };
}
export type OrganizerController = ReturnType<typeof useOrganizer>;
function formatEvent(event: Schedule, timezone: string) {
  if (event.is_all_day) {
    const lastDay = event.end_date ? addDays(event.end_date, -1) : event.start_date;
    return `All day · ${event.start_date}${lastDay !== event.start_date ? ` – ${lastDay}` : ''}`;
  }
  const options: Intl.DateTimeFormatOptions = { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return `${new Date(event.valid_from).toLocaleString(undefined, options)} – ${new Date(event.valid_to).toLocaleString(undefined, options)}`;
}
export function OrganizerList({ controller, expanded }: { controller: OrganizerController; expanded: boolean }) {
  const { state, error, loading, busy, refresh, toggle } = controller;
  const [completed, setCompleted] = useState(false);
  useEffect(() => { if (expanded) setCompleted(false); }, [expanded]);
  if (!expanded) return null;
  const taskRows = state?.tasks.filter(t => t.mark_completed === completed) ?? [];
  const eventRows = state?.schedules.filter(e => e.mark_completed === completed) ?? [];
  const connection = state?.connection;
  const lastSync = connection?.last_calendar_sync_at && connection?.last_tasks_sync_at
    ? new Date(Math.min(Date.parse(connection.last_calendar_sync_at), Date.parse(connection.last_tasks_sync_at))) : null;
  const stale = !lastSync || Date.now() - lastSync.getTime() > 3600000;
  const row = (kind: 'task' | 'schedule', item: Task | Schedule, detail: string) => <View key={`${kind}:${item.id}`} style={styles.row}>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={`${item.mark_completed ? 'Reopen' : 'Complete'} ${item.title}`}
      accessibilityState={{ checked: item.mark_completed, disabled: !!busy }} disabled={!!busy}
      onPress={() => { void toggle(kind, item); }} style={styles.checkTarget}>
      <View style={[styles.check, item.mark_completed && styles.checked]}>{item.mark_completed && <CheckIcon size={14} color={colors.background} />}</View>
    </Pressable>
    <View style={[styles.itemBody, { borderLeftColor: kind === 'task' ? '#D66767' : '#6596DB' }]}>
      <Text style={styles.title}>{item.title}</Text><Text style={styles.detail}>{detail}</Text>
      {item.sync_status !== 'synced' && <Text style={styles.detail}>{item.sync_status === 'error' ? 'Google update needs attention' : 'Google update pending'}</Text>}
    </View>
  </View>;
  return <View style={styles.list}>
    <View style={styles.toolbar}>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: !completed }} onPress={() => setCompleted(false)} style={styles.action}><Text style={!completed ? styles.active : styles.detail}>To do</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: completed }} onPress={() => setCompleted(true)} style={styles.action}><Text style={completed ? styles.active : styles.detail}>Completed</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => { void refresh(); }} style={styles.action}><Text style={styles.detail}>{busy === 'refresh' ? 'Syncing…' : 'Refresh'}</Text></Pressable>
    </View>
    <Text style={styles.detail}>{!connection || connection.connection_status !== 'connected' ? 'Google disconnected · saved activities' : lastSync ? `${stale ? 'Stale · ' : ''}Synced ${lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for the first Google sync'}</Text>
    {!!connection?.last_error && <Text accessibilityRole="alert" style={styles.detail}>{connection.last_error}</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.detail}>{error}</Text>}
    {loading ? <Text style={styles.detail}>Loading organizer…</Text> : state && <>
      <Text style={styles.section}>Tasks</Text>
      {taskRows.length ? taskRows.map(t => row('task', t, t.due_date ? `Due ${t.due_date}${t.due_time ? ` at ${t.due_time.slice(0,5)}` : ''}` : 'No deadline')) : <Text style={styles.detail}>No {completed ? 'completed' : 'unfinished'} tasks.</Text>}
      <Text style={styles.section}>Events</Text>
      {eventRows.length ? eventRows.map(e => row('schedule', e, formatEvent(e, state.timezone))) : <Text style={styles.detail}>No {completed ? 'completed' : 'unfinished'} events.</Text>}
    </>}
  </View>;
}
export function DailyRecapView({ controller }: { controller: OrganizerController }) {
  const recap = controller.state?.recap;
  return <View style={styles.recap}>
    <View style={styles.toolbar}><Text style={styles.section}>Daily recap{recap ? ` · ${recap.local_date}` : ''}</Text>
      <Pressable accessibilityRole="button" disabled={!!controller.busy} onPress={() => { void controller.recap(); }} style={styles.action}>
        <Text style={styles.detail}>{controller.busy === 'recap' ? 'Preparing…' : 'Recap now'}</Text>
      </Pressable>
    </View>
    {recap ? <><Text style={styles.active}>Completed today</Text><Text style={styles.body}>{recap.completed_today}</Text>
      <Text style={styles.active}>Tomorrow’s plan</Text><Text style={styles.body}>{recap.tomorrow_plan}</Text>
      <Text style={styles.detail}>As of {new Date(recap.generated_at).toLocaleString(undefined, { timeZone: recap.timezone })} · {recap.timezone}</Text></>
      : <Text style={styles.detail}>Your short recap appears here after 9 PM, with a plan for tomorrow.</Text>}
    {!!controller.error && <Text accessibilityRole="alert" style={styles.detail}>{controller.error}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  list: { marginHorizontal: 24, paddingTop: 12, paddingBottom: 20, gap: 8 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  action: { minHeight: 44, justifyContent: 'center' },
  section: { fontFamily: fonts.medium, color: colors.foreground, fontSize: 14, marginTop: 10 },
  active: { fontFamily: fonts.medium, color: colors.foreground, fontSize: 12 },
  detail: { fontFamily: fonts.regular, color: colors.inactive, fontSize: 12, lineHeight: 18 },
  title: { fontFamily: fonts.medium, color: colors.foreground, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#252525', paddingVertical: 8 },
  checkTarget: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  check: { height: 20, width: 20, borderWidth: 1, borderColor: colors.inactive, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  itemBody: { flex: 1, gap: 5, borderLeftWidth: 2, paddingLeft: 10 },
  recap: { padding: 16, borderRadius: 20, backgroundColor: colors.composer, gap: 10 },
  body: { fontFamily: fonts.regular, color: colors.foreground, fontSize: 13, lineHeight: 20 },
});
