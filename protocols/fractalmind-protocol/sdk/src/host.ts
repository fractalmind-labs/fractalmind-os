import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair, Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import type { Transaction, TransactionArgument } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { FractalMindClient, toBigInt } from './client.js';
import { bytesToHex, hexToBytes } from './identity-crypto.js';
import type { NetworkName } from './types.js';

const ID = bcs.Address;
const Bytes = bcs.vector(bcs.u8());
const Table = bcs.struct('Table', { id: ID, size: bcs.u64() });
export const HostIndexBcs = bcs.struct('HostIndex', { bindings: bcs.vector(ID), invitations: bcs.vector(ID), memberships: bcs.vector(ID), active_hosts: Table, instances: Table });
export const CoordinatorBindingBcs = bcs.struct('CoordinatorBinding', { id: ID, org_id: ID, coordinator_address: ID, public_key: Bytes, endpoint: bcs.string(), version: bcs.u64(), revoked: bcs.bool() });
export const HostInviteBcs = bcs.struct('HostInvite', {
  id: ID, org_id: ID, coordinator_binding: ID, binding_version: bcs.u64(), issuer_human: ID, issuer_device: ID, issuer_grant: ID,
  issuer_grant_version: bcs.u64(), issuer_generation: bcs.u64(), proof_public_key: Bytes, template_version: bcs.u64(),
  expires_at_ms: bcs.u64(), membership_ttl_ms: bcs.u64(), capability_ttl_ms: bcs.u64(), max_uses: bcs.u8(), uses: bcs.u8(), revoked: bcs.bool(),
});
export const HostMembershipBcs = bcs.struct('HostMembership', {
  id: ID, org_id: ID, host_address: ID, host_public_key: Bytes, encryption_public_key: Bytes, name: bcs.string(), coordinator_binding: ID,
  version: bcs.u64(), revoked: bcs.bool(), expires_at_ms: bcs.u64(), joined_at_ms: bcs.u64(), source_invite: ID, observation_capability: ID,
});
export const ManagedAgentBcs = bcs.struct('ManagedAgent', {
  id: ID, org_id: ID, membership_id: ID, host_address: ID, instance_id: bcs.string(), runtime: bcs.string(), workspace_hash: Bytes,
  control_confirmed: bcs.bool(), confirmed_by_human: ID, confirmed_by_device: ID, version: bcs.u64(), revoked: bcs.bool(), imported_at_ms: bcs.u64(),
});
export const AuthorityBindingBcs = bcs.struct('AuthorityBinding', {
  membership_id: ID, membership_version: bcs.u64(), managed_agent: bcs.option(ID), managed_agent_version: bcs.u64(),
  human_id: ID, device_grant: bcs.option(ID), device_grant_version: bcs.u64(), human_generation: bcs.u64(), required_action: bcs.u8(),
});
export const HostJoinIntentBcs = bcs.struct('JoinIntent', {
  domain: Bytes, invite_id: ID, org_id: ID, coordinator_binding: ID, binding_version: bcs.u64(),
  host_address: ID, host_public_key: Bytes, encryption_public_key: Bytes, proof_expires_at_ms: bcs.u64(),
});
type Authorized = { organizationId: string; humanId: string; grantId: string; tx?: Transaction };
type MembershipInput = Authorized & { membershipId: string; bindingId: string };
const utf8 = new TextEncoder();
const networks = new Set(['localnet', 'devnet', 'testnet', 'mainnet']);

function inviteSigner(entropy: Uint8Array, network: NetworkName): Ed25519Keypair {
  const seed = hkdf(sha256, entropy, utf8.encode('fractalmind.host-invite.v1'), utf8.encode(network), 32);
  try { return Ed25519Keypair.fromSecretKey(seed); } finally { seed.fill(0); }
}
export function createHostInviteMaterial(network: NetworkName) {
  if (!networks.has(network)) throw new Error('Unsupported invitation network.');
  const entropy = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const signer = inviteSigner(entropy, network);
  return { entropy, publicKey: signer.getPublicKey().toRawBytes() };
}
export function encodeHostInviteCode(network: NetworkName, inviteId: string, entropy: Uint8Array): string {
  if (!networks.has(network) || entropy.length !== 32) throw new Error('Invalid invitation material.');
  const prefix = `FHI1:${network}:${normalizeSuiAddress(inviteId)}:${bytesToHex(entropy)}`;
  return `${prefix}:${bytesToHex(sha256(utf8.encode(prefix))).slice(0, 8)}`;
}
export function parseHostInviteCode(code: string, network: NetworkName) {
  const parts = code.trim().split(':');
  if (parts.length !== 5 || parts[0] !== 'FHI1' || parts[1] !== network || !networks.has(network)
    || !/^0x[0-9a-f]{64}$/.test(parts[2]) || !/^[0-9a-f]{64}$/.test(parts[3]) || !/^[0-9a-f]{8}$/.test(parts[4])) throw new Error('Invalid invitation code or network.');
  if (bytesToHex(sha256(utf8.encode(parts.slice(0, 4).join(':')))).slice(0, 8) !== parts[4]) throw new Error('Invitation checksum does not match.');
  const entropy = hexToBytes(parts[3]);
  try { return { inviteId: parts[2], signer: inviteSigner(entropy, network) }; } finally { entropy.fill(0); }
}

/** agent-manager-v1: a Codex/Claude Agent run by agent-manager; controllable
 * through agent-manager (goals, stop, claimed evidence), not its tools. */
export type ManagedRuntime = 'tmux-observe' | 'bounded-process-v1' | 'agent-manager-v1';
export const CONTROLLABLE_RUNTIMES: readonly ManagedRuntime[] = ['bounded-process-v1', 'agent-manager-v1'];

export class HostApi {
  constructor(private readonly fm: FractalMindClient) {}
  private call(name: string, tx: Transaction, args: Parameters<Transaction['moveCall']>[0]['arguments']): Transaction {
    tx.moveCall({ target: `${this.fm.packageId}::host::${name}`, arguments: args });
    return tx;
  }
  private authorized(tx: Transaction, input: Authorized) { return [tx.object(input.organizationId), tx.object(input.humanId), tx.object(input.grantId)]; }
  createCoordinatorBinding(input: Authorized & { publicKey: Uint8Array; endpoint: string }): Transaction {
    const endpoint = new URL(input.endpoint);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/' || !['https:', 'http:'].includes(endpoint.protocol)) throw new Error('Coordinator endpoint must be an http(s) origin without credentials.');
    if (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) throw new Error('Remote coordinators require HTTPS.');
    const tx = this.fm.useTransaction(input.tx);
    return this.call('create_coordinator_binding', tx, [...this.authorized(tx, input), tx.pure.vector('u8', input.publicKey), tx.pure.string(endpoint.origin), tx.object('0x6')]);
  }
  createInvite(input: Authorized & { bindingId: string; proofPublicKey: Uint8Array; expiresAtMs: bigint | string | number; membershipTtlMs?: bigint | string | number; capabilityTtlMs?: bigint | string | number }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('create_invite', tx, [...this.authorized(tx, input), tx.object(input.bindingId), tx.pure.vector('u8', input.proofPublicKey), tx.pure.u64(toBigInt(input.expiresAtMs)), tx.pure.u64(toBigInt(input.membershipTtlMs ?? 30 * 86400000)), tx.pure.u64(toBigInt(input.capabilityTtlMs ?? 86400000)), tx.object('0x6')]);
  }
  revokeInvite(input: Authorized & { inviteId: string }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('revoke_invite', tx, [...this.authorized(tx, input), tx.object(input.inviteId), tx.object('0x6')]);
  }
  revokeMembership(input: Authorized & { membershipId: string }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('revoke_membership', tx, [...this.authorized(tx, input), tx.object(input.membershipId), tx.object('0x6')]);
  }
  redeemInvite(input: { organizationId: string; inviteId: string; bindingId: string; issuerHumanId: string; issuerGrantId: string; hostPublicKey: Uint8Array; encryptionPublicKey: Uint8Array; name: string; proofExpiresAtMs: bigint | string | number; proofSignature: Uint8Array; tx?: Transaction }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('redeem_invite', tx, [tx.object(input.organizationId), tx.object(input.inviteId), tx.object(input.bindingId), tx.object(input.issuerHumanId), tx.object(input.issuerGrantId), tx.pure.vector('u8', input.hostPublicKey), tx.pure.vector('u8', input.encryptionPublicKey), tx.pure.string(input.name), tx.pure.u64(toBigInt(input.proofExpiresAtMs)), tx.pure.vector('u8', input.proofSignature), tx.object('0x6')]);
  }
  async prepareJoin(input: { code: string; network: NetworkName; hostPublicKey: Uint8Array; encryptionPublicKey: Uint8Array; name: string; proofExpiresAtMs?: bigint | string | number }) {
    if (input.network !== this.fm.network) throw new Error('Invitation network does not match the configured client.');
    const code = parseHostInviteCode(input.code, input.network);
    const invite = await this.getInvite(code.inviteId);
    if (!invite.proof_public_key.every((byte, i) => byte === code.signer.getPublicKey().toRawBytes()[i]) || invite.proof_public_key.length !== 32 || invite.revoked || invite.uses !== 0) throw new Error('Invitation is revoked, consumed, or has different proof material.');
    const binding = await this.getCoordinatorBinding(invite.coordinator_binding);
    if (binding.revoked || binding.org_id !== invite.org_id || binding.version !== invite.binding_version) throw new Error('Coordinator binding changed or was revoked.');
    const { object: clock } = await this.fm.client.core.getObject({ objectId: '0x6', include: { content: true } });
    if (!clock.content) throw new Error('Chain Clock content is missing.');
    const now = BigInt(bcs.struct('Clock', { id: ID, timestamp_ms: bcs.u64() }).parse(clock.content).timestamp_ms);
    const expires = BigInt(invite.expires_at_ms);
    if (now >= expires) throw new Error('Invitation has expired.');
    const suggested = now + 120000n < expires ? now + 120000n : expires;
    const proofExpiresAtMs = toBigInt(input.proofExpiresAtMs ?? suggested);
    const hostAddress = new Ed25519PublicKey(input.hostPublicKey).toSuiAddress();
    const intent = HostJoinIntentBcs.serialize({ domain: utf8.encode('fractalmind.host-invite.v1'), invite_id: invite.id, org_id: invite.org_id, coordinator_binding: binding.id, binding_version: binding.version, host_address: hostAddress, host_public_key: input.hostPublicKey, encryption_public_key: input.encryptionPublicKey, proof_expires_at_ms: proofExpiresAtMs.toString() }).toBytes();
    const proofSignature = await code.signer.sign(intent);
    const params = { organizationId: invite.org_id, inviteId: invite.id, bindingId: binding.id, issuerHumanId: invite.issuer_human, issuerGrantId: invite.issuer_grant, hostPublicKey: input.hostPublicKey, encryptionPublicKey: input.encryptionPublicKey, name: input.name, proofExpiresAtMs, proofSignature };
    return { transaction: this.redeemInvite(params), params, binding, hostAddress };
  }
  importAgent(input: MembershipInput & { instanceId: string; runtime: ManagedRuntime; workspaceHash: Uint8Array; controlConfirmed: boolean }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('import_agent', tx, [...this.authorized(tx, input), tx.object(input.membershipId), tx.object(input.bindingId), tx.pure.string(input.instanceId), tx.pure.string(input.runtime), tx.pure.vector('u8', input.workspaceHash), tx.pure.bool(input.controlConfirmed), tx.object('0x6')]);
  }
  revokeAgent(input: Authorized & { managedAgentId: string }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    return this.call('revoke_agent', tx, [...this.authorized(tx, input), tx.object(input.managedAgentId), tx.object('0x6')]);
  }
  rebindAgent(input: MembershipInput & { managedAgentId: string; expectedVersion?: bigint | string | number; runtime: ManagedRuntime; workspaceHash: Uint8Array; controlConfirmed: boolean }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    const version = input.expectedVersion === undefined ? [] : [tx.pure.u64(toBigInt(input.expectedVersion))];
    return this.call(input.expectedVersion === undefined ? 'rebind_agent' : 'rebind_agent_at_version', tx, [...this.authorized(tx, input), tx.object(input.membershipId), tx.object(input.bindingId), tx.object(input.managedAgentId), ...version, tx.pure.string(input.runtime), tx.pure.vector('u8', input.workspaceHash), tx.pure.bool(input.controlConfirmed), tx.object('0x6')]);
  }
  issueCapability(input: MembershipInput & { managedAgentId?: string; actions: string[]; scope: string; maxUses?: bigint | string | number; budgetAsset?: string; maxBudget?: bigint | string | number; expiresAtMs: bigint | string | number }): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    const args: TransactionArgument[] = [...this.authorized(tx, input), tx.object(input.membershipId), tx.object(input.bindingId)];
    if (input.managedAgentId) args.push(tx.object(input.managedAgentId));
    args.push(tx.pure.vector('string', input.actions), tx.pure.string(input.scope), tx.pure.u64(toBigInt(input.maxUses ?? 100)), tx.pure.string(input.budgetAsset ?? ''), tx.pure.u64(toBigInt(input.maxBudget ?? 0)), tx.pure.u64(toBigInt(input.expiresAtMs)), tx.object('0x6'));
    return this.call(input.managedAgentId ? 'issue_agent_capability' : 'issue_device_capability', tx, args);
  }
  private async content(id: string, kind: string) {
    const { object } = await this.fm.client.core.getObject({ objectId: id, include: { content: true } });
    if (object.type !== await this.fm.coreType('host', kind) || !object.content) throw new Error(`Unexpected ${kind} object type or content.`);
    return object.content;
  }
  async getCoordinatorBinding(id: string) { return CoordinatorBindingBcs.parse(await this.content(id, 'CoordinatorBinding')); }
  async getInvite(id: string) { return HostInviteBcs.parse(await this.content(id, 'HostInvite')); }
  async getMembership(id: string) { return HostMembershipBcs.parse(await this.content(id, 'HostMembership')); }
  async getManagedAgent(id: string) { return ManagedAgentBcs.parse(await this.content(id, 'ManagedAgent')); }
  async getAuthorityBinding(capabilityId: string) {
    const field = await this.fm.client.core.getDynamicField({ parentId: capabilityId, name: { type: await this.fm.coreType('host', 'AuthorityBindingKey'), bcs: new Uint8Array([0]) } });
    return AuthorityBindingBcs.parse(field.dynamicField.value.bcs);
  }
  async getIndex(organizationId: string) {
    const field = await this.fm.client.core.getDynamicField({ parentId: organizationId, name: { type: await this.fm.coreType('host', 'HostIndexBinding'), bcs: new Uint8Array([0]) } });
    return HostIndexBcs.parse(field.dynamicField.value.bcs);
  }
  async listManagedAgents(organizationId: string, cursor?: string | null, limit = 50) {
    const index = await this.getIndex(organizationId);
    const page = await this.fm.client.core.listDynamicFields({ parentId: index.instances.id, cursor, limit });
    const pointers = await Promise.all(page.dynamicFields.map(async field => {
      const value = await this.fm.client.core.getDynamicField({ parentId: index.instances.id, name: field.name });
      return bcs.struct('InstancePointer', { record_id: ID, membership_id: ID, runtime: bcs.string(), workspace_hash: Bytes, control_confirmed: bcs.bool(), revoked: bcs.bool() }).parse(value.dynamicField.value.bcs);
    }));
    if (page.hasNextPage && (!page.cursor || page.cursor === cursor)) throw new Error('Managed-agent index returned an invalid cursor.');
    return { agents: await Promise.all(pointers.map(pointer => this.getManagedAgent(pointer.record_id))), cursor: page.hasNextPage ? page.cursor : null, hasNextPage: page.hasNextPage };
  }
}
