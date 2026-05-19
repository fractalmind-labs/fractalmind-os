import type { Transaction } from '@mysten/sui/transactions';

import {
  FractalMindClient,
  readAddress,
  readBigInt,
  readNumber,
  readNumberVector,
  readOptionBigInt,
  readString,
  toBigInt,
} from './client';
import type {
  AcceptKeyResultInput,
  CloseObjectiveInput,
  CreateKeyResultInput,
  CreateObjectiveInput,
  KeyResultData,
  KeyResultVerdict,
  KRReviewData,
  ObjectId,
  ObjectiveData,
  ReviewKeyResultInput,
} from './types';

export class ObjectiveApi {
  constructor(private readonly fm: FractalMindClient) {}

  createObjective(input: CreateObjectiveInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('create_objective'),
      arguments: [
        tx.object(input.adminCapId),
        tx.object(input.organizationId),
        tx.pure.string(input.title),
        tx.pure.vector('u8', input.descriptionHash),
        tx.pure.u64(toBigInt(input.deadlineMs)),
      ],
    });

    return tx;
  }

  createKeyResult(input: CreateKeyResultInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('create_key_result'),
      arguments: [
        tx.object(input.adminCapId),
        tx.object(input.objectiveId),
        tx.pure.string(input.title),
        tx.pure.vector('u8', input.targetHash),
      ],
    });

    return tx;
  }

  reviewKeyResult(input: ReviewKeyResultInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('review_key_result'),
      arguments: [
        tx.object(input.adminCapId),
        tx.object(input.objectiveId),
        tx.object(input.keyResultId),
        tx.pure.u8(input.verdict),
        tx.pure.vector('u8', input.evidenceHash),
      ],
    });

    return tx;
  }

  acceptKeyResult(input: AcceptKeyResultInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('accept_key_result'),
      arguments: [
        tx.object(input.adminCapId),
        tx.object(input.objectiveId),
        tx.object(input.keyResultId),
        tx.pure.vector('u8', input.evidenceHash),
      ],
    });

    return tx;
  }

  closeObjective(input: CloseObjectiveInput): Transaction {
    const tx = this.fm.useTransaction(input.tx);

    tx.moveCall({
      target: this.fm.target('close_objective'),
      arguments: [
        tx.object(input.adminCapId),
        tx.object(input.objectiveId),
      ],
    });

    return tx;
  }

  async getObjective(objectiveId: ObjectId): Promise<ObjectiveData> {
    const obj = await this.fm.getMoveObject(objectiveId);

    if (!obj.type.endsWith('::objective::Objective')) {
      throw new Error(`Object ${objectiveId} is not an Objective.`);
    }

    return {
      objectId: obj.objectId,
      type: obj.type,
      orgId: readAddress(obj.fields, 'org_id'),
      owner: readAddress(obj.fields, 'owner'),
      title: readString(obj.fields, 'title'),
      descriptionHash: readNumberVector(obj.fields, 'description_hash'),
      status: readNumber(obj.fields, 'status'),
      deadlineMs: readBigInt(obj.fields, 'deadline_ms'),
      keyResultCount: readBigInt(obj.fields, 'key_result_count'),
      closedAtMs: readOptionBigInt(obj.fields, 'closed_at_ms'),
    };
  }

  async getKeyResult(keyResultId: ObjectId): Promise<KeyResultData> {
    const obj = await this.fm.getMoveObject(keyResultId);

    if (!obj.type.endsWith('::objective::KeyResult')) {
      throw new Error(`Object ${keyResultId} is not a KeyResult.`);
    }

    return {
      objectId: obj.objectId,
      type: obj.type,
      orgId: readAddress(obj.fields, 'org_id'),
      objectiveId: readAddress(obj.fields, 'objective_id'),
      title: readString(obj.fields, 'title'),
      targetHash: readNumberVector(obj.fields, 'target_hash'),
      status: readNumber(obj.fields, 'status'),
      taskCount: readBigInt(obj.fields, 'task_count'),
      reviewCount: readBigInt(obj.fields, 'review_count'),
      acceptedAtMs: readOptionBigInt(obj.fields, 'accepted_at_ms'),
    };
  }

  async getKRReview(reviewId: ObjectId): Promise<KRReviewData> {
    const obj = await this.fm.getMoveObject(reviewId);

    if (!obj.type.endsWith('::objective::KRReview')) {
      throw new Error(`Object ${reviewId} is not a KRReview.`);
    }

    return {
      objectId: obj.objectId,
      type: obj.type,
      orgId: readAddress(obj.fields, 'org_id'),
      objectiveId: readAddress(obj.fields, 'objective_id'),
      keyResultId: readAddress(obj.fields, 'key_result_id'),
      reviewer: readAddress(obj.fields, 'reviewer'),
      verdict: readNumber(obj.fields, 'verdict') as KeyResultVerdict,
      evidenceHash: readNumberVector(obj.fields, 'evidence_hash'),
    };
  }
}
