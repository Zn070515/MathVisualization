import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { test } from 'node:test';

import { scenarioGifPath } from './config.mjs';
import { validateGif } from './helpers/media.mjs';

const NAMES = ['complex', 'transforms', 'calculus'];

test('committed demo media remains reproducible and within the GIF contract', async () => {
  for (const name of NAMES) {
    const gif = scenarioGifPath(name);
    await access(gif);
    const gifMedia = await validateGif(gif);
    assert.ok(gifMedia.width >= 1100, `${name} GIF is too narrow`);
  }
});
