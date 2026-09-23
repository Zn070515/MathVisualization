import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { URL } from 'node:url';
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

test('every ready scenario has a local source path and GIF output contract', () => {
  assert.match(scenarioSourcePath('complex'), /complex-demo\.webm$/);
  assert.match(scenarioGifPath('calculus'), /calculus-demo\.gif$/);
  assert.match(scenarioSourcePath('transforms'), /transforms-demo\.webm$/);
  assert.match(scenarioGifPath('transforms'), /transforms-demo\.gif$/);
});

test('recording uses the repository Playwright setup', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  );
  const configSource = fs.readFileSync(new URL('./config.mjs', import.meta.url), 'utf8');
  const gitignore = fs.readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');

  assert.equal(packageJson.devDependencies.playwright, '1.63.0');
  assert.equal(packageJson.scripts['demo:setup'], 'playwright install chromium');
  assert.doesNotMatch(configSource, /demo_ArtFlow|MATHVIZ_PLAYWRIGHT_REPO/);
  assert.match(gitignore, /docs\/assets\/source\/\*\.webm/);
});
