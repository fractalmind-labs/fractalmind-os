import { bcs } from '@mysten/sui/bcs';
import type { Transaction, TransactionArgument } from '@mysten/sui/transactions';
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';
import { FractalMindClient, toBigInt } from './client.js';
import { canonicalNodeCommandSigningBytes } from './node-command.js';
import { bytesToHex, hexToBytes } from './identity-crypto.js';
import { bytesArgument } from './wire-bytes.js';
import type { SignedNodeCommand } from './types.js';

const ID = bcs.Address;
const Bytes = bcs.vector(bcs.u8());
const BudgetTotals = bcs.struct('BoundBudgetTotals', { spent: bcs.u64(), reserved: bcs.u64() });
const BudgetClaimKey = bcs.struct('BoundBudgetClaimKey', { intent_hash: Bytes });
const BudgetClaim = bcs.struct('BoundBudgetClaim', { reserved_amount: bcs.u64(), spent_amount: bcs.u64(), settled: bcs.bool() });
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
  async prepareCommand(input: Authority & { command: SignedNodeCommand; tx?: Transaction }) {
    await verifySignedNodeCommand(input.command);
    if (Boolean(input.command.target.agent_id) !== Boolean(input.managedAgentId)) throw new Error('Managed instance authority must match the command target.');
    const tx = this.fm.useTransaction(input.tx);
    const command = input.command;
    const args: TransactionArgument[] = [tx.object(command.capability.id), tx.object(command.target.organization_id), tx.object(input.humanId), tx.object(input.grantId), tx.object(input.membershipId), tx.object(input.bindingId)];
    if (input.managedAgentId) args.push(tx.object(input.managedAgentId));
    args.push(tx.pure.string(command.action), tx.pure.string(command.scope), tx.pure.string(command.command_id), tx.pure.string(command.nonce), tx.pure.string(command.idempotency_key), tx.pure.string(command.budget?.asset ?? ''), tx.pure.u64(toBigInt(command.budget?.amount ?? 0)), tx.pure.vector('u8', nodeCommandIntentHash(command)), tx.pure.u64(command.issued_at_ms), tx.pure.u64(command.expires_at_ms), tx.object('0x6'));
    tx.moveCall({ target: `${this.fm.packageId}::node_execution::prepare_${input.managedAgentId ? 'agent' : 'host'}_command`, arguments: args });
    return tx;
  }
  beginCommand(input: Authority & { executionId: string; capabilityId: string; organizationId: string; attemptId?: Uint8Array; tx?: Transaction }) {
    const tx = this.fm.useTransaction(input.tx);
    const args: TransactionArgument[] = [tx.object(input.executionId), tx.object(input.capabilityId), tx.object(input.organizationId), tx.object(input.humanId), tx.object(input.grantId), tx.object(input.membershipId), tx.object(input.bindingId)];
    if (input.managedAgentId) args.push(tx.object(input.managedAgentId));
    args.push(tx.pure.vector('u8', input.attemptId ?? globalThis.crypto.getRandomValues(new Uint8Array(32))), tx.object('0x6'));
    tx.moveCall({ target: `${this.fm.packageId}::node_execution::begin_${input.managedAgentId ? 'agent' : 'host'}_command`, arguments: args });
    return tx;
  }
  finishCommand(input: { executionId: string; capabilityId: string; organizationId: string; finalState: number; expectedCursor: bigint | string | number; spentAmount: bigint | string | number; keyVersion: bigint | string | number; encryptedResult: Uint8Array; tx?: Transaction }) {
    if (input.finalState === EXECUTION_STATES.needsConfirmation && toBigInt(input.spentAmount) !== 0n) throw new Error('Unknown execution cannot release its budget reservation.');
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({ target: `${this.fm.packageId}::node_execution::finish_command_with_budget`, arguments: [tx.object(input.executionId), tx.object(input.capabilityId), tx.object(input.organizationId), tx.pure.u8(input.finalState), tx.pure.u64(toBigInt(input.expectedCursor)), tx.pure.u64(toBigInt(input.spentAmount)), tx.pure.u64(toBigInt(input.keyVersion)), bytesArgument(tx, this.fm.packageId, input.encryptedResult), tx.object('0x6')] });
    return tx;
  }
  requestStop(input: { executionId: string; capabilityId: string; organizationId: string; humanId: string; grantId: string; tx?: Transaction }) {
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({ target: `${this.fm.packageId}::node_execution::request_stop_with_budget`, arguments: [tx.object(input.executionId), tx.object(input.capabilityId), tx.object(input.organizationId), tx.object(input.humanId), tx.object(input.grantId), tx.object('0x6')] });
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
}
