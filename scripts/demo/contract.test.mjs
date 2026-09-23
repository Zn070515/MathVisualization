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

test('only implemented vertical slices are recordable', () => {
  assert.equal(complex.status, 'ready');
  assert.equal(calculus.status, 'ready');
  assert.equal(transforms.status, 'planned');
  assert.match(transforms.skipReason, /planned/i);
});

test('planned transforms have no media output contract', () => {
  assert.match(scenarioSourcePath('complex'), /complex-demo\.webm$/);
  assert.match(scenarioGifPath('calculus'), /calculus-demo\.gif$/);
  assert.throws(() => scenarioSourcePath('transforms'), /planned/i);
  assert.throws(() => scenarioGifPath('transforms'), /planned/i);
});
