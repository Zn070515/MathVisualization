import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const path = (relative) => new URL(relative, root);

test('local setup wrappers exist for both shell families', () => {
  for (const file of [
    'scripts/bootstrap.ps1',
    'scripts/bootstrap.sh',
    'scripts/start.ps1',
    'scripts/start.sh',
    'scripts/start.mjs',
    'scripts/doctor.mjs',
  ]) {
    assert.equal(existsSync(path(file)), true, file);
  }
});

test('wrappers use the repository ports and project-local symbolic environment', () => {
  const powershell = readFileSync(path('scripts/start.ps1'), 'utf8');
  const shell = readFileSync(path('scripts/start.sh'), 'utf8');
  const node = readFileSync(path('scripts/start.mjs'), 'utf8');

  assert.match(node, /5173/);
  assert.match(node, /8000/);
  assert.match(node, /services/);
  assert.match(node, /symbolic/);
  assert.match(powershell, /start\.mjs/);
  assert.match(shell, /start\.mjs/);
});
