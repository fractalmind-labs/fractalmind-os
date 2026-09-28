import { AgentApi } from './agent.js';
import { AgentPolicyApi } from './agent-policy.js';
import { FractalMindClient } from './client.js';
import { FractalApi } from './fractal.js';
import { GovernanceApi } from './governance.js';
import { ObjectiveApi } from './objective.js';
import { OrganizationApi } from './organization.js';
import { RemoteAuthorityApi } from './remote-authority.js';
import { TaskApi } from './task.js';
import type { FractalMindClientOptions } from './types.js';

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

export { FractalMindClient } from './client.js';
export { ObjectiveApi } from './objective.js';
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
