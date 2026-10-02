import { bcs, TypeTagSerializer } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { deriveDynamicFieldID, normalizeSuiAddress } from "@mysten/sui/utils";
import {
  ManagedAgentBcs,
  SelfPayTransactionManager,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { CoordinatorReadClient } from "./coordinator-read";
import { DeviceIdentityVerifier } from "./device-identity";
import { hostDirectory } from "./host-admission";
import {
  awaitTransactionVisible,
  TransactionVisibilityError,
} from "./transaction-visibility";
import { NativeDeviceSigner } from "./native-device";

export class AgentImportError extends Error {
  constructor(
    readonly code:
      | "invalid_selection"
      | "confirmation_required"
      | "discovery_unavailable"
      | "state_changed"
      | "invalid_source"
      | "existing_conflict"
      | "invalid_quote"
      | "sync_pending"
      | "handover_required",
  ) {
    super(code);
  }
}
export type AgentImportSelection = {
  bindingId: string;
  hostAddress: string;
  instanceId: string;
  workspaceHash: string;
};
export type ManagedInstance = ReturnType<typeof ManagedAgentBcs.parse>;
export type RegistrationIntent =
  | { kind: "import" }
  | { kind: "rebind"; reviewed?: ManagedInstance };
export type AlreadyImported = {
  status: "already-imported";
  record: ManagedInstance;
};
const fullId = /^0x[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const InstanceKey = bcs.struct("InstanceKey", {
  host_address: bcs.Address,
  instance_id: bcs.string(),
});
const Pointer = bcs.struct("InstancePointer", {
  record_id: bcs.Address,
  membership_id: bcs.Address,
  runtime: bcs.string(),
  workspace_hash: bcs.vector(bcs.u8()),
  control_confirmed: bcs.bool(),
  revoked: bcs.bool(),
});
const Imported = bcs.struct("AgentImported", {
  org_id: bcs.Address,
  membership_id: bcs.Address,
  record_id: bcs.Address,
  instance_id: bcs.string(),
  duplicate: bcs.bool(),
});
function fail(code: AgentImportError["code"]): never {
  throw new AgentImportError(code);
}
function selection(s: AgentImportSelection) {
  if (
    !fullId.test(s.bindingId) ||
    !fullId.test(s.hostAddress) ||
    !/^(tmux|native)-[0-9a-f]{64}$/.test(s.instanceId) ||
    !/^[0-9a-f]{64}$/.test(s.workspaceHash)
  )
    fail("invalid_selection");
  return { ...s };
}
export function observationRuntime(
  instanceId: string,
): "tmux-observe" | "bounded-process-v1" {
  if (/^tmux-[0-9a-f]{64}$/.test(instanceId)) return "tmux-observe";
  if (/^native-[0-9a-f]{64}$/.test(instanceId)) return "bounded-process-v1";
  return fail("invalid_selection");
}
function hash(bytes: number[]) {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Exact chain directory pointer; RPC failures never mean "not imported". */
export async function managedInstance(
  chain: ChainReadSession,
  organizationId: string,
  hostAddress: string,
  instanceId: string,
): Promise<ManagedInstance | null> {
  if (
    !fullId.test(organizationId) ||
    !fullId.test(hostAddress) ||
    !/^(tmux|native)-[0-9a-f]{64}$/.test(instanceId)
  )
    fail("invalid_selection");
  const directory = await hostDirectory(chain, organizationId);
  if (!directory.instancesTableId) return null;
  const table = directory.instancesTableId,
    type = `${chain.sdk.client.typesPackageId}::host::InstanceKey`;
  const name = {
    type,
    bcs: InstanceKey.serialize({
      host_address: hostAddress,
      instance_id: instanceId,
    }).toBytes(),
  };
  const absentId = deriveDynamicFieldID(
    table,
    TypeTagSerializer.parseFromStr(type),
    name.bcs,
  );
  const read = async () => {
    try {
      const { dynamicField } =
        await chain.sdk.client.client.core.getDynamicField({
          parentId: table,
          name,
        });
      if (
        dynamicField.value.type !==
        `${chain.sdk.client.typesPackageId}::host::InstancePointer`
      )
        fail("invalid_source");
      return Pointer.parse(dynamicField.value.bcs);
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "reason" in e &&
        e.reason === "notFound" &&
        "objectId" in e &&
        e.objectId === absentId
      )
        return null;
      throw e;
    }
  };
  const pointer = await read();
  let record: ManagedInstance | null = null;
  if (pointer) {
    const { object } = await chain.sdk.client.client.core.getObject({
      objectId: pointer.record_id,
      include: { content: true },
    });
    if (
      object.objectId !== pointer.record_id ||
      object.type !==
        `${chain.sdk.client.typesPackageId}::host::ManagedAgent` ||
      object.owner.$kind !== "Shared" ||
      !object.content ||
      !/^[1-9][0-9]*$/.test(object.version)
    )
      fail("invalid_source");
    record = ManagedAgentBcs.parse(object.content!);
    if (
      record.id !== pointer.record_id ||
      record.org_id !== organizationId ||
      record.host_address !== hostAddress ||
      record.instance_id !== instanceId ||
      record.membership_id !== pointer.membership_id ||
      record.runtime !== pointer.runtime ||
      record.control_confirmed !== pointer.control_confirmed ||
      record.revoked !== pointer.revoked ||
      hash(record.workspace_hash) !== hash(pointer.workspace_hash) ||
      record.workspace_hash.length !== 32 ||
      BigInt(record.version) < 1n
    )
      fail("invalid_source");
  }
  const after = await hostDirectory(chain, organizationId);
  if (
    after.instancesTableId !== table ||
    JSON.stringify(await read()) !== JSON.stringify(pointer)
  )
    fail("state_changed");
  return record;
}

type Plan = {
  requestId: string;
  input: AgentImportSelection;
  sourcePin: string;
  authorityPin: string;
};
/** Imports only an observed instance. No start/restart, adapter control, OKR
 * authority or business state is stored outside Sui. */
export class AgentImport {
  readonly manager: SelfPayTransactionManager;
  readonly intent: RegistrationIntent;
  private verifier: DeviceIdentityVerifier;
  private reads: CoordinatorReadClient;
  private plans = new Map<SelfPayFeeQuote, Plan>();
  constructor(
    readonly chain: ChainReadSession,
    readonly device: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    journal: TransactionJournal,
    intent: RegistrationIntent = { kind: "import" },
  ) {
    if (!fullId.test(organizationId)) fail("invalid_selection");
    this.intent = structuredClone(intent);
    if (this.intent.kind === "rebind" && this.intent.reviewed) {
      Object.freeze(this.intent.reviewed.workspace_hash);
      Object.freeze(this.intent.reviewed);
    }
    Object.freeze(this.intent);
    this.verifier = new DeviceIdentityVerifier(chain, device, grantId);
    this.reads = new CoordinatorReadClient(
      chain,
      device,
      grantId,
      organizationId,
    );
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      signer: {
        getPublicKey: () => device.getPublicKey(),
        signTransaction: async (bytes) => {
          const digest = await Transaction.from(bytes).getDigest();
          const matches = [...this.plans].filter(
            ([quote]) => quote.digest === digest,
          );
          if (matches.length !== 1) fail("invalid_quote");
          const [quote, plan] = matches[0];
          const signed = await device.signTransaction(bytes);
          // Native authorization can wait longer than the observation/quote.
          // Recheck after it returns, before the manager claims/broadcasts.
          if (this.plans.get(quote) !== plan || quote.expiresAtMs <= Date.now())
            fail("state_changed");
          const authority = await this.verifier.verifyOrganization(
            this.organizationId,
            "manage_hosts",
          );
          if (
            authority.authorityPin !== plan.authorityPin ||
            (await this.source(plan.input)).sourcePin !== plan.sourcePin ||
            (await this.existing(plan.input)) ||
            quote.expiresAtMs <= Date.now()
          )
            fail("state_changed");
          return signed;
        },
      },
      journal,
    });
  }
  private request(attemptId: string) {
    if (!uuid.test(attemptId)) fail("invalid_selection");
    return `agent-${this.intent.kind}:${attemptId}`;
  }
  async query(attemptId: string) {
    await this.chain.checkNetwork();
    return this.manager.query(this.request(attemptId));
  }
  private async existing(
    input: AgentImportSelection,
  ): Promise<AlreadyImported | null> {
    const record = await managedInstance(
      this.chain,
      this.organizationId,
      input.hostAddress,
      input.instanceId,
    );
    if (this.intent.kind === "rebind") {
      const reviewed = this.intent.reviewed;
      if (!reviewed || !record) fail("invalid_selection");
      if (JSON.stringify(record) !== JSON.stringify(reviewed))
        fail("state_changed");
      // Dropping control while an old execution may be running is a handover,
      // not an observation-only repair. It needs separate stop evidence.
      if (
        record.control_confirmed ||
        record.runtime !== observationRuntime(input.instanceId)
      )
        fail("handover_required");
    }
    if (!record) return null;
    const directory = await hostDirectory(this.chain, this.organizationId);
    const member = directory.memberships.find(
      (m) => m.id === record.membership_id,
    );
    if (
      record.revoked ||
      record.control_confirmed ||
      record.runtime !== observationRuntime(input.instanceId) ||
      hash(record.workspace_hash) !== input.workspaceHash ||
      !member ||
      member.revoked ||
      BigInt(member.expires_at_ms) <= directory.clockMs ||
      member.coordinator_binding !== input.bindingId
    ) {
      if (this.intent.kind === "rebind") return null;
      fail("existing_conflict");
    }
    if (!directory.activeHostsTableId) fail("existing_conflict");
    const { dynamicField } =
      await this.chain.sdk.client.client.core.getDynamicField({
        parentId: directory.activeHostsTableId!,
        name: {
          type: "address",
          bcs: bcs.Address.serialize(input.hostAddress).toBytes(),
        },
      });
    if (
      dynamicField.value.type !== `${normalizeSuiAddress("0x2")}::object::ID` ||
      bcs.Address.parse(dynamicField.value.bcs) !== member.id
    )
      fail("existing_conflict");
    return { status: "already-imported", record };
  }
  private async source(input: AgentImportSelection) {
    const before = await hostDirectory(this.chain, this.organizationId);
    const member = before.memberships.find(
      (m) =>
        m.host_address === input.hostAddress &&
        !m.revoked &&
        m.coordinator_binding === input.bindingId &&
        BigInt(m.expires_at_ms) > before.clockMs,
    );
    const binding = before.bindings.find(
      (b) => b.id === input.bindingId && !b.revoked,
    );
    if (!member || !binding) fail("discovery_unavailable");
    const rows = await this.reads.readHosts(input.bindingId);
    const row = rows.find(
      (r) =>
        r.address === input.hostAddress &&
        r.state === "verified" &&
        r.membershipId === member.id &&
        r.freshUntilMs! > Date.now(),
    );
    const scan = input.instanceId.startsWith("native-")
      ? row?.nativeDiscovery
      : row?.discovery;
    const instance = scan?.instances.find(
      (i) => i.instanceId === input.instanceId,
    );
    if (
      scan?.state !== "complete" ||
      scan.freshUntilMs === null ||
      scan.freshUntilMs <= Date.now() ||
      !instance ||
      instance.state !== "observed" ||
      instance.runtime !== observationRuntime(input.instanceId) ||
      instance.continuity !==
        (input.instanceId.startsWith("native-")
          ? "envd-process-v1"
          : "kernel-process-v1") ||
      instance.workspaceHash !== input.workspaceHash
    )
      fail("discovery_unavailable");
    const after = await hostDirectory(this.chain, this.organizationId);
    if (
      JSON.stringify(after.memberships.find((m) => m.id === member.id)) !==
        JSON.stringify(member) ||
      JSON.stringify(after.bindings.find((b) => b.id === binding.id)) !==
        JSON.stringify(binding) ||
      after.activeHostsTableId !== before.activeHostsTableId ||
      after.instancesTableId !== before.instancesTableId ||
      scan.freshUntilMs <= Date.now()
    )
      fail("state_changed");
    return {
      member,
      runtime: instance.runtime,
      sourcePin: JSON.stringify([
        before.chainIdentifier,
        member,
        binding,
        before.activeHostsTableId,
        before.instancesTableId,
        instance.instanceId,
        instance.workspaceHash,
        instance.pane,
        instance.runtime,
        instance.continuity,
      ]),
    };
  }
  async prepare(
    raw: AgentImportSelection,
    attemptId: string,
    confirmed: boolean,
  ): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome | AlreadyImported> {
    const requestId = this.request(attemptId),
      prior = await this.query(attemptId);
    if (prior) return prior;
    if (!confirmed) fail("confirmation_required");
    const input = selection(raw);
    for (const [quote, plan] of this.plans)
      if (plan.requestId === requestId) this.plans.delete(quote);
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      "manage_hosts",
    );
    const existing = await this.existing(input);
    if (existing) return existing;
    const source = await this.source(input);
    const parameters = {
      organizationId: this.organizationId,
      humanId: this.chain.profile.humanId,
      grantId: this.grantId,
      membershipId: source.member.id,
      bindingId: input.bindingId,
      runtime: source.runtime,
      workspaceHash: Uint8Array.from(input.workspaceHash.match(/../g)!, (s) =>
        parseInt(s, 16),
      ),
      controlConfirmed: false,
    };
    const tx =
      this.intent.kind === "rebind"
        ? this.chain.sdk.host.rebindAgent({
            ...parameters,
            managedAgentId: this.intent.reviewed!.id,
            expectedVersion: this.intent.reviewed!.version,
          })
        : this.chain.sdk.host.importAgent({
            ...parameters,
            instanceId: input.instanceId,
          });
    const quote = await this.manager.prepare({
      requestId,
      transaction: tx,
      gasBudget: 200000000n,
    });
    const after = await this.verifier.verifyOrganization(
      this.organizationId,
      "manage_hosts",
    );
    if (
      !authority.authorityPin ||
      after.authorityPin !== authority.authorityPin ||
      (await this.source(input)).sourcePin !== source.sourcePin
    )
      fail("state_changed");
    const duplicate = await this.existing(input);
    if (duplicate) return duplicate;
    this.plans.set(quote, {
      requestId,
      input,
      sourcePin: source.sourcePin,
      authorityPin: after.authorityPin!,
    });
    return quote;
  }
  async submit(
    quote: SelfPayFeeQuote,
  ): Promise<SelfPayTransactionOutcome | AlreadyImported> {
    const plan = this.plans.get(quote);
    if (!plan || quote.requestId !== plan.requestId) fail("invalid_quote");
    const prior = await this.manager.query(plan.requestId);
    if (prior) return prior;
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      "manage_hosts",
    );
    if (authority.authorityPin !== plan.authorityPin) fail("state_changed");
    if ((await this.source(plan.input)).sourcePin !== plan.sourcePin)
      fail("state_changed");
    const duplicate = await this.existing(plan.input);
    if (duplicate) return duplicate;
    return this.manager.submit(quote);
  }
  async confirmed(
    outcome: SelfPayTransactionOutcome,
    input?: AgentImportSelection,
  ) {
    try {
      if (!(await awaitTransactionVisible(this.chain, outcome)))
        fail("sync_pending");
    } catch (e) {
      if (e instanceof TransactionVisibilityError) fail("invalid_source");
      throw e;
    }
    const events = outcome.transaction!.events?.filter(
      (e) =>
        e.eventType ===
        `${this.chain.sdk.client.typesPackageId}::host::AgentImported`,
    );
    if (events?.length !== 1) fail("invalid_source");
    const event = events[0];
    if (
      event.sender !== this.device.device.address ||
      event.module !== "host" ||
      event.packageId !== this.chain.sdk.client.packageId
    )
      fail("invalid_source");
    const imported = Imported.parse(event.bcs);
    if (imported.org_id !== this.organizationId) fail("invalid_source");
    const { object } = await this.chain.sdk.client.client.core.getObject({
      objectId: imported.record_id,
      include: { content: true },
    });
    if (
      object.objectId !== imported.record_id ||
      object.type !==
        `${this.chain.sdk.client.typesPackageId}::host::ManagedAgent` ||
      object.owner.$kind !== "Shared" ||
      !object.content
    )
      fail("invalid_source");
    const record = ManagedAgentBcs.parse(object.content!);
    if (
      record.id !== imported.record_id ||
      record.org_id !== imported.org_id ||
      record.instance_id !== imported.instance_id ||
      record.membership_id !== imported.membership_id ||
      (!imported.duplicate &&
        (record.confirmed_by_human !== this.chain.profile.humanId ||
          record.confirmed_by_device !== this.device.device.address))
    )
      fail("invalid_source");
    if (
      record.runtime !== observationRuntime(record.instance_id) ||
      record.control_confirmed ||
      record.workspace_hash.length !== 32 ||
      !/^(tmux|native)-[0-9a-f]{64}$/.test(record.instance_id)
    )
      fail("state_changed");
    if (
      input &&
      (record.host_address !== input.hostAddress ||
        record.instance_id !== input.instanceId ||
        hash(record.workspace_hash) !== input.workspaceHash)
    )
      fail("state_changed");
    if (
      this.intent.kind === "rebind" &&
      this.intent.reviewed &&
      (record.id !== this.intent.reviewed.id ||
        BigInt(record.version) !== BigInt(this.intent.reviewed.version) + 1n)
    )
      fail("state_changed");
    const indexed = await managedInstance(
      this.chain,
      this.organizationId,
      record.host_address,
      record.instance_id,
    );
    if (!indexed || JSON.stringify(indexed) !== JSON.stringify(record))
      fail("state_changed");
    return record;
  }
  cancel(quote: SelfPayFeeQuote) {
    this.plans.delete(quote);
  }
  dispose() {
    this.plans.clear();
  }
}
