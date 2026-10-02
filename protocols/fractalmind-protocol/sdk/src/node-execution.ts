import { bcs } from '@mysten/sui/bcs';
import type { Transaction, TransactionArgument } from '@mysten/sui/transactions';
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import { deriveDynamicFieldID, normalizeSuiAddress } from '@mysten/sui/utils';
import { TypeTagSerializer } from '@mysten/sui/bcs';
import { FractalMindClient, toBigInt } from './client.js';
import { canonicalNodeCommandSigningBytes } from './node-command.js';
import { bytesToHex, hexToBytes, wrapKeys } from './identity-crypto.js';
import { commandResultKey, commandResultWrapContext } from './command-result-crypto.js';
import { HostApi, ManagedAgentBcs } from './host.js';
import { bytesArgument } from './wire-bytes.js';
import type { SignedNodeCommand } from './types.js';

const ID = bcs.Address;
const Bytes = bcs.vector(bcs.u8());
export const AgentExecutionIndexBcs = bcs.struct('AgentExecutionIndex', {
  executions: bcs.struct('Table', { id: ID, size: bcs.u64() }), unsettled_control: bcs.u64(), revision: bcs.u64(),
});
export const AgentExecutionPointerBcs = bcs.struct('AgentExecutionPointer', { capability_id: ID, control: bcs.bool(), settled: bcs.bool() });
export class AgentExecutionReadError extends Error {
  constructor(readonly code: 'coverage_unavailable' | 'invalid_source' | 'snapshot_changed', detail?: string) { super(detail ? `${code}: ${detail}` : code); }
}
const BudgetTotals = bcs.struct('BoundBudgetTotals', { spent: bcs.u64(), reserved: bcs.u64() });
const BudgetClaimKey = bcs.struct('BoundBudgetClaimKey', { intent_hash: Bytes });
const BudgetClaim = bcs.struct('BoundBudgetClaim', { reserved_amount: bcs.u64(), spent_amount: bcs.u64(), settled: bcs.bool() });
const ResultKeyName = bcs.struct('ResultKeyKey', { intent_hash: Bytes, key_version: bcs.u64() });
const ResultKeyGrant = bcs.struct('ResultKeyGrant', { org_id: ID, membership_id: ID, host_address: ID, key_version: bcs.u64(), wrapped_key: Bytes });
export const CommandExecutionBcs = bcs.struct('CommandExecution', {
  id: ID, org_id: ID, capability_id: ID, capability_version: bcs.u64(),
  human_id: ID, grant_id: ID, grant_version: bcs.u64(), membership_id: ID,
  host_address: ID, managed_agent: bcs.option(ID), delegate: ID, node_id: bcs.string(), agent_id: bcs.string(),
  command_id: bcs.string(), nonce: bcs.string(), idempotency_key: bcs.string(), intent_hash: Bytes,
  action: bcs.string(), scope: bcs.string(), budget_asset: bcs.string(), budget_amount: bcs.u64(),
  issued_at_ms: bcs.u64(), expires_at_ms: bcs.u64(), state: bcs.u8(), cursor: bcs.u64(), stop_requested: bcs.bool(),
  created_at_ms: bcs.u64(), started_at_ms: bcs.u64(), updated_at_ms: bcs.u64(), result_record: bcs.option(ID), result_hash: Bytes, attempt_id: Bytes,
});
export const EXECUTION_STATES = Object.freeze({ queued: 0, running: 1, succeeded: 2, failed: 3, needsConfirmation: 4, cancelled: 5 });
type Authority = { humanId: string; grantId: string; membershipId: string; bindingId: string; managedAgentId?: string };

export function nodeCommandSigningBytes(command: SignedNodeCommand): Uint8Array {
  return canonicalNodeCommandSigningBytes({
    version: command.version, commandId: command.command_id, signer: command.signer,
    target: { organizationId: command.target.organization_id, nodeId: command.target.node_id, agentId: command.target.agent_id ?? '' },
    action: command.action, scope: command.scope,
    capability: { id: command.capability.id, revocationVersion: toBigInt(command.capability.revocation_version) },
    nonce: command.nonce, issuedAtMs: command.issued_at_ms, expiresAtMs: command.expires_at_ms,
    idempotencyKey: command.idempotency_key, budget: command.budget ? { asset: command.budget.asset, amount: toBigInt(command.budget.amount) } : undefined,
    payloadHash: command.payload_hash,
  });
}
export function nodeCommandIntentHash(command: SignedNodeCommand) { return sha256(nodeCommandSigningBytes(command)); }
export async function verifySignedNodeCommand(command: SignedNodeCommand) {
  if (command.version !== '1') throw new Error('Unsupported command version.');
  const match = /^ed25519:([0-9a-f]{64}):([0-9a-f]{128})$/.exec(command.signature);
  if (!match) throw new Error('Invalid Ed25519 command signature.');
  const key = new Ed25519PublicKey(hexToBytes(match[1]));
  if (key.toSuiAddress() !== command.signer || !await key.verify(nodeCommandSigningBytes(command), hexToBytes(match[2]))) throw new Error('Command signature or signer does not match.');
  const payload = new TextEncoder().encode(JSON.stringify(command.payload));
  if (bytesToHex(sha256(payload)) !== command.payload_hash) throw new Error('Command payload was modified.');
}

export class NodeExecutionApi {
  constructor(private readonly fm: FractalMindClient) {}
  /** Complete instance history across capabilities and OKRs. Only known
   * terminal states with settled budget cease blocking handover. This is not
   * physical idle, current device permission or permission to continue. */
  async readAgentExecutions(organizationId: string, managedAgentId: string) {
    const org = normalizeSuiAddress(organizationId), managedId = normalizeSuiAddress(managedAgentId);
    const invalid = (): never => { throw new AgentExecutionReadError('invalid_source'); };
    const readManaged = async () => {
      const { object } = await this.fm.client.core.getObject({ objectId: managedId, include: { content: true } });
      if (object.objectId !== managedId || object.type !== `${this.fm.typesPackageId}::host::ManagedAgent` || object.owner.$kind !== 'Shared' || !object.content) invalid();
      const value = ManagedAgentBcs.parse(object.content!);
      if (value.id !== managedId || value.org_id !== org || value.workspace_hash.length !== 32 || BigInt(value.version) < 1n) invalid();
      return value;
    };
    const managed = await readManaged();
    const type = `${this.fm.typesPackageId}::host::AgentExecutionIndexKey`;
    const name = { type, bcs: ID.serialize(managedId).toBytes() };
    const absentId = deriveDynamicFieldID(org, TypeTagSerializer.parseFromStr(type), name.bcs);
    const readIndex = async () => {
      try {
        const { dynamicField } = await this.fm.client.core.getDynamicField({ parentId: org, name });
        if (dynamicField.value.type !== `${this.fm.typesPackageId}::host::AgentExecutionIndex`) invalid();
        const value = AgentExecutionIndexBcs.parse(dynamicField.value.bcs);
        if (BigInt(value.revision) < 1n || BigInt(value.unsettled_control) > BigInt(value.executions.size)) invalid();
        return { value, version: dynamicField.version };
      } catch (error) {
        if (error && typeof error === 'object' && 'reason' in error && error.reason === 'notFound' && 'objectId' in error && error.objectId === absentId) throw new AgentExecutionReadError('coverage_unavailable');
        throw error;
      }
    };
    const before = await readIndex(), executions = [];
    let cursor: string | null = null;
    const cursors = new Set<string>(), ids = new Set<string>();
    do {
      const page = await this.fm.client.core.listDynamicFields({ parentId: before.value.executions.id, cursor, limit: 100 });
      if (page.hasNextPage && (!page.cursor || cursors.has(page.cursor))) invalid();
      if (page.cursor) cursors.add(page.cursor);
      for (const field of page.dynamicFields) {
        if (field.name.type !== '0x2::object::ID' && field.name.type !== `${normalizeSuiAddress('0x2')}::object::ID`) invalid();
        const executionId = ID.parse(field.name.bcs);
        if (ids.has(executionId)) invalid();
        ids.add(executionId);
        const { dynamicField } = await this.fm.client.core.getDynamicField({ parentId: before.value.executions.id, name: field.name });
        if (dynamicField.value.type !== `${this.fm.typesPackageId}::host::AgentExecutionPointer`) invalid();
        const pointer = AgentExecutionPointerBcs.parse(dynamicField.value.bcs);
        const { object } = await this.fm.client.core.getObject({ objectId: executionId, include: { content: true } });
        if (object.objectId !== executionId || object.type !== `${this.fm.typesPackageId}::node_execution::CommandExecution` || object.owner.$kind !== 'Shared' || !object.content) invalid();
        const run = CommandExecutionBcs.parse(object.content!);
        const control = ['start', 'stop', 'assign', 'direct.message'].includes(run.action);
        if (!control && !['inventory', 'status', 'monitor', 'logs', 'health', 'availability'].includes(run.action)) invalid();
        const settled = [2, 3, 5].includes(run.state);
        if (run.id !== executionId || run.org_id !== org || run.managed_agent !== managedId || run.host_address !== managed.host_address || run.node_id !== managed.host_address || run.agent_id !== managed.instance_id || run.capability_id !== pointer.capability_id || run.state > 5 || run.intent_hash.length !== 32 || pointer.control !== control || pointer.settled !== settled) invalid();
        const budget = await this.getReservationBudget(run.capability_id, Uint8Array.from(run.intent_hash));
        if (budget.reservedAmount !== BigInt(run.budget_amount) || budget.settled !== settled) invalid();
        executions.push({ run, control, settled, spent: budget.spentAmount, reserved: settled ? 0n : budget.reservedAmount });
      }
      cursor = page.hasNextPage ? page.cursor : null;
    } while (cursor);
    const after = await readIndex();
    if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(managed) !== JSON.stringify(await readManaged())) throw new AgentExecutionReadError('snapshot_changed');
    const unsettledControl = executions.filter(row => row.control && !row.settled).length;
    if (BigInt(executions.length) !== BigInt(before.value.executions.size) || BigInt(unsettledControl) !== BigInt(before.value.unsettled_control))
      throw new AgentExecutionReadError('invalid_source', `directory size ${before.value.executions.size}, read ${executions.length}; unsettled ${before.value.unsettled_control}, read ${unsettledControl}`);
    return { managed, revision: before.value.revision, executions, unsettledControl };
  }
  async prepareCommand(input: Authority & { command: SignedNodeCommand; resultKey?: { organizationKey: Uint8Array; keyVersion: bigint | string | number }; tx?: Transaction }) {
    await verifySignedNodeCommand(input.command);
    if (Boolean(input.command.target.agent_id) !== Boolean(input.managedAgentId)) throw new Error('Managed instance authority must match the command target.');
    const tx = this.fm.useTransaction(input.tx);
    const command = input.command;
    const contract = command.payload?.okr as { id: string; agreement_version: string; kr_index: string } | undefined;
    if ('okr' in (command.payload ?? {})) {
      if (!contract || !input.managedAgentId || typeof contract.id !== 'string' || typeof contract.agreement_version !== 'string' || typeof contract.kr_index !== 'string' || normalizeSuiAddress(contract.id) !== contract.id || !/^[1-9][0-9]*$/.test(contract.agreement_version) || !/^[0-2]$/.test(contract.kr_index)) throw new Error('Invalid signed OKR context.');
    }
    if (input.resultKey) {
      const member = await new HostApi(this.fm).getMembership(input.membershipId);
      if (member.id !== normalizeSuiAddress(input.membershipId) || member.org_id !== normalizeSuiAddress(command.target.organization_id) || member.host_address !== normalizeSuiAddress(command.target.node_id)) throw new Error('Host membership does not match command key recipient.');
      const fingerprint = bytesToHex(nodeCommandIntentHash(command));
      const derived = commandResultKey(input.resultKey.organizationKey, command.target.organization_id, fingerprint, input.resultKey.keyVersion);
      let wrapped: Uint8Array;
      try { wrapped = await wrapKeys(derived, Uint8Array.from(member.encryption_public_key), commandResultWrapContext(command.target.organization_id, command.capability.id, input.membershipId, fingerprint, input.resultKey.keyVersion)); }
      finally { derived.fill(0); }
      tx.moveCall({ target: `${this.fm.packageId}::node_execution::grant_result_key`, arguments: [tx.object(command.capability.id), tx.object(command.target.organization_id), tx.object(input.humanId), tx.object(input.grantId), tx.object(input.membershipId), tx.object(input.bindingId), tx.pure.vector('u8', nodeCommandIntentHash(command)), tx.pure.u64(toBigInt(input.resultKey.keyVersion)), tx.pure.vector('u8', wrapped), tx.object('0x6')] });
    }
    const args: TransactionArgument[] = [tx.object(command.capability.id), tx.object(command.target.organization_id), tx.object(input.humanId), tx.object(input.grantId), tx.object(input.membershipId), tx.object(input.bindingId)];
    if (input.managedAgentId) args.push(tx.object(input.managedAgentId));
    if (contract) args.push(tx.pure.u64(toBigInt(contract.agreement_version)), tx.pure.u64(toBigInt(contract.kr_index)));
    args.push(tx.pure.string(command.action), tx.pure.string(command.scope), tx.pure.string(command.command_id), tx.pure.string(command.nonce), tx.pure.string(command.idempotency_key), tx.pure.string(command.budget?.asset ?? ''), tx.pure.u64(toBigInt(command.budget?.amount ?? 0)), tx.pure.vector('u8', nodeCommandIntentHash(command)), tx.pure.u64(command.issued_at_ms), tx.pure.u64(command.expires_at_ms), tx.object('0x6'));
    if (contract) args.unshift(tx.object(contract.id));
    tx.moveCall({ target: contract ? `${this.fm.packageId}::okr::prepare_command_v2` : `${this.fm.packageId}::node_execution::prepare_${input.managedAgentId ? 'agent_command_v2' : 'host_command'}`, arguments: args });
    return tx;
  }
  beginCommand(input: Authority & { executionId: string; capabilityId: string; organizationId: string; okrId?: string; attemptId?: Uint8Array; tx?: Transaction }) {
    const tx = this.fm.useTransaction(input.tx);
    const args: TransactionArgument[] = [tx.object(input.executionId), tx.object(input.capabilityId), tx.object(input.organizationId), tx.object(input.humanId), tx.object(input.grantId), tx.object(input.membershipId), tx.object(input.bindingId)];
    if (input.managedAgentId) args.push(tx.object(input.managedAgentId));
    args.push(tx.pure.vector('u8', input.attemptId ?? globalThis.crypto.getRandomValues(new Uint8Array(32))), tx.object('0x6'));
    if (input.okrId) { if (!input.managedAgentId) throw new Error('OKR commands require a managed Agent.'); args.unshift(tx.object(input.okrId)); }
    tx.moveCall({ target: input.okrId ? `${this.fm.packageId}::okr::begin_command` : `${this.fm.packageId}::node_execution::begin_${input.managedAgentId ? 'agent' : 'host'}_command`, arguments: args });
    return tx;
  }
  finishCommand(input: { executionId: string; capabilityId: string; organizationId: string; okrId?: string; finalState: number; expectedCursor: bigint | string | number; spentAmount: bigint | string | number; keyVersion: bigint | string | number; encryptedResult: Uint8Array; tx?: Transaction }) {
    if (input.finalState === EXECUTION_STATES.needsConfirmation && toBigInt(input.spentAmount) !== 0n) throw new Error('Unknown execution cannot release its budget reservation.');
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({ target: input.okrId ? `${this.fm.packageId}::okr::finish_command` : `${this.fm.packageId}::node_execution::finish_command_with_budget`, arguments: [...(input.okrId ? [tx.object(input.okrId)] : []), tx.object(input.executionId), tx.object(input.capabilityId), tx.object(input.organizationId), tx.pure.u8(input.finalState), tx.pure.u64(toBigInt(input.expectedCursor)), tx.pure.u64(toBigInt(input.spentAmount)), tx.pure.u64(toBigInt(input.keyVersion)), bytesArgument(tx, this.fm.packageId, input.encryptedResult), tx.object('0x6')] });
    return tx;
  }
  requestStop(input: { executionId: string; capabilityId: string; organizationId: string; humanId: string; grantId: string; okrId?: string; tx?: Transaction }) {
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({ target: input.okrId ? `${this.fm.packageId}::okr::request_stop_v2` : `${this.fm.packageId}::node_execution::request_stop_with_budget_v2`, arguments: [...(input.okrId ? [tx.object(input.okrId)] : []), tx.object(input.executionId), tx.object(input.capabilityId), tx.object(input.organizationId), tx.object(input.humanId), tx.object(input.grantId), tx.object('0x6')] });
    return tx;
  }
  async getBudget(capabilityId: string) {
    const field = await this.fm.client.core.getDynamicField({ parentId: capabilityId, name: { type: `${this.fm.typesPackageId}::remote_authority::BoundBudgetKey`, bcs: new Uint8Array([0]) } });
    if (field.dynamicField.value.type !== `${this.fm.typesPackageId}::remote_authority::BoundBudgetTotals`) throw new Error('Unexpected budget ledger type.');
    const value = BudgetTotals.parse(field.dynamicField.value.bcs);
    return { spent: BigInt(value.spent), reserved: BigInt(value.reserved) };
  }
  async getReservationBudget(capabilityId: string, intentHash: Uint8Array) {
    if (intentHash.length !== 32) throw new Error('Expected a 32-byte intent hash.');
    const field = await this.fm.client.core.getDynamicField({ parentId: capabilityId, name: { type: `${this.fm.typesPackageId}::remote_authority::BoundBudgetClaimKey`, bcs: BudgetClaimKey.serialize({ intent_hash: Array.from(intentHash) }).toBytes() } });
    if (field.dynamicField.value.type !== `${this.fm.typesPackageId}::remote_authority::BoundBudgetClaim`) throw new Error('Unexpected reservation ledger type.');
    const value = BudgetClaim.parse(field.dynamicField.value.bcs);
    if (BigInt(value.spent_amount) > BigInt(value.reserved_amount) || (!value.settled && BigInt(value.spent_amount) !== 0n)) throw new Error('Invalid reservation budget.');
    return { reservedAmount: BigInt(value.reserved_amount), spentAmount: BigInt(value.spent_amount), settled: value.settled };
  }
  async getExecution(id: string) {
    const { object } = await this.fm.client.core.getObject({ objectId: id, include: { content: true } });
    if (object.type !== `${this.fm.typesPackageId}::node_execution::CommandExecution` || !object.content) throw new Error('Unexpected execution object type or content.');
    const value = CommandExecutionBcs.parse(object.content);
    if (value.id !== id || value.state > 5 || value.intent_hash.length !== 32) throw new Error('Invalid execution checkpoint.');
    return value;
  }
  async getResultKey(capabilityId: string, intentHash: Uint8Array, keyVersion: bigint | string | number) {
    if (intentHash.length !== 32) throw new Error('Expected a 32-byte intent hash.');
    const field = await this.fm.client.core.getDynamicField({ parentId: capabilityId, name: { type: `${this.fm.typesPackageId}::node_execution::ResultKeyKey`, bcs: ResultKeyName.serialize({ intent_hash: Array.from(intentHash), key_version: toBigInt(keyVersion).toString() }).toBytes() } });
    if (field.dynamicField.value.type !== `${this.fm.typesPackageId}::node_execution::ResultKeyGrant`) throw new Error('Unexpected command result key type.');
    const value = ResultKeyGrant.parse(field.dynamicField.value.bcs);
    if (value.key_version !== toBigInt(keyVersion).toString() || value.wrapped_key.length !== 132) throw new Error('Invalid command result key grant.');
    return value;
  }
}
