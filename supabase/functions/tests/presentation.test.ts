import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResponse, type Candidate } from '../_shared/contract.ts';
import { homeCandidates } from '../_shared/home-selection.ts';

const now = Date.parse('2026-10-15T07:00:00Z');
const candidates: Candidate[] = [
  { type: 'task', id: 'task', priority: 90, block: { type: 'task', data: { id: 'task', title: 'Finish draft', due_date: null, due_time: null, is_completed: false } } },
  { type: 'schedule', id: 'event', priority: 70, block: { type: 'schedule', data: { id: 'event', title: 'Meeting', start: '2026-10-15T09:00:00Z', end: '2026-10-15T10:00:00Z' } } },
  { type: 'suggestion', id: 'video', priority: 10, block: { type: 'suggestion', data: { id: 'video', title: 'Learn', video_url: 'https://example.com/video', thumbnail_url: null, duration_minutes: 5 } } },
];
const select = (c: Candidate) => ({ type: c.type, id: c.id, reason: 'Relevant' });
test('preserves fresh model copy and trusted card order', () => {
  const result = buildResponse({ message: 'A little preparation could help with your meeting.', selections: [select(candidates[1]), select(candidates[0])] }, candidates, true);
  assert.equal(result.message, 'A little preparation could help with your meeting.');
  assert.deepEqual(result.blocks, [candidates[1].block, candidates[0].block]);
});
test('empty Home and classified errors do not show errors or not-found copy', () => {
  assert.equal(buildResponse({ message: 'No tasks found', selections: [] }, [], true).message, '');
  for (const answer_kind of ['empty', 'unavailable']) assert.equal(buildResponse({ answer_kind, message: 'Tasks unavailable', selections: [] }, [], false).message, '');
});
test('rejects mixed groups, duplicate and unknown IDs, and card overflow', () => {
  assert.throws(() => buildResponse({ message: '', selections: [select(candidates[0]), select(candidates[2])] }, candidates, true), /Mixed/);
  assert.throws(() => buildResponse({ message: '', selections: [select(candidates[0]), select(candidates[0])] }, candidates, true), /duplicate/);
  assert.throws(() => buildResponse({ message: '', selections: [{ type: 'task', id: 'invented', reason: '' }] }, candidates, true), /unknown/);
  assert.throws(() => buildResponse({ message: '', selections: candidates.map(select) }, candidates, true), /selection/);
  assert.throws(() => buildResponse({ message: '', selections: Array(6).fill(select(candidates[0])) }, candidates, false), /selection/);
  const five = Array.from({ length: 5 }, (_, i) => ({ ...candidates[0], id: String(i) }));
  assert.equal(buildResponse({ message: 'Your tasks', selections: five.map(select) }, five, false).blocks.length, 5);
});
test('nearby boundary includes exactly two hours; otherwise suggestions beat overdue tasks', () => {
  assert.deepEqual(homeCandidates(candidates, {}, now).map(c => c.type), ['schedule', 'task']);
  assert.deepEqual(homeCandidates(candidates, {}, now - 1).map(c => c.type), ['suggestion']);
  assert.deepEqual(homeCandidates(candidates, {}, now + 2.5 * 3600000).map(c => c.type), ['schedule', 'task']);
  assert.deepEqual(homeCandidates(candidates, {}, now + 4 * 3600000).map(c => c.type), ['suggestion']);
});
test('twice-shown schedules yield to suggestions, changed timing resets eligibility', () => {
  const history = { schedules: { event: { start: '2026-10-15T09:00:00Z', end: '2026-10-15T10:00:00Z', count: 2 } } };
  assert.deepEqual(homeCandidates(candidates, history, now).map(c => c.type), ['suggestion']);
  history.schedules.event.count = 1;
  assert.equal(homeCandidates(candidates, history, now)[0].type, 'schedule');
  history.schedules.event.count = 2; history.schedules.event.start = '2026-10-15T08:00:00Z';
  assert.equal(homeCandidates(candidates, history, now)[0].type, 'schedule');
  assert.deepEqual(homeCandidates([candidates[0]], {}, now), []);
});


test('Home preserves verified setup guidance instead of returning a blank screen', () => {
  const result = buildResponse({ answer_kind: 'answer', message: 'Choose a few interests in the account panel to personalize your feed.', selections: [] }, [], true);
  assert.equal(result.message, 'Choose a few interests in the account panel to personalize your feed.');
  assert.deepEqual(result.blocks, []);
});
