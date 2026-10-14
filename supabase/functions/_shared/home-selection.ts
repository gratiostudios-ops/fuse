import type { Candidate } from './contract.ts';

export function homeCandidates(candidates: Candidate[], history: unknown, now: number): Candidate[] {
  const counts = history && typeof history === 'object' && 'schedules' in history ? history.schedules : null;
  const nearby = candidates.filter(candidate => candidate.block.type === 'schedule'
    && Date.parse(candidate.block.data.end) >= now
    && Date.parse(candidate.block.data.start) <= now + 2 * 60 * 60 * 1000);
  const unseen = nearby.filter(candidate => {
    if (candidate.block.type !== 'schedule') return false;
    const saved = counts && typeof counts === 'object' ? (counts as Record<string, unknown>)[candidate.id] : null;
    return !saved || typeof saved !== 'object' || !('start' in saved) || !('end' in saved) || !('count' in saved)
      || saved.start !== candidate.block.data.start || saved.end !== candidate.block.data.end
      || typeof saved.count !== 'number' || saved.count < 2;
  });
  return unseen.length ? [...unseen, ...candidates.filter(candidate => candidate.type === 'task')]
    : candidates.filter(candidate => candidate.type === 'suggestion');
}
