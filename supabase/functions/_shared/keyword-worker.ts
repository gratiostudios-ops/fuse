import { CatalogStore, gemini, loadVideos, searchVideos } from './catalog.ts';
import { keywordQueries, keywordSelections } from './keyword-discovery.ts';

export async function collectKeyword(store: CatalogStore, work: { id: string; item: { keyword_id?: string; source?: string; keyword: string; topic_ids: string[]; auto_publish: boolean } }) {
  const current = work.item.keyword_id
    ? (await store.request(`search_keywords?select=enabled,auto_publish&id=eq.${work.item.keyword_id}`))[0]
    : { enabled: true, auto_publish: work.item.auto_publish };
  if (!current?.enabled) return { videos: [] };
  const querySchema = { type: 'object', additionalProperties: false, required: ['queries'], properties: {
    queries: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } },
  } };
  const skills = await store.request(`topics?select=id,name&id=in.(${work.item.topic_ids.join(',')})`);
  const queries = keywordQueries(await gemini(
    'Generate exactly two complementary YouTube search queries. For source=skill, search the skill itself using useful educational topics within that skill. For source=keyword, preserve the administrator keyword and use the parent skills for disambiguation. Vary practical examples or teaching approaches using the discovery run as a seed. Never broaden to unrelated subjects.',
    { source: work.item.source || 'keyword', search_term: work.item.keyword, parent_skills: skills, discovery_run: work.id }, querySchema,
  ));
  const ids = [...new Set((await Promise.all(queries.map(q => searchVideos(q, 25)))).flat())];
  const verified = (await loadVideos(ids)).filter(v => v.available);
  const filter = verified.map(v => v.youtube_video_id).join(',');
  const [published, rejected, drafts] = filter ? await Promise.all([
    store.request(`suggestions?select=youtube_video_id&youtube_video_id=in.(${filter})`),
    store.request(`video_rejections?select=youtube_video_id,topic_id&youtube_video_id=in.(${filter})&topic_id=in.(${work.item.topic_ids.join(',')})`),
    store.request(`video_drafts?select=youtube_video_id,topic_ids,status&youtube_video_id=in.(${filter})`),
  ]) : [[], [], []];
  const existing = new Set(published.map((v: any) => v.youtube_video_id));
  const candidates = verified.filter(v => {
    if (existing.has(v.youtube_video_id)) return false;
    const allowed = work.item.topic_ids.filter(id => !rejected.some((r: any) => r.youtube_video_id === v.youtube_video_id && r.topic_id === id));
    if (!allowed.length) return false;
    // In automatic mode, an existing unapproved draft can become published.
    return current.auto_publish || !drafts.some((d: any) => d.youtube_video_id === v.youtube_video_id && (d.status !== 'draft' || allowed.every(id => d.topic_ids.includes(id))));
  });
  const rankSchema = { type: 'object', additionalProperties: false, required: ['selections'], properties: {
    selections: { type: 'array', maxItems: 15, items: { type: 'object', additionalProperties: false, required: ['video_id', 'reason'], properties: { video_id: { type: 'string' }, reason: { type: 'string' } } } },
  } };
  const ranked = candidates.length ? await gemini(
    'Select the best 15 supplied educational videos for the search term and parent skills. When source=skill, the term is the skill itself and no extra keyword is required. When source=keyword, match both the refinement and its parent skills. Return fewer only if fewer suitable candidates exist. Use supplied video IDs only. Each reason must be one short sentence based only on metadata. Do not claim to have watched a video or verified its accuracy. Do not fill the target with irrelevant videos.',
    { source: work.item.source || 'keyword', search_term: work.item.keyword, parent_skills: skills, target: 15, candidates }, rankSchema,
  ) : { selections: [] };
  return { videos: keywordSelections(ranked, candidates, work.item.topic_ids) };
}
