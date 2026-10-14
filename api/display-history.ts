import { authStorage } from './storage';
import type { FuseResponse } from './ai';

export type DisplayHistory = {
  outputs: { id: string; displayed_at: string; response: FuseResponse }[];
  schedules: Record<string, { start: string; end: string; count: number }>;
  seen: string[];
};
const empty = (): DisplayHistory => ({ outputs: [], schedules: {}, seen: [] });
let pending: Promise<unknown> = Promise.resolve();
export async function getDisplayHistory(userId: string): Promise<DisplayHistory> {
  await pending;
  return read(userId);
}
async function read(userId: string): Promise<DisplayHistory> {
  try {
    const raw = await authStorage.getItem(`fuse.display.${userId}`);
    const value = raw ? JSON.parse(raw) : null;
    return value && Array.isArray(value.outputs) && Array.isArray(value.seen) && value.schedules ? value : empty();
  } catch { return empty(); }
}
export function recordDisplayed(userId: string, response: FuseResponse): Promise<void> {
  if (!response.message && !response.blocks.length) return Promise.resolve();
  const next = pending.then(async () => {
    const history = await read(userId);
    const id = response.response_id ?? JSON.stringify(response);
    if (history.seen.includes(id)) return;
    history.seen = [...history.seen, id].slice(-256);
    history.outputs = [...history.outputs, { id, displayed_at: new Date().toISOString(), response }].slice(-2);
    for (const [key, event] of Object.entries(history.schedules)) if (Date.parse(event.end) < Date.now()) delete history.schedules[key];
    for (const block of response.blocks) {
      if (block.type !== 'schedule' || Date.parse(block.data.end) < Date.now()) continue;
      const { id, start, end } = block.data;
      const previous = history.schedules[id];
      history.schedules[id] = { start, end, count: Math.min(2, previous?.start === start && previous.end === end ? previous.count + 1 : 1) };
    }
    await authStorage.setItem(`fuse.display.${userId}`, JSON.stringify(history));
  });
  pending = next.catch(() => {});
  return next;
}
