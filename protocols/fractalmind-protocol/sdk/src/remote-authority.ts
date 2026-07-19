import type { Transaction } from '@mysten/sui/transactions';

import {
  FractalMindClient,
  readAddress,
  readBigInt,
  readBoolean,
  readNumber,
  readOptionId,
  readString,
  readStringVector,
  toBigInt,
} from './client';
import type {
  CapabilityProjectionOptions,
  CapabilityReference,
  ClaimRemoteAuthorityUseInput,
  CreateRemoteCapabilityInput,
  DelegateRemoteCapabilityInput,
  EnvdCapabilityState,
  ObjectId,
  RemoteCapabilityData,
  RemoteReservationScope,
  RemoteTargetKind,
  RevokeRemoteCapabilityInput,
} from './types';

const TARGET_ORGANIZATION = 1;
const TARGET_NODE = 2;
const TARGET_AGENT = 3;
const RESERVATION_AUTHORITY = 1;
const RESERVATION_NODE = 2;
const TOKEN_PATTERN = /^[A-Za-z0-9+\-._/:@]{1,128}$/;

export class RemoteAuthorityApi {
  constructor(private readonly fm: FractalMindClient) {}

  createCapability(input: CreateRemoteCapabilityInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({
      target: this.fm.target('create_remote_capability'),
      arguments: [
        tx.object(input.organizationId),
        tx.pure.address(input.delegate),
        tx.pure.u8(input.targetKind),
        tx.pure.string(input.nodeId),
        tx.pure.string(input.agentId),
        tx.pure.vector('string', input.actions),
        tx.pure.string(input.scope),
        tx.pure.u64(toBigInt(input.maxUses)),
        tx.pure.string(input.budgetAsset),
        tx.pure.u64(toBigInt(input.maxBudget)),
        tx.pure.u64(toBigInt(input.expiresAtMs)),
      ],
    });
    return tx;
  }

  delegateCapability(input: DelegateRemoteCapabilityInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({
      target: this.fm.target('delegate_remote_capability'),
      arguments: [
        tx.object(input.parentCapabilityId),
        tx.object(input.organizationId),
        tx.pure.address(input.delegate),
        tx.pure.u8(input.targetKind),
        tx.pure.string(input.nodeId),
        tx.pure.string(input.agentId),
        tx.pure.vector('string', input.actions),
        tx.pure.string(input.scope),
        tx.pure.u64(toBigInt(input.maxUses)),
        tx.pure.string(input.budgetAsset),
        tx.pure.u64(toBigInt(input.maxBudget)),
        tx.pure.u64(toBigInt(input.expiresAtMs)),
      ],
    });
    return tx;
  }

  revokeCapability(input: RevokeRemoteCapabilityInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({
      target: this.fm.target('revoke_remote_capability'),
      arguments: [tx.object(input.capabilityId), tx.object(input.organizationId)],
    });
    return tx;
  }

  claimAuthorityUse(input: ClaimRemoteAuthorityUseInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({
      target: this.fm.target('claim_remote_authority_use'),
      arguments: [
        tx.object(input.capabilityId),
        tx.pure.string(input.action),
        tx.pure.string(input.scope),
        tx.pure.u8(input.targetKind),
        tx.pure.string(input.nodeId),
        tx.pure.string(input.agentId),
        tx.pure.string(input.commandId),
        tx.pure.string(input.nonce),
        tx.pure.string(input.idempotencyKey),
        tx.pure.string(input.budgetAsset),
        tx.pure.u64(toBigInt(input.budgetAmount)),
        tx.pure.vector('u8', input.intentHash),
      ],
    });
    return tx;
  }

  async getCapability(capabilityId: ObjectId): Promise<RemoteCapabilityData> {
    const obj = await this.fm.getMoveObject(capabilityId);
    if (!obj.type.endsWith('::remote_authority::RemoteCapability')) {
      throw new Error(`Object ${capabilityId} is not a RemoteCapability.`);
    }

    const targetKind = readNumber(obj.fields, 'target_kind');
    const reservationScopeCode = readNumber(obj.fields, 'reservation_scope');
    if (!isTargetKind(targetKind)) {
      throw new Error(`RemoteCapability ${capabilityId} has invalid target_kind ${targetKind}.`);
    }
    const schemaVersion = readNumber(obj.fields, 'schema_version');
    if (schemaVersion !== 1) {
      throw new Error(`RemoteCapability ${capabilityId} uses unsupported schema_version ${schemaVersion}.`);
    }

    return {
      objectId: obj.objectId,
      type: obj.type,
      schemaVersion,
      orgId: readAddress(obj.fields, 'org_id'),
      issuer: readAddress(obj.fields, 'issuer'),
      delegate: readAddress(obj.fields, 'delegate'),
      parentId: readOptionId(obj.fields, 'parent_id'),
      parentRevocationVersion: readBigInt(obj.fields, 'parent_revocation_version'),
      reservationScope: reservationScope(reservationScopeCode),
      targetKind,
      nodeId: readString(obj.fields, 'node_id'),
      agentId: readString(obj.fields, 'agent_id'),
      actions: readStringVector(obj.fields, 'actions'),
      scope: readString(obj.fields, 'scope'),
      maxUses: readBigInt(obj.fields, 'max_uses'),
      usesClaimed: readBigInt(obj.fields, 'uses_claimed'),
      usesDelegated: readBigInt(obj.fields, 'uses_delegated'),
      budgetAsset: readString(obj.fields, 'budget_asset'),
      maxBudget: readBigInt(obj.fields, 'max_budget'),
      budgetClaimed: readBigInt(obj.fields, 'budget_claimed'),
      budgetDelegated: readBigInt(obj.fields, 'budget_delegated'),
      expiresAtMs: readBigInt(obj.fields, 'expires_at_ms'),
      revocationVersion: readBigInt(obj.fields, 'revocation_version'),
      revoked: readBoolean(obj.fields, 'revoked'),
    };
  }
}

export function capabilityReference(capability: RemoteCapabilityData): CapabilityReference {
  assertSchemaVersion(capability);
  return { id: capability.objectId, revocationVersion: capability.revocationVersion };
}

export function verifyParentCheckpoint(
  capability: RemoteCapabilityData,
  parent: RemoteCapabilityData,
  nowMs: bigint | number | string = Date.now(),
): void {
  assertSchemaVersion(capability);
  assertSchemaVersion(parent);
  const now = toBigInt(nowMs);
  if (!capability.parentId || capability.parentId !== parent.objectId) {
    throw new Error('Delegated capability parent id does not match the supplied parent.');
  }
  if (parent.parentId !== null || parent.targetKind !== TARGET_ORGANIZATION) {
    throw new Error('Delegated capability parent must be an organization root.');
  }
  if (parent.reservationScope !== 'authority' || capability.reservationScope !== 'node') {
    throw new Error('Delegated capability reservation scopes are invalid.');
  }
  if (capability.orgId !== parent.orgId) {
    throw new Error('Delegated capability organization does not match its parent.');
  }
  if (parent.revoked) {
    throw new Error('Delegated capability parent is revoked.');
  }
  if (parent.expiresAtMs <= now || capability.expiresAtMs > parent.expiresAtMs) {
    throw new Error('Delegated capability parent is expired or narrower than its child expiry.');
  }
  if (capability.parentRevocationVersion !== parent.revocationVersion) {
    throw new Error('Delegated capability parent revocation checkpoint is stale.');
  }
  if (capability.scope !== parent.scope || !isSubset(capability.actions, parent.actions)) {
    throw new Error('Delegated capability action or scope exceeds its parent.');
  }
  if (!targetContains(parent, capability)) {
    throw new Error('Delegated capability target exceeds its parent.');
  }
  if (capability.maxUses > parent.maxUses || capability.maxBudget > parent.maxBudget) {
    throw new Error('Delegated capability quota exceeds its parent.');
  }
  if (capability.maxBudget > 0n && capability.budgetAsset !== parent.budgetAsset) {
    throw new Error('Delegated capability budget asset does not match its parent.');
  }
}

export function projectEnvdCapabilityState(
  capability: RemoteCapabilityData,
  options: CapabilityProjectionOptions,
): EnvdCapabilityState {
  assertSchemaVersion(capability);
  validateCapabilityTokens(capability);
  const checkpointObservedAtMs = toBigInt(options.checkpointObservedAtMs);
  const nowMs = toBigInt(options.nowMs ?? Date.now());
  if (checkpointObservedAtMs === 0n) {
    throw new Error('checkpointObservedAtMs must record a successful trusted authority read.');
  }

  if (capability.parentId) {
    if (!options.parent) {
      throw new Error('Delegated capability projection requires its parent checkpoint.');
    }
    verifyParentCheckpoint(capability, options.parent, nowMs);
  }
  validateReservationScope(capability);

  const actualRemainingUses = remainingBound(
    capability.maxUses,
    capability.usesClaimed,
    capability.usesDelegated,
    'uses',
  );
  const actualRemainingBudget = remainingBound(
    capability.maxBudget,
    capability.budgetClaimed,
    capability.budgetDelegated,
    'budget',
  );
  if (actualRemainingBudget !== null && !capability.budgetAsset) {
    throw new Error('Budget-bounded capability has an empty budget asset.');
  }
  const authorityScoped = capability.reservationScope === 'authority';
  const remainingUses = authorityScoped && capability.maxUses > 0n
    ? capability.maxUses
    : actualRemainingUses;
  const remainingBudgetAmount = authorityScoped && capability.maxBudget > 0n
    ? capability.maxBudget
    : actualRemainingBudget;

  return {
    id: capability.objectId,
    target: {
      organizationId: capability.orgId,
      nodeId: capability.targetKind === TARGET_ORGANIZATION ? '' : capability.nodeId,
      agentId: capability.targetKind === TARGET_AGENT ? capability.agentId : '',
    },
    authorizedSigners: [capability.delegate],
    actions: [...capability.actions].sort(),
    scopes: [capability.scope],
    expiresAtMs: capability.expiresAtMs,
    revoked: capability.revoked,
    revocationVersion: capability.revocationVersion,
    checkpointObservedAtMs,
    reservationScope: capability.reservationScope,
    remainingUses,
    remainingBudget: remainingBudgetAmount === null
      ? null
      : { asset: capability.budgetAsset, amount: remainingBudgetAmount },
  };
}

function assertSchemaVersion(capability: RemoteCapabilityData): void {
  if (capability.schemaVersion !== 1) {
    throw new Error(`Unsupported RemoteCapability schema version ${capability.schemaVersion}.`);
  }
}

function reservationScope(value: number): RemoteReservationScope {
  if (value === RESERVATION_AUTHORITY) return 'authority';
  if (value === RESERVATION_NODE) return 'node';
  throw new Error(`Invalid remote authority reservation scope ${value}.`);
}

function isTargetKind(value: number): value is RemoteTargetKind {
  return value === TARGET_ORGANIZATION || value === TARGET_NODE || value === TARGET_AGENT;
}

function validateReservationScope(capability: RemoteCapabilityData): void {
  const expected = capability.targetKind === TARGET_ORGANIZATION ? 'authority' : 'node';
  if (capability.reservationScope !== expected) {
    throw new Error(`Capability target requires ${expected} reservations.`);
  }
}

function validateCapabilityTokens(capability: RemoteCapabilityData): void {
  const tokens = [capability.orgId, capability.delegate, capability.scope];
  if (capability.nodeId) tokens.push(capability.nodeId);
  if (capability.agentId) tokens.push(capability.agentId);
  if (capability.budgetAsset) tokens.push(capability.budgetAsset);
  tokens.push(...capability.actions);
  if (tokens.some((value) => !TOKEN_PATTERN.test(value))) {
    throw new Error('Capability contains a non-canonical ASCII token.');
  }
  if (new Set(capability.actions).size !== capability.actions.length) {
    throw new Error('Capability actions contain duplicates.');
  }
  if (capability.targetKind === TARGET_ORGANIZATION && (capability.nodeId || capability.agentId)) {
    throw new Error('Organization target must not include node or agent ids.');
  }
  if (capability.targetKind === TARGET_NODE && (!capability.nodeId || capability.agentId)) {
    throw new Error('Node target must include only a node id.');
  }
  if (capability.targetKind === TARGET_AGENT && (!capability.nodeId || !capability.agentId)) {
    throw new Error('Agent target must include node and agent ids.');
  }
}

function remainingBound(max: bigint, used: bigint, delegated: bigint, label: string): bigint | null {
  if (max === 0n) return null;
  const consumed = used + delegated;
  if (consumed > max) {
    throw new Error(`Capability ${label} counters exceed their bound.`);
  }
  return max - consumed;
}

function isSubset(values: string[], parent: string[]): boolean {
  return values.every((value) => parent.includes(value));
}

function targetContains(parent: RemoteCapabilityData, child: RemoteCapabilityData): boolean {
  if (parent.targetKind === TARGET_ORGANIZATION) return true;
  if (parent.nodeId !== child.nodeId) return false;
  if (parent.targetKind === TARGET_NODE) return child.targetKind !== TARGET_ORGANIZATION;
  return child.targetKind === TARGET_AGENT && parent.agentId === child.agentId;
}
