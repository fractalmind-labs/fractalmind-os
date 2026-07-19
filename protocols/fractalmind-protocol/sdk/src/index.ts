import { AgentApi } from './agent';
import { AgentPolicyApi } from './agent-policy';
import { FractalMindClient } from './client';
import { FractalApi } from './fractal';
import { GovernanceApi } from './governance';
import { ObjectiveApi } from './objective';
import { OrganizationApi } from './organization';
import { RemoteAuthorityApi } from './remote-authority';
import { TaskApi } from './task';
import type { FractalMindClientOptions } from './types';

export class FractalMindSDK {
  public readonly client: FractalMindClient;
  public readonly organization: OrganizationApi;
  public readonly objective: ObjectiveApi;
  public readonly agent: AgentApi;
  public readonly agentPolicy: AgentPolicyApi;
  public readonly task: TaskApi;
  public readonly fractal: FractalApi;
  public readonly governance: GovernanceApi;
  public readonly remoteAuthority: RemoteAuthorityApi;

  constructor(options: FractalMindClientOptions) {
    this.client = new FractalMindClient(options);
    this.organization = new OrganizationApi(this.client);
    this.objective = new ObjectiveApi(this.client);
    this.agent = new AgentApi(this.client);
    this.agentPolicy = new AgentPolicyApi(this.client);
    this.task = new TaskApi(this.client);
    this.fractal = new FractalApi(this.client);
    this.governance = new GovernanceApi(this.client);
    this.remoteAuthority = new RemoteAuthorityApi(this.client);
  }
}

export { FractalMindClient } from './client';
export { ObjectiveApi } from './objective';
export { OrganizationApi } from './organization';
export { AgentApi } from './agent';
export { AgentPolicyApi } from './agent-policy';
export { TaskApi } from './task';
export { FractalApi } from './fractal';
export { GovernanceApi } from './governance';
export {
  RemoteAuthorityApi,
  capabilityReference,
  projectEnvdCapabilityState,
  verifyParentCheckpoint,
} from './remote-authority';
export {
  NODE_COMMAND_SIGNATURE_DOMAIN,
  canonicalNodeCommandSigningBytes,
  capabilityReferenceWire,
} from './node-command';

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
} from './types';
