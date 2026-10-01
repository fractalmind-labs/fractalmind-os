import { AgentApi } from './agent.js';
import { IdentityApi } from './identity.js';
import { HostApi } from './host.js';
import { ProductRecordApi } from './product-record.js';
import { AgentPolicyApi } from './agent-policy.js';
import { FractalMindClient } from './client.js';
import { NodeExecutionApi } from './node-execution.js';
import { FractalApi } from './fractal.js';
import { GovernanceApi } from './governance.js';
import { ObjectiveApi } from './objective.js';
import { OkrApi } from './okr.js';
import { OrganizationApi } from './organization.js';
import { RemoteAuthorityApi } from './remote-authority.js';
import { TaskApi } from './task.js';
import type { FractalMindClientOptions } from './types.js';

export class FractalMindSDK {
  public readonly client: FractalMindClient;
  public readonly nodeExecution: NodeExecutionApi;
  public readonly organization: OrganizationApi;
  public readonly objective: ObjectiveApi;
  public readonly okr: OkrApi;
  public readonly agent: AgentApi;
  public readonly identity: IdentityApi;
  public readonly host: HostApi;
  public readonly productRecord: ProductRecordApi;
  public readonly agentPolicy: AgentPolicyApi;
  public readonly task: TaskApi;
  public readonly fractal: FractalApi;
  public readonly governance: GovernanceApi;
  public readonly remoteAuthority: RemoteAuthorityApi;

  constructor(options: FractalMindClientOptions) {
    this.client = new FractalMindClient(options);
    this.nodeExecution = new NodeExecutionApi(this.client);
    this.organization = new OrganizationApi(this.client);
    this.objective = new ObjectiveApi(this.client);
    this.okr = new OkrApi(this.client);
    this.agent = new AgentApi(this.client);
    this.identity = new IdentityApi(this.client);
    this.host = new HostApi(this.client);
    this.productRecord = new ProductRecordApi(this.client);
    this.agentPolicy = new AgentPolicyApi(this.client);
    this.task = new TaskApi(this.client);
    this.fractal = new FractalApi(this.client);
    this.governance = new GovernanceApi(this.client);
    this.remoteAuthority = new RemoteAuthorityApi(this.client);
  }
}

export { FractalMindClient } from './client.js';
export { NodeExecutionApi, CommandExecutionBcs, EXECUTION_STATES, nodeCommandSigningBytes, nodeCommandIntentHash, verifySignedNodeCommand } from './node-execution.js';
export { HostApi, HostInviteBcs, HostMembershipBcs, ManagedAgentBcs, CoordinatorBindingBcs,
  HostIndexBcs, AuthorityBindingBcs, HostJoinIntentBcs, createHostInviteMaterial,
  encodeHostInviteCode, parseHostInviteCode } from './host.js';
export { IdentityApi, IdentityRegistryBcs, RecoveryLocationBcs, HumanIdentityBcs, DeviceGrantBcs, RecoveryRecordBcs, DEVICE_ACTIONS } from './identity.js';
export type { DeviceAction } from './identity.js';
export { ProductRecordApi, PRODUCT_RECORD_KINDS, EncryptedRecordBcs, recordContext } from './product-record.js';
export type { ProductRecordKind } from './product-record.js';
export { createRecoveryCode, parseRecoveryCode, recoveryKeys, createDeviceEncryptionKeys,
  encryptContent, decryptContent, wrapKeys, unwrapKeys, randomContentKey,
  bytesToHex, hexToBytes } from './identity-crypto.js';
export { commandResultKey, commandResultWrapContext, encryptCommandResult, decryptCommandResult } from './command-result-crypto.js';
export { ObjectiveApi } from './objective.js';
export { OkrApi, OkrBcs, OkrMetricBcs, OkrObservationBcs, OKR_STATES, metricProgress, weightedProgress } from './okr.js';
export { OrganizationApi } from './organization.js';
export { AgentApi } from './agent.js';
export { AgentPolicyApi } from './agent-policy.js';
export { TaskApi } from './task.js';
export { FractalApi } from './fractal.js';
export { GovernanceApi } from './governance.js';
export {
  RemoteAuthorityApi,
  capabilityReference,
  projectEnvdCapabilityState,
  verifyParentCheckpoint,
} from './remote-authority.js';
export {
  NODE_COMMAND_SIGNATURE_DOMAIN,
  canonicalNodeCommandSigningBytes,
  capabilityReferenceWire,
  signNodeCommand,
} from './node-command.js';

export type {
  Address,
  AgentCertificateData,
  AcceptKeyResultInput,
  AgentPolicyData,
  AssignTaskInput,
  CastVoteInput,
  CapabilityProjectionOptions,
  CapabilityReference,
  CapabilityTarget,
  ClaimRemoteAuthorityUseInput,
  CloseObjectiveInput,
  CloseProposalVotingInput,
  CreateAgentPolicyForKeyResultInput,
  CreateAgentPolicyForObjectiveInput,
  CreateAgentPolicyInput,
  CompleteTaskInput,
  CreateGovernanceInput,
  CreateKeyResultInput,
  CreateObjectiveInput,
  CreateOrganizationInput,
  CreateProposalInput,
  CreateRemoteCapabilityInput,
  CreateSubOrganizationInput,
  CreateTaskForKeyResultInput,
  CreateTaskInput,
  DetachSubOrganizationInput,
  DelegateRemoteCapabilityInput,
  EnvdBudgetClaim,
  EnvdCapabilityState,
  ExecuteAgentActionInput,
  ExecuteProposalInput,
  FinalizeProposalVotingInput,
  FractalMindClientOptions,
  GetAgentCertificateInput,
  KeyResultData,
  KeyResultVerdict,
  KRReviewData,
  MoveObjectData,
  NetworkName,
  NodeCommandSigningInput,
  NodeCommandSigner,
  SignNodeCommandInput,
  SignedNodeCommand,
  ObjectId,
  ObjectiveData,
  OrganizationData,
  ProposalData,
  RemoteCapabilityData,
  RemoteReservationScope,
  RemoteTargetKind,
  RejectTaskInput,
  ReviewKeyResultInput,
  RegisterAgentInput,
  RevokeAgentPolicyInput,
  RevokeRemoteCapabilityInput,
  StartProposalVotingInput,
  SubmitTaskInput,
  TaskData,
  TxBuildOptions,
  U64,
  U64Input,
  UpdateCapabilitiesInput,
  UpdateDescriptionInput,
  VerifyTaskInput,
  VoteOption,
} from './types.js';
