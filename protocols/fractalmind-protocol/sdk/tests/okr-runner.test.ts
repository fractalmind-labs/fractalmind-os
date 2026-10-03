import test from 'node:test';
import assert from 'node:assert/strict';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { normalizeSuiAddress as id } from '@mysten/sui/utils';
import type { ClientWithCoreApi } from '@mysten/sui/client';
import type { Transaction } from '@mysten/sui/transactions';
import { FractalMindSDK } from '../src/index.js';
import { NativeFileOkrRunner, parseNativeFileOkrPlan, type OkrRunnerCrypto, type OkrRunnerOptions } from '../src/okr-runner.js';
import { executionBoundaryHash } from '../src/execution-boundary.js';
import { EncryptedRecordBcs, recordContext } from '../src/product-record.js';
import { encryptContent } from '../src/identity-crypto.js';
import { nodeCommandIntentHash } from '../src/node-execution.js';
import type { SignedNodeCommand } from '../src/types.js';

const paths = { 'file.read': ['.'], 'file.write': ['.'] };
const plan = { format: 1, paths, krs: [{ files: [{ path: 'README.md', content: 'measurable result\n' }], maxCalls: '3' }] };

/** Mock only chain transport/state transitions. Encryption, record AAD,
 * Ed25519 signatures and ticket builders use production SDK code. Move and
 * actual Host execution are covered by the separate localnet acceptance. */
async function fixture() {
  const org = id('0x10'), human = id('0x11'), grant = id('0x12'), memberId = id('0x13'), managedId = id('0x14');
  const device = Ed25519Keypair.generate(), host = Ed25519Keypair.generate();
  const key = crypto.getRandomValues(new Uint8Array(32));
  const sdk = new FractalMindSDK({ packageId: id('0x42'), client: { core: {} } as unknown as ClientWithCoreApi });
  const metric = { baseline: '0', target: '1', weight: '1', max_age_ms: '1000', current: null as string | null, sampled_at_ms: '0', run_id: null as string | null, evidence_id: null as string | null, verified: false, verification_id: null };
  const okr = { id: id('0x20'), org_id: org, owner_human: human, logical_id: 'file-goal', state: 1, version: '2', agreement_version: '1', priority: 0, deadline_ms: '900000', spec_record: id('0x21'), spec_revision: '1', metrics: [metric], next_kr: '0', observations: { id: id('0x22'), size: '0' }, managed_agent: managedId, managed_version: '1', membership_id: memberId, membership_version: '1', workspace_hash: new Array(32).fill(7), boundary_hash: Array.from(executionBoundaryHash(paths)), budget_asset: 'TOOL_CALLS', budget_limit: '10', expires_at_ms: '500000', activated_at_ms: '90000', agreement_record: id('0x23'), acceptance_record: null, accepted_by_human: null, accepted_at_ms: '0' };
  const managed = { id: managedId, org_id: org, membership_id: memberId, host_address: host.toSuiAddress(), instance_id: 'native-file-agent', runtime: 'bounded-process-v1', workspace_hash: okr.workspace_hash, control_confirmed: true, confirmed_by_human: human, confirmed_by_device: device.toSuiAddress(), version: '1', revoked: false, imported_at_ms: '80000' };
  const member = { id: memberId, org_id: org, host_address: host.toSuiAddress(), host_public_key: Array.from(host.getPublicKey().toRawBytes()), encryption_public_key: new Array(32).fill(1), name: 'test', coordinator_binding: id('0x15'), version: '1', revoked: false, expires_at_ms: '800000', joined_at_ms: '80000', source_invite: id('0x16'), observation_capability: id('0x17') };
  const capability = { objectId: id('0x30'), type: `${sdk.client.typesPackageId}::remote_authority::RemoteCapability`, schemaVersion: 1, orgId: org, issuer: device.toSuiAddress(), delegate: device.toSuiAddress(), parentId: null, parentRevocationVersion: 0n, reservationScope: 'node' as const, targetKind: 3 as const, nodeId: host.toSuiAddress(), agentId: managed.instance_id, actions: ['assign'], scope: 'control', maxUses: 10n, usesClaimed: 0n, usesDelegated: 0n, budgetAsset: 'TOOL_CALLS', maxBudget: 10n, budgetClaimed: 0n, budgetDelegated: 0n, expiresAtMs: 700000n, revocationVersion: 1n, revoked: false };
  const binding = { membership_id: memberId, membership_version: '1', managed_agent: managedId, managed_agent_version: '1', human_id: human, device_grant: grant, device_grant_version: '1', human_generation: '1', required_action: 2 };
  const contract = { contract_id: okr.id, agreement_version: '1', boundary_hash: okr.boundary_hash };
  const policy = { approval_id: id('0x60'), agreement_version: '1', managed_version: '1', max_calls: '10', nonce: new Array(32).fill(3), proposal_hash: new Array(32).fill(4) };
  sdk.handover.getPolicy = async () => structuredClone(policy);
  const budget = { asset: 'TOOL_CALLS', spent: 0n, reserved: 0n, claimsId: id('0x31') };
  type Record = Awaited<ReturnType<typeof sdk.productRecord.getRecord>>;
  const records = new Map<string, Record>();
  async function makeRecord(recordId: string, name: string, kind: number, encryptedBody: Uint8Array) {
    return EncryptedRecordBcs.parse(EncryptedRecordBcs.serialize({ id: recordId, organization_id: org, kind, logical_id: name, revision: 1, key_version: 1, previous: null, writer_human: human, writer_device: device.toSuiAddress(), grant_id: grant, grant_version: 1, created_at_ms: 100000, encrypted_body: encryptedBody }).toBytes());
  }
  records.set(okr.agreement_record, await makeRecord(okr.agreement_record, 'okr-file-goal-agreement', 2,
    await encryptContent(new TextEncoder().encode(JSON.stringify({ nativeFilePlan: plan })), key, recordContext(org, 'contract', 'okr-file-goal-agreement', 1, 1))));
  const pending = new Map<Transaction, { body: Parameters<typeof sdk.productRecord.save>[0]; command?: SignedNodeCommand }>();
  let ticketId: string | undefined;
  let run: Awaited<ReturnType<typeof sdk.nodeExecution.getExecution>> | undefined;
  let calls = 0, prepares = 0, deliveries = 0, reads = 0;
  let mode: 'confirmed' | 'unknown' | 'unknown-committed' | 'rejected' = 'confirmed';
  let failDelivery = false, failDirectory = false, ticketLag = 0, runLag = 0;
  let onRead: (() => void) | undefined;
  const save = sdk.productRecord.save.bind(sdk.productRecord);
  sdk.productRecord.save = input => { const tx = save(input); pending.set(tx, { body: input }); return tx; };
  sdk.productRecord.getRecord = async recordId => { const record = records.get(recordId); assert.ok(record); return structuredClone(record); };
  sdk.productRecord.listCurrent = async () => {
    if (failDirectory) throw new Error('RPC unavailable');
    const visible = ticketId && (ticketLag === 0 || ticketLag-- < 0);
    return { records: visible ? [{ kind: 5, logicalId: records.get(ticketId!)!.logical_id, record_id: ticketId!, revision: '1', key_version: '1' }] : [], keyVersion: '1', cursor: null, hasNextPage: false };
  };
  sdk.okr.getOkr = async () => { reads++; onRead?.(); return structuredClone(okr); };
  sdk.okr.getBudget = async () => budget;
  sdk.okr.getCapabilityContract = async () => contract;
  sdk.host.getManagedAgent = async () => managed;
  sdk.host.getMembership = async () => member;
  sdk.host.getAuthorityBinding = async () => binding;
  sdk.remoteAuthority.getCapability = async () => capability;
  sdk.okr.listExecutions = async () => ({ executions: run && (runLag === 0 || runLag-- < 0) ? [{ run, claim: {} as never, contract: {} as never }] : [], cursor: null, hasNextPage: false });
  sdk.nodeExecution.prepareCommand = async input => {
    prepares++; assert.ok(input.tx); assert.ok(input.resultKey);
    assert.equal(input.resultKey.keyVersion, '1');
    if (input.resultKey.organizationKey) assert.deepEqual(input.resultKey.organizationKey, key);
    else { assert.equal(input.resultKey.wrappedKey.length, 132); assert.equal(input.resultKey.membershipId, memberId); }
    pending.get(input.tx)!.command = input.command;
    input.tx.moveCall({ target: `${sdk.client.packageId}::okr::prepare_command`, arguments: [] });
    return input.tx;
  };
  async function commit(tx: Transaction) {
    const staged = pending.get(tx)!; assert.ok(staged.command);
    assert.equal(staged.body.expectedRevision, 0n);
    // Both builders contribute to the same PTB. A confirmed mock transition
    // records them together; no execution authority is inferred from a ticket.
    assert.equal(tx.getData().commands.filter(command => command.$kind === 'MoveCall').length, 2);
    ticketId = id('0x50');
    records.set(ticketId, await makeRecord(ticketId, staged.body.logicalId, 5, staged.body.encryptedBody));
    const command = staged.command;
    run = { id: id('0x51'), org_id: org, capability_id: capability.objectId, capability_version: '1', human_id: human, grant_id: grant, grant_version: '1', membership_id: memberId, host_address: host.toSuiAddress(), managed_agent: managedId, delegate: command.signer, node_id: command.target.node_id, agent_id: command.target.agent_id!, command_id: command.command_id, nonce: command.nonce, idempotency_key: command.idempotency_key, intent_hash: Array.from(nodeCommandIntentHash(command)), action: command.action, scope: command.scope, budget_asset: 'TOOL_CALLS', budget_amount: command.budget!.amount, issued_at_ms: String(command.issued_at_ms), expires_at_ms: String(command.expires_at_ms), state: 0, cursor: '1', stop_requested: false, created_at_ms: '100000', started_at_ms: '0', updated_at_ms: '100000', result_record: null, result_hash: [], attempt_id: [] };
  }
  const options = { sdk, organizationId: org, humanId: human, grantId: grant, signer: device, now: () => 100000,
    keyForVersion: async () => key,
    submit: async (tx: Transaction) => { calls++; if (mode === 'confirmed' || mode === 'unknown-committed') await commit(tx); return { status: mode === 'unknown-committed' ? 'unknown' as const : mode, digest: 'test-digest' }; },
    deliver: async (_command: SignedNodeCommand) => { deliveries++; if (failDelivery) throw new Error('Delivery receipt lost'); run!.state = 1; },
  };
  const input = { okrId: okr.id, capabilityId: capability.objectId };
  return { options, input, okr, metric, managed, member, capability, binding, contract, policy, budget, key, records,
    runner: () => new NativeFileOkrRunner(options),
    mode: (value: typeof mode) => { mode = value; }, failDelivery: () => { failDelivery = true; }, allowDelivery: () => { failDelivery = false; }, failDirectory: () => { failDirectory = true; },
    lag: () => { ticketLag = 2; runLag = 2; },
    onRead: (callback: () => void) => { onRead = callback; }, stats: () => ({ calls, prepares, deliveries, reads }), run: () => run!, ticketId: () => ticketId!,
  };
}

test('native goal schema rejects unsafe paths, duplicate goals, oversized text and noncanonical budgets', () => {
  assert.deepEqual(parseNativeFileOkrPlan(plan), plan);
  for (const path of ['../secret', '/tmp/a', 'C:/a', '.git/config', 'a//b', '.codex/state', 'a\\b', 'CON.txt', 'com¹', 'name.', 'name ', 'SHORT~1', '.fractalmind-write-temp', '\ud800']) assert.throws(() => parseNativeFileOkrPlan({ ...plan, krs: [{ files: [{ path, content: '' }], maxCalls: '3' }] }));
  for (const maxCalls of ['03', '0', '1001', '-1', 3]) assert.throws(() => parseNativeFileOkrPlan({ ...plan, krs: [{ ...plan.krs[0], maxCalls }] }));
  assert.throws(() => parseNativeFileOkrPlan({ ...plan, krs: [{ files: [plan.krs[0].files[0], plan.krs[0].files[0]], maxCalls: '3' }] }));
  assert.throws(() => parseNativeFileOkrPlan({ ...plan, krs: [{ files: [{ path: 'a', content: '界'.repeat(6000) }], maxCalls: '3' }] }));
  assert.throws(() => parseNativeFileOkrPlan({ ...plan, arbitraryShell: 'run' }));
  assert.throws(() => parseNativeFileOkrPlan({ ...plan, paths: { 'file.write': ['/tmp'] } }));
  assert.throws(() => parseNativeFileOkrPlan({ ...plan, krs: [{ files: [{ path: 'a', content: '\ud800' }], maxCalls: '3' }] }));
});

test('device steps join one atomic ticket submission and fixed-instance delivery', async () => {
  const f = await fixture(), runner = f.runner();
  const results = await Promise.all([runner.step({ ...f.input, createIfMissing: true }), runner.step({ ...f.input, createIfMissing: true })]);
  assert.equal(results[0].status, 'running'); assert.deepEqual(results[0], results[1]);
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().prepares, 1); assert.equal(f.stats().deliveries, 1);
  assert.equal((await f.runner().step(f.input)).status, 'running'); assert.equal(f.stats().deliveries, 1);
  assert.ok(f.key.some(byte => byte !== 0), 'Caller-owned organization key must remain intact.');
});

test('displaying the approved plan does not sign, reserve, submit or deliver and rejects concurrent agreement drift', async () => {
  const f = await fixture();
  const description = await f.runner().describe(f.okr.id);
  assert.deepEqual(description.plan, plan);
  assert.equal(description.okr.id, f.okr.id);
  assert.equal(f.stats().calls, 0); assert.equal(f.stats().prepares, 0); assert.equal(f.stats().deliveries, 0);
  const changed = await fixture();
  changed.onRead(() => { if (changed.stats().reads === 2) changed.okr.version = '3'; });
  await assert.rejects(changed.runner().describe(changed.okr.id), /Agreement changed/);
  assert.equal(changed.stats().calls, 0);
});

test('unknown submission stays query-only; new runner defaults to restoration without signing or replay', async () => {
  const f = await fixture(); f.mode('unknown'); const runner = f.runner();
  assert.equal((await runner.step({ ...f.input, createIfMissing: true })).status, 'awaiting_confirmation');
  assert.equal((await runner.step({ ...f.input, createIfMissing: true })).status, 'awaiting_confirmation');
  assert.equal((await f.runner().step(f.input)).status, 'idle');
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().deliveries, 0);
});

test('lost submission receipt resolves from matching chain ticket and Run', async () => {
  const f = await fixture(); f.mode('unknown-committed');
  assert.equal((await f.runner().step({ ...f.input, createIfMissing: true })).status, 'running');
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().deliveries, 1);
});

test('confirmed effects with lagging ticket and Run indexes are resolved by reads without resubmission', async () => {
  const f = await fixture(); f.lag();
  assert.equal((await f.runner().step({ ...f.input, createIfMissing: true })).status, 'running');
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().prepares, 1); assert.equal(f.stats().deliveries, 1);
});

test('restored queued ticket requires explicit delivery release and reuses the signed command', async () => {
  const f = await fixture(); f.failDelivery();
  assert.equal((await f.runner().step({ ...f.input, createIfMissing: true })).reason, 'delivery_outcome_unknown');
  const originalId = f.run().command_id;
  assert.equal((await f.runner().step({ ...f.input, createIfMissing: true })).status, 'queued');
  assert.equal(f.stats().deliveries, 1);
  f.allowDelivery(); assert.equal((await f.runner().step({ ...f.input, releaseQueued: true })).status, 'running');
  assert.equal(f.run().command_id, originalId); assert.equal(f.stats().calls, 1); assert.equal(f.stats().prepares, 1);
});

test('unknown execution, succeeded-without-measurement and expired queued command never replay', async () => {
  for (const state of [4, 2, 0]) {
    const f = await fixture(); f.failDelivery(); await f.runner().step({ ...f.input, createIfMissing: true });
    f.run().state = state; if (state === 0) f.options.now = () => 499999;
    const outcome = await f.runner().step({ ...f.input, releaseQueued: true });
    assert.equal(outcome.status, state === 0 ? 'blocked' : 'awaiting_confirmation'); assert.equal(f.stats().deliveries, 1);
  }
});

test('lifecycle and measurement states do not approve or accept on behalf of the human', async () => {
  for (const state of [0, 2, 3, 4]) {
    const f = await fixture(); f.okr.state = state;
    assert.equal((await f.runner().step({ ...f.input, createIfMissing: true })).status, state === 3 ? 'achieved' : 'paused'); assert.equal(f.stats().calls, 0);
  }
  const f = await fixture(); f.metric.current = '1'; f.metric.sampled_at_ms = '100000'; f.metric.run_id = id('0x51'); f.metric.evidence_id = id('0x52');
  assert.equal((await f.runner().step({ ...f.input, createIfMissing: true })).status, 'awaiting_verification');
  f.metric.sampled_at_ms = '90000'; assert.equal((await f.runner().step(f.input)).reason, 'measurement_stale_or_future');
  f.okr.next_kr = '1'; assert.equal((await f.runner().step(f.input)).status, 'awaiting_acceptance'); assert.equal(f.stats().calls, 0);
});

test('changed bindings, revoked authority and shared or delegated budget exhaustions block before signing/submitting', async () => {
  for (const change of ['member', 'managed', 'workspace', 'revoked', 'budget', 'capBudget', 'contract', 'delegate']) {
    const f = await fixture();
    if (change === 'member') f.binding.membership_version = '2';
    if (change === 'managed') f.binding.managed_agent_version = '2';
    if (change === 'workspace') f.managed.workspace_hash = new Array(32).fill(9);
    if (change === 'revoked') f.capability.revoked = true;
    if (change === 'budget') f.budget.reserved = 8n;
    if (change === 'capBudget') f.capability.budgetDelegated = 8n;
    if (change === 'contract') f.contract.agreement_version = '2';
    if (change === 'delegate') f.capability.delegate = id('0xff');
    assert.equal((await f.runner().step({ ...f.input, createIfMissing: true })).status, 'awaiting_approval', change);
    assert.equal(f.stats().calls, 0); assert.equal(f.stats().prepares, 0); assert.equal(f.stats().deliveries, 0);
  }
});

test('agreement changed during planning and unavailable index cannot become an empty successful discovery', async () => {
  const f = await fixture(); f.onRead(() => { if (f.stats().reads === 2) f.okr.version = '3'; });
  assert.equal((await f.runner().step({ ...f.input, createIfMissing: true })).reason, 'agreement_changed_during_planning'); assert.equal(f.stats().calls, 0);
  const broken = await fixture(); broken.failDirectory();
  await assert.rejects(broken.runner().step({ ...broken.input, createIfMissing: true }), /RPC unavailable/); assert.equal(broken.stats().calls, 0);
});

test('authenticated ticket tampering and inconsistent chain Run metadata are rejected before recovered delivery', async () => {
  for (const change of ['ciphertext', 'run']) {
    const f = await fixture(); f.failDelivery(); await f.runner().step({ ...f.input, createIfMissing: true });
    if (change === 'ciphertext') f.records.get(f.ticketId())!.encrypted_body[40] ^= 1;
    else f.run().nonce = 'substituted';
    await assert.rejects(f.runner().step({ ...f.input, releaseQueued: true })); assert.equal(f.stats().deliveries, 1);
  }
});

test('known transaction rejection can be corrected explicitly without a permanent unknown receipt', async () => {
  const f = await fixture(), runner = f.runner(); f.mode('rejected');
  assert.equal((await runner.step({ ...f.input, createIfMissing: true })).reason, 'ticket_transaction_rejected');
  f.mode('confirmed'); assert.equal((await runner.step({ ...f.input, createIfMissing: true })).status, 'running'); assert.equal(f.stats().calls, 2);
});

test('reviewed policy versions and tool ceiling prevent a new ticket', async () => {
  for (const mode of ['agreement', 'instance', 'ceiling', 'capability ceiling']) {
    const f = await fixture();
    if (mode === 'agreement') f.policy.agreement_version = '2';
    if (mode === 'instance') f.policy.managed_version = '2';
    if (mode === 'ceiling') { f.policy.max_calls = '2'; f.capability.maxBudget = 2n; }
    if (mode === 'capability ceiling') f.policy.max_calls = '3';
    const result = await f.runner().step({ ...f.input, createIfMissing: true });
    assert.equal(result.reason, 'current_reviewed_policy_or_tool_ceiling_changed');
    assert.equal(f.stats().calls, 0); assert.equal(f.stats().prepares, 0); assert.equal(f.stats().deliveries, 0);
  }
});

test('policy replaced while device signing cannot release a new transaction', async () => {
  const f = await fixture(), device = f.options.signer;
  const runner = new NativeFileOkrRunner({ ...f.options, signer: {
    getPublicKey: () => device.getPublicKey(),
    sign: async bytes => { const signature = await device.sign(bytes); f.policy.nonce[0] ^= 1; return signature; },
  } });
  const result = await runner.step({ ...f.input, createIfMissing: true });
  assert.equal(result.reason, 'reviewed_policy_changed_during_signing');
  assert.equal(f.stats().calls, 0); assert.equal(f.stats().prepares, 0); assert.equal(f.stats().deliveries, 0);
});

test('restored queued ticket queries its original Run but cannot deliver under a replacement policy', async () => {
  const f = await fixture(); f.failDelivery();
  await f.runner().step({ ...f.input, createIfMissing: true });
  const commandId = f.run().command_id;
  f.policy.nonce[0] ^= 1;
  const result = await f.runner().step({ ...f.input, releaseQueued: true });
  assert.equal(result.reason, 'reviewed_policy_changed_before_delivery');
  assert.equal(f.run().command_id, commandId);
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().prepares, 1); assert.equal(f.stats().deliveries, 1);
});

test('native crypto preserves atomic preparation and query-only restoration without a runner key provider', async () => {
  const f = await fixture();
  const {keyForVersion: _unused, ...options} = f.options;
  let encryptions = 0, wraps = 0, retained: Uint8Array | undefined;
  const crypto: OkrRunnerCrypto = {
    decrypt: async record => (await options.sdk.productRecord.decryptRecord(record.id, f.key)).plaintext,
    encrypt: async (plaintext, context) => {
      encryptions++; retained = plaintext;
      return encryptContent(plaintext, f.key, recordContext(context.organizationId, 'checkpoint', context.logicalId, context.revision, context.keyVersion));
    },
    prepareCommand: async input => {
      wraps++;
      return options.sdk.nodeExecution.prepareCommand({...input, humanId: options.humanId, grantId: options.grantId,
        resultKey: {wrappedKey: new Uint8Array(132), keyVersion: input.keyVersion, organizationId: options.organizationId, capabilityId: input.command.capability.id, membershipId: input.membershipId, hostAddress: input.command.target.node_id, hostEncryptionPublicKey: new Uint8Array(32), intentHash: 'fixture'},
      });
    },
  };
  const native = new NativeFileOkrRunner({...options, crypto});
  assert.equal((await native.step({...f.input, createIfMissing: true})).status, 'running');
  assert.equal(encryptions, 1); assert.equal(wraps, 1);
  assert.ok(retained!.every(byte => byte === 0), 'Runner zeroes plaintext after native encryption returns.');
  assert.equal((await new NativeFileOkrRunner({...options, crypto}).step(f.input)).status, 'running');
  assert.equal(encryptions, 1); assert.equal(wraps, 1);
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().deliveries, 1);
  assert.throws(() => new NativeFileOkrRunner({...f.options, crypto} as unknown as OkrRunnerOptions), /exactly one/);
  assert.throws(() => new NativeFileOkrRunner(options as OkrRunnerOptions), /exactly one/);
});

test('persisted confirmed, rejected or unknown receipts stop a fresh runner before command signing and preparation', async () => {
  for (const status of ['confirmed', 'rejected', 'unknown', 'query-error'] as const) {
    const f = await fixture(), device = f.options.signer; let signatures = 0;
    f.options.sdk.productRecord.getRecord = async () => { throw new Error('Original receipt must precede private decryption.'); };
    const runner = new NativeFileOkrRunner({...f.options,
      signer: {getPublicKey: () => device.getPublicKey(), sign: async bytes => { signatures++; return device.sign(bytes); }},
      querySubmission: async () => { if (status === 'query-error') throw new Error('journal unavailable'); return {status, digest: 'original-digest'}; },
    });
    const result = await runner.step({...f.input, createIfMissing: true});
    assert.equal(result.status, status === 'rejected' ? 'blocked' : 'awaiting_confirmation');
    if (status !== 'query-error') assert.equal(result.transactionDigest, 'original-digest');
    assert.equal(signatures, 0); assert.equal(f.stats().calls, 0); assert.equal(f.stats().prepares, 0); assert.equal(f.stats().deliveries, 0);
  }
});

test('authoritative ticket point reads restore without pagination; native preparation cannot replace the ticket transaction', async () => {
  const f = await fixture(); f.options.sdk.productRecord.listCurrent = async () => { throw new Error('pagination must not establish absence'); };
  const runner = new NativeFileOkrRunner({...f.options, discoverTicket: async () => ({keyVersion: '1', ticketId: f.ticketId()})});
  assert.equal((await runner.step({...f.input, createIfMissing: true})).status, 'running');
  const broken = await fixture(), {keyForVersion: _unused, ...options} = broken.options;
  const bad = new NativeFileOkrRunner({...options, crypto: {
    decrypt: async record => (await options.sdk.productRecord.decryptRecord(record.id, broken.key)).plaintext,
    encrypt: async (plaintext, context) => encryptContent(plaintext, broken.key, recordContext(context.organizationId, 'checkpoint', context.logicalId, 1, context.keyVersion)),
    prepareCommand: async () => new (await import('@mysten/sui/transactions')).Transaction(),
  }});
  await assert.rejects(bad.step({...broken.input, createIfMissing: true}), /atomic ticket transaction/);
  assert.equal(broken.stats().calls, 0);
});

test('a delivery receipt does not establish RUNNING without matching chain progress', async () => {
  const f = await fixture(); f.options.deliver = async () => {};
  const result = await f.runner().step({...f.input, createIfMissing: true});
  assert.equal(result.status, 'awaiting_confirmation'); assert.equal(result.reason, 'awaiting_chain_execution_progress');
  assert.equal(f.run().state, 0);
});

test('preparing a new ticket can defer all delivery until explicit release of the same command', async () => {
  const f = await fixture(), runner = f.runner();
  const prepared = await runner.step({...f.input, createIfMissing: true, prepareOnly: true});
  assert.equal(prepared.status, 'queued'); assert.equal(f.stats().calls, 1); assert.equal(f.stats().deliveries, 0);
  const commandId = f.run().command_id;
  assert.equal((await f.runner().step(f.input)).status, 'queued'); assert.equal(f.stats().deliveries, 0);
  assert.equal((await runner.step({...f.input, releaseQueued: true})).status, 'running');
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().prepares, 1); assert.equal(f.stats().deliveries, 1);
  assert.equal(f.run().command_id, commandId);
});

test('explicit release is pinned to the reviewed Run, agreement and KR cursor', async () => {
  const f = await fixture(), runner = f.runner();
  const missing = await runner.step({...f.input, createIfMissing: true, expectedExecutionId: id('0x99')});
  assert.equal(missing.reason, 'reviewed_execution_not_found');
  assert.equal(f.stats().prepares, 0); assert.equal(f.stats().calls, 0);
  const prepared = await runner.step({...f.input, createIfMissing: true, prepareOnly: true});
  for (const changed of [
    {expectedExecutionId: id('0x99')},
    {expectedAgreementVersion: '2'},
    {expectedKrIndex: '1'},
  ]) {
    const refused = await runner.step({...f.input, releaseQueued: true, ...changed});
    assert.equal(refused.status, 'paused');
    assert.equal(f.stats().deliveries, 0);
  }
  assert.equal((await runner.step({...f.input, releaseQueued: true, expectedExecutionId: prepared.executionId, expectedAgreementVersion: '1', expectedKrIndex: '0'})).status, 'running');
  assert.equal(f.stats().deliveries, 1);
  assert.equal(f.stats().calls, 1);
});
