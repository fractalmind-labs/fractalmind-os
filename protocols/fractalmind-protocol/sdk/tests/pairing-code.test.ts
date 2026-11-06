import assert from 'node:assert/strict';
import test from 'node:test';
import { pairingCode } from '../src/identity.js';

test('pairing code is a fixed six-digit rendering of a public fingerprint', () => {
  assert.equal(pairingCode('00000000' + 'f'.repeat(56)), '000000');
  assert.match(pairingCode('ffffffff' + '0'.repeat(56)), /^\d{6}$/);
  assert.throws(() => pairingCode('not-a-fingerprint'), /Invalid pairing fingerprint/);
});
