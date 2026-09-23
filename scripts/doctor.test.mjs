import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_VERSIONS,
  packageManagerVersion,
  parseVersion,
  versionAtLeast,
} from './doctor.mjs';

test('parses node, pnpm and uv version output', () => {
  assert.deepEqual(parseVersion('v24.21.0'), { major: 24, minor: 21, patch: 0 });
  assert.deepEqual(parseVersion('pnpm 11.22.0'), { major: 11, minor: 22, patch: 0 });
  assert.deepEqual(parseVersion('uv 0.12.3 (abc123 2026-01-01)'), {
    major: 0,
    minor: 12,
    patch: 3,
  });
  assert.equal(parseVersion('not a version'), null);
});

test('compares versions numerically, not lexically', () => {
  assert.equal(versionAtLeast('24.10.0', REQUIRED_VERSIONS.node), true);
  assert.equal(versionAtLeast('24.0.0', REQUIRED_VERSIONS.node), true);
  assert.equal(versionAtLeast('23.99.99', REQUIRED_VERSIONS.node), false);
  assert.equal(versionAtLeast('0.12.10', '0.12.3'), true);
  assert.equal(versionAtLeast('0.12.2', '0.12.3'), false);
});

test('reads the exact pnpm version declared by the repository', () => {
  assert.equal(packageManagerVersion({ packageManager: 'pnpm@11.22.0' }), '11.22.0');
  assert.equal(packageManagerVersion({ packageManager: 'npm@10.0.0' }), null);
  assert.equal(packageManagerVersion({}), null);
});
