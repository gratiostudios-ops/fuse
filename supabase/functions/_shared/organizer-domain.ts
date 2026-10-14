/** Pure mapping/date helpers shared by workers and regression tests. */
export const COMPLETED_PREFIX = '✓ Completed · ';
export type GoogleRecord = Record<string, any>;
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`); result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
export function localHour(now: Date, timezone: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(now));
}
export function midnight(date: string, timezone: string): string {
  const target = Date.parse(`${date}T00:00:00Z`);
  let instant = target;
  // Resolve wall time against the IANA zone; separate boundaries account for DST.
  for (let i = 0; i < 6; i++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
    const get = (key: string) => parts.find(p => p.type === key)!.value;
    const wall = Date.parse(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`);
    const correction = target - wall;
    if (!correction) break;
    instant += correction;
  }
  return new Date(instant).toISOString();
}
export function eventTitle(current: string, completed: boolean, managed: boolean): string {
  const plain = managed && current.startsWith(COMPLETED_PREFIX) ? current.slice(COMPLETED_PREFIX.length) : current;
  return completed ? plain.startsWith(COMPLETED_PREFIX) ? plain : COMPLETED_PREFIX + plain : plain;
}
const validStamp = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export function mapTask(task: GoogleRecord, listId: string) {
  const done = task.status === 'completed';
  return {
    id: `google:task:${encodeURIComponent(listId)}:${encodeURIComponent(task.id)}`, google_tasklist_id: listId, google_task_id: task.id,
    title: task.title || 'Untitled task', description: task.notes || null,
    due_date: validStamp(task.due)?.slice(0, 10) ?? null, due_time: null,
    mark_completed: done, completed_at: done ? validStamp(task.completed) : null,
    source_updated_at: validStamp(task.updated), source_deleted: !!task.deleted,
  };
}
export function mapEvent(event: GoogleRecord, timezone: string) {
  const metadata = event.extendedProperties?.private ?? {};
  const done = metadata.fuse_completed === 'true';
  const allDay = !!event.start?.date;
  const start = allDay ? midnight(event.start.date, timezone) : validStamp(event.start?.dateTime);
  const end = allDay ? midnight(event.end.date, timezone) : validStamp(event.end?.dateTime);
  if (event.status !== 'cancelled' && (!start || !end || Date.parse(end) < Date.parse(start))) throw new Error('Google returned an invalid event time');
  return {
    id: `google:event:primary:${encodeURIComponent(event.id)}`, google_calendar_id: 'primary', cal_event_id: event.id,
    title: eventTitle(event.summary || 'Untitled event', false, metadata.fuse_title_managed === 'true'),
    description: event.description || null, valid_from: start, valid_to: end,
    is_all_day: allDay, start_date: allDay ? event.start.date : null, end_date: allDay ? event.end.date : null,
    source_timezone: event.start?.timeZone || timezone, recurring_event_id: event.recurringEventId || null,
    mark_completed: done, completed_at: done ? validStamp(metadata.fuse_completed_at) : null,
    source_updated_at: validStamp(event.updated), source_deleted: event.status === 'cancelled',
  };
}
export function recapActivities(tasks: GoogleRecord[], events: GoogleRecord[], date: string, timezone: string) {
  const start = Date.parse(midnight(date, timezone));
  const next = addDays(date, 1), after = addDays(date, 2);
  const end = Date.parse(midnight(next, timezone)), tomorrowEnd = Date.parse(midnight(after, timezone));
  const completionRecords: GoogleRecord[] = [...tasks.map(t => ({ ...t, kind: 'task' })), ...events.map(e => ({ ...e, kind: 'schedule' }))];
  const completed = completionRecords.filter(t => t.mark_completed && !t.source_deleted && t.completed_at && Date.parse(t.completed_at) >= start && Date.parse(t.completed_at) < end)
    .map(t => ({ kind: t.kind, id: t.id, title: t.title, completed_at: t.completed_at }));
  const activeTasks = tasks.filter(t => !t.mark_completed && !t.source_deleted);
  return {
    completed_today: completed,
    tomorrow_tasks: activeTasks.filter(t => t.due_date === next).map(t => ({ id: t.id, title: t.title, due_date: t.due_date })),
    overdue_tasks: activeTasks.filter(t => t.due_date && t.due_date < next).map(t => ({ id: t.id, title: t.title, due_date: t.due_date })),
    tomorrow_events: events.filter(e => !e.mark_completed && !e.source_deleted &&
      (e.is_all_day ? e.start_date < after && e.end_date > next : Date.parse(e.valid_from) < tomorrowEnd && Date.parse(e.valid_to) > end))
      .map(e => ({ id: e.id, title: e.title, start: e.valid_from, end: e.valid_to, is_all_day: e.is_all_day, start_date: e.start_date, end_date: e.end_date })),
  };
}
