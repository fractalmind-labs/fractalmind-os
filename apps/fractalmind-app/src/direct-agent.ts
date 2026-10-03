import { bcs } from "@mysten/sui/bcs";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  bytesToHex,
  directMessageRecordName,
  directRequestHash,
  executionBoundaryHash,
  nodeCommandIntentHash,
  SelfPayTransactionManager,
  signNodeCommand,
  type DirectAction,
  type DirectRequest,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type SignedNodeCommand,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import { hostDirectory } from "./host-admission";
import { managedInstance } from "./agent-import";
import { canonical } from "./handover-plan";
import {
  NativeDeviceSigner,
  call,
  scopedNativeInvoke,
  type NativeInvoke,
} from "./native-device";
import { PrivateRecords } from "./private-records";
import { NativeCommandResults } from "./command-results";
import { NativeExecutionResults } from "./execution-results";
import { CoordinatorReadClient } from "./coordinator-read";
import { awaitTransactionVisible } from "./transaction-visibility";

export class DirectAgentError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "invalid_source"
      | "state_changed"
      | "invalid_quote"
      | "approval_required"
      | "sync_pending"
      | "delivery_unknown"
      | "unsupported_action",
  ) {
    super(code);
  }
}
const id = /^0x[0-9a-f]{64}$/;
const token = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type StandingInput = {
  actions: DirectAction[];
  paths: Record<string, string[]>;
  maxCalls: string;
  budgetLimit: string;
  expiresAtMs: string;
};
export type DirectOperation =
  | {
      kind: "permission";
      expectedVersion: string | null;
      policy: StandingInput;
    }
  | { kind: "revoke"; expectedVersion: string }
  | {
      kind: "message";
      messageToken: string;
      action: DirectAction;
      request: DirectRequest;
    }
  | { kind: "approval" | "capability" | "stop"; messageId: string }
  | { kind: "decision"; messageId: string; approve: boolean }
  | { kind: "run"; messageId: string; capabilityId: string };
export type DirectMessageView = Awaited<
  ReturnType<NativeDirectAgent["message"]>
>;
const equal = (a: number[] | Uint8Array, b: number[] | Uint8Array) =>
  bytesToHex(Uint8Array.from(a)) === bytesToHex(Uint8Array.from(b));
/** Display only a Host-receipted model answer, always as unverified text. */
export function modelReply(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, any>;
  if (
    v.schema !== "fractalmind.model-reply.v1" ||
    v.status !== "answered" ||
    v.verified !== false ||
    typeof v.reply?.text !== "string" ||
    !v.reply.text ||
    typeof v.reply.model !== "string" ||
    !v.reply.model ||
    !Number.isSafeInteger(v.reply.usage?.input_tokens) ||
    v.reply.usage.input_tokens < 0 ||
    !Number.isSafeInteger(v.reply.usage?.output_tokens) ||
    v.reply.usage.output_tokens < 0
  )
    return null;
  return {
    text: v.reply.text as string,
    model: v.reply.model as string,
    inputTokens: v.reply.usage.input_tokens as number,
    outputTokens: v.reply.usage.output_tokens as number,
  };
}
/** A request declares its own bounds. A difference from standing authority
 * requires exact approval; it does not edit or expand the standing policy. */
export function boundedDirectRequest(input: {
  action: DirectAction;
  message: string;
  paths: Record<string, string[]>;
  maxCalls: string;
  path?: string;
  content?: string;
}): DirectRequest {
  const paths = structuredClone(input.paths);
  if (!["ask", "status", "file.read", "file.write"].includes(input.action))
    throw new DirectAgentError("unsupported_action");
  const path = input.path ?? "";
  if (
    input.action !== "status" &&
    input.action !== "ask" &&
    (!path ||
      /[\\\\:\u0000-\u001f\u007f]/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      !paths[input.action]?.some(
        (root) => root === "." || path === root || path.startsWith(root + "/"),
      ))
  )
    throw new DirectAgentError("invalid_input");
  const request: DirectRequest = {
    message: input.message,
    bounds: {
      paths,
      max_calls: ["ask", "status"].includes(input.action)
        ? "0"
        : input.maxCalls,
    },
    ...(input.action === "file.read"
      ? {
          task: JSON.stringify({ kind: "inspect_text_files", paths: [path] }),
        }
      : input.action === "file.write"
        ? {
            task: JSON.stringify({
              kind: "ensure_text_files",
              files: [{ path, content: input.content ?? "" }],
            }),
          }
        : {}),
  };
  try {
    directRequestHash(request, input.action);
  } catch {
    throw new DirectAgentError("invalid_input");
  }
  return request;
}
export function standingInput(raw: StandingInput): StandingInput {
  const input = structuredClone(raw);
  if (
    !input ||
    !Array.isArray(input.actions) ||
    !input.actions.length ||
    input.actions.length > 4 ||
    new Set(input.actions).size !== input.actions.length ||
    input.actions.some(
      (a) => !["ask", "status", "file.read", "file.write"].includes(a),
    )
  )
    throw new DirectAgentError("invalid_input");
  for (const key of ["maxCalls", "budgetLimit", "expiresAtMs"] as const)
    if (
      !/^(0|[1-9][0-9]{0,19})$/.test(input[key]) ||
      BigInt(input[key]) > 0xffffffffffffffffn
    )
      throw new DirectAgentError("invalid_input");
  if (
    BigInt(input.maxCalls) > 1000n ||
    BigInt(input.maxCalls) > BigInt(input.budgetLimit) ||
    BigInt(input.expiresAtMs) < 1n ||
    (input.actions.some((a) => !["status", "ask"].includes(a)) &&
      BigInt(input.maxCalls) < 1n)
  )
    throw new DirectAgentError("invalid_input");
  try {
    executionBoundaryHash(input.paths);
  } catch {
    throw new DirectAgentError("invalid_input");
  }
  if (
    (input.actions.includes("file.read") &&
      !input.paths["file.read"]?.length) ||
    (input.actions.includes("file.write") && !input.paths["file.write"]?.length)
  )
    throw new DirectAgentError("invalid_input");
  return input;
}
/** These reasons preview a decision; the contract/Host still enforce current
 * permission, exact approval and physical occupancy at execution time. */
export function directApprovalReasons(
  permission: {
    allowed_actions: string[];
    max_calls: string;
    budget_limit: string;
    spent: string;
    reserved: string;
    boundary_hash: number[];
  },
  action: DirectAction,
  request: DirectRequest,
  workspace: { protected: boolean; complete: boolean },
) {
  directRequestHash(request, action);
  const reasons: string[] = [],
    calls = BigInt(request.bounds.max_calls);
  if (!permission.allowed_actions.includes(action)) reasons.push("action");
  if (
    !equal(
      permission.boundary_hash,
      executionBoundaryHash(request.bounds.paths),
    )
  )
    reasons.push("boundary");
  if (calls > BigInt(permission.max_calls)) reasons.push("per_message_limit");
  if (
    calls >
    BigInt(permission.budget_limit) -
      BigInt(permission.spent) -
      BigInt(permission.reserved)
  )
    reasons.push("budget");
  if (action === "file.write" && (!workspace.complete || workspace.protected))
    reasons.push("okr_workspace");
  return reasons;
}

/** Fixed-instance native interaction. Each mutation is independently quoted,
 * current-source checked before/after OS signing, and explicitly submitted.
 * Restoring history never signs, pays, creates a Run or sends to a Host. */
export class NativeDirectAgent {
  private readonly verifier: DeviceIdentityVerifier;
  private readonly records: PrivateRecords;
  private readonly results: NativeCommandResults;
  private readonly reader: NativeExecutionResults;
  private readonly coordinator: CoordinatorReadClient;
  private readonly manager: SelfPayTransactionManager;
  private readonly invoke: NativeInvoke;
  private readonly quotes = new WeakMap<
    SelfPayFeeQuote,
    {
      guard: () => Promise<void>;
      operation: DirectOperation;
      command?: SignedNodeCommand;
    }
  >();
  private signingGuard?: () => Promise<void>;
  private flight?: {
    quote: SelfPayFeeQuote;
    result: Promise<SelfPayTransactionOutcome>;
  };
  private pendingDelivery?: {
    command: SignedNodeCommand;
    runId: string;
    messageId: string;
    attempted: boolean;
  };
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    readonly managedAgentId: string,
    invoke: NativeInvoke,
    journal: TransactionJournal,
    transport: typeof fetch = fetch,
    private readonly assertActive: () => void = () => {},
  ) {
    if (![grantId, organizationId, managedAgentId].every((v) => id.test(v)))
      throw new DirectAgentError("invalid_input");
    this.invoke = scopedNativeInvoke(invoke, assertActive);
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.records = new PrivateRecords(
      chain,
      signer,
      grantId,
      organizationId,
      this.invoke,
    );
    this.results = new NativeCommandResults(
      chain,
      signer,
      grantId,
      organizationId,
      this.invoke,
    );
    this.reader = new NativeExecutionResults(
      chain,
      signer,
      grantId,
      organizationId,
      this.invoke,
    );
    this.coordinator = new CoordinatorReadClient(
      chain,
      signer,
      grantId,
      organizationId,
      transport,
    );
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      journal,
      assertBeforeBroadcast: assertActive,
      signer: {
        getPublicKey: () => signer.getPublicKey(),
        signTransaction: async (bytes) => {
          const guard = this.signingGuard;
          if (!guard) throw new DirectAgentError("invalid_quote");
          await guard();
          const signed = await signer.signTransaction(bytes);
          await guard();
          return signed;
        },
      },
    });
  }
  private async source(
    action: "read" | "operate" | "approve" = "read",
    historical = false,
  ) {
    this.assertActive();
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      action,
    );
    const managed = await this.chain.sdk.host.getManagedAgent(
      this.managedAgentId,
    );
    if (
      managed.id !== this.managedAgentId ||
      managed.org_id !== this.organizationId
    )
      throw new DirectAgentError("invalid_source");
    const [hosts, permission] = await Promise.all([
      hostDirectory(this.chain, this.organizationId),
      this.chain.sdk.directAgent.findPermissionForAgent(
        this.organizationId,
        this.managedAgentId,
      ),
    ]);
    const member = hosts.memberships.find(
      (m) =>
        m.id === managed.membership_id &&
        m.host_address === managed.host_address,
    );
    const binding = hosts.bindings.find(
      (b) => b.id === member?.coordinator_binding,
    );
    if (
      !member ||
      !binding ||
      (permission &&
        (permission.org_id !== this.organizationId ||
          permission.managed_agent !== managed.id ||
          permission.owner_human !== authority.humanId))
    )
      throw new DirectAgentError("invalid_source");
    if (action !== "read" && !historical) {
      if (
        !authority.actions.includes("read") ||
        (action === "operate" && !authority.actions.includes("operate")) ||
        managed.revoked ||
        !managed.control_confirmed ||
        managed.runtime !== "bounded-process-v1" ||
        !/^native-[0-9a-f]{64}$/.test(managed.instance_id) ||
        member.revoked ||
        binding.revoked ||
        BigInt(member.expires_at_ms) <= authority.clockMs ||
        BigInt(member.expires_at_ms) <= BigInt(Date.now()) ||
        !hosts.activeHostsTableId
      )
        throw new DirectAgentError("invalid_source");
      const { dynamicField } =
        await this.chain.sdk.client.client.core.getDynamicField({
          parentId: hosts.activeHostsTableId,
          name: {
            type: "address",
            bcs: bcs.Address.serialize(member.host_address).toBytes(),
          },
        });
      if (
        !["0x2::object::ID", `0x${"2".padStart(64, "0")}::object::ID`].includes(
          dynamicField.value.type,
        ) ||
        bcs.Address.parse(dynamicField.value.bcs) !== member.id ||
        canonical(
          await managedInstance(
            this.chain,
            this.organizationId,
            managed.host_address,
            managed.instance_id,
          ),
        ) !== canonical(managed)
      )
        throw new DirectAgentError("state_changed");
    }
    const key = await this.chain.sdk.productRecord.listCurrent(
      this.organizationId,
      null,
      1,
    );
    if (!/^[1-9][0-9]{0,19}$/.test(key.keyVersion) || !authority.encryptedKeys)
      throw new DirectAgentError("invalid_source");
    const workspace = await this.chain.sdk.directAgent.getWorkspaceState(
      this.organizationId,
      this.managedAgentId,
      managed.host_address,
      managed.workspace_hash,
    );
    this.assertActive();
    return {
      authority,
      managed,
      member,
      binding,
      permission,
      keyVersion: key.keyVersion,
      workspace,
      pin: canonical([
        authority.authorityPin,
        managed,
        member,
        binding,
        permission,
        key.keyVersion,
        workspace,
        hosts.chainIdentifier,
        hosts.activeHostsTableId,
        hosts.instancesTableId,
      ]),
    };
  }
  private current(s: Awaited<ReturnType<NativeDirectAgent["source"]>>) {
    const p = s.permission;
    if (
      !p ||
      p.revoked ||
      p.human_generation !== s.authority.generation ||
      p.managed_version !== s.managed.version ||
      p.membership_id !== s.member.id ||
      p.membership_version !== s.member.version ||
      !equal(p.workspace_hash, s.managed.workspace_hash) ||
      BigInt(p.expires_at_ms) <= s.authority.clockMs ||
      BigInt(p.expires_at_ms) <= BigInt(Date.now())
    )
      throw new DirectAgentError("state_changed");
    return p;
  }
  private target(s: Awaited<ReturnType<NativeDirectAgent["source"]>>) {
    return {
      organizationId: this.organizationId,
      humanId: this.chain.profile.humanId,
      grantId: this.grantId,
      membershipId: s.member.id,
      bindingId: s.binding.id,
      managedAgentId: this.managedAgentId,
    };
  }
  private async encrypt(
    s: Awaited<ReturnType<NativeDirectAgent["source"]>>,
    kind: number,
    logicalId: string,
    revision: string,
    value: unknown,
  ) {
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    try {
      if (plaintext.length > 65504) throw new DirectAgentError("invalid_input");
      const encoded = await call(this.invoke, "fm_device_encrypt_record", {
        profile: this.signer.device.profile,
        record: JSON.stringify({
          network: this.chain.profile.network,
          encryptedKeys: s.authority.encryptedKeys,
          organizationId: this.organizationId,
          kind,
          logicalId,
          revision,
          keyVersion: s.keyVersion,
          plaintext: toBase64(plaintext),
        }),
      });
      if (typeof encoded !== "string" || encoded.length > 87384)
        throw new DirectAgentError("invalid_source");
      const body = fromBase64(encoded);
      if (
        body.length < 32 ||
        body.length > 65536 ||
        toBase64(body) !== encoded ||
        new TextDecoder().decode(body.slice(0, 4)) !== "FME1"
      )
        throw new DirectAgentError("invalid_source");
      return { keyVersion: s.keyVersion, encryptedBody: body };
    } finally {
      plaintext.fill(0);
    }
  }
  private async decrypt(
    recordId: string,
    kind: number,
    logicalId: string,
    revision: string,
  ) {
    const record = await this.chain.sdk.productRecord.getRecord(recordId);
    if (
      record.organization_id !== this.organizationId ||
      record.kind !== kind ||
      record.logical_id !== logicalId ||
      record.revision !== revision
    )
      throw new DirectAgentError("invalid_source");
    const plaintext = await this.records.read(
      {
        kind,
        logicalId,
        record_id: record.id,
        revision,
        key_version: record.key_version,
      },
      true,
    );
    try {
      return {
        record,
        body: JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
        ) as Record<string, unknown>,
      };
    } finally {
      plaintext.fill(0);
    }
  }
  async describe() {
    const s = await this.source();
    let policy: StandingInput | null = null;
    if (s.permission) {
      const p = s.permission,
        decoded = await this.decrypt(
          p.permission_record,
          2,
          `standing-${this.managedAgentId}-permission`,
          p.record_revision,
        );
      if (
        decoded.body.schema !== "fractalmind.standing-permission.v1" ||
        decoded.body.managedAgentId !== this.managedAgentId
      )
        throw new DirectAgentError("invalid_source");
      policy = standingInput({
        actions: decoded.body.actions as StandingInput["actions"],
        paths: decoded.body.paths as StandingInput["paths"],
        maxCalls: String(decoded.body.maxCalls),
        budgetLimit: String(decoded.body.budgetLimit),
        expiresAtMs: String(decoded.body.expiresAtMs),
      });
      if (
        canonical(policy.actions) !== canonical(p.allowed_actions) ||
        policy.maxCalls !== p.max_calls ||
        policy.budgetLimit !== p.budget_limit ||
        policy.expiresAtMs !== p.expires_at_ms ||
        !equal(executionBoundaryHash(policy.paths), p.boundary_hash)
      )
        throw new DirectAgentError("invalid_source");
    }
    const messages = s.permission
      ? await this.chain.sdk.directAgent.listMessages(s.permission.id)
      : [];
    if ((await this.source()).pin !== s.pin)
      throw new DirectAgentError("state_changed");
    return {
      managed: s.managed,
      member: s.member,
      binding: s.binding,
      humanGeneration: s.authority.generation,
      permission: s.permission,
      policy,
      messages,
      actions: s.authority.actions,
      authorityExpiresAtMs: s.authority.expiresAtMs,
    };
  }
  async message(messageId: string) {
    if (!id.test(messageId)) throw new DirectAgentError("invalid_input");
    const s = await this.source(),
      m = await this.chain.sdk.directAgent.getMessage(messageId);
    if (
      !s.permission ||
      m.permission_id !== s.permission.id ||
      m.org_id !== this.organizationId ||
      m.managed_agent !== this.managedAgentId ||
      (
        await this.chain.sdk.directAgent.findMessage(
          m.permission_id,
          m.message_token,
        )
      )?.id !== m.id
    )
      throw new DirectAgentError("invalid_source");
    const { body, record } = await this.decrypt(
      m.encrypted_record,
      6,
      directMessageRecordName(m.message_token),
      "1",
    );
    const request: DirectRequest = {
      message: body.message as string,
      ...(body.task !== undefined ? { task: body.task as string } : {}),
      bounds: body.bounds as DirectRequest["bounds"],
    };
    if (
      body.schema !== "fractalmind.direct-request.v1" ||
      body.action !== m.action ||
      Object.keys(body).some(
        (k) => !["schema", "action", "message", "task", "bounds"].includes(k),
      ) ||
      !equal(
        directRequestHash(request, m.action as DirectAction),
        m.request_hash,
      ) ||
      !equal(executionBoundaryHash(request.bounds.paths), m.boundary_hash) ||
      request.bounds.max_calls !== m.budget_amount ||
      record.writer_human !== m.human_id ||
      record.writer_device !== m.writer_device ||
      record.grant_id !== m.grant_id ||
      record.grant_version !== m.grant_version
    )
      throw new DirectAgentError("invalid_source");
    const links = await this.chain.sdk.directAgent.getMessageLinks(m.id);
    const result = links.executionId
      ? await this.reader.read(links.executionId, this.managedAgentId)
      : null;
    let claim = null;
    if (result) {
      claim = await this.chain.sdk.directAgent.getClaim(
        m.permission_id,
        result.run.id,
      );
      if (
        claim.message_id !== m.id ||
        claim.capability_id !== result.run.capability_id ||
        claim.permission_version !== m.permission_version ||
        claim.reserved !== m.budget_amount ||
        result.run.action !== "direct.message" ||
        result.run.scope !== "direct" ||
        result.run.delegate !== m.writer_device ||
        result.run.grant_id !== m.grant_id ||
        result.run.budget_amount !== m.budget_amount
      )
        throw new DirectAgentError("invalid_source");
    }
    const workspace = await this.chain.sdk.directAgent.getWorkspaceState(
      this.organizationId,
      this.managedAgentId,
      s.managed.host_address,
      s.managed.workspace_hash,
    );
    if ((await this.source()).pin !== s.pin)
      throw new DirectAgentError("state_changed");
    return {
      message: m,
      request,
      approval: links.approval,
      result,
      claim,
      workspace,
      reasons: directApprovalReasons(
        s.permission,
        m.action as DirectAction,
        request,
        workspace,
      ),
    };
  }
  private requestId(op: DirectOperation) {
    if (op.kind === "permission" || op.kind === "revoke") {
      if (
        op.expectedVersion !== null &&
        !/^[1-9][0-9]{0,19}$/.test(op.expectedVersion)
      )
        throw new DirectAgentError("invalid_input");
      return `direct-${op.kind}:${this.managedAgentId}:${op.expectedVersion ?? "create"}`;
    }
    if (op.kind === "message") {
      if (!token.test(op.messageToken))
        throw new DirectAgentError("invalid_input");
      return `direct-message:${op.messageToken}`;
    }
    if (!id.test(op.messageId)) throw new DirectAgentError("invalid_input");
    return `direct-${op.kind}:${op.messageId}${op.kind === "decision" ? `:${op.approve}` : ""}`;
  }
  async query(requestId: string) {
    this.assertActive();
    await this.chain.checkNetwork();
    const result = await this.manager.query(requestId);
    this.assertActive();
    return result;
  }
  async prepare(
    raw: DirectOperation,
  ): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    this.assertActive();
    const op = structuredClone(raw),
      requestId = this.requestId(op);
    const prior = await this.query(requestId);
    if (prior) return prior;
    const action = ["permission", "revoke", "decision"].includes(op.kind)
      ? "approve"
      : "operate";
    const historical = ["revoke", "stop"].includes(op.kind);
    const before = await this.source(action, historical),
      api = this.chain.sdk.directAgent,
      target = this.target(before);
    const guard = async () => {
      if ((await this.source(action, historical)).pin !== before.pin)
        throw new DirectAgentError("state_changed");
    };
    let transaction, command: SignedNodeCommand | undefined;
    if (op.kind === "permission") {
      if ((before.permission?.version ?? null) !== op.expectedVersion)
        throw new DirectAgentError("state_changed");
      const policy = standingInput(op.policy);
      if (
        BigInt(policy.expiresAtMs) <= before.authority.clockMs ||
        BigInt(policy.expiresAtMs) <= BigInt(Date.now()) ||
        BigInt(policy.expiresAtMs) > BigInt(before.member.expires_at_ms)
      )
        throw new DirectAgentError("invalid_input");
      if (
        before.permission &&
        BigInt(policy.budgetLimit) <
          BigInt(before.permission.spent) + BigInt(before.permission.reserved)
      )
        throw new DirectAgentError("invalid_input");
      const body = await this.encrypt(
        before,
        2,
        `standing-${this.managedAgentId}-permission`,
        String(BigInt(before.permission?.record_revision ?? "0") + 1n),
        {
          schema: "fractalmind.standing-permission.v1",
          managedAgentId: this.managedAgentId,
          ...policy,
        },
      );
      transaction = before.permission
        ? api.updatePermission({
            ...target,
            ...policy,
            ...body,
            permissionId: before.permission.id,
            expectedVersion: before.permission.version,
          })
        : api.createPermission({ ...target, ...policy, ...body });
    } else if (op.kind === "revoke") {
      if (
        !before.permission ||
        before.permission.revoked ||
        before.permission.version !== op.expectedVersion
      )
        throw new DirectAgentError("state_changed");
      transaction = api.revokePermission({
        ...target,
        permissionId: before.permission.id,
        expectedVersion: op.expectedVersion,
      });
    } else if (op.kind === "stop") {
      const v = await this.message(op.messageId);
      if (
        !before.permission ||
        !v.result ||
        ![0, 1, 4].includes(v.result.run.state) ||
        v.result.run.stop_requested
      )
        throw new DirectAgentError("state_changed");
      transaction = api.requestStop({
        ...target,
        permissionId: before.permission.id,
        executionId: v.result.run.id,
        capabilityId: v.result.run.capability_id,
      });
    } else {
      const p = this.current(before);
      if (op.kind === "message") {
        if (!["ask", "status", "file.read", "file.write"].includes(op.action))
          throw new DirectAgentError("unsupported_action");
        if (await api.findMessage(p.id, op.messageToken))
          throw new DirectAgentError("state_changed");
        const hash = directRequestHash(op.request, op.action);
        const expires = [
          before.authority.clockMs + 240000n,
          BigInt(Date.now() + 240000),
          BigInt(p.expires_at_ms),
          BigInt(before.member.expires_at_ms),
          BigInt(before.authority.expiresAtMs),
        ].reduce((a, b) => (a < b ? a : b));
        if (
          expires <= BigInt(Date.now()) ||
          expires <= before.authority.clockMs
        )
          throw new DirectAgentError("state_changed");
        const body = await this.encrypt(
          before,
          6,
          directMessageRecordName(op.messageToken),
          "1",
          {
            schema: "fractalmind.direct-request.v1",
            ...op.request,
            action: op.action,
          },
        );
        transaction = api.createMessage({
          ...target,
          ...body,
          permissionId: p.id,
          expectedVersion: p.version,
          conversationId: this.managedAgentId.slice(2),
          messageToken: op.messageToken,
          action: op.action,
          paths: op.request.bounds.paths,
          budgetAmount: op.request.bounds.max_calls,
          requestHash: hash,
          expiresAtMs: expires,
        });
      } else {
        const v = await this.message(op.messageId),
          m = v.message;
        if (
          m.permission_version !== p.version ||
          m.managed_version !== p.managed_version ||
          m.human_generation !== before.authority.generation ||
          BigInt(m.expires_at_ms) <= before.authority.clockMs ||
          BigInt(m.expires_at_ms) <= BigInt(Date.now())
        )
          throw new DirectAgentError("state_changed");
        if (op.kind === "approval") {
          if (v.approval || v.result || !v.reasons.length)
            throw new DirectAgentError("state_changed");
          transaction = api.requestApproval({
            ...target,
            permissionId: p.id,
            messageId: m.id,
            ...(await this.encrypt(
              before,
              3,
              directMessageRecordName(m.message_token, true),
              "1",
              {
                schema: "fractalmind.direct-approval.v1",
                messageId: m.id,
                action: m.action,
                request: v.request,
                reasons: v.reasons,
              },
            )),
          });
        } else if (op.kind === "decision") {
          if (
            !v.approval ||
            v.approval.state !== 0 ||
            v.result ||
            typeof op.approve !== "boolean"
          )
            throw new DirectAgentError("state_changed");
          transaction = api.decideApproval({
            ...target,
            permissionId: p.id,
            approvalId: v.approval.id,
            messageId: m.id,
            approve: op.approve,
            ...(await this.encrypt(
              before,
              3,
              directMessageRecordName(m.message_token, true),
              "2",
              {
                schema: "fractalmind.direct-decision.v1",
                messageId: m.id,
                approvalId: v.approval.id,
                approve: op.approve,
                request: v.request,
              },
            )),
          });
        } else {
          if (
            m.writer_device !== this.signer.device.address ||
            m.grant_id !== this.grantId ||
            m.grant_version !== before.authority.grantVersion ||
            v.result
          )
            throw new DirectAgentError("state_changed");
          if (v.reasons.length && v.approval?.state !== 1)
            throw new DirectAgentError("approval_required");
          if (v.approval && v.approval.state !== 1)
            throw new DirectAgentError("state_changed");
          if (op.kind === "capability") {
            transaction = v.approval
              ? api.issueApprovedCapability({
                  ...target,
                  permissionId: p.id,
                  approvalId: v.approval.id,
                  messageId: m.id,
                  approvingGrantId: v.approval.approved_grant!,
                })
              : api.issueCapability({
                  ...target,
                  permissionId: p.id,
                  expectedVersion: p.version,
                  expiresAtMs: m.expires_at_ms,
                });
          } else if (op.kind === "run") {
            if (!id.test(op.capabilityId))
              throw new DirectAgentError("invalid_input");
            const cap = await this.chain.sdk.remoteAuthority.getCapability(
              op.capabilityId,
            );
            command = await signNodeCommand(this.signer, {
              target: {
                organizationId: this.organizationId,
                nodeId: before.managed.host_address,
                agentId: before.managed.instance_id,
              },
              action: "direct.message",
              scope: "direct",
              capability: {
                id: op.capabilityId,
                revocationVersion: cap.revocationVersion,
              },
              ...(BigInt(m.budget_amount)
                ? {
                    budget: {
                      asset: "TOOL_CALLS",
                      amount: BigInt(m.budget_amount),
                    },
                  }
                : {}),
              issuedAtMs: Date.now(),
              expiresAtMs: Number(m.expires_at_ms),
              payload: {
                ...v.request,
                direct: {
                  version: "1",
                  permission_id: p.id,
                  permission_version: p.version,
                  message_id: m.id,
                  conversation_id: m.conversation_id,
                  message_token: m.message_token,
                  message_record_id: m.encrypted_record,
                  action: m.action,
                  ...(v.approval
                    ? {
                        approval_id: v.approval.id,
                        approving_grant_id: v.approval.approved_grant!,
                      }
                    : {}),
                },
              },
            });
            const prepared = await this.results.prepare(
              {
                command,
                membershipId: before.member.id,
                bindingId: before.binding.id,
                managedAgentId: this.managedAgentId,
              },
              { expectedKeyVersion: before.keyVersion },
            );
            transaction = prepared.transaction;
          } else throw new DirectAgentError("invalid_input");
        }
      }
    }
    await guard();
    const quote = await this.manager.prepare({
      requestId,
      transaction,
      gasBudget: 200000000n,
    });
    await guard();
    this.quotes.set(quote, { guard, operation: op, command });
    return quote;
  }
  submit(quote: SelfPayFeeQuote) {
    if (!this.quotes.has(quote))
      return Promise.reject(new DirectAgentError("invalid_quote"));
    if (this.flight)
      return this.flight.quote === quote
        ? this.flight.result
        : Promise.reject(new DirectAgentError("invalid_quote"));
    const result = this.submitOnce(quote).finally(() => {
      this.flight = undefined;
    });
    this.flight = { quote, result };
    return result;
  }
  private async submitOnce(quote: SelfPayFeeQuote) {
    const plan = this.quotes.get(quote)!;
    await plan.guard();
    this.signingGuard = plan.guard;
    let outcome: SelfPayTransactionOutcome;
    try {
      outcome = await this.manager.submit(quote);
    } finally {
      this.signingGuard = undefined;
    }
    this.assertActive();
    if (outcome.status === "confirmed") {
      if (!(await awaitTransactionVisible(this.chain, outcome)))
        throw new DirectAgentError("sync_pending");
      if (plan.command && plan.operation.kind === "run") {
        const view = await this.message(plan.operation.messageId);
        if (
          !view.result ||
          !equal(
            view.result.run.intent_hash,
            nodeCommandIntentHash(plan.command),
          )
        )
          throw new DirectAgentError("invalid_source");
        this.pendingDelivery = {
          command: plan.command,
          runId: view.result.run.id,
          messageId: plan.operation.messageId,
          attempted: false,
        };
      }
    }
    return outcome;
  }
  canSend(messageId: string) {
    return (
      this.pendingDelivery?.messageId === messageId &&
      !this.pendingDelivery.attempted
    );
  }
  /** Caller durably marks the one delivery attempt before any Host request.
   * Unknown replies only lead to reading the original Run, never resending. */
  async send(messageId: string, markAttempted: () => Promise<void>) {
    const pending = this.pendingDelivery;
    if (!pending || pending.messageId !== messageId || pending.attempted)
      throw new DirectAgentError("delivery_unknown");
    const s = await this.source("operate"),
      p = this.current(s),
      view = await this.message(messageId);
    if (
      !view.result ||
      view.result.run.id !== pending.runId ||
      view.result.run.state !== 0 ||
      view.result.run.stop_requested ||
      view.claim?.settled ||
      view.claim?.permission_version !== p.version ||
      !equal(
        view.result.run.intent_hash,
        nodeCommandIntentHash(pending.command),
      ) ||
      (view.approval && view.approval.state !== 3)
    )
      throw new DirectAgentError("state_changed");
    // This ordinary reservation already includes the original command amount;
    // do not apply the pre-reservation remaining-budget check a second time.
    if (
      !view.approval &&
      (!p.allowed_actions.includes(view.message.action) ||
        BigInt(view.message.budget_amount) > BigInt(p.max_calls) ||
        !equal(view.message.boundary_hash, p.boundary_hash) ||
        (view.workspace.protected && view.message.action === "file.write"))
    )
      throw new DirectAgentError("state_changed");
    const commandTarget = {
      command: pending.command,
      membershipId: s.member.id,
      bindingId: s.binding.id,
      managedAgentId: this.managedAgentId,
    };
    const guard = await this.results.preflight(commandTarget);
    const request = await this.coordinator.prepareCommand(
      s.binding.id,
      pending.command,
    );
    await guard();
    if ((await this.source("operate")).pin !== s.pin)
      throw new DirectAgentError("state_changed");
    this.assertActive();
    pending.attempted = true;
    await markAttempted();
    this.assertActive();
    await guard();
    if ((await this.source("operate")).pin !== s.pin)
      throw new DirectAgentError("state_changed");
    return request.send();
  }
}
