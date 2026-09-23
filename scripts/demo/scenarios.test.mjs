import assert from 'node:assert/strict';
import { test } from 'node:test';

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

test('transforms scenario cannot be accidentally recorded', () => {
  assert.equal(transforms.status, 'planned');
  assert.equal(typeof transforms.run, 'function');
  assert.throws(() => transforms.run({}), /Fourier|planned/i);
});
