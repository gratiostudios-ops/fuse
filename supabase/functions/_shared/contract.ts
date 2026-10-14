export type Block =
  | { type: 'task'; data: { id: string; title: string; due_date: string | null; due_time: string | null; is_completed: boolean } }
  | { type: 'schedule'; data: { id: string; title: string; start: string; end: string; is_completed?: boolean; is_all_day?: boolean; start_date?: string | null; end_date?: string | null } }
  | { type: 'suggestion'; data: { id: string; title: string; description?: string | null; video_url: string; thumbnail_url: string | null; duration_minutes: number | null } }
  | { type: 'text'; data: { content: string } };
export type FuseResponse = { schema_version: 1; response_id?: string; message: string; blocks: Block[] };
export type Candidate = { type: 'task' | 'schedule' | 'suggestion'; id: string; block: Block; priority: number };
export type Selection = { type: Candidate['type']; id: string; reason: string };

const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isoDate = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x));
const timestamp = (x: unknown) => typeof x === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(x) && Number.isFinite(Date.parse(x));
const safeUrl = (x: unknown) => {
  if (typeof x !== 'string') return false;
  try { return ['http:', 'https:'].includes(new URL(x).protocol); } catch { return false; }
};

/** Validate every discriminated block before either server delivery or UI rendering. */
export function parseFuseResponse(value: unknown): FuseResponse {
  if (!object(value) || value.schema_version !== 1 || typeof value.message !== 'string'
    || value.message.length > 4000 || !Array.isArray(value.blocks) || value.blocks.length > 50) throw new Error('Invalid AI response.');
  if (value.response_id !== undefined && (typeof value.response_id !== 'string' || value.response_id.length > 128)) throw new Error('Invalid response ID.');
  for (const block of value.blocks) {
    if (!object(block) || !object(block.data)) throw new Error('Invalid AI block.');
    const d = block.data;
    if (block.type === 'text') {
      if (typeof d.content !== 'string' || d.content.length > 4000) throw new Error('Invalid text block.');
      continue;
    }
    if (typeof d.id !== 'string' || !d.id || typeof d.title !== 'string') throw new Error('Invalid record block.');
    if (block.type === 'task') {
      if (!(d.due_date === null || isoDate(d.due_date)) || !(d.due_time === null || typeof d.due_time === 'string' && /^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(d.due_time))
        || typeof d.is_completed !== 'boolean') throw new Error('Invalid task block.');
    } else if (block.type === 'schedule') {
      if (!timestamp(d.start) || !timestamp(d.end) || Date.parse(d.end as string) < Date.parse(d.start as string)
        || (d.is_completed !== undefined && typeof d.is_completed !== 'boolean')
        || (d.is_all_day !== undefined && typeof d.is_all_day !== 'boolean')
        || (d.is_all_day === true && (!isoDate(d.start_date) || !isoDate(d.end_date)))) throw new Error('Invalid schedule block.');
    } else if (block.type === 'suggestion') {
      if (!(d.description === undefined || d.description === null || typeof d.description === 'string') || !safeUrl(d.video_url) || !(d.thumbnail_url === null || safeUrl(d.thumbnail_url))
        || !(d.duration_minutes === null || typeof d.duration_minutes === 'number' && Number.isFinite(d.duration_minutes) && d.duration_minutes >= 0)) throw new Error('Invalid suggestion block.');
    } else throw new Error('Unsupported AI block type.');
  }
  return value as FuseResponse;
}

/** Model selects IDs; all displayed fields come from server-fetched rows. */
export function buildResponse(value: unknown, candidates: Candidate[], home: boolean): FuseResponse {
  if (!object(value) || typeof value.message !== 'string' || !Array.isArray(value.selections)
    || value.selections.length > (home ? 2 : 5)) throw new Error('Invalid AI selection.');
  const seen = new Set<string>();
  const blocks: Block[] = [];
  for (const selection of value.selections) {
    if (!object(selection) || typeof selection.reason !== 'string' || selection.reason.length > 300) throw new Error('Invalid selection reason.');
    const key = `${selection.type}:${selection.id}`;
    const candidate = candidates.find(c => c.type === selection.type && c.id === selection.id);
    if (!candidate || seen.has(key)) throw new Error('AI selected an unknown or duplicate record.');
    seen.add(key);
    blocks.push(candidate.block);
  }
  if (blocks.some(b => b.type === 'suggestion') && blocks.some(b => b.type === 'task' || b.type === 'schedule')) throw new Error('Mixed answer groups.');
  return parseFuseResponse({ schema_version: 1, message: (home && !blocks.length && value.answer_kind !== 'answer') || value.answer_kind === 'empty' || value.answer_kind === 'unavailable' ? '' : value.message, blocks });
}
