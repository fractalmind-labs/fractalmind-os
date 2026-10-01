import assert from 'node:assert/strict';
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { SuiClientTypes } from '@mysten/sui/client';
import type { Transaction } from '@mysten/sui/transactions';
import type { FractalMindSDK } from '../src/index.js';
import { createDeviceEncryptionKeys, createHostInviteMaterial, encodeHostInviteCode } from '../src/index.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { verifyGoAuthority } from './verify-go-authority.js';
import { exerciseNodeExecutions } from './node-execution-localnet-cases.js';

type Data = SuiClientTypes.Transaction<{ effects: true; objectTypes: true; events: true }>;
type Execute = (label: string, tx: Transaction, signer?: Ed25519Keypair, sponsor?: Ed25519Keypair, allowRejected?: boolean) => Promise<{ data: Data }>;
type Options = {
  sdk: FractalMindSDK; execute: Execute; created: (data: Data, suffix: string) => string;
  humanId: string; organizationId: string; rootGrantId: string; phoneGrantId: string;
  desktop: Ed25519Keypair; phone: Ed25519Keypair; faucet: string;
  contentKey: Uint8Array;
};
/** Chain integration, not a claim of two deployed runtime hosts. The following
 * runtime phase must start real envd processes and test routing and execution. */
export async function exerciseHostAdmission(o: Options) {
  const { sdk, execute, created, humanId, organizationId, rootGrantId, desktop } = o;
  const auth = { humanId, organizationId, grantId: rootGrantId };
  const local = Ed25519Keypair.generate();
  const cloud = Ed25519Keypair.generate();
  const localEncryption = createDeviceEncryptionKeys();
  const cloudEncryption = createDeviceEncryptionKeys();
  await Promise.all([local, cloud].map(signer => requestSuiFromFaucetV2({ host: o.faucet, recipient: signer.getPublicKey().toSuiAddress() })));
  const coordinator = Ed25519Keypair.generate();
  const madeBinding = await execute('Host: approve organization Coordinator entry', sdk.host.createCoordinatorBinding({ ...auth, publicKey: coordinator.getPublicKey().toRawBytes(), endpoint: 'http://127.0.0.1:19090' }));
  assert.equal(madeBinding.data.status.success, true);
  const bindingId = created(madeBinding.data, '::host::CoordinatorBinding');
  const binder = await sdk.host.getCoordinatorBinding(bindingId);
  assert.equal(binder.coordinator_address, coordinator.getPublicKey().toSuiAddress());
  async function makeInvite() {
    const material = createHostInviteMaterial('localnet');
    const result = await execute('Host: issue one-use invitation', sdk.host.createInvite({ ...auth, bindingId, proofPublicKey: material.publicKey, expiresAtMs: Date.now() + 600000 }));
    assert.equal(result.data.status.success, true);
    const inviteId = created(result.data, '::host::HostInvite');
    const code = encodeHostInviteCode('localnet', inviteId, material.entropy);
    material.entropy.fill(0);
    return { code, inviteId };
  }
  const first = await makeInvite();
  const joinLocal = await sdk.host.prepareJoin({ code: first.code, network: 'localnet', hostPublicKey: local.getPublicKey().toRawBytes(), encryptionPublicKey: localEncryption.publicKey, name: 'local integration Host' });
  const stolen = await execute('Host: copied proof cannot join as another sender', sdk.host.redeemInvite({ ...joinLocal.params, hostPublicKey: cloud.getPublicKey().toRawBytes(), encryptionPublicKey: cloudEncryption.publicKey, name: 'copied proof' }), cloud, undefined, true);
  assert.equal(stolen.data.status.success, false);
  assert.match(JSON.stringify(stolen.data.status), /9205/);
  assert.equal((await sdk.host.getInvite(first.inviteId)).uses, 0, 'Failed transaction must not consume an invite.');
  const joined = await execute('Host: valid proof consumes invite, creates membership and limited authority', joinLocal.transaction, local);
  assert.equal(joined.data.status.success, true);
  const localMemberId = created(joined.data, '::host::HostMembership');
  const localMember = await sdk.host.getMembership(localMemberId);
  const observation = await sdk.remoteAuthority.getCapability(localMember.observation_capability);
  assert.equal(observation.delegate, local.getPublicKey().toSuiAddress());
  assert.equal(observation.nodeId, local.getPublicKey().toSuiAddress());
  assert.equal(observation.maxBudget, 0n);
  assert.equal(observation.actions.includes('direct.message'), false);
  assert.equal((await sdk.host.getInvite(first.inviteId)).uses, 1);
  const consumed = await execute('Host: consumed invite cannot be revoked', sdk.host.revokeInvite({ ...auth, inviteId: first.inviteId }), desktop, undefined, true);
  assert.equal(consumed.data.status.success, false);
  assert.match(JSON.stringify(consumed.data.status), /9204/);

  const second = await makeInvite();
  await execute('Host: revoke an unused invitation', sdk.host.revokeInvite({ ...auth, inviteId: second.inviteId }));
  await assert.rejects(sdk.host.prepareJoin({ code: second.code, network: 'localnet', hostPublicKey: cloud.getPublicKey().toRawBytes(), encryptionPublicKey: cloudEncryption.publicKey, name: 'revoked' }), /revoked/);

  // A race uses different funded addresses/gas coins. The losing transaction
  // must fail because the shared invitation was consumed, not gas conflicts.
  const race = await makeInvite();
  const racer = Ed25519Keypair.generate();
  const racerEncryption = createDeviceEncryptionKeys();
  await requestSuiFromFaucetV2({ host: o.faucet, recipient: racer.getPublicKey().toSuiAddress() });
  const raceInputs = await Promise.all([
    sdk.host.prepareJoin({ code: race.code, network: 'localnet', hostPublicKey: cloud.getPublicKey().toRawBytes(), encryptionPublicKey: cloudEncryption.publicKey, name: 'cloud integration Host' }),
    sdk.host.prepareJoin({ code: race.code, network: 'localnet', hostPublicKey: racer.getPublicKey().toRawBytes(), encryptionPublicKey: racerEncryption.publicKey, name: 'competing Host' }),
  ]);
  const raced = await Promise.all(raceInputs.map((input, i) => execute(`Host: concurrent join candidate ${i + 1}`, input.transaction, [cloud, racer][i], undefined, true)));
  assert.equal(raced.filter(result => result.data.status.success).length, 1);
  const loser = raced.find(result => !result.data.status.success)!;
  assert.match(JSON.stringify(loser.data.status), /9204/);
  const cloudMemberId = created(raced.find(result => result.data.status.success)!.data, '::host::HostMembership');
  assert.notEqual(localMemberId, cloudMemberId);
  const idx = await sdk.host.getIndex(organizationId);
  assert.deepEqual(new Set(idx.memberships), new Set([localMemberId, cloudMemberId]));

  const membership = { ...auth, membershipId: localMemberId, bindingId };
  const workspaceHash = sha256(new TextEncoder().encode('/tmp/localnet-bound-workspace'));
  const observationImport = { ...membership, instanceId: 'existing-observed-agent', runtime: 'tmux-observe' as const, workspaceHash, controlConfirmed: false };
  const observed = await execute('Host: discover and explicitly import existing observation instance', sdk.host.importAgent(observationImport));
  assert.equal(observed.data.status.success, true);
  const observedId = created(observed.data, '::host::ManagedAgent');
  const repeat = await execute('Host: repeating import does not create a second record', sdk.host.importAgent(observationImport));
  assert.equal(repeat.data.status.success, true);
  assert.equal(Object.values(repeat.data.objectTypes ?? {}).some(type => type.endsWith('::host::ManagedAgent')), false);
  const conflictingImport = await execute('Host: repeated discovery cannot silently change workspace', sdk.host.importAgent({ ...observationImport, workspaceHash: sha256(new TextEncoder().encode('/another/workspace')) }), desktop, undefined, true);
  assert.equal(conflictingImport.data.status.success, false);
  assert.match(JSON.stringify(conflictingImport.data.status), /9207/);
  const sameName = await execute('Host: same instance name on another Host stays separate', sdk.host.importAgent({ ...observationImport, membershipId: cloudMemberId }));
  assert.equal(sameName.data.status.success, true);
  const sameNameId = created(sameName.data, '::host::ManagedAgent');
  assert.notEqual(sameNameId, observedId);
  const unsupported = await execute('Host: observation instance cannot receive execution authority', sdk.host.issueCapability({ ...membership, managedAgentId: observedId, actions: ['direct.message'], scope: 'direct', expiresAtMs: Date.now() + 3600000 }), desktop, undefined, true);
  assert.equal(unsupported.data.status.success, false);
  assert.match(JSON.stringify(unsupported.data.status), /9201/);
  const deniedConfirmation = await execute('Host: tmux self-report cannot become constrained runtime', sdk.host.importAgent({ ...membership, instanceId: 'false-control', runtime: 'tmux-observe', workspaceHash, controlConfirmed: true }), desktop, undefined, true);
  assert.equal(deniedConfirmation.data.status.success, false);
  assert.match(JSON.stringify(deniedConfirmation.data.status), /9201/);
  const controlled = await execute('Host: managing device confirms bounded adapter instance', sdk.host.importAgent({ ...membership, instanceId: 'bounded-agent', runtime: 'bounded-process-v1', workspaceHash, controlConfirmed: true }));
  assert.equal(controlled.data.status.success, true);
  const managedId = created(controlled.data, '::host::ManagedAgent');
  const capability = await execute('Host: issue exact-instance device execution authority', sdk.host.issueCapability({ ...membership, managedAgentId: managedId, actions: ['direct.message'], scope: 'direct', maxUses: 10n, budgetAsset: 'MIST', maxBudget: 100000000n, expiresAtMs: Date.now() + 3600000 }));
  assert.equal(capability.data.status.success, true);
  const capabilityId = created(capability.data, '::remote_authority::RemoteCapability');
  const cap = await sdk.remoteAuthority.getCapability(capabilityId);
  const authorityBinding = await sdk.host.getAuthorityBinding(capabilityId);
  assert.equal(cap.agentId, 'bounded-agent');
  assert.equal(cap.nodeId, local.getPublicKey().toSuiAddress());
  assert.equal(authorityBinding.device_grant, rootGrantId);
  assert.equal(authorityBinding.managed_agent, managedId);
  await verifyGoAuthority(sdk.client.packageId, capabilityId);
  const executions = process.env.FM_NODE_CHECKPOINT_ACCEPTANCE === '1' ? await exerciseNodeExecutions({ sdk, execute, created, organizationId, humanId, grantId: rootGrantId, membershipId: localMemberId, bindingId, managedAgentId: managedId, desktop, host: local, wrongHost: cloud, hostEncryptionSecret: localEncryption.secret, contentKey: o.contentKey }) : undefined;
  const deniedReadOnly = await execute('Host: read-only phone cannot acquire operation authority', sdk.host.issueCapability({ ...membership, grantId: o.phoneGrantId, managedAgentId: managedId, actions: ['direct.message'], scope: 'direct', expiresAtMs: Date.now() + 3600000 }), o.phone, undefined, true);
  assert.equal(deniedReadOnly.data.status.success, false);
  assert.match(JSON.stringify(deniedReadOnly.data.status), /9001/);
  await execute('Host: revoke admitted membership', sdk.host.revokeMembership({ ...auth, membershipId: localMemberId }));
  if (executions) {
    const stopped = await execute('Execution: Host revocation rejects an already reserved queued command', sdk.nodeExecution.beginCommand(executions.pendingStart), local, undefined, true);
    assert.equal(stopped.data.status.success, false);
    assert.match(JSON.stringify(stopped.data.status), /9203/);
    assert.equal((await sdk.nodeExecution.getExecution(executions.pendingStart.executionId)).state, 0);
  }
  const afterRevoke = await execute('Host: revoked membership prevents new execution grants', sdk.host.issueCapability({ ...membership, managedAgentId: managedId, actions: ['direct.message'], scope: 'direct', expiresAtMs: Date.now() + 3600000 }), desktop, undefined, true);
  assert.equal(afterRevoke.data.status.success, false);
  assert.match(JSON.stringify(afterRevoke.data.status), /9203/);
  await verifyGoAuthority(sdk.client.packageId, capabilityId, 'revoked');
  const replacement = await makeInvite();
  const newJoin = await sdk.host.prepareJoin({ code: replacement.code, network: 'localnet', hostPublicKey: local.getPublicKey().toRawBytes(), encryptionPublicKey: localEncryption.publicKey, name: 'explicitly re-admitted Host' });
  const rejoined = await execute('Host: explicit invitation admits same Host with new membership', newJoin.transaction, local);
  assert.equal(rejoined.data.status.success, true);
  const newMemberId = created(rejoined.data, '::host::HostMembership');
  const freshObservationCapabilityId = (await sdk.host.getMembership(newMemberId)).observation_capability;
  await verifyGoAuthority(sdk.client.packageId, freshObservationCapabilityId);
  const newMembership = { ...membership, membershipId: newMemberId };
  const implicitRebind = await execute('Host: discovery cannot implicitly re-authorize old managed instance', sdk.host.importAgent({ ...newMembership, instanceId: 'bounded-agent', runtime: 'bounded-process-v1', workspaceHash, controlConfirmed: true }), desktop, undefined, true);
  assert.equal(implicitRebind.data.status.success, false);
  assert.match(JSON.stringify(implicitRebind.data.status), /9207/);
  await execute('Host: management explicitly rebinds original managed ID', sdk.host.rebindAgent({ ...newMembership, managedAgentId: managedId, runtime: 'bounded-process-v1', workspaceHash, controlConfirmed: true }));
  const rebound = await sdk.host.getManagedAgent(managedId);
  assert.equal(rebound.version, '2');
  assert.equal(rebound.membership_id, newMemberId);
  assert.equal((await sdk.host.getAuthorityBinding(capabilityId)).managed_agent_version, '1');
  const freshCap = await execute('Host: re-authorized instance receives new version-bound capability', sdk.host.issueCapability({ ...newMembership, managedAgentId: managedId, actions: ['direct.message'], scope: 'direct', expiresAtMs: Date.now() + 3600000 }));
  assert.equal(freshCap.data.status.success, true);
  const freshCapabilityId = created(freshCap.data, '::remote_authority::RemoteCapability');
  assert.equal((await sdk.host.getAuthorityBinding(freshCapabilityId)).managed_agent_version, '2');
  await verifyGoAuthority(sdk.client.packageId, freshCapabilityId);
  const reconstructed = await sdk.host.listManagedAgents(organizationId);
  assert.equal(reconstructed.agents.length, 3);
  assert.equal(reconstructed.agents.find(agent => agent.id === observedId)!.control_confirmed, false);
  return { bindingId, localMembershipId: localMemberId, replacementMembershipId: newMemberId, secondMembershipId: cloudMemberId, managedAgentId: managedId, observationAgentId: observedId, sameNameOtherHostId: sameNameId, capabilityId, freshCapabilityId, freshObservationCapabilityId, executions, authorityReaderVerified: process.env.FM_HOST_AUTHORITY_VERIFY === '1', checks: 'chain admission and optional real Go authority reads; runtime execution and external cloud deployment pending' };
}
