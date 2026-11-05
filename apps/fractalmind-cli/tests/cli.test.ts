import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from '../src/index.js';
import { schema } from '../src/readers.js';

test('parser keeps commands separate from flags', () => {
  assert.deepEqual(parse(['auth', 'login', '--org', 'Example', '--no-wait']), {
    command: ['auth', 'login'], values: { org: 'Example', 'no-wait': true },
  });
});

test('schema publishes the stable exit-code contract', () => {
  assert.deepEqual(schema.exits, { 0: 'ok', 2: 'usage', 3: 'needs_funding', 4: 'not_authorized', 5: 'revoked_or_expired', 6: 'chain_unreachable', 7: 'not_found' });
});
