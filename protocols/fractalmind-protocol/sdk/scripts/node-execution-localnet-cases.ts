import { executionBoundaryHash } from '../src/execution-boundary.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import type { SuiClientTypes } from '@mysten/sui/client';
import type { Transaction } from '@mysten/sui/transactions';
import { FractalMindSDK, signNodeCommand, nodeCommandIntentHash } from '../src/index.js';
import { bytesToHex, encryptContent, unwrapKeys } from '../src/identity-crypto.js';
import { commandResultKey, commandResultWrapContext, encryptCommandResult, decryptCommandResult } from '../src/command-result-crypto.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { recordContext } from '../src/product-record.js';
import type { SignedNodeCommand } from '../src/types.js';
import { prepareOkrAcceptance } from './okr-localnet-cases.js';

type Data = SuiClientTypes.Transaction<{ effects: true; objectTypes: true; events: true }>;
type Execute = (label: string, tx: Transaction, signer?: Ed25519Keypair, sponsor?: Ed25519Keypair, allowRejected?: boolean) => Promise<{ data: Data }>;
type Options = { sdk: FractalMindSDK; execute: Execute; created: (data: Data, suffix: string) => string; organizationId: string; humanId: string; grantId: string; membershipId: string; bindingId: string; managedAgentId: string; desktop: Ed25519Keypair; host: Ed25519Keypair; wrongHost: Ed25519Keypair; hostEncryptionSecret: Uint8Array; contentKey: Uint8Array; workspace: string };

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

/** Tests chain claim/start/result semantics and a synthetic subprocess adapter.
 * Actual bounded Agent execution and cost metering remain separate gates. */
export async function exerciseNodeExecutions(o: Options) {
  const { sdk, execute, created, desktop, host } = o;
  const goChecks: Record<string, unknown>[] = [];
  const budgetChecks: Record<string, unknown>[] = [];
  async function assertBudget(id: string, spent: bigint, reserved: bigint, label: string) {
    assert.deepEqual(await sdk.nodeExecution.getBudget(id), { spent, reserved });
    assert.equal((await sdk.remoteAuthority.getCapability(id)).budgetClaimed, spent + reserved);
    budgetChecks.push({ label, capabilityId: id, spent: spent.toString(), reserved: reserved.toString() });
  }
  async function assertClaim(command: SignedNodeCommand, spentAmount: bigint, settled: boolean) {
    assert.deepEqual(await sdk.nodeExecution.getReservationBudget(command.capability.id, nodeCommandIntentHash(command)), { reservedAmount: 20n, spentAmount, settled });
  }
  async function verifyGo(command: SignedNodeCommand, duplicate = false, code = '') { goChecks.push(await goValidate(o, command, duplicate, code)); }
  const authority = { organizationId: o.organizationId, humanId: o.humanId, grantId: o.grantId, membershipId: o.membershipId, bindingId: o.bindingId, managedAgentId: o.managedAgentId };
  const capTx = await execute('Execution: issue three-use bounded device authority', sdk.host.issueCapability({ ...authority, actions: ['assign'], scope: 'control', maxUses: 3n, budgetAsset: 'MIST', maxBudget: 100n, expiresAtMs: Date.now() + 3600000 }));
  assert.equal(capTx.data.status.success, true);
  const capabilityId = created(capTx.data, '::remote_authority::RemoteCapability');
  const cap = await sdk.remoteAuthority.getCapability(capabilityId);
  const prepareInput = { ...authority, capabilityId };
  const newCommand = () => signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action: 'assign', scope: 'control', capability: { id: capabilityId, revocationVersion: 1n }, budget: { asset: 'MIST', amount: 20n }, payload: { task: 'verify bounded command preflight' }, expiresAtMs: Date.now() + 300000 });
  async function prepare(command: SignedNodeCommand, keyed = false) {
    const made = await execute('Execution: device atomically reserves command and checkpoint', await sdk.nodeExecution.prepareCommand({ ...authority, command, resultKey: keyed ? { organizationKey: o.contentKey, keyVersion: 1n } : undefined }));
    assert.equal(made.data.status.success, true, JSON.stringify(made.data.status));
    const id = created(made.data, '::node_execution::CommandExecution');
    assert.equal((await sdk.nodeExecution.getExecution(id)).state, 0);
    return id;
  }
  const first = await newCommand();
  const firstId = await prepare(first, true);
  const storedKey = await sdk.nodeExecution.getResultKey(capabilityId, nodeCommandIntentHash(first), 1n);
  const wrapContext = commandResultWrapContext(o.organizationId, capabilityId, o.membershipId, bytesToHex(nodeCommandIntentHash(first)), 1n);
  const hostResultKey = await unwrapKeys(Uint8Array.from(storedKey.wrapped_key), o.hostEncryptionSecret, wrapContext);
  assert.deepEqual(hostResultKey, commandResultKey(o.contentKey, o.organizationId, bytesToHex(nodeCommandIntentHash(first)), 1n));
  const goKey = await promisify(execFile)('go', ['test', './internal/sui', '-run', '^TestChainCommandResultKeyLive$', '-count=1', '-v'], { cwd: fileURLToPath(new URL('../../../../runtime/fractalmind-envd/', import.meta.url)), timeout: 30000, env: { ...process.env, FM_HOST_RESULT_ENCRYPTION_TEST_SECRET: bytesToHex(o.hostEncryptionSecret), FM_CHAIN_RESULT_KEY_CASE: JSON.stringify({ RPC: process.env.FM_LOCALNET_RPC ?? 'http://127.0.0.1:29000', PackageID: sdk.client.packageId, CapabilityID: capabilityId, Fingerprint: bytesToHex(nodeCommandIntentHash(first)), KeyVersion: 1, ExpectedKeyHash: bytesToHex(sha256(hostResultKey)) }) } });
  assert.ok(goKey.stdout.includes('--- PASS: TestChainCommandResultKeyLive'));
  const resultKeyEvidence = JSON.parse(/FM_RESULT_KEY_EVIDENCE (.+)/.exec(goKey.stdout)![1]);
  const repeat = await execute('Execution: exact claim retry does not create another checkpoint', await sdk.nodeExecution.prepareCommand({ ...authority, command: first, resultKey: { organizationKey: o.contentKey, keyVersion: 1n } }));
  assert.deepEqual(await sdk.nodeExecution.getResultKey(capabilityId, nodeCommandIntentHash(first), 1n), storedKey, 'Retry preserves the existing wrapping envelope.');
  assert.equal(repeat.data.status.success, true);
  const copiedKeyRequest = await execute('Result key: another sender cannot grant a device command key', await sdk.nodeExecution.prepareCommand({ ...authority, command: first, resultKey: { organizationKey: o.contentKey, keyVersion: 1n } }), o.wrongHost, undefined, true);
  assert.equal(copiedKeyRequest.data.status.success, false);
  assert.match(JSON.stringify(copiedKeyRequest.data.status), /9311/);
  const badKeyVersion = await execute('Result key: stale or future organization key generation is rejected atomically', await sdk.nodeExecution.prepareCommand({ ...authority, command: await newCommand(), resultKey: { organizationKey: o.contentKey, keyVersion: 2n } }), desktop, undefined, true);
  assert.equal(badKeyVersion.data.status.success, false);
  assert.match(JSON.stringify(badKeyVersion.data.status), /9311/);
  assert.equal((await sdk.remoteAuthority.getCapability(capabilityId)).usesClaimed, 1n);
  assert.equal((await sdk.remoteAuthority.getCapability(capabilityId)).budgetClaimed, 20n);
  await assertBudget(capabilityId, 0n, 20n, 'Exact retry preserves a single pending reservation');
  await assertClaim(first, 0n, false);
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
  const encryptedResult = await encryptCommandResult(plaintext, hostResultKey, recordContext(o.organizationId, 'checkpoint', logicalId, 1, 1));
  await assert.rejects(decryptCommandResult(encryptedResult, o.contentKey, recordContext(o.organizationId, 'checkpoint', logicalId, 1, 1)));
  hostResultKey.fill(0);
  const finishInput = { executionId: firstId, capabilityId, organizationId: o.organizationId, finalState: 2, expectedCursor: 2n, keyVersion: 1n, encryptedResult };
  const overSpent = await execute('Budget: actual cost above reservation is rejected', sdk.nodeExecution.finishCommand({ ...finishInput, spentAmount: 21n }), host, undefined, true);
  assert.equal(overSpent.data.status.success, false);
  assert.match(JSON.stringify(overSpent.data.status), /8319/);
  await assertBudget(capabilityId, 0n, 20n, 'Rejected overspend cannot release reservation');
  const wrongKey = await execute('Budget: failed result write rolls back settlement atomically', sdk.nodeExecution.finishCommand({ ...finishInput, spentAmount: 7n, encryptedResult: encryptedResult.slice(0, 31) }), host, undefined, true);
  assert.equal(wrongKey.data.status.success, false);
  assert.match(JSON.stringify(wrongKey.data.status), /9101/);
  assert.equal((await sdk.nodeExecution.getExecution(firstId)).state, 1);
  await assertBudget(capabilityId, 0n, 20n, 'Result write failure rolls back cost settlement');
  await assertClaim(first, 0n, false);
  const finished = await execute('Execution: Host persists encrypted terminal checkpoint result', sdk.nodeExecution.finishCommand({ executionId: firstId, capabilityId, spentAmount: 7n, organizationId: o.organizationId, finalState: 2, expectedCursor: 2n, keyVersion: 1n, encryptedResult }), host);
  assert.equal(finished.data.status.success, true);
  await assertBudget(capabilityId, 7n, 0n, 'Known result settles seven and releases thirteen');
  await assertClaim(first, 7n, true);
  const twice = await execute('Budget: already terminal command cannot settle a second cost', sdk.nodeExecution.finishCommand({ ...finishInput, spentAmount: 8n }), host, undefined, true);
  assert.equal(twice.data.status.success, false);
  assert.match(JSON.stringify(twice.data.status), /9305/);
  await assertBudget(capabilityId, 7n, 0n, 'Second result cannot change already settled cost');
  const resultId = (await sdk.nodeExecution.getExecution(firstId)).result_record!;
  assert.deepEqual((await sdk.productRecord.decryptRecord(resultId, o.contentKey)).plaintext, plaintext);
  await verifyGo(first, true);

  const second = await newCommand();
  const secondId = await prepare(second);
  await assertBudget(capabilityId, 7n, 20n, 'Next command reserves against actual plus pending budget');
  const wrong = await execute('Execution: another Host cannot start a valid queued command', sdk.nodeExecution.beginCommand({ ...prepareInput, executionId: secondId }), o.wrongHost, undefined, true);
  assert.equal(wrong.data.status.success, false);
  assert.match(JSON.stringify(wrong.data.status), /9302/);
  const early = await execute('Execution: result cannot precede a confirmed start', sdk.nodeExecution.finishCommand({ executionId: secondId, capabilityId, spentAmount: 0n, organizationId: o.organizationId, finalState: 2, expectedCursor: 1n, keyVersion: 1n, encryptedResult }), host, undefined, true);
  assert.equal(early.data.status.success, false);
  assert.match(JSON.stringify(early.data.status), /9305/);
  await execute('Execution: device cancels queued command before any start', sdk.nodeExecution.requestStop({ ...authority, capabilityId, executionId: secondId }));
  assert.equal((await sdk.nodeExecution.getExecution(secondId)).state, 5);
  await assertBudget(capabilityId, 7n, 0n, 'Queued cancellation releases reservation without refunding a use');
  await assertClaim(second, 0n, true);
  assert.equal((await sdk.remoteAuthority.getCapability(capabilityId)).usesClaimed, 2n);
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
  const missingKeyGrant = await execute('Result key: Host cannot publish command-derived body without a chain key grant', sdk.nodeExecution.finishCommand({ executionId: thirdId, capabilityId, spentAmount: 0n, organizationId: o.organizationId, finalState: 4, expectedCursor: 2n, keyVersion: 1n, encryptedResult: await encryptCommandResult(unknownPlaintext, commandResultKey(o.contentKey, o.organizationId, bytesToHex(nodeCommandIntentHash(third)), 1n), recordContext(o.organizationId, 'checkpoint', unknownLogicalId, 1, 1)) }), host, undefined, true);
  assert.equal(missingKeyGrant.data.status.success, false);
  assert.match(JSON.stringify(missingKeyGrant.data.status), /9311/);
  assert.equal((await sdk.nodeExecution.getExecution(thirdId)).state, 1);
  await execute('Execution: unknown result is persisted without granting replay', sdk.nodeExecution.finishCommand({ executionId: thirdId, capabilityId, spentAmount: 0n, organizationId: o.organizationId, finalState: 4, expectedCursor: 2n, keyVersion: 1n, encryptedResult: await encryptContent(unknownPlaintext, o.contentKey, recordContext(o.organizationId, 'checkpoint', unknownLogicalId, 1, 1)) }), host);
  assert.equal((await sdk.nodeExecution.getExecution(thirdId)).state, 4);
  await assertBudget(capabilityId, 7n, 20n, 'Unknown result retains entire pending reservation');
  await assertClaim(third, 0n, false);
  await verifyGo(third, true);
  await assertBudget(capabilityId, 7n, 20n, 'Duplicate query cannot release an unknown result reservation');

  const limited = await execute('Budget: issue thirty-unit capability for pending limit and stop checks', sdk.host.issueCapability({ ...authority, actions: ['assign'], scope: 'control', maxUses: 3n, budgetAsset: 'MIST', maxBudget: 30n, expiresAtMs: Date.now() + 3600000 }));
  const limitedId = created(limited.data, '::remote_authority::RemoteCapability');
  const limitedCommand = () => signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action: 'assign', scope: 'control', capability: { id: limitedId, revocationVersion: 1n }, budget: { asset: 'MIST', amount: 20n }, payload: { task: 'test pending budget and confirmed stop only; no adapter invoked' }, expiresAtMs: Date.now() + 300000 });
  const waiting = await limitedCommand();
  const waitingId = await prepare(waiting);
  const competing = await execute('Budget: pending reservation prevents oversubscribing remaining budget', await sdk.nodeExecution.prepareCommand({ ...authority, command: await limitedCommand() }), desktop, undefined, true);
  assert.equal(competing.data.status.success, false);
  assert.match(JSON.stringify(competing.data.status), /8309/);
  await assertBudget(limitedId, 0n, 20n, 'Pending twenty consumes twenty of thirty-unit budget');
  assert.equal((await sdk.remoteAuthority.getCapability(limitedId)).usesClaimed, 1n);
  await execute('Budget: cancel pending command to release budget', sdk.nodeExecution.requestStop({ ...authority, capabilityId: limitedId, executionId: waitingId }));
  await assertBudget(limitedId, 0n, 0n, 'Cancelled pending command restores available budget');
  const stoppedCommand = await limitedCommand();
  const stoppedId = await prepare(stoppedCommand);
  await verifyGo(stoppedCommand);
  await execute('Budget: request running stop while retaining pending reservation', sdk.nodeExecution.requestStop({ ...authority, capabilityId: limitedId, executionId: stoppedId }));
  const stopping = await sdk.nodeExecution.getExecution(stoppedId);
  assert.equal(stopping.state, 1);
  assert.equal(stopping.stop_requested, true);
  assert.equal(stopping.cursor, '3');
  await assertBudget(limitedId, 0n, 20n, 'Running stop request retains budget until Host confirms');
  const stopLogicalId = `command-${bytesToHex(nodeCommandIntentHash(stoppedCommand))}`;
  const stopPlaintext = JSON.stringify({ result: 'chain stop confirmation fixture; no physical adapter invoked', cost: '3' });
  const stopEncrypted = await encryptContent(new TextEncoder().encode(stopPlaintext), o.contentKey, recordContext(o.organizationId, 'checkpoint', stopLogicalId, 1, 1));
  await execute('Budget: Host confirms stop and settles known cost', sdk.nodeExecution.finishCommand({ executionId: stoppedId, capabilityId: limitedId, organizationId: o.organizationId, finalState: 5, expectedCursor: 3n, spentAmount: 3n, keyVersion: 1n, encryptedResult: stopEncrypted }), host);
  await assertBudget(limitedId, 3n, 0n, 'Confirmed stop settles three and releases seventeen');
  await assertClaim(stoppedCommand, 3n, true);
  await verifyGo(stoppedCommand, true);
  assert.equal((await sdk.remoteAuthority.getCapability(limitedId)).usesClaimed, 2n);
  const runtimeCapTx = await execute('Runtime store: issue two-use fixture adapter authority', sdk.host.issueCapability({ ...authority, actions: ['assign'], scope: 'control', maxUses: 2n, budgetAsset: 'MIST', maxBudget: 40n, expiresAtMs: Date.now() + 3600000 }));
  const runtimeCapabilityId = created(runtimeCapTx.data, '::remote_authority::RemoteCapability');
  const runtimeRecords: { logicalId: string; plaintext: string }[] = [];
  const runtimeExecutionIds: string[] = [];
  const runtimeStoreChecks: Record<string, unknown>[] = [];
  for (const known of [true, false]) {
    const command = await signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action: 'assign', scope: 'control', capability: { id: runtimeCapabilityId, revocationVersion: 1n }, budget: { asset: 'MIST', amount: 20n }, payload: { task: 'synthetic subprocess fixture; verify result transport and no replay' }, expiresAtMs: Date.now() + 300000 });
    runtimeExecutionIds.push(await prepare(command, true));
    const seed = decodeSuiPrivateKey(host.getSecretKey()).secretKey;
    try {
      const { stdout } = await promisify(execFile)('go', ['test', './internal/sui', '-run', '^TestChainRuntimeResultStoreLive$', '-count=1', '-v'], {
        cwd: fileURLToPath(new URL('../../../../runtime/fractalmind-envd/', import.meta.url)), timeout: 60000,
        env: { ...process.env, FM_CHAIN_EXECUTION_TEST_SEED: bytesToHex(seed), FM_HOST_RESULT_ENCRYPTION_TEST_SECRET: bytesToHex(o.hostEncryptionSecret), FM_CHAIN_RUNTIME_STORE_CASE: JSON.stringify({ RPC: process.env.FM_LOCALNET_RPC ?? 'http://127.0.0.1:29000', PackageID: sdk.client.packageId, Command: command, KnownSpend: known }) },
      });
      assert.ok(stdout.includes('--- PASS: TestChainRuntimeResultStoreLive'));
      const evidence = JSON.parse(/FM_RUNTIME_STORE_EVIDENCE (.+)/.exec(stdout)![1]);
      runtimeStoreChecks.push(evidence);
      const record = await sdk.productRecord.decryptRecord(evidence.recordId, o.contentKey);
      const plaintext = new TextDecoder().decode(record.plaintext);
      assert.equal(JSON.parse(plaintext).response.execution_state, known ? 'succeeded' : 'needs_confirmation');
      runtimeRecords.push({ logicalId: 'command-' + bytesToHex(nodeCommandIntentHash(command)), plaintext });
      console.log('Go chain result store PASS', evidence.state, 'one fixture subprocess; fresh executor restored encrypted result');
    } finally { seed.fill(0); }
  }
  await assertBudget(runtimeCapabilityId, 3n, 20n, 'Go executor settles known fixture cost and preserves unknown reservation');
  const factoryCapTx = await execute('Production factory: issue observation and control test authority', sdk.host.issueCapability({ ...authority, actions: ['status', 'assign'], scope: 'control', maxUses: 2n, budgetAsset: 'MIST', maxBudget: 40n, expiresAtMs: Date.now() + 3600000 }));
  assert.equal(factoryCapTx.data.status.success, true);
  const factoryCapabilityId = created(factoryCapTx.data, '::remote_authority::RemoteCapability');
  const factoryCommand = (action: 'status' | 'assign') => signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action, scope: 'control', capability: { id: factoryCapabilityId, revocationVersion: 1n }, budget: action === 'assign' ? { asset: 'MIST', amount: 20n } : undefined, payload: action === 'assign' ? { task: 'must be rejected by actual observation adapter before chain start' } : {}, expiresAtMs: Date.now() + 300000 });
  const observation = await factoryCommand('status');
  const forbiddenControl = await factoryCommand('assign');
  runtimeExecutionIds.push(await prepare(observation, true));
  const forbiddenExecutionId = await prepare(forbiddenControl, true);
  runtimeExecutionIds.push(forbiddenExecutionId);
  let productionFactoryEvidence: Record<string, unknown>;
  const factorySeed = decodeSuiPrivateKey(host.getSecretKey()).secretKey;
  try {
    const { stdout } = await promisify(execFile)('go', ['test', './cmd/envd', '-run', '^TestProductionChainRuntimeLive$', '-count=1', '-v'], {
      cwd: fileURLToPath(new URL('../../../../runtime/fractalmind-envd/', import.meta.url)), timeout: 60000,
      env: { ...process.env, FM_CHAIN_EXECUTION_TEST_SEED: bytesToHex(factorySeed), FM_HOST_RESULT_ENCRYPTION_TEST_SECRET: bytesToHex(o.hostEncryptionSecret), FM_PRODUCTION_CHAIN_RUNTIME_CASE: JSON.stringify({ RPC: process.env.FM_LOCALNET_RPC ?? 'http://127.0.0.1:29000', PackageID: sdk.client.packageId, Command: observation, ForbiddenCommand: forbiddenControl }) },
    });
    assert.ok(stdout.includes('--- PASS: TestProductionChainRuntimeLive'));
    const evidence = /FM_PRODUCTION_FACTORY_EVIDENCE (.+)/.exec(stdout)?.[1];
    assert.ok(evidence, 'Production factory must report confirmed chain result and restart evidence.');
    productionFactoryEvidence = JSON.parse(evidence);
    const record = await sdk.productRecord.decryptRecord(productionFactoryEvidence.recordId as string, o.contentKey);
    const plaintext = new TextDecoder().decode(record.plaintext);
    assert.equal(JSON.parse(plaintext).response.execution_state, 'succeeded');
    runtimeRecords.push({ logicalId: 'command-' + bytesToHex(nodeCommandIntentHash(observation)), plaintext });
    console.log('Production factory PASS chain authority/result, stable identity, restart deduplication and observation-only control refusal');
  } finally { factorySeed.fill(0); }
  assert.equal((await sdk.nodeExecution.getExecution(forbiddenExecutionId)).state, 0);
  await assertBudget(factoryCapabilityId, 0n, 20n, 'Observation factory never starts unsupported control');
  assert.equal((await execute('Production factory: device cancels unsupported queued control', sdk.nodeExecution.requestStop({ ...authority, capabilityId: factoryCapabilityId, executionId: forbiddenExecutionId }))).data.status.success, true);
  await assertBudget(factoryCapabilityId, 0n, 0n, 'Cancelled unsupported command releases pending budget');
  const paths = { 'file.read': ['.'], 'file.write': ['.'] };
  const okrAcceptance = process.env.FM_OKR_ACCEPTANCE === '1' ? await prepareOkrAcceptance(o, executionBoundaryHash(paths)) : undefined;
  const nativeCap = await execute('Native file Agent: issue two-run actual tool-call budget', okrAcceptance
    ? sdk.okr.issueCapability({ ...authority, okrId: okrAcceptance.okrId, expectedVersion: 2n, maxUses: 2n })
    : sdk.host.issueCapability({ ...authority, actions: ['assign'], scope: 'control', maxUses: 2n, budgetAsset: 'TOOL_CALLS', maxBudget: 14n, expiresAtMs: Date.now() + 3600000 }));
  assert.equal(nativeCap.data.status.success, true);
  const nativeCapabilityId = created(nativeCap.data, '::remote_authority::RemoteCapability');
  const nativeExpiresAtMs = okrAcceptance ? Number((await sdk.okr.getOkr(okrAcceptance.okrId)).expires_at_ms) - 1 : Date.now() + 300000;
  const fileGoals = [{ path: 'README.md', content: 'FractalMind: human-approved native goal\n' }, { path: 'RESULT.md', content: 'Measured by the Host file reader\n' }];
  const nativeCommand = (files: typeof fileGoals, maxCalls: bigint) => signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action: 'assign', scope: 'control', capability: { id: nativeCapabilityId, revocationVersion: 1n }, budget: { asset: 'TOOL_CALLS', amount: maxCalls }, payload: { task: JSON.stringify({ kind: 'ensure_text_files', files }), bounds: { paths, max_calls: maxCalls.toString() }, ...(okrAcceptance ? { okr: { id: okrAcceptance.okrId, agreement_version: '1', kr_index: '0' }, measurement: { kind: 'verified_text_file_count' } } : {}) }, expiresAtMs: nativeExpiresAtMs });
  const native = await nativeCommand(fileGoals, 10n);
  const nativeStopped = await nativeCommand([fileGoals[0], { path: 'after-stop.md', content: 'must not be written' }], 4n);
  if (okrAcceptance) {
    const signVariant = (payload: Record<string, unknown>, budgetAmount: bigint = 1n, capability = nativeCapabilityId) => signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action: 'assign', scope: 'control', capability: { id: capability, revocationVersion: 1n }, budget: { asset: 'TOOL_CALLS', amount: budgetAmount }, payload, expiresAtMs: nativeExpiresAtMs });
    const { okr: context, ...withoutContext } = native.payload!;
    const bypass = await signVariant(withoutContext);
    const denied = await execute('OKR binding: generic prepare cannot bypass OKR ledger', await sdk.nodeExecution.prepareCommand({ ...authority, command: bypass }), desktop, undefined, true);
    assert.equal(denied.data.status.success, false); assert.match(JSON.stringify(denied.data.status), /8321/);
    for (const [label, change, code] of [['stale agreement', { agreement_version: '2' }, '9402'], ['wrong KR cursor', { kr_index: '1' }, '9406']] as const) {
      const command = await signVariant({ ...native.payload, okr: { ...context as object, ...change } });
      const rejected = await execute('OKR binding: reject ' + label, await sdk.nodeExecution.prepareCommand({ ...authority, command }), desktop, undefined, true);
      assert.equal(rejected.data.status.success, false); assert.match(JSON.stringify(rejected.data.status), new RegExp(code));
    }
    assert.equal((await sdk.remoteAuthority.getCapability(nativeCapabilityId)).usesClaimed, 0n);
  }
  const nativeExecutionId = await prepare(native, true);
  if (okrAcceptance) {
    const retry = await execute('OKR binding: exact command retry does not reserve global budget twice', await sdk.nodeExecution.prepareCommand({ ...authority, command: native, resultKey: { organizationKey: o.contentKey, keyVersion: 1n } }));
    assert.equal(retry.data.status.success, true);
    assert.equal((await sdk.okr.getBudget(okrAcceptance.okrId)).reserved, 10n);
    assert.equal((await sdk.remoteAuthority.getCapability(nativeCapabilityId)).usesClaimed, 1n);
  }
  runtimeExecutionIds.push(nativeExecutionId, await prepare(nativeStopped, true));
  if (okrAcceptance) {
    const budget = await sdk.okr.getBudget(okrAcceptance.okrId);
    assert.equal(budget.spent, 0n); assert.equal(budget.reserved, 14n);
  }
  if (okrAcceptance) {
    const secondCap = await execute('OKR binding: issue second capability sharing global budget', sdk.okr.issueCapability({ ...authority, okrId: okrAcceptance.okrId, expectedVersion: 2n, maxUses: 1n }));
    assert.equal(secondCap.data.status.success, true);
    const secondCapabilityId = created(secondCap.data, '::remote_authority::RemoteCapability');
    const oversubscribed = await signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action: 'assign', scope: 'control', capability: { id: secondCapabilityId, revocationVersion: 1n }, budget: { asset: 'TOOL_CALLS', amount: 1n }, payload: { ...native.payload, bounds: { paths, max_calls: '1' } }, expiresAtMs: nativeExpiresAtMs });
    const denied = await execute('OKR binding: second capability cannot reset global pending budget', await sdk.nodeExecution.prepareCommand({ ...authority, command: oversubscribed }), desktop, undefined, true);
    assert.equal(denied.data.status.success, false); assert.match(JSON.stringify(denied.data.status), /9409/);
    assert.equal((await sdk.remoteAuthority.getCapability(secondCapabilityId)).usesClaimed, 0n);
    const genericInput = { ...authority, executionId: nativeExecutionId, capabilityId: nativeCapabilityId };
    const startBypass = await execute('OKR binding: generic start cannot bypass live OKR', sdk.nodeExecution.beginCommand(genericInput), host, undefined, true);
    assert.equal(startBypass.data.status.success, false); assert.match(JSON.stringify(startBypass.data.status), /8321/);
    const stopBypass = await execute('OKR binding: generic stop cannot leave global budget inconsistent', sdk.nodeExecution.requestStop(genericInput), desktop, undefined, true);
    assert.equal(stopBypass.data.status.success, false); assert.match(JSON.stringify(stopBypass.data.status), /8321/);
    const finishBypass = await execute('OKR binding: generic finish cannot leave global budget inconsistent', sdk.nodeExecution.finishCommand({ ...genericInput, finalState: 2, expectedCursor: 1n, spentAmount: 0n, keyVersion: 1n, encryptedResult: new Uint8Array() }), host, undefined, true);
    assert.equal(finishBypass.data.status.success, false); assert.match(JSON.stringify(finishBypass.data.status), /8321/);
  }
  const nativeSeed = decodeSuiPrivateKey(host.getSecretKey()).secretKey;
  const deviceSeed = decodeSuiPrivateKey(desktop.getSecretKey()).secretKey;
  let nativeFileAgentEvidence: Record<string, unknown>;
  try {
    const { stdout } = await promisify(execFile)('go', ['test', './cmd/envd', '-run', '^TestNativeChainFileAgentLive$', '-count=1', '-v'], {
      cwd: fileURLToPath(new URL('../../../../runtime/fractalmind-envd/', import.meta.url)), timeout: 120000,
      env: { ...process.env, FM_CHAIN_EXECUTION_TEST_SEED: bytesToHex(nativeSeed), FM_HOST_RESULT_ENCRYPTION_TEST_SECRET: bytesToHex(o.hostEncryptionSecret), FM_CHAIN_FILE_DEVICE_TEST_SEED: bytesToHex(deviceSeed), FM_CHAIN_FILE_AGENT_CASE: JSON.stringify({ RPC: process.env.FM_LOCALNET_RPC ?? 'http://127.0.0.1:29000', PackageID: sdk.client.packageId, Workspace: o.workspace, Command: native, StoppedCommand: nativeStopped }) },
    });
    assert.ok(stdout.includes('--- PASS: TestNativeChainFileAgentLive'));
    const evidence = /FM_NATIVE_FILE_AGENT_EVIDENCE (.+)/.exec(stdout)?.[1];
    assert.ok(evidence, 'Native file Agent must report actual effects, measurements and chain stop.');
    nativeFileAgentEvidence = JSON.parse(evidence);
    for (const [index, id] of (nativeFileAgentEvidence.recordIds as string[]).entries()) {
      const record = await sdk.productRecord.decryptRecord(id, o.contentKey);
      const plaintext = new TextDecoder().decode(record.plaintext);
      assert.equal(JSON.parse(plaintext).response.execution_state, index === 0 ? 'succeeded' : 'cancelled');
      runtimeRecords.push({ logicalId: 'command-' + bytesToHex(nodeCommandIntentHash(index === 0 ? native : nativeStopped)), plaintext });
    }
    console.log('Native file Agent PASS actual workspace goals, reader measurements, chain stop and factory restart restoration');
  } finally { nativeSeed.fill(0); deviceSeed.fill(0); }
  await assertBudget(nativeCapabilityId, 7n, 0n, 'Native Agent charges seven actual tool attempts and releases unused reservations');
  if (okrAcceptance) {
    const budget = await sdk.okr.getBudget(okrAcceptance.okrId);
    assert.equal(budget.spent, 7n); assert.equal(budget.reserved, 0n);
    const claim = await sdk.okr.getReservationBudget(okrAcceptance.okrId, nativeExecutionId);
    assert.equal(claim.spent, '6'); assert.equal(claim.settled, true);
  }
  const okrAcceptanceEvidence = okrAcceptance ? await okrAcceptance.finish(nativeExecutionId, (nativeFileAgentEvidence.recordIds as string[])[0], async step => {
    const payload = { okr: { id: step.okrId, agreement_version: step.agreementVersion, kr_index: step.krIndex }, measurement: { kind: 'verified_text_file_count' }, bounds: { paths, max_calls: step.maxCalls.toString() }, task: JSON.stringify({ kind: 'ensure_text_files', files: step.files }) };
    const signStep = (krIndex: string) => signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action: 'assign', scope: 'control', capability: { id: step.capabilityId, revocationVersion: 1n }, budget: { asset: 'TOOL_CALLS', amount: step.maxCalls }, payload: { ...payload, okr: { ...payload.okr, kr_index: krIndex } }, expiresAtMs: step.expiresAtMs });
    if (step.krIndex === '1') {
      const priorCursor = await signStep('0');
      const denied = await execute('OKR sequential: completed KR cannot reserve another execution', await sdk.nodeExecution.prepareCommand({ ...authority, command: priorCursor }), desktop, undefined, true);
      assert.equal(denied.data.status.success, false); assert.match(JSON.stringify(denied.data.status), /9406/);
      assert.equal((await sdk.remoteAuthority.getCapability(step.capabilityId)).usesClaimed, 1n);
    }
    const command = await signStep(step.krIndex);
    const executionId = await prepare(command, true); runtimeExecutionIds.push(executionId);
    const seed = decodeSuiPrivateKey(host.getSecretKey()).secretKey;
    try {
      const { stdout } = await promisify(execFile)('go', ['test', './cmd/envd', '-run', '^TestNativeChainSingleKrLive$', '-count=1', '-v'], {
        cwd: fileURLToPath(new URL('../../../../runtime/fractalmind-envd/', import.meta.url)), timeout: 90000,
        env: { ...process.env, FM_CHAIN_EXECUTION_TEST_SEED: bytesToHex(seed), FM_HOST_RESULT_ENCRYPTION_TEST_SECRET: bytesToHex(o.hostEncryptionSecret), FM_CHAIN_SINGLE_KR_CASE: JSON.stringify({ RPC: process.env.FM_LOCALNET_RPC ?? 'http://127.0.0.1:29000', PackageID: sdk.client.packageId, Workspace: o.workspace, Command: command, ExpectedToolCalls: Number(step.maxCalls) }) },
      });
      assert.ok(stdout.includes('--- PASS: TestNativeChainSingleKrLive'));
      const runtimeEvidence = JSON.parse(/FM_SINGLE_KR_EVIDENCE (.+)/.exec(stdout)![1]);
      assert.equal(runtimeEvidence.executionId, executionId); assert.equal(runtimeEvidence.contract.agreement_version, step.agreementVersion); assert.equal(runtimeEvidence.contract.kr_index, step.krIndex);
      const record = await sdk.productRecord.decryptRecord(runtimeEvidence.recordId, o.contentKey);
      const plaintext = new TextDecoder().decode(record.plaintext);
      assert.equal(JSON.parse(plaintext).response.execution_state, 'succeeded');
      runtimeRecords.push({ logicalId: 'command-' + bytesToHex(nodeCommandIntentHash(command)), plaintext });
      await assertBudget(step.capabilityId, step.krIndex === '0' ? 1n : 4n, 0n, 'Sequential KR actual tool costs accumulate without resetting global budget');
      console.log('Native sequential KR PASS', step.krIndex, 'actual files, new agreement and restored result');
      return { executionId, evidenceId: runtimeEvidence.recordId as string, runtimeEvidence };
    } finally { seed.fill(0); }
  }) : undefined;
  let unknownResultEvidence: Record<string, unknown> | undefined;
  if (okrAcceptance) {
    const okr = await sdk.okr.getOkr(okrAcceptance.unknownContext.okrId);
    const made = await execute('OKR unknown: issue transport-check capability with shared budget', sdk.okr.issueCapability({ ...authority, okrId: okr.id, expectedVersion: okr.version, maxUses: 1n }));
    assert.equal(made.data.status.success, true);
    const unknownCapabilityId = created(made.data, '::remote_authority::RemoteCapability');
    const signUnknown = (capabilityId: string, amount: bigint) => signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action: 'assign', scope: 'control', capability: { id: capabilityId, revocationVersion: 1n }, budget: { asset: 'TOOL_CALLS', amount }, payload: { okr: { id: okr.id, agreement_version: okr.agreement_version, kr_index: okr.next_kr }, bounds: { paths, max_calls: amount.toString() }, task: 'synthetic unknown-result transport check; no actual file Agent claim' }, expiresAtMs: Math.min(Date.now() + 300000, Number(okr.expires_at_ms) - 1) });
    const command = await signUnknown(unknownCapabilityId, 14n);
    const executionId = await prepare(command, true); runtimeExecutionIds.push(executionId);
    const seed = decodeSuiPrivateKey(host.getSecretKey()).secretKey;
    try {
      const { stdout } = await promisify(execFile)('go', ['test', './internal/sui', '-run', '^TestChainRuntimeResultStoreLive$', '-count=1', '-v'], {
        cwd: fileURLToPath(new URL('../../../../runtime/fractalmind-envd/', import.meta.url)), timeout: 60000,
        env: { ...process.env, FM_CHAIN_EXECUTION_TEST_SEED: bytesToHex(seed), FM_HOST_RESULT_ENCRYPTION_TEST_SECRET: bytesToHex(o.hostEncryptionSecret), FM_CHAIN_RUNTIME_STORE_CASE: JSON.stringify({ RPC: process.env.FM_LOCALNET_RPC ?? 'http://127.0.0.1:29000', PackageID: sdk.client.packageId, Command: command, KnownSpend: false }) },
      });
      assert.ok(stdout.includes('--- PASS: TestChainRuntimeResultStoreLive'));
      const runtimeEvidence = JSON.parse(/FM_RUNTIME_STORE_EVIDENCE (.+)/.exec(stdout)![1]);
      assert.equal(runtimeEvidence.state, 'needs_confirmation'); assert.equal(runtimeEvidence.reserved, '14'); assert.equal(runtimeEvidence.fixtureOnly, true);
      runtimeStoreChecks.push(runtimeEvidence);
      const record = await sdk.productRecord.decryptRecord(runtimeEvidence.recordId, o.contentKey);
      const plaintext = new TextDecoder().decode(record.plaintext);
      assert.equal(JSON.parse(plaintext).response.execution_state, 'needs_confirmation');
      runtimeRecords.push({ logicalId: 'command-' + bytesToHex(nodeCommandIntentHash(command)), plaintext });
      unknownResultEvidence = { okrId: okr.id, capabilityId: unknownCapabilityId, executionId, runtimeEvidence, unknownReservationRetained: true, actualAgentSideEffectsVerified: false };
    } finally { seed.fill(0); }
    await assertBudget(unknownCapabilityId, 0n, 14n, 'Unknown OKR transport result retains all capability budget');
    assert.equal((await sdk.okr.getBudget(okr.id)).reserved, 14n);
    const replacement = await execute('OKR unknown: issue second authority without resetting unknown reservation', sdk.okr.issueCapability({ ...authority, okrId: okr.id, expectedVersion: okr.version, maxUses: 1n }));
    assert.equal(replacement.data.status.success, true);
    const replacementId = created(replacement.data, '::remote_authority::RemoteCapability');
    const denied = await execute('OKR unknown: unresolved result prevents oversubscribing global budget', await sdk.nodeExecution.prepareCommand({ ...authority, command: await signUnknown(replacementId, 1n) }), desktop, undefined, true);
    assert.equal(denied.data.status.success, false); assert.match(JSON.stringify(denied.data.status), /9409/);
    assert.equal((await sdk.remoteAuthority.getCapability(replacementId)).usesClaimed, 0n);
    await verifyGo(command, true);
    const directory = await sdk.okr.listExecutions(okr.id);
    assert.equal(directory.executions.length, 1); assert.equal(directory.executions[0].run.state, 4); assert.equal(directory.executions[0].claim.settled, false);
  }
  const pendingCap = await execute('Execution: issue authority for revoke-after-prepare check', sdk.host.issueCapability({ ...authority, actions: ['assign'], scope: 'control', maxUses: 1n, budgetAsset: 'MIST', maxBudget: 100n, expiresAtMs: Date.now() + 3600000 }));
  const pendingCapabilityId = created(pendingCap.data, '::remote_authority::RemoteCapability');
  const pendingCommand = await signNodeCommand(desktop, { target: { organizationId: o.organizationId, nodeId: host.getPublicKey().toSuiAddress(), agentId: cap.agentId }, action: 'assign', scope: 'control', capability: { id: pendingCapabilityId, revocationVersion: 1n }, budget: { asset: 'MIST', amount: 20n }, payload: { task: 'must not begin after Host revocation' }, expiresAtMs: Date.now() + 300000 });
  const pendingId = await prepare(pendingCommand);
  return { capabilityId, limitedCapabilityId: limitedId, runtimeCapabilityId, factoryCapabilityId, nativeCapabilityId, executions: [firstId, secondId, thirdId, waitingId, stoppedId, ...runtimeExecutionIds], goChecks, budgetChecks, resultKeyEvidence, runtimeStoreChecks, productionFactoryEvidence, nativeFileAgentEvidence, okrAcceptanceEvidence, unknownResultEvidence, pendingStart: { ...authority, capabilityId: pendingCapabilityId, executionId: pendingId }, records: [{ logicalId, plaintext: new TextDecoder().decode(plaintext) }, { logicalId: unknownLogicalId, plaintext: new TextDecoder().decode(unknownPlaintext) }, { logicalId: stopLogicalId, plaintext: stopPlaintext }, ...runtimeRecords], checks: 'real chain budget/checkpoints, native bounded text-file goals, actual tool-call accounting and stop; generic model planning, command tools, financial metering and cloud deployment pending' };
}

/** Reconstruct the selected fixture budgets solely from their persisted chain
 * claims after Human recovery. Fixture IDs select the records under test; this
 * is not yet an App-wide discovery/index rebuild. */
export async function verifyExecutionBudgetRebuild(sdk: FractalMindSDK, executionIds: string[]) {
  const totals = new Map<string, { spent: bigint; reserved: bigint }>();
  const checkpoints: Record<string, unknown>[] = [];
  for (const id of executionIds) {
    const run = await sdk.nodeExecution.getExecution(id);
    const claim = await sdk.nodeExecution.getReservationBudget(run.capability_id, Uint8Array.from(run.intent_hash));
    assert.equal(claim.reservedAmount, BigInt(run.budget_amount));
    assert.equal(claim.settled, [2, 3, 5].includes(run.state));
    const sum = totals.get(run.capability_id) ?? { spent: 0n, reserved: 0n };
    sum.spent += claim.spentAmount;
    if (!claim.settled) sum.reserved += claim.reservedAmount;
    totals.set(run.capability_id, sum);
    checkpoints.push({ id, state: run.state, capabilityId: run.capability_id, spent: claim.spentAmount.toString(), reserved: claim.settled ? '0' : claim.reservedAmount.toString(), settled: claim.settled });
  }
  const ledgers: Record<string, unknown>[] = [];
  for (const [capabilityId, sum] of totals) {
    assert.deepEqual(await sdk.nodeExecution.getBudget(capabilityId), sum);
    assert.equal((await sdk.remoteAuthority.getCapability(capabilityId)).budgetClaimed, sum.spent + sum.reserved);
    ledgers.push({ capabilityId, spent: sum.spent.toString(), reserved: sum.reserved.toString() });
  }
  return { checkpoints, ledgers };
}
