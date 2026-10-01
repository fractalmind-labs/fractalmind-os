import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import test from 'node:test';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { canonicalNodeCommandSigningBytes, signNodeCommand } from '../src/node-command.js';

const key = Ed25519Keypair.fromSecretKey(Uint8Array.from({ length: 32 }, (_, i) => i));
const input = {
  target: { organizationId: 'org-1', nodeId: 'host-1', agentId: 'agent-1' },
  action: 'assign', scope: 'lifecycle', capability: { id: 'cap-1', revocationVersion: 3n },
  payload: { task: '测量 KR <project> & report', timeout_seconds: 30 },
  commandId: 'cmd-1', nonce: 'nonce-1', idempotencyKey: 'idem-1',
  issuedAtMs: 1784394000000, expiresAtMs: 1784394060000,
};

test('real device signature verifies independently and covers the transmitted payload', async () => {
  const command = await signNodeCommand(key, input);
  const [scheme, pub, sig] = command.signature.split(':');
  assert.equal(scheme, 'ed25519');
  assert.equal(command.signer, key.getPublicKey().toSuiAddress());
  assert.equal(command.payload_hash, createHash('sha256').update(JSON.stringify(command.payload)).digest('hex'));
  const bytes = canonicalNodeCommandSigningBytes({
    ...input, version: '1', signer: command.signer, payloadHash: command.payload_hash,
  });
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pub, 'hex')]),
    format: 'der', type: 'spki',
  });
  assert.equal(verify(null, bytes, publicKey, Buffer.from(sig, 'hex')), true);
  assert.equal(verify(null, Buffer.from('tampered'), publicKey, Buffer.from(sig, 'hex')), false);
  assert.equal(command.capability.revocation_version, '3');
  assert.equal('domain' in command, false);
});

test('node-wide command omits agent and zero-claim commands omit budget', async () => {
  const command = await signNodeCommand(key, { ...input, target: { ...input.target, agentId: '' }, action: 'inventory' });
  assert.equal('agent_id' in command.target, false);
  assert.equal('budget' in command, false);
});

test('unsafe identifiers, TTL and budget cannot be signed', async () => {
  await assert.rejects(signNodeCommand(key, { ...input, scope: '<script>' }), /ASCII/);
  await assert.rejects(signNodeCommand(key, { ...input, expiresAtMs: input.issuedAtMs + 300001 }), /TTL/);
  await assert.rejects(signNodeCommand(key, { ...input, budget: { asset: 'MIST', amount: 0n } }), /greater than zero/);
});
