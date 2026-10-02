import { bcs } from '@mysten/sui/bcs';
import type { Transaction, TransactionArgument } from '@mysten/sui/transactions';
import { normalizeSuiAddress, deriveDynamicFieldID } from '@mysten/sui/utils';
import { TypeTagSerializer } from '@mysten/sui/bcs';
import { FractalMindClient, toBigInt } from './client.js';
import { bytesArgument } from './wire-bytes.js';
import { NodeExecutionApi } from './node-execution.js';

const ID = bcs.Address;
const Bytes = bcs.vector(bcs.u8());
const Table = bcs.struct('Table', { id: ID, size: bcs.u64() });
export const OkrMetricBcs = bcs.struct('Metric', {
  baseline: bcs.u64(), target: bcs.u64(), weight: bcs.u64(), max_age_ms: bcs.u64(),
  current: bcs.option(bcs.u64()), sampled_at_ms: bcs.u64(), run_id: bcs.option(ID),
  evidence_id: bcs.option(ID), verified: bcs.bool(), verification_id: bcs.option(ID),
});
export const OkrBcs = bcs.struct('Okr', {
  id: ID, org_id: ID, owner_human: ID, logical_id: bcs.string(), state: bcs.u8(), version: bcs.u64(),
  agreement_version: bcs.u64(), priority: bcs.u8(), deadline_ms: bcs.u64(), spec_record: ID, spec_revision: bcs.u64(),
  metrics: bcs.vector(OkrMetricBcs), next_kr: bcs.u64(), observations: Table, managed_agent: bcs.option(ID), managed_version: bcs.u64(),
  membership_id: bcs.option(ID), membership_version: bcs.u64(), workspace_hash: Bytes, boundary_hash: Bytes,
  budget_asset: bcs.string(), budget_limit: bcs.u64(), expires_at_ms: bcs.u64(), activated_at_ms: bcs.u64(),
  agreement_record: bcs.option(ID), acceptance_record: bcs.option(ID), accepted_by_human: bcs.option(ID), accepted_at_ms: bcs.u64(),
});
const Index = bcs.struct('OkrIndex', { active_count: bcs.u64(), records: Table });
const Budget = bcs.struct('BudgetState', { asset: bcs.string(), spent: bcs.u64(), reserved: bcs.u64(), claims: Table });
const CommandContract = bcs.struct('CommandContractBinding', { contract_id: ID, agreement_version: bcs.u64(), kr_index: bcs.u64(), boundary_hash: Bytes });
const CapabilityContract = bcs.struct('ExecutionContractBinding', { contract_id: ID, agreement_version: bcs.u64(), boundary_hash: Bytes });
const CommandContractKey = bcs.struct('CommandContractKey', { intent_hash: Bytes });
const Claim = bcs.struct('BudgetClaim', { capability_id: ID, agreement_version: bcs.u64(), kr_index: bcs.u64(), reserved: bcs.u64(), spent: bcs.u64(), settled: bcs.bool() });
const Pointer = bcs.struct('DraftPointer', { id: ID, fingerprint: Bytes });
export const OkrObservationBcs = bcs.struct('Observation', {
  id: ID, org_id: ID, okr_id: ID, kr_index: bcs.u64(), agreement_version: bcs.u64(), current: bcs.u64(),
  sampled_at_ms: bcs.u64(), recorded_at_ms: bcs.u64(), run_id: ID, evidence_id: ID, host_address: ID,
});
export const OKR_STATES = Object.freeze({ draft: 0, active: 1, paused: 2, achieved: 3, archived: 4 } as const);
type U64 = bigint | string | number;
type Authorized = { organizationId: string; humanId: string; grantId: string; tx?: Transaction };
type Mutation = Authorized & { okrId: string; expectedVersion: U64 };
type Body = { keyVersion: U64; encryptedBody: Uint8Array };
type Criteria = { priority: number; deadlineMs: U64; baselines: U64[]; targets: U64[]; weights: U64[]; maxAgesMs: U64[] };

/** Builders retain signing and gas in the caller. Metrics are exact fixed-point
 * integers; units, scale, rules and success criteria live in encrypted specs. */
export class OkrApi {
  constructor(private readonly fm: FractalMindClient) {}
  private call(tx: Transaction, name: string, args: TransactionArgument[]) {
    tx.moveCall({ target: `${this.fm.okrPackageId}::okr::${name}`, arguments: args }); return tx;
  }
  private authorized(tx: Transaction, input: Authorized) { return [tx.object(input.organizationId), tx.object(input.humanId), tx.object(input.grantId)]; }
  private criteria(tx: Transaction, input: Criteria) {
    const n = input.baselines.length;
    if (n < 1 || n > 3 || [input.targets, input.weights, input.maxAgesMs].some(x => x.length !== n)) throw new Error('An OKR requires 1–3 complete measurable KRs.');
    if (!Number.isInteger(input.priority) || input.priority < 0 || input.priority > 2) throw new Error('Invalid OKR priority.');
    for (let i = 0; i < n; i++) {
      if (toBigInt(input.baselines[i]) === toBigInt(input.targets[i]) || toBigInt(input.weights[i]) < 1n || toBigInt(input.weights[i]) > 1000000n || toBigInt(input.maxAgesMs[i]) < 1n || toBigInt(input.maxAgesMs[i]) > 2592000000n) throw new Error('Invalid baseline, target, weight or sampling age.');
    }
    return [tx.pure.u8(input.priority), tx.pure.u64(toBigInt(input.deadlineMs)), ...[input.baselines, input.targets, input.weights, input.maxAgesMs].map(x => tx.pure.vector('u64', x.map(toBigInt)))];
  }
  private body(tx: Transaction, input: Body) { return [tx.pure.u64(toBigInt(input.keyVersion)), bytesArgument(tx, this.fm.packageId, input.encryptedBody)]; }
  createDraft(input: Authorized & Criteria & Body & { logicalId: string }) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, 'create_draft', [...this.authorized(tx, input), tx.pure.string(input.logicalId), ...this.criteria(tx, input), ...this.body(tx, input), tx.object('0x6')]);
  }
  /** @deprecated New protocol approvals require handover.confirmOkr; retained for historical package ABI. */
  activate(input: Mutation & Body & { membershipId: string; bindingId: string; managedAgentId: string; workspaceHash: Uint8Array; boundaryHash: Uint8Array; budgetAsset: string; budgetLimit: U64; expiresAtMs: U64; expectedRecordRevision: U64 }) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, 'activate', [tx.object(input.okrId), ...this.authorized(tx, input), tx.object(input.membershipId), tx.object(input.bindingId), tx.object(input.managedAgentId), tx.pure.u64(toBigInt(input.expectedVersion)), tx.pure.vector('u8', input.workspaceHash), tx.pure.vector('u8', input.boundaryHash), tx.pure.string(input.budgetAsset), tx.pure.u64(toBigInt(input.budgetLimit)), tx.pure.u64(toBigInt(input.expiresAtMs)), tx.pure.u64(toBigInt(input.expectedRecordRevision)), ...this.body(tx, input), tx.object('0x6')]);
  }
  pause(input: Mutation & Body & { expectedRecordRevision: U64 }) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, 'pause', [tx.object(input.okrId), ...this.authorized(tx, input), tx.pure.u64(toBigInt(input.expectedVersion)), tx.pure.u64(toBigInt(input.expectedRecordRevision)), ...this.body(tx, input), tx.object('0x6')]);
  }
  replaceSpec(input: Mutation & Criteria & Body) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, 'replace_spec', [tx.object(input.okrId), ...this.authorized(tx, input), tx.pure.u64(toBigInt(input.expectedVersion)), ...this.criteria(tx, input), ...this.body(tx, input), tx.object('0x6')]);
  }
  issueCapability(input: Mutation & { membershipId: string; bindingId: string; managedAgentId: string; maxUses: U64 }) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, 'issue_capability', [tx.object(input.okrId), ...this.authorized(tx, input), tx.object(input.membershipId), tx.object(input.bindingId), tx.object(input.managedAgentId), tx.pure.u64(toBigInt(input.expectedVersion)), tx.pure.u64(toBigInt(input.maxUses)), tx.object('0x6')]);
  }
  observe(input: { okrId: string; organizationId: string; membershipId: string; bindingId: string; managedAgentId: string; capabilityId: string; executionId: string; evidenceId: string; expectedVersion: U64; expectedAgreement: U64; krIndex: U64; current: U64; sampledAtMs: U64; tx?: Transaction }) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, 'observe', [tx.object(input.okrId), tx.object(input.organizationId), tx.object(input.membershipId), tx.object(input.bindingId), tx.object(input.managedAgentId), tx.object(input.capabilityId), tx.object(input.executionId), tx.object(input.evidenceId), ...[input.expectedVersion, input.expectedAgreement, input.krIndex, input.current, input.sampledAtMs].map(x => tx.pure.u64(toBigInt(x))), tx.object('0x6')]);
  }
  verifyKr(input: Mutation & Body & { krIndex: U64; expectedRecordRevision: U64 }) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, 'verify_kr', [tx.object(input.okrId), ...this.authorized(tx, input), tx.pure.u64(toBigInt(input.expectedVersion)), tx.pure.u64(toBigInt(input.krIndex)), tx.pure.u64(toBigInt(input.expectedRecordRevision)), ...this.body(tx, input), tx.object('0x6')]);
  }
  achieve(input: Mutation & Body & { successCriteriaConfirmed: boolean }) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, 'achieve', [tx.object(input.okrId), ...this.authorized(tx, input), tx.pure.u64(toBigInt(input.expectedVersion)), tx.pure.bool(input.successCriteriaConfirmed), ...this.body(tx, input), tx.object('0x6')]);
  }
  archive(input: Mutation) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, 'archive', [tx.object(input.okrId), ...this.authorized(tx, input), tx.pure.u64(toBigInt(input.expectedVersion)), tx.object('0x6')]);
  }
  async getBudget(okrId: string) {
    const field = await this.fm.client.core.getDynamicField({ parentId: okrId, name: { type: `${this.fm.okrTypesPackageId}::okr::BudgetKey`, bcs: new Uint8Array([0]) } });
    if (field.dynamicField.value.type !== `${this.fm.okrTypesPackageId}::okr::BudgetState`) throw new Error('Unexpected OKR budget type.');
    const value = Budget.parse(field.dynamicField.value.bcs);
    const okr = await this.getOkr(okrId);
    const spent = BigInt(value.spent), reserved = BigInt(value.reserved);
    if (value.asset !== okr.budget_asset || spent + reserved > BigInt(okr.budget_limit)) throw new Error('Invalid OKR budget totals.');
    return { asset: value.asset, spent, reserved, claimsId: value.claims.id };
  }
  async getReservationBudget(okrId: string, executionId: string) {
    const budget = await this.getBudget(okrId);
    const field = await this.fm.client.core.getDynamicField({ parentId: budget.claimsId, name: { type: '0x2::object::ID', bcs: ID.serialize(executionId).toBytes() } });
    if (field.dynamicField.value.type !== `${this.fm.okrTypesPackageId}::okr::BudgetClaim`) throw new Error('Unexpected OKR claim type.');
    const value = Claim.parse(field.dynamicField.value.bcs);
    if (BigInt(value.spent) > BigInt(value.reserved) || (!value.settled && BigInt(value.spent) !== 0n)) throw new Error('Invalid OKR claim.');
    return value;
  }
  async getCapabilityContract(capabilityId: string) {
    const field = await this.fm.client.core.getDynamicField({ parentId: capabilityId, name: { type: `${this.fm.typesPackageId}::remote_authority::ExecutionContractKey`, bcs: new Uint8Array([0]) } });
    if (field.dynamicField.value.type !== `${this.fm.typesPackageId}::remote_authority::ExecutionContractBinding`) throw new Error('Unexpected capability contract type.');
    const value = CapabilityContract.parse(field.dynamicField.value.bcs);
    if (value.agreement_version === '0' || value.boundary_hash.length !== 32) throw new Error('Invalid capability contract.');
    return value;
  }
  /** Enumerate every Run from the chain-owned OKR claims directory. Historical
   * agreements remain readable; this method never grants execution authority. */
  async listExecutions(okrId: string, cursor?: string | null, limit = 50) {
    const okr = await this.getOkr(okrId);
    if (okr.managed_agent === null) {
      if (![OKR_STATES.draft, OKR_STATES.archived].includes(okr.state as 0 | 4) || okr.budget_limit !== '0') throw new Error('Unexpected unassigned OKR.');
      return { executions: [], cursor: null, hasNextPage: false };
    }
    const budget = await this.getBudget(okrId);
    const page = await this.fm.client.core.listDynamicFields({ parentId: budget.claimsId, cursor, limit });
    if (page.hasNextPage && (!page.cursor || page.cursor === cursor)) throw new Error('Invalid execution page cursor.');
    const reader = new NodeExecutionApi(this.fm);
    const executions = await Promise.all(page.dynamicFields.map(async field => {
      if (field.name.type !== '0x2::object::ID' && field.name.type !== `${normalizeSuiAddress('0x2')}::object::ID`) throw new Error('Unexpected OKR claim key.');
      const executionId = ID.parse(field.name.bcs);
      const pointer = await this.fm.client.core.getDynamicField({ parentId: budget.claimsId, name: field.name });
      if (pointer.dynamicField.value.type !== `${this.fm.okrTypesPackageId}::okr::BudgetClaim`) throw new Error('Unexpected OKR claim type.');
      const claim = Claim.parse(pointer.dynamicField.value.bcs);
      const run = await reader.getExecution(executionId);
      const binding = await this.fm.client.core.getDynamicField({ parentId: run.capability_id, name: { type: `${this.fm.typesPackageId}::remote_authority::CommandContractKey`, bcs: CommandContractKey.serialize({ intent_hash: run.intent_hash }).toBytes() } });
      if (binding.dynamicField.value.type !== `${this.fm.typesPackageId}::remote_authority::CommandContractBinding`) throw new Error('Unexpected execution contract type.');
      const contract = CommandContract.parse(binding.dynamicField.value.bcs);
      const localClaim = await reader.getReservationBudget(run.capability_id, Uint8Array.from(run.intent_hash));
      if (localClaim.reservedAmount !== BigInt(claim.reserved) || localClaim.spentAmount !== BigInt(claim.spent) || localClaim.settled !== claim.settled) throw new Error('OKR and capability budget claims differ.');
      const settled = run.state === 2 || run.state === 3 || run.state === 5;
      if (run.org_id !== okr.org_id || contract.contract_id !== okr.id || claim.capability_id !== run.capability_id || contract.agreement_version !== claim.agreement_version || contract.kr_index !== claim.kr_index || contract.boundary_hash.length !== 32 || claim.reserved !== run.budget_amount || BigInt(claim.spent) > BigInt(claim.reserved) || claim.settled !== settled || (!settled && BigInt(claim.spent) !== 0n) || run.budget_asset !== budget.asset) throw new Error('Inconsistent OKR execution binding or budget.');
      return { run, claim, contract };
    }));
    return { executions, cursor: page.hasNextPage ? page.cursor : null, hasNextPage: page.hasNextPage };
  }
  async getOkr(id: string) {
    const { object } = await this.fm.client.core.getObject({ objectId: id, include: { content: true } });
    if (object.type !== `${this.fm.okrTypesPackageId}::okr::Okr` || !object.content || object.owner.$kind !== 'Shared') throw new Error('Unexpected OKR type, body or owner.');
    const value = OkrBcs.parse(object.content);
    if (normalizeSuiAddress(value.id) !== normalizeSuiAddress(id) || value.state > 4 || value.metrics.length < 1 || value.metrics.length > 3 || BigInt(value.next_kr) > BigInt(value.metrics.length)) throw new Error('Invalid OKR identity or state.');
    return value;
  }
  indexName() {
    return this.fm.okrTypesPackageId === this.fm.typesPackageId
      ? { type: `${this.fm.okrTypesPackageId}::okr::IndexKey`, bcs: new Uint8Array([0]) }
      : { type: `${this.fm.typesPackageId}::execution_extension::FieldKey<${this.fm.okrTypesPackageId}::okr::Witness>`, bcs: Bytes.serialize(Array.from(new TextEncoder().encode('okr-index'))).toBytes() };
  }
  isMissingIndex(error: unknown, organizationId: string) {
    const name = this.indexName(), expected = deriveDynamicFieldID(normalizeSuiAddress(organizationId), TypeTagSerializer.parseFromStr(name.type), name.bcs);
    return Boolean(error && typeof error === 'object' && 'reason' in error && error.reason === 'notFound' && 'objectId' in error && error.objectId === expected);
  }
  async getIndex(organizationId: string) {
    const field = await this.fm.client.core.getDynamicField({ parentId: organizationId, name: this.indexName() });
    if (field.dynamicField.value.type !== `${this.fm.okrTypesPackageId}::okr::OkrIndex`) throw new Error('Unexpected OKR index source.');
    const value = Index.parse(field.dynamicField.value.bcs);
    if (BigInt(value.active_count) > 3n) throw new Error('Invalid OKR active count.'); return value;
  }
  async listObservations(okrId: string, cursor?: string | null, limit = 50) {
    const okr = await this.getOkr(okrId);
    const page = await this.fm.client.core.listDynamicFields({ parentId: okr.observations.id, cursor, limit });
    if (page.hasNextPage && (!page.cursor || page.cursor === cursor)) throw new Error('Invalid observation cursor.');
    const observations = await Promise.all(page.dynamicFields.map(async field => {
      const pointer = await this.fm.client.core.getDynamicField({ parentId: okr.observations.id, name: field.name });
      const id = ID.parse(pointer.dynamicField.value.bcs);
      const { object } = await this.fm.client.core.getObject({ objectId: id, include: { content: true } });
      if (object.type !== `${this.fm.okrTypesPackageId}::okr::Observation` || !object.content || object.owner.$kind !== 'Immutable') throw new Error('Unexpected observation type, content or owner.');
      const observation = OkrObservationBcs.parse(object.content);
      if (observation.id !== id || observation.okr_id !== okr.id || observation.org_id !== okr.org_id) throw new Error('Observation identity or scope mismatch.');
      return observation;
    }));
    return { observations, cursor: page.hasNextPage ? page.cursor : null, hasNextPage: page.hasNextPage };
  }
  async listOkrs(organizationId: string, cursor?: string | null, limit = 50) {
    const index = await this.getIndex(organizationId);
    const page = await this.fm.client.core.listDynamicFields({ parentId: index.records.id, cursor, limit });
    if (page.hasNextPage && (!page.cursor || page.cursor === cursor)) throw new Error('Invalid OKR page cursor.');
    const okrs = await Promise.all(page.dynamicFields.map(async field => {
      const pointer = await this.fm.client.core.getDynamicField({ parentId: index.records.id, name: field.name });
      const okr = await this.getOkr(Pointer.parse(pointer.dynamicField.value.bcs).id);
      if (okr.org_id !== normalizeSuiAddress(organizationId)) throw new Error('Cross-organization OKR.'); return okr;
    }));
    return { okrs, cursor: page.hasNextPage ? page.cursor : null, hasNextPage: page.hasNextPage };
  }
}

/** Progress is independent of verification/acceptance. Missing or expired
 * observations stay unknown; BigInt arithmetic preserves large fixed values. */
export function metricProgress(input: { baseline: U64; target: U64; current: U64 | null; sampledAtMs: U64; maxAgeMs: U64 }, nowMs: U64): number | null {
  const baseline = toBigInt(input.baseline), target = toBigInt(input.target), now = toBigInt(nowMs), sampled = toBigInt(input.sampledAtMs);
  if (baseline === target) throw new Error('Baseline must differ from target.');
  if (input.current === null || sampled > now || now - sampled > toBigInt(input.maxAgeMs)) return null;
  const numerator = target > baseline ? toBigInt(input.current) - baseline : baseline - toBigInt(input.current);
  const denominator = target > baseline ? target - baseline : baseline - target;
  if (numerator <= 0n) return 0; if (numerator >= denominator) return 1;
  return Number(numerator * 1000000n / denominator) / 1000000;
}
export function weightedProgress(metrics: Array<{ progress: number | null; weight: U64 }>): number | null {
  if (!metrics.length || metrics.some(x => x.progress === null)) return null;
  let total = 0n, sum = 0n;
  for (const metric of metrics) {
    const weight = toBigInt(metric.weight);
    if (weight <= 0n || !Number.isFinite(metric.progress) || metric.progress! < 0 || metric.progress! > 1) throw new Error('Invalid progress or weight.');
    total += weight; sum += BigInt(Math.round(metric.progress! * 1000000)) * weight;
  }
  return Number(sum / total) / 1000000;
}
