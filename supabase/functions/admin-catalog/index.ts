import { CatalogError, CatalogStore, corsHeaders, errorResponse, loadVideos, object, uuid } from '../_shared/catalog.ts';

export async function handleRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  try {
    const store = new CatalogStore();
    const actor = await store.admin(req);
    const raw = await req.text();
    if (raw.length > 16000) throw new CatalogError(413, 'Request too large');
    let body;
    try { body = JSON.parse(raw); } catch { throw new CatalogError(400, 'Invalid JSON'); }
    const operations = ['overview', 'drafts', 'library', 'save_tags', 'reject', 'publish', 'deactivate', 'revise', 'retry', 'collect_now', 'keywords', 'keyword_runs', 'save_keywords', 'search_settings', 'save_skill_settings'];
    if (!object(body) || !operations.includes(body.operation) || !object(body.payload ?? {})) throw new CatalogError(400, 'Invalid operation');
    const payload = body.payload ?? {};
    if (['save_tags', 'reject', 'publish', 'deactivate', 'revise'].includes(body.operation) && !uuid(payload.id)) throw new CatalogError(400, 'Invalid record ID');
    if (payload.offset !== undefined && (!Number.isInteger(payload.offset) || payload.offset < 0 || payload.offset > 100000)) throw new CatalogError(400, 'Invalid page');
    if (payload.topic_id && !uuid(payload.topic_id)) throw new CatalogError(400, 'Invalid skill');
    if (body.operation === 'retry' && (!uuid(payload.run_id) || !Number.isInteger(payload.index) || payload.index < 0)) throw new CatalogError(400, 'Invalid retry');
    if (body.operation === 'save_tags' && (!Array.isArray(payload.topic_ids) || payload.topic_ids.length > 50 || !payload.topic_ids.every(uuid))) throw new CatalogError(400, 'Invalid skills');
    if (['search_settings', 'save_skill_settings'].includes(body.operation)) {
      if (body.operation === 'save_skill_settings' && (!Array.isArray(payload.topic_ids) || !payload.topic_ids.length || payload.topic_ids.length > 50 || !payload.topic_ids.every(uuid) || typeof payload.auto_publish !== 'boolean')) throw new CatalogError(400, 'Choose skills and a publishing mode; keywords are optional');
      const data = await store.rpc('fuse_skill_search_settings', { actor, topic_ids: body.operation === 'save_skill_settings' ? payload.topic_ids : null, auto_publish: payload.auto_publish ?? true });
      return Response.json({ data }, { headers: corsHeaders });
    }
    if (['keywords', 'keyword_runs', 'save_keywords'].includes(body.operation)) {
      if (body.operation === 'save_keywords' && (!Array.isArray(payload.entries) || !payload.entries.length || payload.entries.length > 50 || payload.entries.some((e: unknown) => !object(e)
        || typeof e.keyword !== 'string' || !e.keyword.trim() || e.keyword.length > 200 || (e.id !== undefined && !uuid(e.id))
        || !Array.isArray(e.topic_ids) || !e.topic_ids.length || e.topic_ids.length > 20 || !e.topic_ids.every(uuid)
        || typeof e.auto_publish !== 'boolean' || typeof e.enabled !== 'boolean'))) throw new CatalogError(400, 'Provide valid keywords, existing skills and publishing settings');
      const data = await store.rpc('fuse_keyword_admin', { actor, operation: body.operation, payload });
      return Response.json({ data }, { headers: corsHeaders });
    }
    if (body.operation === 'collect_now') {
      if (payload.keyword_ids !== undefined && (!Array.isArray(payload.keyword_ids) || !payload.keyword_ids.length || payload.keyword_ids.length > 500 || !payload.keyword_ids.every(uuid))) throw new CatalogError(400, 'Select saved keywords');
      if (payload.topic_ids !== undefined && (!Array.isArray(payload.topic_ids) || !payload.topic_ids.length || payload.topic_ids.length > 50 || !payload.topic_ids.every(uuid))) throw new CatalogError(400, 'Select existing skills');
      const data = await store.rpc('fuse_collect_catalog', { actor, topic_ids: payload.topic_ids || null, keyword_ids: payload.keyword_ids || null });
      // Begin one bounded item immediately; Cron continues the rest without an open tab.
      const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
      const secret = Deno.env.get('CATALOG_WORKER_SECRET');
      if (runtime && secret && !data.already_running) runtime.waitUntil(fetch(`${store.url}/functions/v1/catalog-worker`, {
        method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(145000),
      }).then(response => { if (!response.ok) console.error('Immediate worker start failed', response.status); }).catch(() => console.error('Immediate worker start failed; Cron will retry.')));
      return Response.json({ data }, { headers: corsHeaders });
    }
    // Never accept a browser-supplied metadata/availability claim for publication.
    delete payload.video;
    if (body.operation === 'publish') {
      const drafts = await store.request(`video_drafts?select=youtube_video_id&id=eq.${payload.id}`);
      if (!drafts.length) throw new CatalogError(404, 'Draft not found');
      const [video] = await loadVideos([drafts[0].youtube_video_id]);
      if (!video?.available) throw new CatalogError(400, 'This video is no longer publicly available');
      payload.video = video;
    }
    const data = await store.rpc('fuse_admin_execute', { actor, operation: body.operation, payload });
    return Response.json({ data }, { headers: corsHeaders });
  } catch (error) { return errorResponse(error, true); }
}
Deno.serve(handleRequest);
