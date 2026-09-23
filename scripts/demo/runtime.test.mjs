import assert from 'node:assert/strict';
import { test } from 'node:test';

import { humanPoints } from './helpers/mouse.mjs';
import { typeDelays } from './helpers/timing.mjs';

test('human pointer path is deterministic and includes both endpoints', () => {
  assert.deepEqual(humanPoints({ x: 0, y: 10 }, { x: 100, y: 50 }, 4), [
    { x: 0, y: 10 },
    { x: 25, y: 20 },
    { x: 50, y: 30 },
    { x: 75, y: 40 },
    { x: 100, y: 50 },
  ]);
});

test('typing delays are stable and bounded', () => {
  assert.deepEqual(typeDelays('abc', { min: 55, max: 95 }), [55, 75, 95]);
});
