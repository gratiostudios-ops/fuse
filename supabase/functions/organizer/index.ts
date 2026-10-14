import { Store, cors, HttpError, json, env, verifyUser, validTimezone, encrypt, decrypt, challenge, googleToken, isObject } from '../_shared/organizer-server.ts';
import { syncConnection } from '../_shared/organizer-sync.ts';
import { generateRecap } from '../_shared/organizer-recap.ts';

const scopes = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/tasks'];
function organizerRedirectUri(): string {
  const expected = `${env('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/organizer`;
  const configured = env('GOOGLE_ORGANIZER_REDIRECT_URI').trim();
  if (configured !== expected) {
    throw new HttpError(503, `Set GOOGLE_ORGANIZER_REDIRECT_URI to ${expected}. The Calendar connection must use the organizer callback.`);
  }
  return configured;
}

async function connectionFor(db: Store, userId: string) {
  return (await db.rows('calendar_connections', { user_id: `eq.${userId}` }))[0];
}
async function callback(req: Request, db: Store) {
  console.info('Organizer OAuth callback received');
  const url = new URL(req.url), state = url.searchParams.get('state');
  if (!state) throw new HttpError(400, 'Missing authorization state');
  const [stored] = await db.rpc('fuse_consume_oauth', { oauth_state: state });
  if (!stored) throw new HttpError(400, 'Authorization expired or was already used. Return to Fuse and reconnect.');
  if (url.searchParams.get('error')) throw new HttpError(400, 'Google connection cancelled. Return to Fuse to try again.');
  const code = url.searchParams.get('code'); if (!code) throw new HttpError(400, 'Missing authorization code');
  const tokens = await googleToken({ grant_type: 'authorization_code', code, code_verifier: stored.verifier, redirect_uri: organizerRedirectUri() });
  const granted = String(tokens.scope || '').split(' ');
  if (!scopes.slice(2).every(scope => granted.includes(scope))) throw new HttpError(400, 'Calendar and Tasks permissions are required. Return to Fuse and reconnect.');
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new HttpError(502, 'Could not verify Google account');
  const google = await response.json();
  if (typeof google.sub !== 'string' || typeof google.email !== 'string') throw new HttpError(502, 'Invalid Google account');
  const existing = await connectionFor(db, stored.user_id);
  if (existing?.google_account_id && existing.google_account_id !== google.sub) throw new HttpError(409, 'Reconnect the original Google account. Switching accounts is not supported in this version.');
  const credential = existing ? (await db.rows('organizer_credentials', { connection_id: `eq.${existing.id}` }, 'connection_id.asc'))[0] : null;
  const refreshToken = tokens.refresh_token || (credential ? await decrypt(credential.encrypted_refresh_token) : null);
  if (!refreshToken) throw new HttpError(400, 'Google returned no offline access. Reconnect and grant consent.');
  const savedConnection = await db.rpc('fuse_finish_oauth', { owner_id: stored.user_id, expected_generation: stored.connection_generation,
    account_id: google.sub, account_email: google.email, encrypted_token: await encrypt(refreshToken) });
  const connection = Array.isArray(savedConnection) ? savedConnection[0] : savedConnection;
  if (!isObject(connection) || typeof connection.id !== 'string') throw new HttpError(503, 'Google connection could not be saved');
  console.info('Organizer Google connection saved');
  const work = syncConnection(db, connection, true);
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work); else await work;
  // No tokens or arbitrary redirect URLs leave this backend callback.
  return new Response('Google connected. Your activities are syncing. Close this tab and return to Fuse.', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
async function scheduled(db: Store) {
  const now = new Date().toISOString();
  const connections = await db.request(`calendar_connections?${new URLSearchParams({ select: '*', connection_status: 'eq.connected', next_sync_at: `lte.${now}`, order: 'next_sync_at.asc', limit: '5' })}`);
  const syncs = await Promise.allSettled(connections.map((connection: any) => syncConnection(db, connection)));
  const settings = await db.request(`organizer_settings?${new URLSearchParams({ select: '*', next_recap_at: `lte.${now}`, order: 'next_recap_at.asc', limit: '5' })}`);
  const recaps = await Promise.allSettled(settings.map(async (setting: any) => {
    // Rotate candidates even before 9 PM, so one time zone cannot starve others.
    await db.patch('organizer_settings', { user_id: `eq.${setting.user_id}` }, { next_recap_at: new Date(Date.now() + 300000).toISOString() });
    return generateRecap(db, setting);
  }));
  return json({ connections_processed: syncs.length, sync_failures: syncs.filter(r => r.status === 'rejected').length,
    recaps_processed: recaps.length, recap_failures: recaps.filter(r => r.status === 'rejected').length });
}
export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const db = new Store();
    if (req.method === 'GET') return await callback(req, db);
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const raw = await req.text(); if (raw.length > 10000) throw new HttpError(413, 'Request too large');
    let body: unknown; try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
    if (!isObject(body)) throw new HttpError(400, 'Invalid request');
    if (body.action === 'scheduled') {
      if (req.headers.get('Authorization') !== `Bearer ${env('ORGANIZER_CRON_SECRET')}`) throw new HttpError(401, 'Unauthorized scheduler');
      return await scheduled(db);
    }
    const { user, headers } = await verifyUser(req);
    const own = { user_id: `eq.${user.id}` };
    if (body.action === 'initialize') {
      const timezone = validTimezone(body.timezone);
      const result = await db.upsert('organizer_settings', { user_id: user.id, timezone, timezone_initialized: true }, 'user_id', true);
      await db.patch('organizer_settings', { ...own, timezone_initialized: 'eq.false' }, { timezone, timezone_initialized: true });
      return json({ initialized: true, created: !!result?.length });
    }
    if (body.action === 'timezone') {
      const timezone = validTimezone(body.timezone);
      // Preserve revisions/leases; a changed zone itself invalidates saved recaps.
      await db.upsert('organizer_settings', { user_id: user.id, timezone, timezone_initialized: true, next_recap_at: new Date().toISOString() }, 'user_id');
      return json({ timezone });
    }
    if (body.action === 'connect') {
      const redirectUri = organizerRedirectUri();
      const clientId = env('GOOGLE_CLIENT_ID').trim();
      const state = crypto.randomUUID() + crypto.randomUUID(), verifier = crypto.randomUUID() + crypto.randomUUID();
      await db.remove('organizer_oauth_states', { expires_at: `lt.${new Date().toISOString()}` });
      const [settings] = await db.rows('organizer_settings', own, 'user_id.asc');
      if (!settings) throw new HttpError(409, 'Initialize organizer before connecting');
      await db.request('organizer_oauth_states', 'POST', { state, user_id: user.id, verifier, connection_generation: settings.connection_generation, expires_at: new Date(Date.now() + 600000).toISOString() });
      const connection = await connectionFor(db, user.id);
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
        response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', state,
        code_challenge: await challenge(verifier), code_challenge_method: 'S256', ...(connection?.google_acc ? { login_hint: connection.google_acc } : {}) });
      console.info('Organizer OAuth configuration', JSON.stringify({ client_id: clientId, redirect_uri: redirectUri }));
      console.info('Organizer Google authorization requested; waiting for consent');
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    }
    if (body.action === 'complete') {
      if (!['task','schedule'].includes(body.kind) || typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || typeof body.completed !== 'boolean') throw new HttpError(400, 'Invalid completion request');
      const result = await new Store(headers).rpc('fuse_set_completion', { item_kind: body.kind, target_id: body.id, desired_completed: body.completed });
      const connection = await connectionFor(db, user.id);
      if (connection?.connection_status === 'connected') {
        const work = syncConnection(db, connection, true);
        if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work); else await work;
      }
      return json(result);
    }
    if (body.action === 'sync') {
      const connection = await connectionFor(db, user.id);
      return json(connection ? await syncConnection(db, connection, body.force === true) : { status: 'not-connected' });
    }
    if (body.action === 'disconnect') {
      await db.rpc('fuse_disconnect_google', { owner_id: user.id });
      return json({ status: 'disconnected' });
    }
    if (body.action === 'recap') {
      // Reuse the existing per-user AI budget; recap requests cannot bypass provider limits.
      if (!await new Store(headers).rpc('fuse_ai_allow_request', { request_mode: 'chat' })) throw new HttpError(429, 'Too many AI requests. Try again later.');
      const [settings] = await db.rows('organizer_settings', own, 'user_id.asc');
      if (!settings) throw new HttpError(409, 'Open the organizer first to initialize your time zone');
      const recap = await generateRecap(db, settings, true);
      return json({ recap, ...(recap ? {} : { message: 'Your recap is being prepared. Refresh in a moment.' }) });
    }
    throw new HttpError(400, 'Unknown organizer action');
  } catch (error) {
    console.error('Organizer request failed', error instanceof HttpError ? error.message : 'Unexpected error');
    return json({ error: error instanceof HttpError ? error.message : 'Organizer request failed. Check server configuration and logs.' }, error instanceof HttpError ? error.status : 500);
  }
}
Deno.serve(handleRequest);
