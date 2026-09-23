import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { URL } from 'node:url';

import calculus from './scenarios/calculus.mjs';
import complex from './scenarios/complex.mjs';
import transforms from './scenarios/transforms.mjs';

test('complex scenario declares the actual contour workflow', () => {
  assert.equal(complex.route, '/complex');
  assert.equal(complex.status, 'ready');
  assert.match(complex.description, /poles|contour|accumulated/i);
});

test('calculus scenario declares the actual surface workflow', () => {
  assert.equal(calculus.route, '/calculus');
  assert.equal(calculus.status, 'ready');
  assert.match(calculus.description, /surface|slider|hover/i);
});

test('transforms scenario declares the real Fourier workflow', () => {
  assert.equal(transforms.status, 'ready');
  assert.equal(typeof transforms.run, 'function');
  assert.match(transforms.description, /DFT|aliasing|sampling/i);
  assert.match(
    fs.readFileSync(new URL('./scenarios/transforms.mjs', import.meta.url), 'utf8'),
    /SLIDER_DRAG_STEPS = (?:1[5-9]|20)/,
  );
});
