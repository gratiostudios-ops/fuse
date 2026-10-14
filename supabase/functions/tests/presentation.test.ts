import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResponse, homeSummary, stripLegacyLoadWarning, type Candidate } from '../_shared/contract.ts';

const candidates: Candidate[] = [
  { type: 'task', id: 'task', priority: 0, block: { type: 'task', data: { id: 'task', title: 'Finish draft', due_date: null, due_time: null, is_completed: false } } },
  { type: 'schedule', id: 'event', priority: 0, block: { type: 'schedule', data: { id: 'event', title: 'Meeting', start: '2026-10-15T09:00:00Z', end: '2026-10-15T10:00:00Z' } } },
];

test('Home keeps verified cards and order while discarding diagnostics and duplicate reasons', () => {
  const result = buildResponse({ message: 'Some data could not be loaded (tasks). You are free.', selections: [
    { type: 'schedule', id: 'event', reason: 'Meeting starts soon.' },
    { type: 'task', id: 'task', reason: 'Finish draft is important.' },
  ] }, candidates, true);
  assert.deepEqual(result.blocks, [candidates[1].block, candidates[0].block]);
  assert.equal(result.message, 'Here’s your upcoming plan.');
});

test('empty Home does not claim no commitments or free time', () => {
  assert.equal(buildResponse({ message: 'Nothing scheduled; you are free.', selections: [] }, [], true).message,
    'Your plan will appear here when items are available.');
  assert.equal(homeSummary([candidates[0].block]), 'Here are your tasks.');
  assert.equal(homeSummary([candidates[1].block]), 'Here are your upcoming events.');
});

test('legacy prefix removal preserves meaningful failures and chat content', () => {
  const failure = "I couldn't save this. Google Tasks access is unavailable.";
  assert.equal(stripLegacyLoadWarning(failure), failure);
  assert.equal(buildResponse({ message: `Some data could not be loaded (tasks). ${failure}`, selections: [] }, [], false).message, failure);
  assert.equal(stripLegacyLoadWarning('Calendar is unavailable, so I cannot determine your schedule.'),
    'Calendar is unavailable, so I cannot determine your schedule.');
});
