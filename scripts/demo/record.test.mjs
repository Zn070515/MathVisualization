import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDemoArgs } from './record.mjs';

test('CLI accepts one scenario or all', () => {
  assert.deepEqual(parseDemoArgs(['complex']), { mode: 'record', names: ['complex'] });
  assert.deepEqual(parseDemoArgs(['--rehearse', 'all']), {
    mode: 'rehearse',
    names: ['complex', 'transforms', 'calculus'],
  });
  assert.deepEqual(parseDemoArgs(['--check']), { mode: 'check', names: [] });
});
