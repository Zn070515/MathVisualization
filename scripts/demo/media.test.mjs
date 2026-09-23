import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gifAttemptPlan, gifFilter } from './helpers/media.mjs';

test('GIF filter uses palette generation and paletteuse', () => {
  assert.match(gifFilter({ fps: 15, width: 1200 }), /palettegen/);
  assert.match(gifFilter({ fps: 15, width: 1200 }), /paletteuse/);
});

test('GIF attempts reduce frame rate before width', () => {
  assert.deepEqual(gifAttemptPlan(), [
    { fps: 15, width: 1200 },
    { fps: 12, width: 1200 },
    { fps: 12, width: 1100 },
  ]);
});
