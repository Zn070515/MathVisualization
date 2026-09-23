import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';

const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

test('README embeds only recorded demo GIFs', () => {
  assert.match(readme, /docs\/assets\/complex-demo\.gif/);
  assert.match(readme, /docs\/assets\/calculus-demo\.gif/);
  assert.doesNotMatch(readme, /docs\/assets\/transforms-demo\.gif/);
  assert.match(readme, /Fourier|frequency-domain|planned/i);
});
