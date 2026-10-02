import { bcs, TypeTagSerializer } from "@mysten/sui/bcs";
import type {
  Transaction,
  TransactionArgument,
} from "@mysten/sui/transactions";
import { deriveDynamicFieldID, normalizeSuiAddress, normalizeStructTag } from "@mysten/sui/utils";
import { FractalMindClient, toBigInt } from "./client.js";
import { executionBoundaryHash } from "./execution-boundary.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { HostMembershipBcs, ManagedAgentBcs } from "./host.js";
import { RemoteAuthorityApi } from "./remote-authority.js";
import { bytesArgument } from "./wire-bytes.js";
import type { SignedNodeCommand } from "./types.js";

const ID = bcs.Address,
  Bytes = bcs.vector(bcs.u8());
const Table = bcs.struct("Table", { id: ID, size: bcs.u64() });
export const StandingPermissionBcs = bcs.struct("StandingPermission", {
  id: ID,
  org_id: ID,
  owner_human: ID,
  human_generation: bcs.u64(),
  managed_agent: ID,
  managed_version: bcs.u64(),
  membership_id: ID,
  membership_version: bcs.u64(),
  host_address: ID,
  workspace_hash: Bytes,
  version: bcs.u64(),
  revoked: bcs.bool(),
  allowed_actions: bcs.vector(bcs.string()),
  boundary_hash: Bytes,
  max_calls: bcs.u64(),
  budget_limit: bcs.u64(),
  spent: bcs.u64(),
  reserved: bcs.u64(),
  approved_spent: bcs.u64(),
  approved_reserved: bcs.u64(),
  expires_at_ms: bcs.u64(),
  approved_device: ID,
  approved_grant: ID,
  permission_record: ID,
  record_revision: bcs.u64(),
  messages: Table,
  approvals: Table,
  message_runs: Table,
  claims: Table,
});
export const DirectMessageBcs = bcs.struct("Message", {
  id: ID,
  org_id: ID,
  permission_id: ID,
  permission_version: bcs.u64(),
  managed_agent: ID,
  managed_version: bcs.u64(),
  membership_id: ID,
  conversation_id: bcs.string(),
  message_token: bcs.string(),
  action: bcs.string(),
  boundary_hash: Bytes,
  budget_amount: bcs.u64(),
  request_hash: Bytes,
  human_id: ID,
  human_generation: bcs.u64(),
  writer_device: ID,
  grant_id: ID,
  grant_version: bcs.u64(),
  created_at_ms: bcs.u64(),
  expires_at_ms: bcs.u64(),
  encrypted_record: ID,
});
export const DirectApprovalBcs = bcs.struct("Approval", {
  id: ID,
  org_id: ID,
  permission_id: ID,
  permission_version: bcs.u64(),
  message_id: ID,
  managed_agent: ID,
  managed_version: bcs.u64(),
  action: bcs.string(),
  boundary_hash: Bytes,
  budget_amount: bcs.u64(),
  workspace_revision: bcs.u64(),
  state: bcs.u8(),
  expires_at_ms: bcs.u64(),
  approved_device: ID,
  approved_grant: bcs.option(ID),
  grant_version: bcs.u64(),
  human_generation: bcs.u64(),
  encrypted_record: ID,
});
export const DirectClaimBcs = bcs.struct("DirectClaim", {
  capability_id: ID,
  message_id: ID,
  permission_version: bcs.u64(),
  approval_id: bcs.option(ID),
  reserved: bcs.u64(),
  spent: bcs.u64(),
  settled: bcs.bool(),
});
const PermissionIndex = bcs.struct("PermissionIndex", { source: bcs.struct("TypeName", { name: bcs.string() }), agents: Table });
const PermissionBinding = bcs.struct("PermissionCapability", {
  permission_id: ID,
  permission_version: bcs.u64(),
  approval_id: bcs.option(ID),
});
const CommandBinding = bcs.struct("DirectCommandBinding", {
  permission_id: ID,
  permission_version: bcs.u64(),
  message_id: ID,
  approval_id: bcs.option(ID),
});
const CommandKey = bcs.struct("DirectCommandKey", { intent_hash: Bytes });
export const DIRECT_ACTIONS = [
  "ask",
  "status",
  "file.read",
  "file.write",
] as const;
export type DirectAction = (typeof DIRECT_ACTIONS)[number];
export const DIRECT_APPROVAL_STATES = Object.freeze({
  pending: 0,
  approved: 1,
  rejected: 2,
  consumed: 3,
});
type U64 = bigint | string | number;
type Authorized = {
  organizationId: string;
  humanId: string;
  grantId: string;
  tx?: Transaction;
};
export type DirectAuthority = Authorized & {
  membershipId: string;
  bindingId: string;
  managedAgentId: string;
};
type Body = { keyVersion: U64; encryptedBody: Uint8Array };
type Policy = {
  actions: DirectAction[];
  paths: Record<string, string[]>;
  maxCalls: U64;
  budgetLimit: U64;
  expiresAtMs: U64;
};
export interface DirectMessageContext {
  version: "1";
  permission_id: string;
  permission_version: string;
  message_id: string;
  conversation_id: string;
  message_token: string;
  message_record_id: string;
  action: DirectAction;
  approval_id?: string;
  approving_grant_id?: string;
}
export interface DirectRequest {
  message: string;
  task?: string;
  bounds: { paths: Record<string, string[]>; max_calls: string };
}
const RequestBcs = bcs.struct("DirectRequest", {
  version: bcs.u8(),
  action: bcs.string(),
  message: bcs.string(),
  task: bcs.string(),
  boundary: Bytes,
  max_calls: bcs.u64(),
});
/** Content hash does not contain the not-yet-created Message ID. It binds the
 * actual request body as well as the independently enforced tool boundary. */
export function directRequestHash(
  request: DirectRequest,
  requestedAction: DirectAction,
): Uint8Array {
  action(requestedAction);
  const validText = (
    value: unknown,
    max: number,
    empty = false,
  ): value is string => {
    if (typeof value !== "string") return false;
    const encoded = new TextEncoder().encode(value);
    return (
      (empty || encoded.length > 0) &&
      encoded.length <= max &&
      new TextDecoder("utf-8", { fatal: true }).decode(encoded) === value
    );
  };
  if (
    !request ||
    !validText(request.message, 4096) ||
    !validText(request.task ?? "", 16384, true) ||
    !request.bounds ||
    typeof request.bounds.max_calls !== "string"
  )
    throw new Error("Invalid direct request body.");
  const calls = toBigInt(request.bounds.max_calls);
  if (
    calls > 1000n ||
    ["ask", "status"].includes(requestedAction) !== (calls === 0n) ||
    (["ask", "status"].includes(requestedAction) && Boolean(request.task))
  )
    throw new Error("Invalid direct request tool budget or task.");
  const encoded = RequestBcs.serialize({
    version: 1,
    action: requestedAction,
    message: request.message,
    task: request.task ?? "",
    boundary: executionBoundaryHash(request.bounds.paths),
    max_calls: calls,
  }).toBytes();
  const prefix = new TextEncoder().encode("fractalmind.direct-request.v1"),
    input = new Uint8Array(prefix.length + encoded.length);
  input.set(prefix);
  input.set(encoded, prefix.length);
  return sha256(input);
}
const canonicalId = (value: unknown): string => {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/.test(value))
    throw new Error("Canonical direct object ID required.");
  return value;
};
function token(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Direct conversation/message token required.");
  const encoded = new TextEncoder().encode(value);
  if (
    !encoded.length ||
    encoded.length > 64 ||
    new TextDecoder("utf-8", { fatal: true }).decode(encoded) !== value
  )
    throw new Error("Invalid direct conversation/message token.");
  return value;
}
function action(value: unknown): DirectAction {
  if (
    typeof value !== "string" ||
    !DIRECT_ACTIONS.includes(value as DirectAction)
  )
    throw new Error("Unsupported direct action.");
  return value as DirectAction;
}
const equalBytes = (a: number[] | Uint8Array, b: number[] | Uint8Array) =>
  a.length === b.length && a.every((value, i) => value === b[i]);
export function directMessageRecordName(
  messageToken: string,
  approval = false,
) {
  return `${approval ? "direct-approval-" : "direct-message-"}${token(messageToken)}`;
}
/** Validate the signed context. Chain source and signature checks remain
 * separate; parsing never confers execution authority. */
export function parseDirectMessageContext(
  value: unknown,
): DirectMessageContext {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Signed direct context required.");
  const d = value as Record<string, unknown>;
  const keys = [
    "version",
    "permission_id",
    "permission_version",
    "message_id",
    "conversation_id",
    "message_token",
    "message_record_id",
    "action",
    "approval_id",
    "approving_grant_id",
  ];
  if (
    Object.keys(d).some((key) => !keys.includes(key)) ||
    d.version !== "1" ||
    typeof d.permission_version !== "string" ||
    toBigInt(d.permission_version) < 1n
  )
    throw new Error("Invalid signed direct context.");
  const result: DirectMessageContext = {
    version: "1",
    permission_id: canonicalId(d.permission_id),
    permission_version: d.permission_version,
    message_id: canonicalId(d.message_id),
    conversation_id: token(d.conversation_id),
    message_token: token(d.message_token),
    message_record_id: canonicalId(d.message_record_id),
    action: action(d.action),
  };
  if ("approval_id" in d || "approving_grant_id" in d) {
    result.approval_id = canonicalId(d.approval_id);
    result.approving_grant_id = canonicalId(d.approving_grant_id);
  }
  return result;
}

/** Fixed-instance encrypted interaction, using the existing capability/Run
 * state machine. Builders never sign, pay, dispatch, retry or change an OKR. */
export class DirectAgentApi {
  constructor(private readonly fm: FractalMindClient) {}
  private call(tx: Transaction, name: string, args: TransactionArgument[]) {
    tx.moveCall({
      target: `${this.fm.directPackageId}::direct_agent::${name}`,
      arguments: args,
    });
    return tx;
  }
  private authorized(tx: Transaction, input: Authorized) {
    return [
      tx.object(input.organizationId),
      tx.object(input.humanId),
      tx.object(input.grantId),
    ];
  }
  private authority(tx: Transaction, input: DirectAuthority) {
    return [
      ...this.authorized(tx, input),
      tx.object(input.membershipId),
      tx.object(input.bindingId),
      tx.object(input.managedAgentId),
    ];
  }
  private body(tx: Transaction, input: Body) {
    if (toBigInt(input.keyVersion) < 1n)
      throw new Error("Positive encryption key version required.");
    return [
      tx.pure.u64(toBigInt(input.keyVersion)),
      bytesArgument(tx, this.fm.packageId, input.encryptedBody.slice()),
    ];
  }
  private policy(tx: Transaction, input: Policy) {
    const actions = input.actions.map(action),
      calls = toBigInt(input.maxCalls),
      limit = toBigInt(input.budgetLimit);
    if (
      actions.length > 4 ||
      new Set(actions).size !== actions.length ||
      calls > 1000n ||
      calls > limit ||
      toBigInt(input.expiresAtMs) < 1n
    )
      throw new Error("Invalid standing permission.");
    return [
      tx.pure.vector("string", actions),
      tx.pure.vector("u8", executionBoundaryHash(input.paths)),
      tx.pure.u64(calls),
      tx.pure.u64(limit),
      tx.pure.u64(toBigInt(input.expiresAtMs)),
    ];
  }
  createPermission(input: DirectAuthority & Policy & Body) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, "create_permission", [
      ...this.authority(tx, input),
      ...this.policy(tx, input),
      ...this.body(tx, input),
      tx.object("0x6"),
    ]);
  }
  updatePermission(
    input: DirectAuthority &
      Policy &
      Body & { permissionId: string; expectedVersion: U64 },
  ) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, "update_permission", [
      tx.object(input.permissionId),
      ...this.authority(tx, input),
      tx.pure.u64(toBigInt(input.expectedVersion)),
      ...this.policy(tx, input),
      ...this.body(tx, input),
      tx.object("0x6"),
    ]);
  }
  revokePermission(
    input: Authorized & { permissionId: string; expectedVersion: U64 },
  ) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, "revoke_permission", [
      tx.object(input.permissionId),
      ...this.authorized(tx, input),
      tx.pure.u64(toBigInt(input.expectedVersion)),
      tx.object("0x6"),
    ]);
  }
  createMessage(
    input: DirectAuthority &
      Body & {
        permissionId: string;
        expectedVersion: U64;
        conversationId: string;
        messageToken: string;
        action: DirectAction;
        paths: Record<string, string[]>;
        budgetAmount: U64;
        requestHash: Uint8Array;
        expiresAtMs: U64;
      },
  ) {
    const requestedAction = action(input.action),
      amount = toBigInt(input.budgetAmount);
    if (
      amount > 1000n ||
      ["ask", "status"].includes(requestedAction) !== (amount === 0n) ||
      input.requestHash.length !== 32
    )
      throw new Error("Direct action, request hash and tool budget disagree.");
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, "create_message", [
      tx.object(input.permissionId),
      ...this.authority(tx, input),
      tx.pure.u64(toBigInt(input.expectedVersion)),
      tx.pure.string(token(input.conversationId)),
      tx.pure.string(token(input.messageToken)),
      tx.pure.string(requestedAction),
      tx.pure.vector("u8", executionBoundaryHash(input.paths)),
      tx.pure.u64(amount),
      tx.pure.vector("u8", input.requestHash.slice()),
      tx.pure.u64(toBigInt(input.expiresAtMs)),
      ...this.body(tx, input),
      tx.object("0x6"),
    ]);
  }
  requestApproval(
    input: DirectAuthority & Body & { permissionId: string; messageId: string },
  ) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, "request_approval", [
      tx.object(input.permissionId),
      tx.object(input.messageId),
      ...this.authority(tx, input),
      ...this.body(tx, input),
      tx.object("0x6"),
    ]);
  }
  decideApproval(
    input: DirectAuthority &
      Body & {
        permissionId: string;
        approvalId: string;
        messageId: string;
        approve: boolean;
      },
  ) {
    if (typeof input.approve !== "boolean")
      throw new Error("Explicit approval decision required.");
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, "decide_approval", [
      tx.object(input.permissionId),
      tx.object(input.approvalId),
      tx.object(input.messageId),
      ...this.authority(tx, input),
      tx.pure.bool(input.approve),
      ...this.body(tx, input),
      tx.object("0x6"),
    ]);
  }
  issueCapability(
    input: DirectAuthority & {
      permissionId: string;
      expectedVersion: U64;
      expiresAtMs: U64;
    },
  ) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, "issue_capability", [
      tx.object(input.permissionId),
      ...this.authority(tx, input),
      tx.pure.u64(toBigInt(input.expectedVersion)),
      tx.pure.u64(toBigInt(input.expiresAtMs)),
      tx.object("0x6"),
    ]);
  }
  issueApprovedCapability(
    input: DirectAuthority & {
      permissionId: string;
      approvalId: string;
      messageId: string;
      approvingGrantId: string;
    },
  ) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, "issue_approved_capability", [
      tx.object(input.permissionId),
      tx.object(input.approvalId),
      tx.object(input.messageId),
      ...this.authorized(tx, input),
      tx.object(input.approvingGrantId),
      tx.object(input.membershipId),
      tx.object(input.bindingId),
      tx.object(input.managedAgentId),
      tx.object("0x6"),
    ]);
  }
  beginMessage(
    input: DirectAuthority & {
      permissionId: string;
      messageId: string;
      executionId: string;
      capabilityId: string;
      approvalId?: string;
      approvingGrantId?: string;
      attemptId?: Uint8Array;
    },
  ) {
    if (Boolean(input.approvalId) !== Boolean(input.approvingGrantId))
      throw new Error(
        "Approval and approving device grant must be supplied together.",
      );
    const attempt =
      input.attemptId?.slice() ??
      globalThis.crypto.getRandomValues(new Uint8Array(32));
    if (attempt.length !== 32)
      throw new Error("32-byte original attempt ID required.");
    const tx = this.fm.useTransaction(input.tx);
    const args = [
      tx.object(input.permissionId),
      ...(input.approvalId ? [tx.object(input.approvalId)] : []),
      tx.object(input.messageId),
      tx.object(input.executionId),
      tx.object(input.capabilityId),
      ...this.authorized(tx, input),
      ...(input.approvingGrantId ? [tx.object(input.approvingGrantId)] : []),
      tx.object(input.membershipId),
      tx.object(input.bindingId),
      tx.object(input.managedAgentId),
      tx.pure.vector("u8", attempt),
      tx.object("0x6"),
    ];
    return this.call(
      tx,
      input.approvalId ? "begin_approved_message" : "begin_message",
      args,
    );
  }
  finishMessage(input: {
    permissionId: string;
    executionId: string;
    capabilityId: string;
    organizationId: string;
    finalState: number;
    expectedCursor: U64;
    spentAmount: U64;
    keyVersion: U64;
    encryptedResult: Uint8Array;
    tx?: Transaction;
  }) {
    if (
      ![2, 3, 4, 5].includes(input.finalState) ||
      (input.finalState === 4 && toBigInt(input.spentAmount) !== 0n)
    )
      throw new Error("Unknown direct execution must retain its budget.");
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, "finish_message", [
      tx.object(input.permissionId),
      tx.object(input.executionId),
      tx.object(input.capabilityId),
      tx.object(input.organizationId),
      tx.pure.u8(input.finalState),
      tx.pure.u64(toBigInt(input.expectedCursor)),
      tx.pure.u64(toBigInt(input.spentAmount)),
      ...this.body(tx, {
        keyVersion: input.keyVersion,
        encryptedBody: input.encryptedResult,
      }),
      tx.object("0x6"),
    ]);
  }
  requestStop(
    input: Authorized & {
      permissionId: string;
      executionId: string;
      capabilityId: string;
    },
  ) {
    const tx = this.fm.useTransaction(input.tx);
    return this.call(tx, "request_stop", [
      tx.object(input.permissionId),
      tx.object(input.executionId),
      tx.object(input.capabilityId),
      ...this.authorized(tx, input),
      tx.object("0x6"),
    ]);
  }
  private async object(
    objectId: string,
    name: string,
    owner: "Shared" | "Immutable",
    module = "direct_agent",
  ) {
    const expectedId = normalizeSuiAddress(objectId),
      { object } = await this.fm.client.core.getObject({
        objectId: expectedId,
        include: { content: true },
      });
    if (
      object.objectId !== expectedId ||
      object.type !== `${module === "direct_agent" ? this.fm.directTypesPackageId : this.fm.typesPackageId}::${module}::${name}` ||
      object.owner.$kind !== owner ||
      !object.content
    )
      throw new Error("Invalid direct object source.");
    return object.content;
  }
  private async field(
    parentId: string,
    type: string,
    name: { type: string; bcs: Uint8Array },
  ) {
    const { dynamicField } = await this.fm.client.core.getDynamicField({
      parentId: normalizeSuiAddress(parentId),
      name,
    });
    if (normalizeStructTag(dynamicField.value.type) !== normalizeStructTag(type))
      throw new Error("Invalid direct index/binding source.");
    return dynamicField.value.bcs;
  }
  async getPermission(permissionId: string) {
    const p = StandingPermissionBcs.parse(
      await this.object(permissionId, "StandingPermission", "Shared"),
    );
    if (
      p.id !== normalizeSuiAddress(permissionId) ||
      BigInt(p.version) < 1n ||
      BigInt(p.human_generation) < 1n ||
      BigInt(p.managed_version) < 1n ||
      BigInt(p.membership_version) < 1n ||
      BigInt(p.record_revision) < 1n ||
      p.workspace_hash.length !== 32 ||
      p.boundary_hash.length !== 32 ||
      p.allowed_actions.length > 4 ||
      new Set(p.allowed_actions).size !== p.allowed_actions.length ||
      p.allowed_actions.some(
        (x) => !DIRECT_ACTIONS.includes(x as DirectAction),
      ) ||
      BigInt(p.max_calls) > 1000n ||
      BigInt(p.max_calls) > BigInt(p.budget_limit) ||
      BigInt(p.spent) + BigInt(p.reserved) > BigInt(p.budget_limit)
    )
      throw new Error("Invalid standing permission state.");
    return p;
  }
  async getPermissionForAgent(organizationId: string, managedAgentId: string) {
    const org = normalizeSuiAddress(organizationId),
      managed = normalizeSuiAddress(managedAgentId),
      module = `${this.fm.directTypesPackageId}::direct_agent`;
    const index = PermissionIndex.parse(
      await this.field(org, `${this.fm.typesPackageId}::execution_extension::PermissionIndex`, {
        type: `${this.fm.typesPackageId}::execution_extension::IndexKey`,
        bcs: new Uint8Array([0]),
      }),
    );
    if (index.source.name !== `${this.fm.directTypesPackageId.slice(2)}::direct_agent::Witness`) throw new Error("Unexpected direct extension source.");
    const pointer = ID.parse(
      await this.field(index.agents.id, "0x2::object::ID", {
        type: "0x2::object::ID",
        bcs: ID.serialize(managed).toBytes(),
      }),
    );
    const permission = await this.getPermission(pointer);
    if (permission.org_id !== org || permission.managed_agent !== managed)
      throw new Error("Direct permission belongs to another instance.");
    return permission;
  }
  async getMessage(messageId: string) {
    const m = DirectMessageBcs.parse(
      await this.object(messageId, "Message", "Immutable"),
    );
    if (
      m.id !== normalizeSuiAddress(messageId) ||
      BigInt(m.permission_version) < 1n ||
      BigInt(m.managed_version) < 1n ||
      BigInt(m.human_generation) < 1n ||
      BigInt(m.grant_version) < 1n ||
      m.boundary_hash.length !== 32 ||
      m.request_hash.length !== 32 ||
      BigInt(m.budget_amount) > 1000n ||
      ["ask", "status"].includes(action(m.action)) !==
        (BigInt(m.budget_amount) === 0n) ||
      BigInt(m.expires_at_ms) <= BigInt(m.created_at_ms) ||
      BigInt(m.expires_at_ms) - BigInt(m.created_at_ms) > 300000n
    )
      throw new Error("Invalid immutable direct message.");
    token(m.conversation_id);
    token(m.message_token);
    return m;
  }
  async getApproval(approvalId: string) {
    const a = DirectApprovalBcs.parse(
      await this.object(approvalId, "Approval", "Shared"),
    );
    if (
      a.id !== normalizeSuiAddress(approvalId) ||
      a.state > 3 ||
      BigInt(a.permission_version) < 1n ||
      BigInt(a.managed_version) < 1n ||
      BigInt(a.human_generation) < 1n ||
      a.boundary_hash.length !== 32 ||
      BigInt(a.budget_amount) > 1000n ||
      (a.state === 0
        ? a.approved_grant !== null || BigInt(a.grant_version) !== 0n
        : a.approved_grant === null || BigInt(a.grant_version) < 1n)
    )
      throw new Error("Invalid direct approval state.");
    action(a.action);
    return a;
  }
  async getCapabilityBinding(capabilityId: string) {
    const module = `${this.fm.directTypesPackageId}::direct_agent`;
    return PermissionBinding.parse(
      await this.field(capabilityId, `${module}::PermissionCapability`, {
        type: `${this.fm.typesPackageId}::execution_extension::FieldKey<${module}::Witness>`,
        bcs: Bytes.serialize(Array.from(new TextEncoder().encode("permission"))).toBytes(),
      }),
    );
  }
  async getCommandBinding(capabilityId: string, intentHash: Uint8Array) {
    if (intentHash.length !== 32)
      throw new Error("32-byte signed intent required.");
    const module = `${this.fm.directTypesPackageId}::direct_agent`;
    return CommandBinding.parse(
      await this.field(capabilityId, `${module}::DirectCommandBinding`, {
        type: `${this.fm.typesPackageId}::execution_extension::FieldKey<${module}::Witness>`,
        bcs: Bytes.serialize(Array.from(intentHash)).toBytes(),
      }),
    );
  }
  async getClaim(permissionId: string, executionId: string) {
    const permission = await this.getPermission(permissionId),
      module = `${this.fm.directTypesPackageId}::direct_agent`;
    const claim = DirectClaimBcs.parse(
      await this.field(permission.claims.id, `${module}::DirectClaim`, {
        type: "0x2::object::ID",
        bcs: ID.serialize(normalizeSuiAddress(executionId)).toBytes(),
      }),
    );
    if (
      BigInt(claim.spent) > BigInt(claim.reserved) ||
      (!claim.settled && BigInt(claim.spent) !== 0n) ||
      BigInt(claim.permission_version) < 1n ||
      BigInt(claim.permission_version) > BigInt(permission.version)
    )
      throw new Error("Invalid direct reservation.");
    return claim;
  }
  /** Historical message index, from Sui rather than a local conversation store.
   * A changing permission snapshot requires an explicit new read. */
  async listMessages(permissionId: string) {
    const before = await this.getPermission(permissionId),
      ids = new Set<string>(),
      cursors = new Set<string>(),
      messages = [];
    let cursor: string | null = null;
    do {
      const page = await this.fm.client.core.listDynamicFields({
        parentId: before.messages.id,
        cursor,
        limit: 100,
      });
      if (page.hasNextPage && (!page.cursor || cursors.has(page.cursor)))
        throw new Error("Invalid direct message pagination.");
      if (page.cursor) cursors.add(page.cursor);
      for (const field of page.dynamicFields) {
        if (
          ![
            `${normalizeSuiAddress("0x1")}::string::String`,
            "0x1::string::String",
          ].includes(field.name.type)
        )
          throw new Error("Invalid direct message index name.");
        const messageToken = token(bcs.string().parse(field.name.bcs));
        const messageId = ID.parse(
          await this.field(before.messages.id, "0x2::object::ID", field.name),
        );
        if (ids.has(messageId))
          throw new Error("Duplicate direct message pointer.");
        ids.add(messageId);
        const m = await this.getMessage(messageId);
        if (
          m.permission_id !== before.id ||
          m.org_id !== before.org_id ||
          m.managed_agent !== before.managed_agent ||
          m.message_token !== messageToken ||
          BigInt(m.permission_version) > BigInt(before.version)
        )
          throw new Error("Direct message index and source disagree.");
        messages.push(m);
      }
      cursor = page.hasNextPage ? page.cursor : null;
    } while (cursor);
    if (
      BigInt(messages.length) !== BigInt(before.messages.size) ||
      JSON.stringify(before) !==
        JSON.stringify(await this.getPermission(permissionId))
    )
      throw new Error("Direct conversation changed during read.");
    return messages.sort((a, b) =>
      BigInt(a.created_at_ms) < BigInt(b.created_at_ms)
        ? -1
        : BigInt(a.created_at_ms) > BigInt(b.created_at_ms)
          ? 1
          : a.id.localeCompare(b.id),
    );
  }
  /** Exact absence is distinct from a corrupt index or network failure. */
  isMissingPermissionIndex(error: unknown, organizationId: string) {
    const type = `${this.fm.typesPackageId}::execution_extension::IndexKey`;
    const expected = deriveDynamicFieldID(
      normalizeSuiAddress(organizationId),
      TypeTagSerializer.parseFromStr(type),
      new Uint8Array([0]),
    );
    return Boolean(
      error &&
        typeof error === "object" &&
        "reason" in error &&
        error.reason === "notFound" &&
        "objectId" in error &&
        error.objectId === expected,
    );
  }
  async assertCommandContext(
    command: SignedNodeCommand,
    authority: Omit<DirectAuthority, "organizationId" | "tx">,
  ) {
    if (
      command.action !== "direct.message" ||
      command.scope !== "direct" ||
      !authority.managedAgentId ||
      "okr" in (command.payload ?? {})
    )
      throw new Error(
        "Direct commands require a fixed instance and standing permission.",
      );
    const d = parseDirectMessageContext(command.payload?.direct);
    const [p, m, binding, managedContent, memberContent, cap] =
      await Promise.all([
        this.getPermission(d.permission_id),
        this.getMessage(d.message_id),
        this.getCapabilityBinding(command.capability.id),
        this.object(authority.managedAgentId, "ManagedAgent", "Shared", "host"),
        this.object(authority.membershipId, "HostMembership", "Shared", "host"),
        new RemoteAuthorityApi(this.fm).getCapability(command.capability.id),
      ]);
    const managed = ManagedAgentBcs.parse(managedContent),
      member = HostMembershipBcs.parse(memberContent);
    const bounds = command.payload?.bounds as
      | DirectRequest["bounds"]
      | undefined;
    if (
      Object.keys(command.payload ?? {}).some(
        (key) => !["direct", "message", "task", "bounds"].includes(key),
      ) ||
      !bounds?.paths ||
      typeof bounds.max_calls !== "string"
    )
      throw new Error("Signed direct tool bounds required.");
    const requestHash = directRequestHash(
      {
        message: command.payload?.message as string,
        task: command.payload?.task as string | undefined,
        bounds,
      },
      d.action,
    );
    const amount = BigInt(bounds.max_calls);
    if (
      managed.id !== normalizeSuiAddress(authority.managedAgentId) ||
      managed.org_id !== p.org_id ||
      managed.membership_id !== p.membership_id ||
      managed.host_address !== command.target.node_id ||
      managed.instance_id !== command.target.agent_id ||
      managed.version !== p.managed_version ||
      managed.revoked ||
      !managed.control_confirmed ||
      managed.runtime !== "bounded-process-v1" ||
      !equalBytes(managed.workspace_hash, p.workspace_hash) ||
      member.id !== p.membership_id ||
      member.org_id !== p.org_id ||
      member.host_address !== p.host_address ||
      member.host_address !== managed.host_address ||
      member.version !== p.membership_version ||
      member.revoked ||
      member.coordinator_binding !== normalizeSuiAddress(authority.bindingId) ||
      cap.objectId !== command.capability.id ||
      cap.type !==
        `${this.fm.typesPackageId}::remote_authority::RemoteCapability` ||
      cap.orgId !== p.org_id ||
      cap.targetKind !== 3 ||
      cap.nodeId !== command.target.node_id ||
      cap.agentId !== command.target.agent_id ||
      cap.delegate !== command.signer ||
      cap.parentId !== null ||
      cap.scope !== "direct" ||
      cap.actions.length !== 1 ||
      cap.actions[0] !== "direct.message" ||
      cap.revoked ||
      cap.revocationVersion !==
        toBigInt(command.capability.revocation_version) ||
      p.revoked ||
      p.version !== d.permission_version ||
      p.org_id !== command.target.organization_id ||
      p.owner_human !== normalizeSuiAddress(authority.humanId) ||
      p.managed_agent !== normalizeSuiAddress(authority.managedAgentId) ||
      p.membership_id !== normalizeSuiAddress(authority.membershipId) ||
      m.permission_id !== p.id ||
      m.permission_version !== p.version ||
      m.org_id !== p.org_id ||
      m.managed_agent !== p.managed_agent ||
      m.managed_version !== p.managed_version ||
      m.membership_id !== p.membership_id ||
      m.human_id !== p.owner_human ||
      m.human_generation !== p.human_generation ||
      m.writer_device !== command.signer ||
      m.grant_id !== normalizeSuiAddress(authority.grantId) ||
      m.conversation_id !== d.conversation_id ||
      m.message_token !== d.message_token ||
      m.encrypted_record !== d.message_record_id ||
      m.action !== d.action ||
      amount !== BigInt(m.budget_amount) ||
      amount !== toBigInt(command.budget?.amount ?? 0) ||
      (amount === 0n
        ? (command.budget?.asset ?? "") !== ""
        : command.budget?.asset !== "TOOL_CALLS") ||
      !equalBytes(m.boundary_hash, executionBoundaryHash(bounds.paths)) ||
      !equalBytes(m.request_hash, requestHash) ||
      BigInt(command.issued_at_ms) < BigInt(m.created_at_ms) ||
      BigInt(command.expires_at_ms) > BigInt(m.expires_at_ms) ||
      BigInt(m.expires_at_ms) > BigInt(p.expires_at_ms) ||
      BigInt(command.expires_at_ms) > BigInt(member.expires_at_ms) ||
      BigInt(command.expires_at_ms) > cap.expiresAtMs ||
      binding.permission_id !== p.id ||
      binding.permission_version !== p.version ||
      binding.approval_id !== (d.approval_id ?? null)
    )
      throw new Error(
        "Signed direct message, permission or reservation context changed.",
      );
    if (d.approval_id) {
      const a = await this.getApproval(d.approval_id);
      if (
        a.org_id !== p.org_id ||
        a.permission_id !== p.id ||
        a.permission_version !== p.version ||
        a.managed_agent !== p.managed_agent ||
        a.managed_version !== p.managed_version ||
        a.human_generation !== p.human_generation ||
        a.message_id !== m.id ||
        a.action !== m.action ||
        !equalBytes(a.boundary_hash, m.boundary_hash) ||
        a.budget_amount !== m.budget_amount ||
        ![1, 3].includes(a.state) ||
        a.approved_grant !== d.approving_grant_id ||
        BigInt(command.expires_at_ms) > BigInt(a.expires_at_ms)
      )
        throw new Error(
          "Direct approval does not authorize this exact message.",
        );
    }
    return d;
  }
}
