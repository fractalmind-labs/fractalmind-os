import { bcs } from "@mysten/sui/bcs";
import {
  AuthorityBindingBcs,
  HANDOVER_REVIEW_WINDOW_MS,
  OkrBcs,
  SelfPayTransactionManager,
  bytesToHex,
  handoverProposalHash,
  signNodeCommand,
  type HandoverProposal,
  type NativeFileOkrPlan,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import { NativeDeviceSigner, type NativeInvoke } from "./native-device";
import { hostDirectory } from "./host-admission";
import { managedInstance } from "./agent-import";
import { PrivateRecords } from "./private-records";
import {
  canonical,
  parseOkrSpecification,
  validateHandoverPlan,
} from "./handover-plan";
import { awaitTransactionVisible } from "./transaction-visibility";
import type { HandoverReviewInput } from "./handover-review";

export class HandoverSetupError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "invalid_source"
      | "state_changed"
      | "invalid_quote"
      | "sync_pending"
      | "review_expired",
  ) {
    super(code);
  }
}
const id = /^0x[0-9a-f]{64}$/;

/** Issues a device-bound, single-use observation capability. This has no
 * control authority, tool budget or Host delivery. Draft plans remain in
 * memory until HandoverReview saves the exact signed ticket on Sui. */
export class HandoverSetup {
  readonly requestId: string;
  private readonly verifier: DeviceIdentityVerifier;
  private readonly records: PrivateRecords;
  private readonly manager: SelfPayTransactionManager;
  private readonly quotes = new WeakMap<SelfPayFeeQuote, () => Promise<void>>();
  private guard?: () => Promise<void>;
  private flight?: {
    quote: SelfPayFeeQuote;
    promise: Promise<SelfPayTransactionOutcome>;
  };
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    readonly managedAgentId: string,
    readonly attemptId: string,
    invoke: NativeInvoke,
    journal: TransactionJournal,
    private readonly assertActive: () => void = () => {},
  ) {
    if (
      ![grantId, organizationId, managedAgentId].every((v) => id.test(v)) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        attemptId,
      )
    )
      throw new HandoverSetupError("invalid_input");
    this.requestId = `handover-observe-${attemptId}`;
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.records = new PrivateRecords(
      chain,
      signer,
      grantId,
      organizationId,
      invoke,
    );
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      journal,
      assertBeforeBroadcast: assertActive,
      signer: {
        getPublicKey: () => signer.getPublicKey(),
        signTransaction: async (bytes) => {
          const guard = this.guard;
          if (!guard) throw new HandoverSetupError("invalid_quote");
          await guard();
          const signed = await signer.signTransaction(bytes);
          await guard();
          return signed;
        },
      },
    });
  }
  async query() {
    await this.chain.checkNetwork();
    return this.manager.query(this.requestId);
  }
  private async source() {
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      "approve",
    );
    if (
      !authority.authorityPin ||
      !(["read", "operate", "approve", "manage_hosts"] as const).every((a) =>
        authority.actions.includes(a),
      )
    )
      throw new HandoverSetupError("invalid_source");
    const coverage = await this.chain.sdk.nodeExecution.readAgentExecutions(
      this.organizationId,
      this.managedAgentId,
    );
    const managed = coverage.managed;
    if (
      coverage.unsettledControl ||
      managed.id !== this.managedAgentId ||
      managed.org_id !== this.organizationId ||
      managed.revoked ||
      managed.runtime !== "bounded-process-v1" ||
      managed.workspace_hash.length !== 32
    )
      throw new HandoverSetupError("invalid_source");
    const hosts = await hostDirectory(this.chain, this.organizationId);
    const member = hosts.memberships.find(
      (m) =>
        m.id === managed.membership_id &&
        !m.revoked &&
        m.host_address === managed.host_address &&
        BigInt(m.expires_at_ms) > hosts.clockMs,
    );
    const binding = hosts.bindings.find(
      (b) => b.id === member?.coordinator_binding && !b.revoked,
    );
    if (!member || !binding || !hosts.activeHostsTableId)
      throw new HandoverSetupError("invalid_source");
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
      bcs.Address.parse(dynamicField.value.bcs) !== member.id
    )
      throw new HandoverSetupError("invalid_source");
    const current = await managedInstance(
      this.chain,
      this.organizationId,
      managed.host_address,
      managed.instance_id,
    );
    if (canonical(current) !== canonical(managed))
      throw new HandoverSetupError("state_changed");
    return {
      authority,
      managed,
      member,
      binding,
      pin: canonical([
        authority.authorityPin,
        coverage.revision,
        managed,
        member,
        binding,
        hosts.activeHostsTableId,
        hosts.instancesTableId,
      ]),
    };
  }
  async prepare(): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    const prior = await this.query();
    if (prior) return prior;
    const before = await this.source();
    const now = BigInt(Math.max(Date.now(), Number(before.authority.clockMs)));
    const expires = [
      now + 600000n,
      BigInt(before.member.expires_at_ms),
      BigInt(before.authority.expiresAtMs),
    ].reduce((a, b) => (a < b ? a : b));
    if (expires <= now + BigInt(HANDOVER_REVIEW_WINDOW_MS))
      throw new HandoverSetupError("review_expired");
    const guard = async () => {
      if ((await this.source()).pin !== before.pin)
        throw new HandoverSetupError("state_changed");
      if (BigInt(Date.now()) + BigInt(HANDOVER_REVIEW_WINDOW_MS) >= expires)
        throw new HandoverSetupError("review_expired");
    };
    const transaction = this.chain.sdk.host.issueCapability({
      organizationId: this.organizationId,
      humanId: before.authority.humanId,
      grantId: this.grantId,
      membershipId: before.member.id,
      bindingId: before.binding.id,
      managedAgentId: this.managedAgentId,
      actions: ["status"],
      scope: "observation",
      maxUses: 1,
      expiresAtMs: expires,
    });
    const quote = await this.manager.prepare({
      requestId: this.requestId,
      transaction,
      gasBudget: 200000000n,
    });
    await guard();
    this.quotes.set(quote, guard);
    return quote;
  }
  async submit(quote: SelfPayFeeQuote): Promise<SelfPayTransactionOutcome> {
    if (this.flight) {
      if (this.flight.quote !== quote)
        throw new HandoverSetupError("invalid_quote");
      return this.flight.promise;
    }
    const promise = this.submitOnce(quote);
    this.flight = { quote, promise };
    try {
      return await promise;
    } finally {
      this.flight = undefined;
    }
  }
  private async submitOnce(quote: SelfPayFeeQuote) {
    const prior = await this.query();
    if (prior) return prior;
    const guard = this.quotes.get(quote);
    if (!guard) throw new HandoverSetupError("invalid_quote");
    await guard();
    this.guard = guard;
    try {
      return await this.manager.submit(quote);
    } finally {
      this.guard = undefined;
      this.quotes.delete(quote);
    }
  }
  private async capability(
    capabilityId: string,
    source: Awaited<ReturnType<HandoverSetup["source"]>>,
  ) {
    if (!id.test(capabilityId)) throw new HandoverSetupError("invalid_input");
    const { object } = await this.chain.sdk.client.client.core.getObject({
      objectId: capabilityId,
    });
    if (
      object.objectId !== capabilityId ||
      object.owner.$kind !== "Shared" ||
      object.type !==
        (await this.chain.sdk.client.coreType(
          "remote_authority",
          "RemoteCapability",
        ))
    )
      throw new HandoverSetupError("invalid_source");
    const cap =
      await this.chain.sdk.remoteAuthority.getCapability(capabilityId);
    const { dynamicField } =
      await this.chain.sdk.client.client.core.getDynamicField({
        parentId: capabilityId,
        name: {
          type: await this.chain.sdk.client.coreType(
            "host",
            "AuthorityBindingKey",
          ),
          bcs: new Uint8Array([0]),
        },
      });
    if (
      dynamicField.value.type !==
      (await this.chain.sdk.client.coreType("host", "AuthorityBinding"))
    )
      throw new HandoverSetupError("invalid_source");
    const binding = AuthorityBindingBcs.parse(dynamicField.value.bcs);
    if (
      cap.objectId !== capabilityId ||
      cap.type !== object.type ||
      cap.revoked ||
      cap.parentId ||
      cap.orgId !== this.organizationId ||
      cap.nodeId !== source.managed.host_address ||
      cap.agentId !== source.managed.instance_id ||
      cap.delegate !== this.signer.device.address ||
      cap.scope !== "observation" ||
      canonical(cap.actions) !== '["status"]' ||
      cap.maxUses !== 1n ||
      cap.usesClaimed !== 0n ||
      cap.usesDelegated !== 0n ||
      cap.maxBudget !== 0n ||
      cap.budgetAsset ||
      cap.expiresAtMs <= source.authority.clockMs ||
      binding.membership_id !== source.member.id ||
      binding.membership_version !== source.member.version ||
      binding.managed_agent !== source.managed.id ||
      binding.managed_agent_version !== source.managed.version ||
      binding.human_id !== source.authority.humanId ||
      binding.device_grant !== this.grantId ||
      binding.device_grant_version !== source.authority.grantVersion ||
      binding.human_generation !== source.authority.generation ||
      binding.required_action !== 1
    )
      throw new HandoverSetupError("invalid_source");
    return cap;
  }
  async confirmed(outcome: SelfPayTransactionOutcome) {
    if (
      outcome.status !== "confirmed" ||
      outcome.requestId !== this.requestId ||
      outcome.transaction?.digest !== outcome.digest
    )
      throw new HandoverSetupError("invalid_source");
    const capabilityType = await this.chain.sdk.client.coreType(
      "remote_authority",
      "RemoteCapability",
    );
    const created = outcome.transaction?.effects?.changedObjects.filter(
      (o) =>
        o.outputState === "ObjectWrite" &&
        o.idOperation === "Created" &&
        outcome.transaction?.objectTypes?.[o.objectId] === capabilityType,
    );
    if (created?.length !== 1 || !id.test(created[0].objectId))
      throw new HandoverSetupError("invalid_source");
    if (!(await awaitTransactionVisible(this.chain, outcome)))
      throw new HandoverSetupError("sync_pending");
    const capabilityId = created[0].objectId;
    const { object } = await this.chain.sdk.client.client.core.getObject({
      objectId: capabilityId,
      include: { previousTransaction: true },
    });
    if (object.previousTransaction !== outcome.digest)
      throw new HandoverSetupError("invalid_source");
    await this.capability(capabilityId, await this.source());
    return capabilityId;
  }
  async specification(okrId: string) {
    if (!id.test(okrId)) throw new HandoverSetupError("invalid_input");
    const source = await this.source();
    const { object } = await this.chain.sdk.client.client.core.getObject({
      objectId: okrId,
      include: { content: true },
    });
    if (
      object.objectId !== okrId ||
      object.owner.$kind !== "Shared" ||
      !object.content ||
      object.type !== `${this.chain.sdk.client.okrTypesPackageId}::okr::Okr`
    )
      throw new HandoverSetupError("invalid_source");
    const okr = OkrBcs.parse(object.content);
    if (
      okr.id !== okrId ||
      okr.org_id !== this.organizationId ||
      okr.owner_human !== source.authority.humanId ||
      ![0, 2].includes(okr.state)
    )
      throw new HandoverSetupError("invalid_source");
    if (
      BigInt(okr.deadline_ms) <=
        source.authority.clockMs + BigInt(HANDOVER_REVIEW_WINDOW_MS) ||
      BigInt(okr.deadline_ms) <=
        BigInt(Date.now()) + BigInt(HANDOVER_REVIEW_WINDOW_MS)
    )
      throw new HandoverSetupError("review_expired");
    const logicalId = `okr-${okr.logical_id}-spec`;
    const head = await this.chain.sdk.productRecord.getCurrent(
      this.organizationId,
      "okr",
      logicalId,
    );
    if (
      head.record_id !== okr.spec_record ||
      head.revision !== okr.spec_revision
    )
      throw new HandoverSetupError("invalid_source");
    const plain = await this.records.read({ ...head, kind: 1, logicalId });
    let spec: ReturnType<typeof parseOkrSpecification>;
    try {
      spec = parseOkrSpecification(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)),
      );
    } finally {
      plain.fill(0);
    }
    if (
      okr.priority !== spec.priority ||
      okr.deadline_ms !== spec.deadlineMs ||
      okr.metrics.length !== spec.krs.length ||
      okr.metrics.some(
        (m, i) =>
          m.baseline !== spec.krs[i].baseline ||
          m.target !== spec.krs[i].target ||
          m.weight !== spec.krs[i].weight ||
          m.max_age_ms !== spec.krs[i].maxAgeMs,
      )
    )
      throw new HandoverSetupError("invalid_source");
    const after = await this.source();
    const latest = await this.chain.sdk.okr.getOkr(okrId);
    if (after.pin !== source.pin || canonical(latest) !== canonical(okr))
      throw new HandoverSetupError("state_changed");
    return { source, okr, spec, pin: canonical([source.pin, okr, head]) };
  }
  async createReview(
    okrId: string,
    capabilityId: string,
    rawPlan: NativeFileOkrPlan,
    expectedSpec?: ReturnType<typeof parseOkrSpecification>,
  ): Promise<HandoverReviewInput> {
    const before = await this.specification(okrId),
      plan = structuredClone(rawPlan);
    if (
      expectedSpec &&
      canonical(parseOkrSpecification(expectedSpec)) !== canonical(before.spec)
    )
      throw new HandoverSetupError("state_changed");
    const cap = await this.capability(capabilityId, before.source);
    const now = Math.max(Date.now(), Number(before.source.authority.clockMs));
    const reviewExpiresAtMs = now + HANDOVER_REVIEW_WINDOW_MS;
    const expiresAtMs = Math.min(Number(cap.expiresAtMs), reviewExpiresAtMs);
    const executionExpiry = [
      before.okr.deadline_ms,
      before.source.authority.expiresAtMs,
      before.source.member.expires_at_ms,
    ]
      .map(Number)
      .reduce((a, b) => Math.min(a, b));
    if (
      !Number.isSafeInteger(executionExpiry) ||
      executionExpiry <= reviewExpiresAtMs ||
      expiresAtMs < reviewExpiresAtMs
    )
      throw new HandoverSetupError("review_expired");
    const proposal: HandoverProposal = {
      version: "1",
      managed_agent_id: this.managedAgentId,
      managed_version: before.source.managed.version,
      okr_id: okrId,
      okr_version: before.okr.version,
      spec_revision: before.okr.spec_revision,
      workspace_hash: bytesToHex(
        Uint8Array.from(before.source.managed.workspace_hash),
      ),
      paths: plan.paths,
      budget_asset: "TOOL_CALLS",
      budget_limit: before.spec.constraints.budget.limit,
      max_calls: plan.krs.reduce(
        (m, k) => (BigInt(k.maxCalls) > BigInt(m) ? k.maxCalls : m),
        "0",
      ),
      expires_at_ms: executionExpiry,
      review_expires_at_ms: reviewExpiresAtMs,
      nonce: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    };
    handoverProposalHash(proposal);
    const validated = validateHandoverPlan(before.spec, plan, proposal);
    const command = await signNodeCommand(this.signer, {
      target: {
        organizationId: this.organizationId,
        nodeId: before.source.managed.host_address,
        agentId: before.source.managed.instance_id,
      },
      action: "status",
      scope: "observation",
      capability: {
        id: capabilityId,
        revocationVersion: cap.revocationVersion,
      },
      payload: { handover_review: proposal },
      issuedAtMs: now,
      expiresAtMs,
    });
    const after = await this.specification(okrId);
    if (
      after.pin !== before.pin ||
      canonical(await this.capability(capabilityId, before.source)) !==
        canonical(cap)
    )
      throw new HandoverSetupError("state_changed");
    if (
      Math.max(Date.now(), Number(after.source.authority.clockMs)) >=
      reviewExpiresAtMs
    )
      throw new HandoverSetupError("review_expired");
    return {
      command,
      membershipId: before.source.member.id,
      bindingId: before.source.binding.id,
      managedAgentId: this.managedAgentId,
      nativeFilePlan: validated.plan,
    };
  }
}
