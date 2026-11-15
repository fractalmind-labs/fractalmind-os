import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { evaluateGrant } from '../src/auth.js';
import { FmError } from '../src/output.js';

const human = '0x1', grant = '0x2', org = '0x3', device = '0x4';
const profile = { network: 'localnet' as const, humanId: human, grantId: grant, organizationId: org, address: device };
const address = (value: string) => normalizeSuiAddress(value);
const good = () => ({
  profile, now: 100n, required: 'read' as const, organizationActive: true,
  human: { id: address(human), network: 'localnet', organizations: [address(org)], grants: [address(grant)], generation: '7' },
  grant: { revoked: false, expires_at_ms: '101', human_id: address(human), device: address(device), org_scope: address(org), generation: '7', actions: [1] },
});

test('a scoped, live READ grant passes fresh authorization checks', () => {
  assert.doesNotThrow(() => evaluateGrant(good()));
});

test('revoked and expired grants are exit 5', () => {
  for (const grantPatch of [{ revoked: true }, { expires_at_ms: '100' }]) {
    const input = good(); Object.assign(input.grant, grantPatch);
    assert.throws(() => evaluateGrant(input), (error: unknown) => error instanceof FmError && error.exitCode === 5);
  }
});

test('wrong device, scope, or missing READ are exit 4', () => {
  for (const grantPatch of [{ device: address('0x5') }, { org_scope: address('0x6') }, { actions: [] }]) {
    const input = good(); Object.assign(input.grant, grantPatch);
    assert.throws(() => evaluateGrant(input), (error: unknown) => error instanceof FmError && error.exitCode === 4);
  }
});

test('an OPERATE write is denied to a READ-only Agent grant', () => {
  const input = good(); input.required = 'operate';
  assert.throws(() => evaluateGrant(input), (error: unknown) => error instanceof FmError && error.exitCode === 4);
});
