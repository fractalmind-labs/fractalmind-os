import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { signNodeCommand, canonicalNodeCommandSigningBytes } from '../src/node-command.js';
import { nodeCommandIntentHash, nodeCommandSigningBytes, verifySignedNodeCommand } from '../src/node-execution.js';

test('prepared intent hashes the exact signed NodeCommand envelope', async () => {
  const signer = Ed25519Keypair.generate();
  const input = { target: { organizationId: '0x2', nodeId: '0x3', agentId: 'worker' }, action: 'assign', scope: 'direct', capability: { id: '0x4', revocationVersion: 1n }, commandId: 'command-1', nonce: 'nonce-1', idempotencyKey: 'idem-1', issuedAtMs: 1700000000000, expiresAtMs: 1700000060000, payload: { task: 'bounded task' }, budget: { asset: 'MIST', amount: 1n } };
  const command = await signNodeCommand(signer, input);
  await verifySignedNodeCommand(command);
  const expected = canonicalNodeCommandSigningBytes({ ...input, version: '1', signer: command.signer, payloadHash: command.payload_hash });
  assert.deepEqual(nodeCommandSigningBytes(command), expected);
  assert.equal(Buffer.from(nodeCommandIntentHash(command)).toString('hex'), createHash('sha256').update(expected).digest('hex'));
});

test('preparation rejects payload or envelope mutation before submitting a transaction', async () => {
  const command = await signNodeCommand(Ed25519Keypair.generate(), { target: { organizationId: '0x2', nodeId: '0x3', agentId: '' }, action: 'status', scope: 'view', capability: { id: '0x4', revocationVersion: 1n }, payload: {} });
  await assert.rejects(verifySignedNodeCommand({ ...command, payload: { injected: true } }), /payload/);
  await assert.rejects(verifySignedNodeCommand({ ...command, action: 'start' }), /signature/);
  await assert.rejects(verifySignedNodeCommand({ ...command, target: { ...command.target, node_id: '0x5' } }), /signature/);
});
