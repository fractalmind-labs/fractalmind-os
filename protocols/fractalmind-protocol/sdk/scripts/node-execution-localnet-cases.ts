import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import type { SuiClientTypes } from '@mysten/sui/client';
import type { Transaction } from '@mysten/sui/transactions';
import { FractalMindSDK, signNodeCommand, nodeCommandIntentHash } from '../src/index.js';
import { bytesToHex, encryptContent } from '../src/identity-crypto.js';
import { recordContext } from '../src/product-record.js';
import type { SignedNodeCommand } from '../src/types.js';

type Data = SuiClientTypes.Transaction<{ effects: true; objectTypes: true; events: true }>;
type Execute = (label: string, tx: Transaction, signer?: Ed25519Keypair, sponsor?: Ed25519Keypair, allowRejected?: boolean) => Promise<{ data: Data }>;
type Options = { sdk: FractalMindSDK; execute: Execute; created: (data: Data, suffix: string) => string; organizationId: string; humanId: string; grantId: string; membershipId: string; bindingId: string; managedAgentId: string; desktop: Ed25519Keypair; host: Ed25519Keypair; wrongHost: Ed25519Keypair; contentKey: Uint8Array };

async function goValidate(o: Options, command: SignedNodeCommand, expectedDuplicate = false, expectedCode = '') {
  const seed = decodeSuiPrivateKey(o.host.getSecretKey()).secretKey;
  try {
    const { stdout } = await promisify(execFile)('go', ['test', './internal/sui', '-run', '^TestChainExecutionLive$', '-count=1', '-v'], {
      cwd: fileURLToPath(new URL('../../../../runtime/fractalmind-envd/', import.meta.url)), timeout: 30000,
      env: { ...process.env, FM_CHAIN_EXECUTION_TEST_SEED: bytesToHex(seed), FM_CHAIN_EXECUTION_CASE: JSON.stringify({ RPC: process.env.FM_LOCALNET_RPC ?? 'http://127.0.0.1:29000', PackageID: o.sdk.client.packageId, Command: command, ExpectedDuplicate: expectedDuplicate, ExpectedCode: expectedCode }) },
    });
    assert.ok(stdout.includes('--- PASS: TestChainExecutionLive'), 'Go real-chain verification must run.');
    console.log(`Go execution ${expectedCode || (expectedDuplicate ? 'duplicate query' : 'start ownership')} PASS ${command.command_id}`);
    const evidence = /FM_EXECUTION_EVIDENCE (.+)/.exec(stdout)?.[1];
    assert.ok(evidence, 'Go must return public execution checkpoint and transaction evidence.');
    return JSON.parse(evidence) as Record<string, unknown>;
  } finally { seed.fill(0); }
}

/** Tests chain claim/start/result semantics. This slice does not call an Agent
 * adapter or assert that an assigned task has physically run. */
export async function exerciseNodeExecutions(o: Options) {
  const { sdk, execute, created, desktop, host } = o;
  const goChecks: Record<string, unknown>[] = [];
  async function verifyGo(command: SignedNodeCommand, duplicate = false, code = '') { goChecks.push(await goValidate(o, command, duplicate, code)); }
  const authority = { organizationId: o.organizationId, humanId: o.humanId, grantId: o.grantId, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId };
  const capTx = await execute('Execution: issue three-use bounded device authority', sdk.host.issueCapability({ ...authority, actions: ['assign'], scope: 'control', maxUses: 3n, budgetAsset: 'MIST', maxBudget: 100n, expiresAtMs: Date.now() + 3600000 }));
  assert.equal(capTx.data.status.success, true);
  const capabilityId = created(capTx.data, '::remote_authority::RemoteCapability');
  const cap = await sdk.remoteAuthority.getCapability(capabilityId);
  const prepareInput = { ...authority, capabilityId };
  const newCommand = () => signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action: 'assign', scope: 'control', capability: { id: capabilityId, revocationVersion: 1n }, budget: { asset: 'MIST', amount: 20n }, payload: { task: 'verify bounded command preflight' }, expiresAtMs: Date.now() + 300000 });
  async function prepare(command: SignedNodeCommand) {
    const made = await execute('Execution: device atomically reserves command and checkpoint', await sdk.nodeExecution.prepareCommand({ ...authority, command }));
    assert.equal(made.data.status.success, true);
    const id = created(made.data, '::node_execution::CommandExecution');
    assert.equal((await sdk.nodeExecution.getExecution(id)).state, 0);
    return id;
  }
  const first = await newCommand();
  const firstId = await prepare(first);
  const repeat = await execute('Execution: exact claim retry does not create another checkpoint', await sdk.nodeExecution.prepareCommand({ ...authority, command: first }));
  assert.equal(repeat.data.status.success, true);
  assert.equal((await sdk.remoteAuthority.getCapability(capabilityId)).usesClaimed, 1n);
  assert.equal((await sdk.remoteAuthority.getCapability(capabilityId)).budgetClaimed, 20n);
  const unprepared = await newCommand();
  await verifyGo(unprepared, false, 'unauthorized');
  await verifyGo(first);
  assert.equal((await sdk.nodeExecution.getExecution(firstId)).state, 1);
  assert.equal((await sdk.nodeExecution.getExecution(firstId)).attempt_id.length, 32);
  await verifyGo(first, true);
  const alreadyRunning = await execute('Execution: running checkpoint cannot start again', sdk.nodeExecution.beginCommand({ ...prepareInput, executionId: firstId }), host, undefined, true);
  assert.equal(alreadyRunning.data.status.success, false);
  assert.match(JSON.stringify(alreadyRunning.data.status), /9304/);
  const logicalId = `command-${bytesToHex(nodeCommandIntentHash(first))}`;
  const plaintext = new TextEncoder().encode(JSON.stringify({ result: 'chain preflight test only; no adapter was invoked' }));
  const encryptedResult = await encryptContent(plaintext, o.contentKey, recordContext(o.organizationId, 'checkpoint', logicalId, 1, 1));
  const finished = await execute('Execution: Host persists encrypted terminal checkpoint result', sdk.nodeExecution.finishCommand({ executionId: firstId, organizationId: o.organizationId, finalState: 2, expectedCursor: 2n, keyVersion: 1n, encryptedResult }), host);
  assert.equal(finished.data.status.success, true);
  const resultId = (await sdk.nodeExecution.getExecution(firstId)).result_record!;
  assert.deepEqual((await sdk.productRecord.decryptRecord(resultId, o.contentKey)).plaintext, plaintext);
  await verifyGo(first, true);

  const second = await newCommand();
  const secondId = await prepare(second);
  const wrong = await execute('Execution: another Host cannot start a valid queued command', sdk.nodeExecution.beginCommand({ ...prepareInput, executionId: secondId }), o.wrongHost, undefined, true);
  assert.equal(wrong.data.status.success, false);
  assert.match(JSON.stringify(wrong.data.status), /9302/);
  const early = await execute('Execution: result cannot precede a confirmed start', sdk.nodeExecution.finishCommand({ executionId: secondId, organizationId: o.organizationId, finalState: 2, expectedCursor: 1n, keyVersion: 1n, encryptedResult }), host, undefined, true);
  assert.equal(early.data.status.success, false);
  assert.match(JSON.stringify(early.data.status), /9305/);
  await execute('Execution: device cancels queued command before any start', sdk.nodeExecution.requestStop({ ...authority, executionId: secondId }));
  assert.equal((await sdk.nodeExecution.getExecution(secondId)).state, 5);
  const cancelled = await execute('Execution: cancelled queued command cannot start', sdk.nodeExecution.beginCommand({ ...prepareInput, executionId: secondId }), host, undefined, true);
  assert.equal(cancelled.data.status.success, false);
  assert.match(JSON.stringify(cancelled.data.status), /9304/);

  const third = await newCommand();
  const thirdId = await prepare(third);
  assert.equal((await sdk.remoteAuthority.getCapability(capabilityId)).usesClaimed, 3n);
  await verifyGo(third); // last allowed preclaimed use must remain executable
  const tooMany = await execute('Execution: fourth unique claim exceeds use bound', await sdk.nodeExecution.prepareCommand({ ...authority, command: await newCommand() }), desktop, undefined, true);
  assert.equal(tooMany.data.status.success, false);
  assert.match(JSON.stringify(tooMany.data.status), /8308/);
  const unknownLogicalId = `command-${bytesToHex(nodeCommandIntentHash(third))}`;
  const unknownPlaintext = new TextEncoder().encode(JSON.stringify({ result: 'needs confirmation; no automatic retry' }));
  await execute('Execution: unknown result is persisted without granting replay', sdk.nodeExecution.finishCommand({ executionId: thirdId, organizationId: o.organizationId, finalState: 4, expectedCursor: 2n, keyVersion: 1n, encryptedResult: await encryptContent(unknownPlaintext, o.contentKey, recordContext(o.organizationId, 'checkpoint', unknownLogicalId, 1, 1)) }), host);
  assert.equal((await sdk.nodeExecution.getExecution(thirdId)).state, 4);
  await verifyGo(third, true);
  const pendingCap = await execute('Execution: issue authority for revoke-after-prepare check', sdk.host.issueCapability({ ...authority, actions: ['assign'], scope: 'control', maxUses: 1n, budgetAsset: 'MIST', maxBudget: 100n, expiresAtMs: Date.now() + 3600000 }));
  const pendingCapabilityId = created(pendingCap.data, '::remote_authority::RemoteCapability');
  const pendingCommand = await signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action: 'assign', scope: 'control', capability: { id: pendingCapabilityId, revocationVersion: 1n }, budget: { asset: 'MIST', amount: 20n }, payload: { task: 'must not begin after Host revocation' }, expiresAtMs: Date.now() + 300000 });
  const pendingId = await prepare(pendingCommand);
  return { capabilityId, executions: [firstId, secondId, thirdId], goChecks, pendingStart: { ...authority, capabilityId: pendingCapabilityId, executionId: pendingId }, records: [{ logicalId, plaintext: new TextDecoder().decode(plaintext) }, { logicalId: unknownLogicalId, plaintext: new TextDecoder().decode(unknownPlaintext) }], checks: 'real chain reservation/checkpoints and Go start ownership; actual Agent adapter execution pending' };
}
