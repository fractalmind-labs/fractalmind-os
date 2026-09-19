import type { SuiClient } from '@mysten/sui/client';
import type { Transaction } from '@mysten/sui/transactions';

export type ObjectId = string;
export type Address = string;
export type U64 = bigint;

export type NetworkName = 'mainnet' | 'testnet' | 'devnet' | 'localnet';
export type VoteOption = 1 | 2 | 3;
export type KeyResultVerdict = 1 | 2 | 3;

export interface FractalMindClientOptions {
  packageId: string;
  registryId?: ObjectId;
  network?: NetworkName;
  fullnodeUrl?: string;
  client?: SuiClient;
}

export interface MoveObjectData {
  objectId: ObjectId;
  type: string;
  fields: Record<string, unknown>;
}

export interface TxBuildOptions {
  tx?: Transaction;
}

export interface OrganizationData {
  objectId: ObjectId;
  type: string;
  name: string;
  description: string;
  admin: Address;
  isActive: boolean;
  agentCount: U64;
  taskCount: U64;
  depth: U64;
  childOrgCount: U64;
  parentOrgId: ObjectId | null;
}

export interface AgentCertificateData {
  objectId: ObjectId;
  type: string;
  orgId: ObjectId;
  agent: Address;
  capabilityTags: string[];
  status: number;
  tasksCompleted: U64;
  reputationScore: U64;
}

export interface AgentPolicyData {
  objectId: ObjectId;
  type: string;
  orgId: ObjectId;
  owner: Address;
  agent: Address;
  allowedAction: string;
  targetScope: string;
  maxUses: U64;
  usesConsumed: U64;
  expiresAtMs: U64;
  maxGasBudget: U64;
  revoked: boolean;
  objectiveId: ObjectId | null;
  keyResultId: ObjectId | null;
}

export interface TaskData {
  objectId: ObjectId;
  type: string;
  orgId: ObjectId;
  creator: Address;
  title: string;
  description: string;
  status: number;
  assignee: Address | null;
  keyResultId: ObjectId | null;
}


export interface ObjectiveData {
  objectId: ObjectId;
  type: string;
  orgId: ObjectId;
  owner: Address;
  title: string;
  descriptionHash: number[];
  status: number;
  deadlineMs: U64;
  keyResultCount: U64;
  closedAtMs: U64 | null;
}

export interface KeyResultData {
  objectId: ObjectId;
  type: string;
  orgId: ObjectId;
  objectiveId: ObjectId;
  title: string;
  targetHash: number[];
  status: number;
  taskCount: U64;
  reviewCount: U64;
  acceptedAtMs: U64 | null;
}

export interface KRReviewData {
  objectId: ObjectId;
  type: string;
  orgId: ObjectId;
  objectiveId: ObjectId;
  keyResultId: ObjectId;
  reviewer: Address;
  verdict: KeyResultVerdict;
  evidenceHash: number[];
}

export interface ProposalData {
  objectId: ObjectId;
  type: string;
  governanceId: ObjectId;
  orgId: ObjectId;
  creator: Address;
  title: string;
  description: string;
  status: number;
  votingDeadline: U64;
  forVotes: U64;
  againstVotes: U64;
  abstainVotes: U64;
}


export interface CreateObjectiveInput extends TxBuildOptions {
  adminCapId: ObjectId;
  organizationId: ObjectId;
  title: string;
  descriptionHash: number[];
  deadlineMs: bigint | number | string;
}

export interface CreateKeyResultInput extends TxBuildOptions {
  adminCapId: ObjectId;
  objectiveId: ObjectId;
  title: string;
  targetHash: number[];
}

export interface ReviewKeyResultInput extends TxBuildOptions {
  adminCapId: ObjectId;
  objectiveId: ObjectId;
  keyResultId: ObjectId;
  verdict: KeyResultVerdict;
  evidenceHash: number[];
}

export interface AcceptKeyResultInput extends TxBuildOptions {
  adminCapId: ObjectId;
  objectiveId: ObjectId;
  keyResultId: ObjectId;
  evidenceHash: number[];
}

export interface CloseObjectiveInput extends TxBuildOptions {
  adminCapId: ObjectId;
  objectiveId: ObjectId;
}

export interface CreateOrganizationInput extends TxBuildOptions {
  registryId?: ObjectId;
  name: string;
  description: string;
}

export interface UpdateDescriptionInput extends TxBuildOptions {
  adminCapId: ObjectId;
  organizationId: ObjectId;
  newDescription: string;
}

export interface RegisterAgentInput extends TxBuildOptions {
  organizationId: ObjectId;
  capabilityTags: string[];
}

export interface GetAgentCertificateById {
  certificateId: ObjectId;
}

export interface GetAgentCertificateByOwner {
  owner: Address;
  orgId?: ObjectId;
}

export type GetAgentCertificateInput = GetAgentCertificateById | GetAgentCertificateByOwner;

export interface UpdateCapabilitiesInput extends TxBuildOptions {
  certificateId: ObjectId;
  newTags: string[];
}

export interface CreateAgentPolicyInput extends TxBuildOptions {
  organizationId: ObjectId;
  agent: Address;
  allowedAction: string;
  targetScope: string;
  maxUses: bigint | number | string;
  expiresAtMs: bigint | number | string;
  maxGasBudget: bigint | number | string;
}


export interface CreateAgentPolicyForObjectiveInput extends CreateAgentPolicyInput {
  objectiveId: ObjectId;
}

export interface CreateAgentPolicyForKeyResultInput extends CreateAgentPolicyInput {
  objectiveId: ObjectId;
  keyResultId: ObjectId;
}

export interface RevokeAgentPolicyInput extends TxBuildOptions {
  policyId: ObjectId;
  organizationId: ObjectId;
}

export interface ExecuteAgentActionInput extends TxBuildOptions {
  policyId: ObjectId;
  organizationId: ObjectId;
  certificateId: ObjectId;
  actionKind: string;
  targetScope: string;
  intentHash: number[];
  resultHash: number[];
  gasBudget: bigint | number | string;
}

export interface CreateTaskInput extends TxBuildOptions {
  organizationId: ObjectId;
  creatorCertId: ObjectId;
  title: string;
  description: string;
}


export interface CreateTaskForKeyResultInput extends CreateTaskInput {
  objectiveId: ObjectId;
  keyResultId: ObjectId;
}

export interface AssignTaskInput extends TxBuildOptions {
  taskId: ObjectId;
  organizationId: ObjectId;
  certId: ObjectId;
}

export interface SubmitTaskInput extends TxBuildOptions {
  taskId: ObjectId;
  submission: string;
}

export interface VerifyTaskInput extends TxBuildOptions {
  adminCapId: ObjectId;
  taskId: ObjectId;
}

export interface CompleteTaskInput extends TxBuildOptions {
  adminCapId: ObjectId;
  taskId: ObjectId;
  assigneeCertId: ObjectId;
}

export interface RejectTaskInput extends TxBuildOptions {
  adminCapId: ObjectId;
  taskId: ObjectId;
  assigneeCertId: ObjectId;
  reason: string;
}

export interface CreateSubOrganizationInput extends TxBuildOptions {
  adminCapId: ObjectId;
  parentOrganizationId: ObjectId;
  registryId?: ObjectId;
  name: string;
  description: string;
}

export interface DetachSubOrganizationInput extends TxBuildOptions {
  parentAdminCapId: ObjectId;
  childAdminCapId: ObjectId;
  parentOrganizationId: ObjectId;
  childOrganizationId: ObjectId;
}

export interface CreateGovernanceInput extends TxBuildOptions {
  adminCapId: ObjectId;
  organizationId: ObjectId;
}

export interface CreateProposalInput extends TxBuildOptions {
  governanceId: ObjectId;
  organizationId: ObjectId;
  proposerCertId: ObjectId;
  title: string;
  description: string;
  votingDeadlineMs: bigint | number | string;
  executionPayload: number[];
}

export interface StartProposalVotingInput extends TxBuildOptions {
  adminCapId: ObjectId;
  governanceId: ObjectId;
  proposalId: ObjectId;
}

export interface CastVoteInput extends TxBuildOptions {
  proposalId: ObjectId;
  voterCertId: ObjectId;
  vote: VoteOption;
}

export interface FinalizeProposalVotingInput extends TxBuildOptions {
  adminCapId: ObjectId;
  governanceId: ObjectId;
  proposalId: ObjectId;
}

export interface CloseProposalVotingInput extends TxBuildOptions {
  adminCapId: ObjectId;
  governanceId: ObjectId;
  proposalId: ObjectId;
}

export interface ExecuteProposalInput extends TxBuildOptions {
  adminCapId: ObjectId;
  governanceId: ObjectId;
  proposalId: ObjectId;
}

export type RemoteTargetKind = 1 | 2 | 3;
export type RemoteReservationScope = 'authority' | 'node';
export type U64Input = bigint | number | string;

export interface RemoteCapabilityData {
  objectId: ObjectId;
  type: string;
  schemaVersion: number;
  orgId: ObjectId;
  issuer: Address;
  delegate: Address;
  parentId: ObjectId | null;
  parentRevocationVersion: U64;
  reservationScope: RemoteReservationScope;
  targetKind: RemoteTargetKind;
  nodeId: string;
  agentId: string;
  actions: string[];
  scope: string;
  maxUses: U64;
  usesClaimed: U64;
  usesDelegated: U64;
  budgetAsset: string;
  maxBudget: U64;
  budgetClaimed: U64;
  budgetDelegated: U64;
  expiresAtMs: U64;
  revocationVersion: U64;
  revoked: boolean;
}

export interface RemoteCapabilityShape extends TxBuildOptions {
  delegate: Address;
  targetKind: RemoteTargetKind;
  nodeId: string;
  agentId: string;
  actions: string[];
  scope: string;
  maxUses: U64Input;
  budgetAsset: string;
  maxBudget: U64Input;
  expiresAtMs: U64Input;
}

export interface CreateRemoteCapabilityInput extends RemoteCapabilityShape {
  organizationId: ObjectId;
}

export interface DelegateRemoteCapabilityInput extends RemoteCapabilityShape {
  parentCapabilityId: ObjectId;
  organizationId: ObjectId;
}

export interface RevokeRemoteCapabilityInput extends TxBuildOptions {
  capabilityId: ObjectId;
  organizationId: ObjectId;
}

export interface ClaimRemoteAuthorityUseInput extends TxBuildOptions {
  capabilityId: ObjectId;
  action: string;
  scope: string;
  targetKind: RemoteTargetKind;
  nodeId: string;
  agentId: string;
  commandId: string;
  nonce: string;
  idempotencyKey: string;
  budgetAsset: string;
  budgetAmount: U64Input;
  intentHash: number[];
}

export interface CapabilityReference {
  id: ObjectId;
  revocationVersion: U64;
}

export interface CapabilityTarget {
  organizationId: ObjectId;
  nodeId: string;
  agentId: string;
}

export interface EnvdBudgetClaim {
  asset: string;
  amount: U64;
}

export interface EnvdCapabilityState {
  id: ObjectId;
  target: CapabilityTarget;
  authorizedSigners: Address[];
  actions: string[];
  scopes: string[];
  expiresAtMs: U64;
  revoked: boolean;
  revocationVersion: U64;
  checkpointObservedAtMs: U64;
  reservationScope: RemoteReservationScope;
  remainingUses: U64 | null;
  remainingBudget: EnvdBudgetClaim | null;
}

export interface CapabilityProjectionOptions {
  checkpointObservedAtMs: U64Input;
  nowMs?: U64Input;
  parent?: RemoteCapabilityData;
}

export interface NodeCommandSigningInput {
  version: string;
  commandId: string;
  signer: string;
  target: CapabilityTarget;
  action: string;
  scope: string;
  capability: CapabilityReference;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  idempotencyKey: string;
  budget?: EnvdBudgetClaim;
  payloadHash: string;
}
