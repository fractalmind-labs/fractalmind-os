import type { Transaction } from '@mysten/sui/transactions';

import {
  FractalMindClient,
  readAddress,
  readBigInt,
  readBoolean,
  readOptionId,
  readString,
  toBigInt,
} from './client';
import type {
  AgentPolicyData,
  CreateAgentPolicyForKeyResultInput,
  CreateAgentPolicyForObjectiveInput,
  CreateAgentPolicyInput,
  ExecuteAgentActionInput,
  ObjectId,
  RevokeAgentPolicyInput,
} from './types';

export class AgentPolicyApi {
  constructor(private readonly fm: FractalMindClient) {}

  createPolicy(input: CreateAgentPolicyInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('create_agent_policy'),
      arguments: [
        tx.object(input.organizationId),
        tx.pure.address(input.agent),
        tx.pure.string(input.allowedAction),
        tx.pure.string(input.targetScope),
        tx.pure.u64(toBigInt(input.maxUses)),
        tx.pure.u64(toBigInt(input.expiresAtMs)),
        tx.pure.u64(toBigInt(input.maxGasBudget)),
      ],
    });

    return tx;
  }



  createPolicyForObjective(input: CreateAgentPolicyForObjectiveInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('create_agent_policy_for_objective'),
      arguments: [
        tx.object(input.organizationId),
        tx.object(input.objectiveId),
        tx.pure.address(input.agent),
        tx.pure.string(input.allowedAction),
        tx.pure.string(input.targetScope),
        tx.pure.u64(toBigInt(input.maxUses)),
        tx.pure.u64(toBigInt(input.expiresAtMs)),
        tx.pure.u64(toBigInt(input.maxGasBudget)),
      ],
    });

    return tx;
  }

  createPolicyForKeyResult(input: CreateAgentPolicyForKeyResultInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('create_agent_policy_for_key_result'),
      arguments: [
        tx.object(input.organizationId),
        tx.object(input.objectiveId),
        tx.object(input.keyResultId),
        tx.pure.address(input.agent),
        tx.pure.string(input.allowedAction),
        tx.pure.string(input.targetScope),
        tx.pure.u64(toBigInt(input.maxUses)),
        tx.pure.u64(toBigInt(input.expiresAtMs)),
        tx.pure.u64(toBigInt(input.maxGasBudget)),
      ],
    });

    return tx;
  }

  revokePolicy(input: RevokeAgentPolicyInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('revoke_agent_policy'),
      arguments: [
        tx.object(input.policyId),
        tx.object(input.organizationId),
      ],
    });

    return tx;
  }

  executeAction(input: ExecuteAgentActionInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('execute_agent_action'),
      arguments: [
        tx.object(input.policyId),
        tx.object(input.organizationId),
        tx.object(input.certificateId),
        tx.pure.string(input.actionKind),
        tx.pure.string(input.targetScope),
        tx.pure.vector('u8', input.intentHash),
        tx.pure.vector('u8', input.resultHash),
        tx.pure.u64(toBigInt(input.gasBudget)),
      ],
    });

    return tx;
  }

  async getPolicy(policyId: ObjectId): Promise<AgentPolicyData> {
    const obj = await this.fm.getMoveObject(policyId);

    if (!obj.type.endsWith('::agent_policy::AgentPolicy')) {
      throw new Error(`Object ${policyId} is not an AgentPolicy.`);
    }

    return {
      objectId: obj.objectId,
      type: obj.type,
      orgId: readAddress(obj.fields, 'org_id'),
      owner: readAddress(obj.fields, 'owner'),
      agent: readAddress(obj.fields, 'agent'),
      allowedAction: readString(obj.fields, 'allowed_action'),
      targetScope: readString(obj.fields, 'target_scope'),
      maxUses: readBigInt(obj.fields, 'max_uses'),
      usesConsumed: readBigInt(obj.fields, 'uses_consumed'),
      expiresAtMs: readBigInt(obj.fields, 'expires_at_ms'),
      maxGasBudget: readBigInt(obj.fields, 'max_gas_budget'),
      revoked: readBoolean(obj.fields, 'revoked'),
      objectiveId: readOptionId(obj.fields, 'objective_id'),
      keyResultId: readOptionId(obj.fields, 'key_result_id'),
    };
  }
}
