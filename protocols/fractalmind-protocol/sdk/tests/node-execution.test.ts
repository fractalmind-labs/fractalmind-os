import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { bcs } from '@mysten/sui/bcs';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import { FractalMindClient } from '../src/client.js';
import { signNodeCommand, canonicalNodeCommandSigningBytes } from '../src/node-command.js';
import { NodeExecutionApi, nodeCommandIntentHash, nodeCommandSigningBytes, verifySignedNodeCommand } from '../src/node-execution.js';

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

test('budget reads use original package types after upgrade and retain full u64 precision', async () => {
  const original = `0x${'1'.repeat(64)}`;
  const totals = bcs.struct('Totals', { spent: bcs.u64(), reserved: bcs.u64() });
  const spent = 9007199254740993n;
  const reserved = 10n;
  let read = false;
  const core = { getDynamicField: async (input: { parentId: string; name: { type: string; bcs: Uint8Array } }) => {
    assert.equal(input.parentId, '0x3');
    assert.equal(input.name.type, `${original}::remote_authority::BoundBudgetKey`);
    assert.deepEqual(input.name.bcs, new Uint8Array([0]));
    read = true;
    return { dynamicField: { value: { type: `${original}::remote_authority::BoundBudgetTotals`, bcs: totals.serialize({ spent, reserved }).toBytes() } } };
  } };
  const api = new NodeExecutionApi(new FractalMindClient({ packageId: '0x2', originalPackageId: original, client: { core } as unknown as ClientWithCoreApi }));
  assert.deepEqual(await api.getBudget('0x3'), { spent, reserved });
  assert.equal(read, true);
});

test('reservation ledger rejects wrong types, impossible costs and an unsettled claimed cost', async () => {
  const original = `0x${'0'.repeat(63)}2`;
  const claim = bcs.struct('Claim', { reserved_amount: bcs.u64(), spent_amount: bcs.u64(), settled: bcs.bool() });
  for (const item of [
    { type: `${original}::remote_authority::BoundBudgetTotals`, reserved_amount: 20n, spent_amount: 0n, settled: false },
    { type: `${original}::remote_authority::BoundBudgetClaim`, reserved_amount: 20n, spent_amount: 21n, settled: true },
    { type: `${original}::remote_authority::BoundBudgetClaim`, reserved_amount: 20n, spent_amount: 1n, settled: false },
  ]) {
    const core = { getDynamicField: async () => ({ dynamicField: { value: { type: item.type, bcs: claim.serialize(item).toBytes() } } }) };
    const api = new NodeExecutionApi(new FractalMindClient({ packageId: '0x2', client: { core } as unknown as ClientWithCoreApi }));
    await assert.rejects(api.getReservationBudget('0x3', new Uint8Array(32)), /type|budget/);
  }
});

test('unknown result cannot request settlement with nonzero cost', () => {
  const api = new NodeExecutionApi(new FractalMindClient({ packageId: '0x2' }));
  assert.throws(() => api.finishCommand({ executionId: '0x3', capabilityId: '0x4', organizationId: '0x5', finalState: 4, expectedCursor: 2n, spentAmount: 7n, keyVersion: 1n, encryptedResult: new Uint8Array(32) }), /Unknown execution/);
});

test('scheduled preparation uses a separate OKR entry and rejects non-OKR commands', async () => {
  const command=await signNodeCommand(Ed25519Keypair.generate(),{target:{organizationId:'0x2',nodeId:'0x3',agentId:'native-file'},action:'assign',scope:'control',capability:{id:'0x4',revocationVersion:1n},payload:{okr:{id:`0x${'5'.padStart(64,'0')}`,agreement_version:'1',kr_index:'1'}},budget:{asset:'TOOL_CALLS',amount:3n}});
  const api=new NodeExecutionApi(new FractalMindClient({packageId:'0x2',okrPackageId:'0x6'}));
  const input={humanId:'0x7',grantId:'0x8',membershipId:'0x9',bindingId:'0xa',managedAgentId:'0xb',command};
  const scheduled=await api.prepareCommand({...input,scheduled:true});
  assert.equal(scheduled.getData().commands[0].MoveCall?.function,'prepare_scheduled_command_v2');
  const normal=await api.prepareCommand(input);
  assert.equal(normal.getData().commands[0].MoveCall?.function,'prepare_command_v2');
  const status=await signNodeCommand(Ed25519Keypair.generate(),{target:{organizationId:'0x2',nodeId:'0x3',agentId:'native-file'},action:'status',scope:'observation',capability:{id:'0x4',revocationVersion:1n},payload:{}});
  await assert.rejects(api.prepareCommand({...input,command:status,scheduled:true}),/Scheduled preparation/);
});
