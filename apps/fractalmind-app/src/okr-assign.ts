import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  PRODUCT_RECORD_KINDS,
  SelfPayTransactionManager,
  bytesToHex,
  executionBoundaryHash,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import type { ChainReadSession } from "./chain";
import { missingIndex } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import { call, type NativeDeviceSigner, type NativeInvoke } from "./native-device";
import { canonical } from "./handover-plan";
import type { Okr } from "./domain";

/** Assigning an OKR to an agent-manager Agent (#75): one transaction that
 * records the agreement and makes the OKR ACTIVE for that Agent. FractalMind
 * then delivers the goal to the Agent's Home; it does not meter or enforce
 * the Agent's tool use or spending, and the agreement says so. */
export const AGENT_MANAGER_RUNTIME = "agent-manager-v1";
export type AgentManagerAgreement = {
  format: 1;
  kind: typeof AGENT_MANAGER_RUNTIME;
  specRecordId: string;
  managedAgentId: string;
  managedVersion: string;
  membershipId: string;
  instanceId: string;
  workspaceHash: string;
  allowedPaths: string[];
  budget: { asset: "TOOL_CALLS"; limit: string };
  expiresAtMs: string;
  enforced: ["deliver", "stop", "record_claimed"];
  notEnforced: ["tool_use", "model_spending"];
};
export class OkrAssignError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "not_assignable"
      | "agent_not_controllable"
      | "agent_busy"
      | "host_not_member"
      | "active_limit"
      | "state_changed"
      | "invalid_quote"
      | "invalid_ciphertext",
  ) {
    super(code);
  }
}
const id = /^0x[0-9a-f]{64}$/;

/** The declared file boundary: read and write within these Home paths. */
export function agentManagerBoundary(paths: string[]) {
  return executionBoundaryHash({ "file.read": paths, "file.write": paths });
}

/** Checks a decrypted agreement record against the chain OKR it belongs to. */
export function validateAgentManagerAgreement(body: unknown, okr: Okr): AgentManagerAgreement {
  const a = body as AgentManagerAgreement;
  if (
    !a ||
    typeof a !== "object" ||
    a.format !== 1 ||
    a.kind !== AGENT_MANAGER_RUNTIME ||
    a.specRecordId !== okr.spec_record ||
    a.managedAgentId !== okr.managed_agent ||
    a.managedVersion !== okr.managed_version ||
    a.membershipId !== okr.membership_id ||
    a.workspaceHash !== bytesToHex(Uint8Array.from(okr.workspace_hash)) ||
    a.budget?.asset !== okr.budget_asset ||
    a.budget?.limit !== okr.budget_limit ||
    a.expiresAtMs !== okr.expires_at_ms ||
    !Array.isArray(a.allowedPaths) ||
    bytesToHex(agentManagerBoundary(a.allowedPaths)) !== bytesToHex(Uint8Array.from(okr.boundary_hash))
  )
    throw new OkrAssignError("state_changed");
  return a;
}

export type AssignInput = {
  okrId: string;
  managedAgentId: string;
  /** Declared tool-call limit, recorded but not enforced for agent-manager. */
  budgetLimit: string;
  allowedPaths: string[];
};

export class AgentManagerAssignment {
  readonly manager: SelfPayTransactionManager;
  private verifier: DeviceIdentityVerifier;
  private plans = new WeakMap<SelfPayFeeQuote, { pin: string; input: AssignInput }>();
  private signingGuard?: () => Promise<void>;
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    private invoke: NativeInvoke,
    journal: TransactionJournal,
  ) {
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      journal,
      signer: {
        getPublicKey: () => signer.getPublicKey(),
        signTransaction: async (bytes) => {
          const guard = this.signingGuard;
          if (!guard) throw new OkrAssignError("invalid_quote");
          await guard();
          const signed = await signer.signTransaction(bytes);
          await guard();
          return signed;
        },
      },
    });
  }
  static requestId(okrId: string, okrVersion: string) {
    return `okr-assign:${okrId}:${okrVersion}`;
  }
  private async source(input: AssignInput) {
    if (
      !id.test(input.okrId) ||
      !id.test(input.managedAgentId) ||
      !/^[1-9][0-9]{0,19}$/.test(input.budgetLimit) ||
      !input.allowedPaths.length
    )
      throw new OkrAssignError("invalid_input");
    const sdk = this.chain.sdk;
    const [approve, operate, okr, managed] = await Promise.all([
      this.verifier.verifyOrganization(this.organizationId, "approve"),
      this.verifier.verifyOrganization(this.organizationId, "operate"),
      sdk.okr.getOkr(input.okrId),
      sdk.host.getManagedAgent(input.managedAgentId),
    ]);
    if (okr.org_id !== this.organizationId || (okr.state !== 0 && okr.state !== 2))
      throw new OkrAssignError("not_assignable");
    if (
      managed.org_id !== this.organizationId ||
      managed.revoked ||
      !managed.control_confirmed ||
      managed.runtime !== AGENT_MANAGER_RUNTIME
    )
      throw new OkrAssignError("agent_not_controllable");
    const member = await sdk.host.getMembership(managed.membership_id);
    if (
      member.org_id !== this.organizationId ||
      member.revoked ||
      member.host_address !== managed.host_address ||
      BigInt(member.expires_at_ms) <= approve.clockMs
    )
      throw new OkrAssignError("host_not_member");
    const binding = await sdk.host.getCoordinatorBinding(member.coordinator_binding);
    if (binding.revoked || binding.org_id !== this.organizationId) throw new OkrAssignError("host_not_member");
    if (BigInt(okr.deadline_ms) <= approve.clockMs) throw new OkrAssignError("not_assignable");
    // One goal at a time per Agent, and at most three ACTIVE per organization.
    const active = await this.active();
    if (active.some((o) => o.managed_agent === managed.id)) throw new OkrAssignError("agent_busy");
    if (active.length >= 3) throw new OkrAssignError("active_limit");
    const records = await this.records(okr.logical_id);
    return {
      approve,
      okr,
      managed,
      member,
      binding,
      records,
      pin: canonical([approve.authorityPin, operate.authorityPin, okr, managed, member, binding, records, active.map((o) => o.id)]),
    };
  }
  private async active() {
    const out: Okr[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page: { okrs: Okr[]; cursor: string | null; hasNextPage: boolean } = await this.chain.sdk.okr
        .listOkrs(this.organizationId, cursor, 50)
        .catch((error) => {
          if (cursor === null && this.chain.sdk.okr.isMissingIndex(error, this.organizationId))
            return { okrs: [], cursor: null, hasNextPage: false };
          throw error;
        });
      out.push(...page.okrs.filter((o) => o.state === 1));
      if (!page.hasNextPage) break;
      if (!page.cursor || seen.has(page.cursor) || seen.size > 40) throw new OkrAssignError("state_changed");
      seen.add(page.cursor);
      cursor = page.cursor;
    } while (cursor);
    return out;
  }
  /** The organization key version and this OKR's current agreement revision. */
  private async records(logicalId: string) {
    let cursor: string | null = null,
      keyVersion: string | undefined,
      revision = "0";
    const seen = new Set<string>();
    do {
      type Page = Awaited<ReturnType<ChainReadSession["sdk"]["productRecord"]["listCurrent"]>>;
      const page: Page = await this.chain.sdk.productRecord.listCurrent(this.organizationId, cursor, 50).catch(async (error): Promise<Page> => {
        if (
          cursor === null &&
          missingIndex(error, this.organizationId, await this.chain.sdk.client.coreType("product_record", "IndexBinding"))
        )
          return { keyVersion: "1", records: [], cursor: null, hasNextPage: false } as unknown as Page;
        throw error;
      });
      if (keyVersion && keyVersion !== page.keyVersion) throw new OkrAssignError("state_changed");
      keyVersion = page.keyVersion;
      const row = page.records.find(
        (r) =>
          r.kind === PRODUCT_RECORD_KINDS.contract && r.logicalId === `okr-${logicalId}-agreement`,
      );
      if (row) revision = row.revision;
      if (!page.hasNextPage) break;
      if (!page.cursor || seen.has(page.cursor) || seen.size > 40) throw new OkrAssignError("state_changed");
      seen.add(page.cursor);
      cursor = page.cursor;
    } while (cursor);
    return { keyVersion: keyVersion!, revision };
  }
  query(okrId: string, okrVersion: string) {
    return this.manager.query(AgentManagerAssignment.requestId(okrId, okrVersion));
  }
  async prepare(raw: AssignInput): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    const input = structuredClone(raw);
    const before = await this.source(input);
    const requestId = AgentManagerAssignment.requestId(before.okr.id, before.okr.version);
    const prior = await this.manager.query(requestId);
    if (prior) return prior;
    const workspaceHash = Uint8Array.from(before.managed.workspace_hash);
    const agreement: AgentManagerAgreement = {
      format: 1,
      kind: AGENT_MANAGER_RUNTIME,
      specRecordId: before.okr.spec_record,
      managedAgentId: before.managed.id,
      managedVersion: before.managed.version,
      membershipId: before.member.id,
      instanceId: before.managed.instance_id,
      workspaceHash: bytesToHex(workspaceHash),
      allowedPaths: input.allowedPaths,
      budget: { asset: "TOOL_CALLS", limit: input.budgetLimit },
      expiresAtMs: before.okr.deadline_ms,
      enforced: ["deliver", "stop", "record_claimed"],
      notEnforced: ["tool_use", "model_spending"],
    };
    const boundary = agentManagerBoundary(input.allowedPaths);
    const plaintext = new TextEncoder().encode(JSON.stringify(agreement));
    let encrypted: unknown;
    try {
      encrypted = await call(this.invoke, "fm_device_encrypt_record", {
        profile: this.signer.device.profile,
        record: JSON.stringify({
          network: this.chain.profile.network,
          encryptedKeys: before.approve.encryptedKeys,
          organizationId: this.organizationId,
          kind: PRODUCT_RECORD_KINDS.contract,
          logicalId: `okr-${before.okr.logical_id}-agreement`,
          revision: (BigInt(before.records.revision) + 1n).toString(),
          keyVersion: before.records.keyVersion,
          plaintext: toBase64(plaintext),
        }),
      });
    } finally {
      plaintext.fill(0);
    }
    let body: Uint8Array;
    try {
      if (typeof encrypted !== "string" || encrypted.length > 87384) throw new Error();
      body = fromBase64(encrypted);
      if (body.length < 32 || body.length > 65536 || toBase64(body) !== encrypted || new TextDecoder().decode(body.slice(0, 4)) !== "FME1")
        throw new Error();
    } catch {
      throw new OkrAssignError("invalid_ciphertext");
    }
    const transaction = this.chain.sdk.okr.assignAgentManager({
      okrId: before.okr.id,
      organizationId: this.organizationId,
      humanId: this.chain.profile.humanId,
      grantId: this.grantId,
      expectedVersion: before.okr.version,
      membershipId: before.member.id,
      bindingId: before.binding.id,
      managedAgentId: before.managed.id,
      workspaceHash,
      boundaryHash: boundary,
      budgetAsset: "TOOL_CALLS",
      budgetLimit: input.budgetLimit,
      expiresAtMs: before.okr.deadline_ms,
      expectedRecordRevision: before.records.revision,
      keyVersion: before.records.keyVersion,
      encryptedBody: body,
    });
    const quote = await this.manager.prepare({ requestId, transaction, gasBudget: 200_000_000n });
    this.plans.set(quote, { pin: before.pin, input });
    return quote;
  }
  async submit(quote: SelfPayFeeQuote): Promise<SelfPayTransactionOutcome> {
    const plan = this.plans.get(quote);
    if (!plan) throw new OkrAssignError("invalid_quote");
    const guard = async () => {
      if ((await this.source(plan.input)).pin !== plan.pin) throw new OkrAssignError("state_changed");
    };
    // One full re-read right before signing; the quote is seconds old.
    await guard();
    this.signingGuard = async () => {};
    try {
      return await this.manager.submit(quote);
    } finally {
      this.signingGuard = undefined;
    }
  }
}
