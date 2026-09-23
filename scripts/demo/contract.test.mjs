import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenarioGifPath, scenarioSourcePath } from './config.mjs';
import { DEMO_NAMES } from './scenarioManifest.mjs';
import complex from './scenarios/complex.mjs';
import transforms from './scenarios/transforms.mjs';
import calculus from './scenarios/calculus.mjs';

const scenarios = { complex, transforms, calculus };

test('the demo manifest covers the three public routes', () => {
  assert.deepEqual(DEMO_NAMES, ['complex', 'transforms', 'calculus']);
  assert.deepEqual(
    Object.values(scenarios).map((scenario) => scenario.route),
    ['/complex', '/transforms', '/calculus'],
  );
});

test('all three public vertical slices are recordable', () => {
  assert.equal(complex.status, 'ready');
  assert.equal(calculus.status, 'ready');
  assert.equal(transforms.status, 'ready');
});

test('every ready scenario has a source and GIF output contract', () => {
  assert.match(scenarioSourcePath('complex'), /complex-demo\.webm$/);
  assert.match(scenarioGifPath('calculus'), /calculus-demo\.gif$/);
  assert.match(scenarioSourcePath('transforms'), /transforms-demo\.webm$/);
  assert.match(scenarioGifPath('transforms'), /transforms-demo\.gif$/);
});
