import { Store, HttpError, decrypt, encrypt, env, googleToken } from './organizer-server.ts';
import { addDays, localDate, mapEvent, mapTask, midnight, eventTitle } from './organizer-domain.ts';
export const requiredScopes = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/tasks'];
export async function connectionFor(db: Store, userId: string) {
  return (await db.rows('calendar_connections', { user_id: `eq.${userId}` }))[0] || null;
}
export function publicConnection(connection: Record<string, any> | null) {
  if (!connection) return null;
  const { id, google_account_id, google_acc, google_calendar_id, connection_status, last_calendar_sync_at, last_tasks_sync_at, last_error, updated_at } = connection;
  return { id, google_account_id, google_acc, google_calendar_id, connection_status, last_calendar_sync_at, last_tasks_sync_at, last_error, updated_at };
}
async function identity(accessToken: string) {
  const [infoResponse, userResponse] = await Promise.all([
    fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(10000) }),
    fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) }),
  ]);
  if (!infoResponse.ok || !userResponse.ok) throw new HttpError(401, 'Google credentials could not be verified. Reconnect Google Calendar.');
  const info = await infoResponse.json(), user = await userResponse.json();
  if ((info.aud || info.azp) !== env('GOOGLE_CLIENT_ID') || typeof user.sub !== 'string' || typeof user.email !== 'string') throw new HttpError(403, 'Google OAuth client or identity does not match. Reconnect Google Calendar.');
  if (!requiredScopes.every(scope => String(info.scope || '').split(' ').includes(scope))) throw new HttpError(400, 'Calendar and Tasks permissions are required. Reconnect and grant both permissions.');
  return user;
}
export async function registerGoogle(db: Store, user: Record<string, any>, body: Record<string, any>) {
  if (typeof body.provider_token !== 'string' || !body.provider_token || body.provider_token.length > 8000) throw new HttpError(400, 'Calendar connection incomplete. Reconnect Google Calendar.');
  await db.upsert('organizer_settings', { user_id: user.id, timezone: 'UTC' }, 'user_id', true);
  const [settings] = await db.rows('organizer_settings', { user_id: `eq.${user.id}` }, 'user_id.asc');
  if (!settings) throw new HttpError(409, 'Initialize organizer before connecting');
  const google = await identity(body.provider_token);
  const identities = Array.isArray(user.identities) ? user.identities.filter((i: any) => i.provider === 'google') : [];
  if (!identities.some((i: any) => (i.identity_data?.sub || i.id) === google.sub)) throw new HttpError(403, 'Google account does not match the signed-in account.');
  const existing = await connectionFor(db, user.id);
  if (existing?.google_account_id && existing.google_account_id !== google.sub) throw new HttpError(409, 'Reconnect the original Google account.');
  let refresh = body.provider_refresh_token;
  if (refresh !== undefined && refresh !== null && (typeof refresh !== 'string' || refresh.length > 8000)) throw new HttpError(400, 'Invalid Google refresh credentials');
  if (!refresh && existing?.google_account_id === google.sub) {
    const [credential] = await db.rows('organizer_credentials', { connection_id: `eq.${existing.id}` }, 'connection_id.asc');
    if (credential) refresh = await decrypt(credential.encrypted_refresh_token);
  }
  if (!refresh) throw new HttpError(400, 'Calendar connection incomplete: Google returned no offline access. Reconnect and grant consent.');
  const refreshed = await googleToken({ grant_type: 'refresh_token', refresh_token: refresh });
  if ((await identity(refreshed.access_token)).sub !== google.sub) throw new HttpError(403, 'Google refresh credentials belong to another account.');
  const saved = await db.rpc('fuse_register_google', { owner_id: user.id, expected_generation: settings.connection_generation,
    account_id: google.sub, account_email: google.email, encrypted_token: await encrypt(refresh), oauth_client: env('GOOGLE_CLIENT_ID') });
  return { status: 'connected', connection: publicConnection(Array.isArray(saved) ? saved[0] : saved) };
}
export async function googleClient(db: Store, connection: Record<string, any>) {
  if (connection.connection_status !== 'connected') throw new HttpError(401, 'Reconnect Google Calendar.');
  const [credential] = await db.rows('organizer_credentials', { connection_id: `eq.${connection.id}` }, 'connection_id.asc');
  if (!credential || credential.oauth_client_id !== env('GOOGLE_CLIENT_ID')) throw new HttpError(401, 'Reconnect Google Calendar with the current Google sign-in.');
  let token;
  try { token = await googleToken({ grant_type: 'refresh_token', refresh_token: await decrypt(credential.encrypted_refresh_token) }); }
  catch (error) {
    if (error instanceof HttpError && error.status === 401) await db.patch('calendar_connections', { id: `eq.${connection.id}` }, { connection_status: 'reconnect_required', last_error: error.message });
    throw error;
  }
  return async (path: string, method = 'GET', body?: unknown, etag?: string): Promise<any> => {
    const response = await fetch(`https://www.googleapis.com/${path}`, { method,
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      if (response.status === 403) {
        const failure = await response.json().catch(() => null);
        const reasons = [...(Array.isArray(failure?.error?.details) ? failure.error.details : []), ...(Array.isArray(failure?.error?.errors) ? failure.error.errors : [])].map(detail => detail?.reason);
        const service = path.startsWith('tasks/') ? 'Google Tasks' : 'Google Calendar';
        if (reasons.some(reason => ['SERVICE_DISABLED', 'accessNotConfigured'].includes(reason))) throw new HttpError(403, `${service} API is disabled. Enable it in the Google Cloud project that owns your OAuth client, then refresh.`);
        if (reasons.some(reason => ['ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'insufficientPermissions'].includes(reason))) throw new HttpError(403, `${service} permission is missing. Reconnect Google Calendar and grant both Calendar and Tasks access.`);
        if (reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'QUOTA_EXCEEDED', 'RATE_LIMIT_EXCEEDED'].includes(reason))) throw new HttpError(403, `${service} usage limit reached. Try again later.`);
        throw new HttpError(403, `${service} access was denied (403). Check API enablement, account permissions, and organization restrictions.`);
      }
      throw new HttpError(response.status, response.status === 404 || response.status === 410 ? 'This activity no longer exists in Google.' : response.status === 412 ? 'Google event changed. Try the update again.' : response.status === 401 ? 'Google authorization expired. Reconnect Google Calendar.' : `Google request failed (${response.status}). Try again.`);
    }
    return response.status === 204 ? null : response.json();
  };
}
export async function pages(google: Awaited<ReturnType<typeof googleClient>>, path: string, params: Record<string, string>) {
  const items: Record<string, any>[] = []; let pageToken: string | undefined; const seen = new Set<string>();
  do {
    const page = await google(`${path}?${new URLSearchParams({ ...params, ...(pageToken ? { pageToken } : {}) })}`);
    if (page.items !== undefined && !Array.isArray(page.items)) throw new HttpError(502, 'Invalid Google list response');
    items.push(...(page.items || [])); pageToken = page.nextPageToken;
    if (items.length > 20000 || pageToken && seen.has(pageToken)) throw new HttpError(413, 'Google data exceeds the processing limit');
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return items;
}
export async function readGoogleActivities(db: Store, userId: string) {
  const connection = await connectionFor(db, userId);
  const result = { connection: publicConnection(connection), tasks: [] as Record<string, any>[], schedules: [] as Record<string, any>[],
    source_status: { tasks: 'not_connected', calendar: 'not_connected' }, source_errors: {} as Record<string, string>, fetched_at: new Date().toISOString() };
  if (!connection || connection.connection_status !== 'connected') return result;
  let google;
  try { google = await googleClient(db, connection); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Google authorization failed';
    result.source_status = { tasks: 'error', calendar: 'error' }; result.source_errors = { tasks: message, calendar: message };
    if (error instanceof HttpError && error.status === 401) result.connection = { ...result.connection!, connection_status: 'reconnect_required', last_error: message };
    return result;
  }
  await Promise.all([
    (async () => { try {
      const lists = await pages(google, 'tasks/v1/users/@me/lists', { maxResults: '100' });
      const tasks = [];
      for (const list of lists) tasks.push(...(await pages(google, `tasks/v1/lists/${encodeURIComponent(list.id)}/tasks`, { maxResults: '100', showCompleted: 'true', showHidden: 'true', showDeleted: 'false' })).filter(t => !t.deleted).map(t => mapTask(t, list.id)));
      result.tasks = tasks; result.source_status.tasks = 'ok';
    } catch (error) { result.source_status.tasks = 'error'; result.source_errors.tasks = error instanceof Error ? error.message : 'Google Tasks unavailable'; } })(),
    (async () => { try {
      const calendar = await google('calendar/v3/calendars/primary/events?maxResults=1'), zone = calendar.timeZone || 'UTC', date = localDate(new Date(), zone);
      result.schedules = (await pages(google, 'calendar/v3/calendars/primary/events', { maxResults: '250', singleEvents: 'true', showDeleted: 'false',
        timeMin: midnight(addDays(date, -30), zone), timeMax: midnight(addDays(date, 366), zone) })).filter(e => e.status !== 'cancelled').map(e => mapEvent(e, zone));
      result.source_status.calendar = 'ok';
    } catch (error) { result.source_status.calendar = 'error'; result.source_errors.calendar = error instanceof Error ? error.message : 'Google Calendar unavailable'; } })(),
  ]);
  return result;
}
export async function setGoogleCompletion(db: Store, userId: string, body: Record<string, any>) {
  if (!['task', 'schedule'].includes(body.kind) || typeof body.completed !== 'boolean') throw new HttpError(400, 'Invalid completion request');
  const valid = (id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 1024 && !/[\x00-\x1f]/.test(id);
  const connection = await connectionFor(db, userId);
  if (!connection) throw new HttpError(401, 'Connect Google Calendar first');
  const google = await googleClient(db, connection);
  if (body.kind === 'task') {
    if (!valid(body.taskListId) || !valid(body.taskId)) throw new HttpError(400, 'Missing Google task identifiers');
    const task = await google(`tasks/v1/lists/${encodeURIComponent(body.taskListId)}/tasks/${encodeURIComponent(body.taskId)}`, 'PATCH',
      { status: body.completed ? 'completed' : 'needsAction', completed: body.completed ? new Date().toISOString() : null });
    return mapTask(task, body.taskListId);
  }
  if (body.calendarId !== 'primary' || !valid(body.eventId)) throw new HttpError(400, 'Invalid Google calendar identifiers');
  const path = `calendar/v3/calendars/primary/events/${encodeURIComponent(body.eventId)}`;
  const calendar = await google('calendar/v3/calendars/primary/events?maxResults=1');
  for (let attempt = 0; ; attempt++) {
    const event = await google(path), metadata = event.extendedProperties?.private || {};
    if (event.status === 'cancelled') throw new HttpError(404, 'This activity no longer exists in Google.');
    if (typeof event.etag !== 'string') throw new HttpError(502, 'Google returned no event version');
    try {
      const updated = await google(`${path}?sendUpdates=none`, 'PATCH', { summary: eventTitle(event.summary || 'Untitled event', body.completed, metadata.fuse_title_managed === 'true'),
        extendedProperties: { private: { ...metadata, fuse_completed: String(body.completed), fuse_completed_at: body.completed ? new Date().toISOString() : '', fuse_title_managed: String(body.completed) } } }, event.etag);
      return mapEvent(updated, calendar.timeZone || 'UTC');
    } catch (error) { if (!(error instanceof HttpError) || error.status !== 412 || attempt >= 2) throw error; }
  }
}
