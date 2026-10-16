import { CatalogError, CatalogStore, env, errorResponse, loadVideos } from '../_shared/catalog.ts';
import { collectKeyword } from '../_shared/keyword-worker.ts';

export async function handleRequest(req: Request) {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  try {
    if (req.headers.get('Authorization') !== `Bearer ${env('CATALOG_WORKER_SECRET')}`) throw new CatalogError(401, 'Worker authorization required');
    const store = new CatalogStore();
    const work = await store.rpc('fuse_catalog_claim');
    if (!work) return Response.json({ status: 'idle' });
    let outcome;
    try {
      if (work.kind === 'maintenance') {
        const videos = await loadVideos(work.item);
        outcome = { videos: work.item.map((id: string) => videos.find(v => v.youtube_video_id === id) || { youtube_video_id: id, available: false }) };
      } else if (work.item.keyword_id || work.item.source === 'skill') {
        outcome = await collectKeyword(store, work);
      } else {
        throw new CatalogError(400, 'Old search format. Start a new skill search.');
      }
    } catch (error) {
      outcome = { error: error instanceof Error ? error.message : 'Collection failed' };
    }
    await store.rpc('fuse_catalog_finish', { run_id: work.id, token: work.token, outcome });
    return Response.json({ status: 'processed', run_id: work.id, index: work.index, failed: 'error' in outcome });
  } catch (error) { return errorResponse(error); }
}
Deno.serve(handleRequest);
