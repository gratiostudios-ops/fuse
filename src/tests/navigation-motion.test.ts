import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampProgress, navigationAxis, projectedDestination } from '../navigation-motion-policy';

test('slow drags commit only past halfway and fast flicks use release direction', () => {
  assert.equal(projectedDestination(0.49, 0, 402), 0);
  assert.equal(projectedDestination(0.51, 0, 402), 1);
  assert.equal(projectedDestination(0.2, 1000, 402), 1);
  assert.equal(projectedDestination(0.8, -1000, 402), 0);
  assert.equal(projectedDestination(0.2, 500, 230), 1);
  assert.equal(projectedDestination(0.8, -500, 230), 0);
});

test('reversing an interrupted transition continues on the visible surface', () => {
  assert.equal(navigationAxis(0, 0, 0, 0, 20), 'panel');
  assert.equal(navigationAxis(0, 0, 0, 0, -20), 'page');
  assert.equal(navigationAxis(0.2, 0, 0, 0, -20), 'panel');
  assert.equal(navigationAxis(0, 1, 0, 0, -20), 'panel');
  assert.equal(navigationAxis(0, 0, 0.2, 0, 20), 'page');
  assert.equal(navigationAxis(1, 1, 1, 1, -20), 'panel');
});

test('progress clamps at view boundaries without rubber banding', () => {
  assert.equal(clampProgress(-0.2), 0);
  assert.equal(clampProgress(1.2), 1);
  assert.equal(clampProgress(0.37), 0.37);
});
