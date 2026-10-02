import type { Transaction } from "@mysten/sui/transactions";
import { FractalMindClient, toBigInt } from "./client.js";
import { bytesArgument } from "./wire-bytes.js";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "./identity-crypto.js";
import { executionBoundaryHash } from "./execution-boundary.js";

/** Wire format of the exact proposed agreement. A proposal is not authority. */
export interface HandoverProposal {
  version: "1";
  managed_agent_id: string;
  managed_version: string;
  okr_id: string;
  okr_version: string;
  spec_revision: string;
  workspace_hash: string;
  paths: Record<string, string[]>;
  budget_asset: "TOOL_CALLS";
  budget_limit: string;
  max_calls: string;
  expires_at_ms: number;
  nonce: string;
  review_expires_at_ms: number;
}
export interface HandoverAcceptance {
  version: "1";
  execution_id: string;
  organization_id: string;
  human_id: string;
  grant_id: string;
  membership_id: string;
  binding_id: string;
  host_address: string;
  instance_id: string;
  proposal: HandoverProposal;
  coverage_revision: string;
  observed_at_ms: number;
  signature: string;
}
const Bytes = bcs.vector(bcs.u8());
const ProposalBcs = bcs.struct("HandoverProposal", {
  version: bcs.u8(),
  managed: bcs.Address,
  okr: bcs.Address,
  managed_version: bcs.u64(),
  okr_version: bcs.u64(),
  spec_revision: bcs.u64(),
  workspace: Bytes,
  boundary: Bytes,
  asset: bcs.string(),
  limit: bcs.u64(),
  max_calls: bcs.u64(),
  expires: bcs.u64(),
  review_expires: bcs.u64(),
  nonce: Bytes,
});
const AcceptanceBcs = bcs.struct("HandoverAcceptance", {
  version: bcs.u8(),
  execution: bcs.Address,
  organization: bcs.Address,
  human: bcs.Address,
  grant: bcs.Address,
  membership: bcs.Address,
  binding: bcs.Address,
  host: bcs.Address,
  instance: bcs.string(),
  proposal_hash: Bytes,
  coverage_revision: bcs.u64(),
  observed_at: bcs.u64(),
});
function domainBytes(domain: string, data: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(domain),
    out = new Uint8Array(prefix.length + data.length);
  out.set(prefix);
  out.set(data, prefix.length);
  return out;
}
function id(value: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value))
    throw new Error("Canonical handover ID required.");
  return value;
}
function hex32(value: string): Uint8Array {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    throw new Error("Canonical 32-byte handover hash required.");
  return hexToBytes(value);
}
function positiveU64(value: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value))
    throw new Error("Positive decimal u64 required.");
  const result = BigInt(value);
  if (result > 0xffffffffffffffffn) throw new Error("u64 overflow.");
  return result;
}
function timestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("Safe positive timestamp required.");
  return value;
}
export function handoverProposalHash(p: HandoverProposal): Uint8Array {
  if (p.version !== "1" || p.budget_asset !== "TOOL_CALLS")
    throw new Error("Unsupported handover proposal.");
  const limit = positiveU64(p.budget_limit),
    max = positiveU64(p.max_calls);
  if (
    max > 1000n ||
    max > limit ||
    timestamp(p.review_expires_at_ms) > timestamp(p.expires_at_ms)
  )
    throw new Error("Invalid handover budget or expiry.");
  const data = ProposalBcs.serialize({
    version: 1,
    managed: id(p.managed_agent_id),
    okr: id(p.okr_id),
    managed_version: positiveU64(p.managed_version),
    okr_version: positiveU64(p.okr_version),
    spec_revision: positiveU64(p.spec_revision),
    workspace: hex32(p.workspace_hash),
    boundary: executionBoundaryHash(p.paths),
    asset: p.budget_asset,
    limit,
    max_calls: max,
    expires: p.expires_at_ms,
    review_expires: p.review_expires_at_ms,
    nonce: hex32(p.nonce),
  }).toBytes();
  return sha256(domainBytes("fractalmind.handover-proposal.v1", data));
}
export function handoverAcceptanceSigningBytes(
  a: HandoverAcceptance,
): Uint8Array {
  if (
    a.version !== "1" ||
    !/^native-[0-9a-f]{64}$/.test(a.instance_id) ||
    timestamp(a.observed_at_ms) >= a.proposal.review_expires_at_ms ||
    a.proposal.review_expires_at_ms - a.observed_at_ms > 60000
  )
    throw new Error("Invalid native handover acceptance.");
  const data = AcceptanceBcs.serialize({
    version: 1,
    execution: id(a.execution_id),
    organization: id(a.organization_id),
    human: id(a.human_id),
    grant: id(a.grant_id),
    membership: id(a.membership_id),
    binding: id(a.binding_id),
    host: id(a.host_address),
    instance: a.instance_id,
    proposal_hash: handoverProposalHash(a.proposal),
    coverage_revision: positiveU64(a.coverage_revision),
    observed_at: a.observed_at_ms,
  }).toBytes();
  return domainBytes("fractalmind.handover-acceptance.v1", data);
}
/** Authenticate the historical Host proof only. Callers must separately read
 * current Sui authority, Run/coverage, physical continuity and chain Clock;
 * this function cannot authorize execution or renew the review's expiry. */
export async function verifyHandoverAcceptanceSignature(
  a: HandoverAcceptance,
  expectedHostAddress: string,
): Promise<void> {
  if (id(expectedHostAddress) !== a.host_address)
    throw new Error("Handover Host mismatch.");
  const match = /^ed25519:([0-9a-f]{64}):([0-9a-f]{128})$/.exec(a.signature);
  if (!match) throw new Error("Invalid Host acceptance signature.");
  const key = new Ed25519PublicKey(hexToBytes(match[1]));
  if (
    key.toSuiAddress() !== expectedHostAddress ||
    !(await key.verify(handoverAcceptanceSigningBytes(a), hexToBytes(match[2])))
  )
    throw new Error("Host acceptance signature mismatch.");
}
export function assertFreshHandoverAcceptance(
  a: HandoverAcceptance,
  chainTimeMs: number,
  expectedProposal: HandoverProposal,
): void {
  timestamp(chainTimeMs);
  handoverAcceptanceSigningBytes(a);
  if (
    chainTimeMs < a.observed_at_ms ||
    chainTimeMs >= a.proposal.review_expires_at_ms ||
    bytesToHex(handoverProposalHash(a.proposal)) !==
      bytesToHex(handoverProposalHash(expectedProposal))
  )
    throw new Error("Handover acceptance expired or proposal changed.");
}

export const HandoverApprovalBcs = bcs.struct("Approval", {
  id: bcs.Address,
  org_id: bcs.Address,
  okr_id: bcs.Address,
  managed_agent_id: bcs.Address,
  review_execution_id: bcs.Address,
  review_result_id: bcs.Address,
  human_id: bcs.Address,
  grant_id: bcs.Address,
  host_address: bcs.Address,
  proposal: ProposalBcs,
  coverage_revision: bcs.u64(),
  observed_at_ms: bcs.u64(),
  approved_at_ms: bcs.u64(),
  host_signature: Bytes,
  managed_version: bcs.u64(),
  agreement_version: bcs.u64(),
});
export const HandoverPolicyBcs = bcs.struct("HandoverPolicy", {
  agreement_version: bcs.u64(),
  managed_version: bcs.u64(),
  max_calls: bcs.u64(),
  nonce: Bytes,
  proposal_hash: Bytes,
  approval_id: bcs.Address,
});
/** Builds a fee-quoted device approval; no signing, broadcast or dispatch.
 * The contract consumes the exact Host proof and rechecks current sources. */
export class HandoverApi {
  constructor(private readonly fm: FractalMindClient) {}
  async confirmOkr(input: {
    acceptance: HandoverAcceptance;
    capabilityId: string;
    expectedRecordRevision: bigint | string | number;
    keyVersion: bigint | string | number;
    encryptedAgreement: Uint8Array;
    tx?: Transaction;
  }): Promise<Transaction> {
    const a = structuredClone(input.acceptance),
      p = a.proposal;
    await verifyHandoverAcceptanceSignature(a, a.host_address);
    if (
      input.encryptedAgreement.length < 32 ||
      input.encryptedAgreement.length > 65536
    )
      throw new Error("Encrypted agreement must be 32..65536 bytes.");
    const signature = a.signature.split(":")[2];
    const tx = this.fm.useTransaction(input.tx);
    tx.moveCall({
      target: `${this.fm.packageId}::handover::confirm_okr`,
      arguments: [
        ...[
          p.okr_id,
          a.organization_id,
          a.human_id,
          a.grant_id,
          a.membership_id,
          a.binding_id,
          p.managed_agent_id,
          a.execution_id,
          id(input.capabilityId),
        ].map((value) => tx.object(value)),
        ...[p.managed_version, p.okr_version, p.spec_revision].map((value) =>
          tx.pure.u64(positiveU64(value)),
        ),
        tx.pure.vector("u8", hex32(p.workspace_hash)),
        tx.pure.vector("u8", executionBoundaryHash(p.paths)),
        tx.pure.string(p.budget_asset),
        tx.pure.u64(positiveU64(p.budget_limit)),
        tx.pure.u64(positiveU64(p.max_calls)),
        tx.pure.u64(p.expires_at_ms),
        tx.pure.u64(p.review_expires_at_ms),
        tx.pure.vector("u8", hex32(p.nonce)),
        tx.pure.u64(positiveU64(a.coverage_revision)),
        tx.pure.u64(a.observed_at_ms),
        tx.pure.vector("u8", hexToBytes(signature)),
        tx.pure.u64(toBigInt(input.expectedRecordRevision)),
        tx.pure.u64(positiveU64(toBigInt(input.keyVersion).toString())),
        bytesArgument(tx, this.fm.packageId, input.encryptedAgreement.slice()),
        tx.object("0x6"),
      ],
    });
    return tx;
  }
  async getApproval(approvalId: string) {
    const expectedId = id(approvalId);
    const { object } = await this.fm.client.core.getObject({
      objectId: expectedId,
      include: { content: true },
    });
    if (
      object.objectId !== expectedId ||
      object.type !== `${this.fm.typesPackageId}::handover::Approval` ||
      object.owner.$kind !== "Shared" ||
      !object.content
    )
      throw new Error("Invalid handover approval source.");
    const value = HandoverApprovalBcs.parse(object.content);
    if (
      value.id !== expectedId ||
      BigInt(value.managed_version) !==
        BigInt(value.proposal.managed_version) + 1n ||
      BigInt(value.agreement_version) < 1n
    )
      throw new Error("Invalid handover approval versions.");
    return value;
  }
  async getPolicy(okrId: string) {
    const { dynamicField } = await this.fm.client.core.getDynamicField({
      parentId: id(okrId),
      name: {
        type: `${this.fm.typesPackageId}::okr::HandoverPolicyKey`,
        bcs: new Uint8Array([0]),
      },
    });
    if (
      dynamicField.value.type !==
      `${this.fm.typesPackageId}::okr::HandoverPolicy`
    )
      throw new Error("Invalid handover policy source.");
    const value = HandoverPolicyBcs.parse(dynamicField.value.bcs);
    if (
      BigInt(value.max_calls) < 1n ||
      BigInt(value.max_calls) > 1000n ||
      BigInt(value.agreement_version) < 1n ||
      BigInt(value.managed_version) < 1n ||
      value.nonce.length !== 32 ||
      value.proposal_hash.length !== 32
    )
      throw new Error("Invalid handover policy.");
    return value;
  }
}
