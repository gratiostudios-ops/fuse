export const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function env(name: string): string { const value = Deno.env.get(name); if (!value) throw new HttpError(503, `Missing server configuration: ${name}`); return value; }
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });
export const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
export function validTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw new HttpError(400, 'Invalid time zone');
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return value; } catch { throw new HttpError(400, 'Invalid time zone'); }
}
export async function verifyUser(req: Request) {
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'Sign in required');
  const key = Deno.env.get('FUSE_SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_ANON_KEY');
  const headers = { apikey: key, Authorization: authorization };
  const response = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new HttpError(401, 'Session expired. Sign in again.');
  const user = await response.json();
  if (!isObject(user) || typeof user.id !== 'string') throw new HttpError(401, 'Invalid session');
  return { user, headers };
}
export class Store {
  constructor(private userHeaders?: Record<string, string>) {}
  async request(path: string, method = 'GET', body?: unknown, prefer = 'return=representation'): Promise<any> {
    const key = this.userHeaders ? '' : env('SUPABASE_SERVICE_ROLE_KEY');
    const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
      method, headers: { ...(this.userHeaders || { apikey: key, Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json', Prefer: prefer },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      console.error('Organizer database request failed', path.split('?')[0], response.status, detail?.code, typeof detail?.message === 'string' ? detail.message.slice(0, 500) : 'Unknown database error');
      throw new HttpError(503, 'Organizer database unavailable. Check migrations and function logs.');
    }
    return response.status === 204 ? null : response.json();
  }
  rpc(name: string, body: unknown) { return this.request(`rpc/${name}`, 'POST', body); }
  async rows(table: string, filters: Record<string, string> = {}, order = 'id.asc'): Promise<Record<string, any>[]> {
    const data: Record<string, any>[] = [];
    for (let offset = 0; ; ) {
      const params = new URLSearchParams({ select: '*', ...filters, order, offset: String(offset), limit: '100' });
      const key = this.userHeaders ? '' : env('SUPABASE_SERVICE_ROLE_KEY');
      const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/${table}?${params}`, {
        headers: { ...(this.userHeaders || { apikey: key, Authorization: `Bearer ${key}` }), Prefer: 'count=exact' }, signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        console.error('Organizer database read failed', table, response.status, detail?.code, typeof detail?.message === 'string' ? detail.message.slice(0, 500) : 'Unknown database error');
        throw new HttpError(503, `Could not load ${table}. Check the organizer function logs.`);
      }
      const page = await response.json(), total = Number(response.headers.get('content-range')?.split('/')[1]);
      if (!Array.isArray(page) || !Number.isFinite(total)) throw new HttpError(503, 'Incomplete organizer response');
      data.push(...page);
      if (data.length >= total) return data;
      if (!page.length || data.length > 20000) throw new HttpError(413, 'Organizer data changed or exceeds the processing limit');
      offset += page.length;
    }
  }
  patch(table: string, filters: Record<string, string>, body: unknown) { return this.request(`${table}?${new URLSearchParams(filters)}`, 'PATCH', body); }
  remove(table: string, filters: Record<string, string>) { return this.request(`${table}?${new URLSearchParams(filters)}`, 'DELETE'); }
  upsert(table: string, body: unknown, conflict: string, ignore = false) {
    return this.request(`${table}?on_conflict=${encodeURIComponent(conflict)}`, 'POST', body, `resolution=${ignore ? 'ignore' : 'merge'}-duplicates,return=representation`);
  }
}
function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function bytes(value: string) { return Uint8Array.from(atob(value), x => x.charCodeAt(0)); }
async function encryptionKey() {
  let raw: Uint8Array<ArrayBuffer>;
  try { raw = bytes(env('ORGANIZER_TOKEN_KEY')); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(503, 'ORGANIZER_TOKEN_KEY must be valid base64'); }
  if (raw.length !== 32) throw new HttpError(503, 'ORGANIZER_TOKEN_KEY must be a base64-encoded 32-byte key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(value));
  return `${base64(iv)}.${base64(new Uint8Array(data))}`;
}
export async function decrypt(value: string) {
  const [iv, data] = value.split('.');
  const result = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, await encryptionKey(), bytes(data));
  return new TextDecoder().decode(result);
}
export async function challenge(verifier: string) {
  return base64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function googleToken(parameters: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), ...parameters }), signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) {
    console.error('Organizer Google token request failed', response.status, result.error, parameters.grant_type);
    const message = result.error === 'invalid_grant' ? 'Google authorization expired. Reconnect your calendar.'
      : result.error === 'invalid_client' ? 'Google rejected the OAuth credentials. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Supabase secrets.'
      : result.error === 'redirect_uri_mismatch' ? 'The Google organizer callback URL does not match its authorized redirect URI.'
      : 'Google authorization failed. Check the organizer function logs.';
    throw new HttpError(result.error === 'invalid_grant' ? 401 : 502, message);
  }
  return result;
}
