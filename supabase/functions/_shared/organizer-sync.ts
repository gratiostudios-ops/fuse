import { Store, HttpError, decrypt, googleToken } from './organizer-server.ts';
import { addDays, localDate, mapEvent, mapTask, midnight, eventTitle } from './organizer-domain.ts';

class GoogleError extends HttpError {}
export async function syncConnection(db: Store, connection: Record<string, any>, force = false) {
  if (connection.connection_status !== 'connected') return { status: 'disconnected' };
  if (!force && Date.parse(connection.next_sync_at) > Date.now()) return { status: 'not-due' };
  const lease = crypto.randomUUID();
  if (!await db.rpc('fuse_claim_connection', { target_id: connection.id, claim_token: lease })) return { status: 'busy' };
  const owned = { id: `eq.${connection.id}`, lease_token: `eq.${lease}`, connection_status: 'eq.connected' };
  const deadline = Date.now() + 110000;
  async function pulse() {
    if (Date.now() > deadline) throw new HttpError(503, 'Sync is taking longer than expected. It will retry automatically.');
    const result = await db.patch('calendar_connections', owned, { lease_until: new Date(Date.now() + 300000).toISOString() });
    if (!result?.length) throw new HttpError(409, 'Connection changed during synchronization');
  }
  try {
    const [credential] = await db.rows('organizer_credentials', { connection_id: `eq.${connection.id}` }, 'connection_id.asc');
    if (!credential) throw new HttpError(401, 'Reconnect Google Calendar to enable syncing.');
    const token = await googleToken({ grant_type: 'refresh_token', refresh_token: await decrypt(credential.encrypted_refresh_token) });
    async function google(path: string, method = 'GET', body?: unknown, etag?: string): Promise<any> {
      await pulse();
      const response = await fetch(`https://www.googleapis.com/${path}`, {
        method, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new GoogleError(response.status, response.status === 403 ? 'Google denied this update. Check event edit permissions or reconnect Google.' : response.status === 404 ? 'This activity no longer exists in Google.' : `Google sync failed (${response.status}).`);
      return response.status === 204 ? null : response.json();
    }
    async function pages(path: string, params: Record<string, string>) {
      const items: Record<string, any>[] = []; let pageToken: string | undefined; let syncToken: string | undefined;
      do {
        const page = await google(`${path}?${new URLSearchParams({ ...params, ...(pageToken ? { pageToken } : {}) })}`);
        if (page.items !== undefined && !Array.isArray(page.items)) throw new HttpError(502, 'Invalid Google list response');
        items.push(...(page.items || [])); pageToken = page.nextPageToken; syncToken = page.nextSyncToken;
        if (items.length > 20000) throw new HttpError(413, 'Too many Google activities for one sync');
      } while (pageToken);
      return { items, syncToken };
    }
    // Writes precede reads. Item + queue version checking prevents stale acknowledgements.
    const queue = await db.rows('organizer_sync_queue', { connection_id: `eq.${connection.id}`, next_attempt_at: `lte.${new Date().toISOString()}` }, 'next_attempt_at.asc,item_id.asc');
    const writeErrors: string[] = [];
    for (const queued of queue) {
      await pulse();
      try {
        const table = queued.kind === 'task' ? 'tasks' : 'schedules';
        const [item] = await db.rows(table, { id: `eq.${queued.item_id}`, user_id: `eq.${connection.user_id}` });
        if (!item) throw new HttpError(404, 'Activity no longer exists');
        if (queued.kind === 'task') {
          if (!item.google_tasklist_id || !item.google_task_id) throw new HttpError(409, 'Task source identifiers are missing. Refresh Google first.');
          await google(`tasks/v1/lists/${encodeURIComponent(item.google_tasklist_id)}/tasks/${encodeURIComponent(item.google_task_id)}`, 'PATCH',
            { status: queued.completed ? 'completed' : 'needsAction', completed: queued.completed ? queued.completed_at : null });
        } else {
          const path = `calendar/v3/calendars/primary/events/${encodeURIComponent(item.cal_event_id)}`;
          // Fetch and conditionally patch the latest title; never overwrite a concurrent Google edit.
          for (let attempt = 0; ; attempt++) {
            const current = await google(path);
            const metadata = current.extendedProperties?.private || {};
            const patch = {
              summary: eventTitle(current.summary || 'Untitled event', queued.completed, metadata.fuse_title_managed === 'true'),
              extendedProperties: { private: { ...metadata, fuse_completed: String(queued.completed),
                fuse_completed_at: queued.completed ? queued.completed_at : '', fuse_title_managed: String(queued.completed) } },
            };
            try { await google(`${path}?sendUpdates=none`, 'PATCH', patch, current.etag); break; }
            catch (error) { if (!(error instanceof GoogleError) || error.status !== 412 || attempt >= 2) throw error; }
          }
        }
        await db.rpc('fuse_ack_completion', { item_kind: queued.kind, target_id: queued.item_id, expected_version: queued.version });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Google update failed'; writeErrors.push(message);
        const updated = await db.patch('organizer_sync_queue', { kind: `eq.${queued.kind}`, item_id: `eq.${queued.item_id}`, version: `eq.${queued.version}` }, {
          attempts: queued.attempts + 1, last_error: message,
          next_attempt_at: new Date(Date.now() + Math.min(1800000, 30000 * 2 ** Math.min(queued.attempts, 6))).toISOString(),
        });
        // A newer checkbox intention must retain its pending status.
        if (updated?.length) await db.rpc('fuse_fail_completion', { item_kind: queued.kind, target_id: queued.item_id, expected_version: queued.version });
        if (error instanceof HttpError && error.status === 401) throw error;
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const calendar = await google('calendar/v3/calendars/primary');
    const zone = calendar.timeZone || 'UTC';
    const from = midnight(addDays(localDate(new Date(), zone), -30), zone), to = midnight(addDays(localDate(new Date(), zone), 366), zone);
    let full = !connection.calendar_sync_token || connection.calendar_window_date !== today;
    let eventPage: { items: Record<string, any>[]; syncToken?: string };
    const eventPath = 'calendar/v3/calendars/primary/events';
    const base = { maxResults: '250', singleEvents: 'true', showDeleted: 'true' };
    try {
      eventPage = await pages(eventPath, full ? { ...base, timeMin: from, timeMax: to } : { ...base, syncToken: connection.calendar_sync_token });
    } catch (error) {
      if (!(error instanceof GoogleError) || error.status !== 410) throw error;
      full = true; eventPage = await pages(eventPath, { ...base, timeMin: from, timeMax: to });
    }
    if (!eventPage.syncToken) throw new HttpError(502, 'Google returned no calendar sync token');
    const seenEvents = new Set<string>();
    for (const event of eventPage.items) {
      await pulse(); seenEvents.add(event.id);
      if (event.status === 'cancelled') {
        await db.rpc('fuse_delete_source', { connection: connection.id, item_kind: 'schedule', source_id: event.id, list_id: null });
      } else {
        const mapped = mapEvent(event, zone);
        if (Date.parse(mapped.valid_to!) < Date.parse(from) || Date.parse(mapped.valid_from!) >= Date.parse(to)) continue;
        await db.rpc('fuse_import_activity', { connection: connection.id, item_kind: 'schedule', payload: mapped });
      }
    }
    if (full) {
      const existing = await db.rows('schedules', { google_connection_id: `eq.${connection.id}`, source_deleted: 'eq.false', valid_from: `lt.${to}`, valid_to: `gt.${from}` });
      for (const item of existing) if (!seenEvents.has(item.cal_event_id)) {
        await pulse(); await db.rpc('fuse_delete_source', { connection: connection.id, item_kind: 'schedule', source_id: item.cal_event_id, list_id: null });
      }
    }
    await db.patch('calendar_connections', owned, { calendar_sync_token: eventPage.syncToken, calendar_window_date: today, last_calendar_sync_at: new Date().toISOString() });
    const lists = await pages('tasks/v1/users/@me/lists', { maxResults: '100' });
    const seenTasks = new Set<string>();
    // Complete every list fetch before any missing-item reconciliation.
    for (const list of lists.items) {
      const tasks = await pages(`tasks/v1/lists/${encodeURIComponent(list.id)}/tasks`, { maxResults: '100', showCompleted: 'true', showHidden: 'true', showDeleted: 'true' });
      for (const task of tasks.items) {
        await pulse(); seenTasks.add(JSON.stringify([list.id, task.id]));
        if (task.deleted) await db.rpc('fuse_delete_source', { connection: connection.id, item_kind: 'task', source_id: task.id, list_id: list.id });
        else await db.rpc('fuse_import_activity', { connection: connection.id, item_kind: 'task', payload: mapTask(task, list.id) });
      }
    }
    const existingTasks = await db.rows('tasks', { google_connection_id: `eq.${connection.id}`, source_deleted: 'eq.false' });
    for (const task of existingTasks) if (task.google_tasklist_id && !seenTasks.has(JSON.stringify([task.google_tasklist_id, task.google_task_id]))) {
      await pulse(); await db.rpc('fuse_delete_source', { connection: connection.id, item_kind: 'task', source_id: task.google_task_id, list_id: task.google_tasklist_id });
    }
    await db.patch('calendar_connections', owned, { last_tasks_sync_at: new Date().toISOString(), last_error: writeErrors[0] || null,
      next_sync_at: new Date(Date.now() + (writeErrors.length ? 60000 : 1800000)).toISOString() });
    return { status: writeErrors.length ? 'partial' : 'synced', ...(writeErrors.length ? { error: writeErrors[0] } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google sync failed';
    await db.patch('calendar_connections', owned, { last_error: message,
      ...(error instanceof HttpError && error.status === 401 ? { connection_status: 'reconnect_required' } : {}),
      next_sync_at: new Date(Date.now() + 60000).toISOString() });
    return { status: 'error', error: message };
  } finally {
    await db.patch('calendar_connections', { id: `eq.${connection.id}`, lease_token: `eq.${lease}` }, { lease_until: null, lease_token: null });
  }
}
