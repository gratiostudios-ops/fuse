import { CatalogError, object, videoId, type Video } from './catalog.ts';

export function keywordQueries(value: unknown): string[] {
  if (!object(value) || !Array.isArray(value.queries) || value.queries.length !== 2 || value.queries.some((q: unknown) => typeof q !== 'string' || !q.trim() || q.length > 300)) throw new CatalogError(502, 'AI returned invalid keyword queries');
  return [...new Set(value.queries.map((q: string) => q.trim()))];
}

/** The model can only rank verified candidates; the server owns skill assignment. */
export function keywordSelections(value: unknown, videos: Video[], topicIds: string[]) {
  if (!object(value) || !Array.isArray(value.selections) || value.selections.length > 15) throw new CatalogError(502, 'AI returned invalid keyword selections');
  const used = new Set<string>();
  return value.selections.map((selection: unknown) => {
    if (!object(selection) || !videoId(selection.video_id) || used.has(selection.video_id) || typeof selection.reason !== 'string' || !selection.reason.trim() || selection.reason.length > 600) throw new CatalogError(502, 'AI returned invalid keyword selections');
    const video = videos.find(v => v.youtube_video_id === selection.video_id && v.available);
    if (!video) throw new CatalogError(502, 'AI selected an unverified video');
    used.add(selection.video_id);
    return { ...video, topic_ids: [...topicIds], reason: selection.reason };
  });
}
