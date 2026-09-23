import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { test } from 'node:test';

import { scenarioGifPath, scenarioSourcePath } from './config.mjs';
import { validateGif, probeMedia } from './helpers/media.mjs';

const NAMES = ['complex', 'transforms', 'calculus'];

test('committed demo media remains reproducible and within the GIF contract', async () => {
  for (const name of NAMES) {
    const source = scenarioSourcePath(name);
    const gif = scenarioGifPath(name);
    await access(source);
    await access(gif);

    const sourceMedia = await probeMedia(source);
    assert.equal(sourceMedia.width, 1440, `${name} source width`);
    assert.equal(sourceMedia.height, 900, `${name} source height`);
    assert.ok(sourceMedia.bytes > 0, `${name} source is empty`);

    const gifMedia = await validateGif(gif);
    assert.ok(gifMedia.width >= 1100, `${name} GIF is too narrow`);
  }
});
