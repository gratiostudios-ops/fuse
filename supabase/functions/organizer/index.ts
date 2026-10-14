import { Store, cors, HttpError, json, env, verifyUser, validTimezone, isObject } from '../_shared/organizer-server.ts';
import { registerGoogle, readGoogleActivities, setGoogleCompletion } from '../_shared/organizer-google.ts';
import { generateRecap } from '../_shared/organizer-recap.ts';
import { createGoogleActivity } from '../_shared/organizer-create.ts';

async function scheduled(db: Store) {
  const now = new Date().toISOString();
  const settings = await db.request(`organizer_settings?${new URLSearchParams({ select: '*', next_recap_at: `lte.${now}`, order: 'next_recap_at.asc', limit: '5' })}`);
  const recaps = await Promise.allSettled(settings.map(async (setting: any) => {
    // Rotate candidates even before 9 PM, so one time zone cannot starve others.
    await db.patch('organizer_settings', { user_id: `eq.${setting.user_id}` }, { next_recap_at: new Date(Date.now() + 300000).toISOString() });
    return generateRecap(db, setting);
  }));
  return json({ recaps_processed: recaps.length, recap_failures: recaps.filter(r => r.status === 'rejected').length });
}
export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const db = new Store();
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
    if (body.action === 'register-google') return json(await registerGoogle(db, user, body));
    if (body.action === 'create') return json(await createGoogleActivity(db, user.id, body.params, body.timezone));
    if (body.action === 'complete') return json(await setGoogleCompletion(db, user.id, body));
    if (body.action === 'activities') {
      const [activities, settings, recaps] = await Promise.all([
        readGoogleActivities(db, user.id), db.rows('organizer_settings', own, 'user_id.asc'),
        db.rows('organizer_daily_recaps', own, 'local_date.desc'),
      ]);
      return json({ ...activities, timezone: settings[0]?.timezone || 'UTC', recap: recaps[0] || null });
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
