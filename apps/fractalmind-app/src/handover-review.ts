import {
  fromBase64,
  toBase64,
  isValidTransactionDigest,
} from "@mysten/sui/utils";
import {
  AuthorityBindingBcs,
  OkrBcs,
  parseNativeFileOkrPlan,
  executionBoundaryHash,
  SelfPayTransactionManager,
  bytesToHex,
  nodeCommandIntentHash,
  verifySignedNodeCommand,
  handoverProposalHash,
  type HandoverProposal,
  type NativeFileOkrPlan,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import {
  NativeCommandResults,
  type CommandResultTarget,
} from "./command-results";
import { NativeExecutionResults } from "./execution-results";
import { DeviceIdentityVerifier } from "./device-identity";
import { PrivateRecords } from "./private-records";
import { NativeDeviceSigner, call, type NativeInvoke } from "./native-device";
import { CoordinatorReadClient } from "./coordinator-read";
import { canonical, validateHandoverPlan } from "./handover-plan";
import { readRecordPointer } from "./record-pointer";

export class HandoverReviewError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "invalid_source"
      | "review_expired"
      | "state_changed"
      | "already_exists"
      | "invalid_quote"
      | "invalid_ciphertext"
      | "confirmation_required"
      | "delivery_already_attempted",
  ) {
    super(code);
  }
}
export type HandoverReviewInput = CommandResultTarget & {
  nativeFilePlan: NativeFileOkrPlan;
};
export type HandoverReviewTicket = {
  schema: "fractalmind.handover-review-ticket.v1";
  specRecordId: string;
  input: HandoverReviewInput;
};
const id = /^0x[0-9a-f]{64}$/;

/** Persist the exact original request and reserved observation atomically.
 * No approval or execution continuation; Host delivery is a separate one-use
 * explicit action. Restore is read-only and never regenerates a command. */
export class HandoverReview {
  readonly logicalId: string;
  readonly requestId: string;
  private readonly verifier: DeviceIdentityVerifier;
  private readonly records: PrivateRecords;
  private readonly results: NativeCommandResults;
  private readonly manager: SelfPayTransactionManager;
  private readonly plans = new WeakMap<
    SelfPayFeeQuote,
    { assertCurrent: () => Promise<void> }
  >();
  private signingGuard?: () => Promise<void>;
  private submitting?: {
    quote: SelfPayFeeQuote;
    outcome: Promise<SelfPayTransactionOutcome>;
  };
  private deliveryAttempted = false;
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    readonly attemptId: string,
    private readonly invoke: NativeInvoke,
    journal: TransactionJournal,
    private readonly transport: typeof fetch = fetch,
    private readonly assertActive: () => void = () => {},
  ) {
    if (
      ![grantId, organizationId].every((v) => id.test(v)) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        attemptId,
      )
    )
      throw new HandoverReviewError("invalid_input");
    this.logicalId = `handover-review-${attemptId}`;
    this.requestId = this.logicalId;
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.records = new PrivateRecords(
      chain,
      signer,
      grantId,
      organizationId,
      invoke,
    );
    this.results = new NativeCommandResults(
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
          const guard = this.signingGuard;
          if (!guard) throw new HandoverReviewError("invalid_quote");
          await guard();
          const signature = await signer.signTransaction(bytes);
          await guard();
          return signature;
        },
      },
    });
  }
  async query() {
    await this.chain.checkNetwork();
    return this.manager.query(this.requestId);
  }
  private async directory() {
    const found = await readRecordPointer(
      this.chain,
      this.organizationId,
      "checkpoint",
      this.logicalId,
    );
    if (found.pointer && found.pointer.revision !== "1")
      throw new HandoverReviewError("invalid_source");
    return { keyVersion: found.keyVersion, ticket: found.pointer };
  }
  private async context(input: HandoverReviewInput, reserved = false) {
    const c = input.command,
      p = c?.payload?.handover_review as HandoverProposal;
    if (
      !p ||
      ![
        input.managedAgentId,
        input.membershipId,
        input.bindingId,
        p.okr_id,
        c.capability.id,
      ].every((v) => id.test(v)) ||
      p.managed_agent_id !== input.managedAgentId ||
      c.action !== "status" ||
      c.scope !== "observation" ||
      c.budget ||
      c.signer !== this.signer.device.address ||
      c.target.organization_id !== this.organizationId ||
      Object.keys(c.payload).some((k) => k !== "handover_review")
    )
      throw new HandoverReviewError("invalid_input");
    await verifySignedNodeCommand(c);
    handoverProposalHash(p);
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
      throw new HandoverReviewError("invalid_source");
    if (
      !Number.isSafeInteger(p.review_expires_at_ms) ||
      p.review_expires_at_ms <= Date.now() ||
      BigInt(p.review_expires_at_ms) <= authority.clockMs ||
      c.expires_at_ms <= Date.now() ||
      BigInt(c.expires_at_ms) <= authority.clockMs
    )
      throw new HandoverReviewError("review_expired");
    const coverage = await this.chain.sdk.nodeExecution.readAgentExecutions(
      this.organizationId,
      input.managedAgentId,
    );
    const managed = coverage.managed;
    if (
      coverage.unsettledControl ||
      managed.id !== input.managedAgentId ||
      managed.revoked ||
      managed.membership_id !== input.membershipId ||
      managed.runtime !== "bounded-process-v1" ||
      managed.instance_id !== c.target.agent_id ||
      managed.host_address !== c.target.node_id ||
      managed.version !== p.managed_version ||
      bytesToHex(Uint8Array.from(managed.workspace_hash)) !== p.workspace_hash
    )
      throw new HandoverReviewError("invalid_source");
    // NativeCommandResults separately validates current directory pointers and
    // member/binding authority for preparation and every delivery preflight.
    const capSource = await this.chain.sdk.client.client.core.getObject({
      objectId: c.capability.id,
    });
    if (
      capSource.object.objectId !== c.capability.id ||
      capSource.object.owner.$kind !== "Shared" ||
      capSource.object.type !==
        (await this.chain.sdk.client.coreType(
          "remote_authority",
          "RemoteCapability",
        ))
    )
      throw new HandoverReviewError("invalid_source");
    const capability = await this.chain.sdk.remoteAuthority.getCapability(
      c.capability.id,
    );
    const { dynamicField } =
      await this.chain.sdk.client.client.core.getDynamicField({
        parentId: c.capability.id,
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
      throw new HandoverReviewError("invalid_source");
    const binding = AuthorityBindingBcs.parse(dynamicField.value.bcs);
    const member = await this.chain.sdk.host.getMembership(input.membershipId);
    if (
      capability.objectId !== c.capability.id ||
      capability.type !== capSource.object.type ||
      capability.revoked ||
      capability.parentId ||
      capability.orgId !== this.organizationId ||
      capability.delegate !== c.signer ||
      capability.nodeId !== managed.host_address ||
      capability.agentId !== managed.instance_id ||
      capability.scope !== "observation" ||
      capability.actions.length !== 1 ||
      capability.actions[0] !== "status" ||
      capability.maxUses !== 1n ||
      capability.usesDelegated !== 0n ||
      capability.usesClaimed !== (reserved ? 1n : 0n) ||
      capability.budgetAsset ||
      capability.maxBudget !== 0n ||
      capability.revocationVersion.toString() !==
        c.capability.revocation_version ||
      capability.expiresAtMs < BigInt(c.expires_at_ms) ||
      capability.expiresAtMs <= authority.clockMs ||
      binding.human_id !== authority.humanId ||
      binding.device_grant !== this.grantId ||
      binding.device_grant_version !== authority.grantVersion ||
      binding.human_generation !== authority.generation ||
      binding.managed_agent !== managed.id ||
      binding.managed_agent_version !== managed.version ||
      binding.membership_id !== input.membershipId ||
      binding.membership_version !== member.version ||
      member.id !== input.membershipId ||
      member.org_id !== this.organizationId ||
      member.host_address !== managed.host_address ||
      member.coordinator_binding !== input.bindingId ||
      member.revoked ||
      BigInt(p.expires_at_ms) > BigInt(member.expires_at_ms)
    )
      throw new HandoverReviewError("invalid_source");
    const { object } = await this.chain.sdk.client.client.core.getObject({
      objectId: p.okr_id,
      include: { content: true },
    });
    if (
      object.objectId !== p.okr_id ||
      object.owner.$kind !== "Shared" ||
      !object.content ||
      object.type !== `${this.chain.sdk.client.okrTypesPackageId}::okr::Okr`
    )
      throw new HandoverReviewError("invalid_source");
    const okr = OkrBcs.parse(object.content);
    if (
      okr.id !== p.okr_id ||
      okr.org_id !== this.organizationId ||
      okr.owner_human !== authority.humanId ||
      ![0, 2].includes(okr.state) ||
      okr.version !== p.okr_version ||
      okr.spec_revision !== p.spec_revision ||
      BigInt(p.expires_at_ms) > BigInt(okr.deadline_ms) ||
      BigInt(p.expires_at_ms) > BigInt(authority.expiresAtMs)
    )
      throw new HandoverReviewError("invalid_source");
    const head = await this.chain.sdk.productRecord.getCurrent(
      this.organizationId,
      "okr",
      `okr-${okr.logical_id}-spec`,
    );
    if (
      head.record_id !== okr.spec_record ||
      head.revision !== okr.spec_revision
    )
      throw new HandoverReviewError("invalid_source");
    const plain = await this.records.read({
      ...head,
      kind: 1,
      logicalId: `okr-${okr.logical_id}-spec`,
    });
    let validated: ReturnType<typeof validateHandoverPlan>;
    try {
      validated = validateHandoverPlan(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)),
        input.nativeFilePlan,
        p,
      );
    } finally {
      plain.fill(0);
    }
    const { spec, plan } = validated;
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
      throw new HandoverReviewError("invalid_source");
    const directory = await this.directory();
    return {
      authority,
      okr,
      plan,
      directory,
      pin: canonical([
        authority.authorityPin,
        coverage.revision,
        managed,
        capability,
        binding,
        okr,
        head,
        directory,
      ]),
    };
  }
  async prepare(
    raw: HandoverReviewInput,
  ): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    const input = structuredClone(raw),
      prior = await this.query();
    if (prior) return prior;
    const before = await this.context(input);
    if (before.directory.ticket)
      throw new HandoverReviewError("already_exists");
    const prepared = await this.results.prepare(input);
    const ticket: HandoverReviewTicket = {
      schema: "fractalmind.handover-review-ticket.v1",
      specRecordId: before.okr.spec_record,
      input: { ...input, nativeFilePlan: before.plan },
    };
    const plaintext = new TextEncoder().encode(JSON.stringify(ticket));
    let encrypted: unknown;
    try {
      encrypted = await call(this.invoke, "fm_device_encrypt_record", {
        profile: this.signer.device.profile,
        record: JSON.stringify({
          network: this.chain.profile.network,
          encryptedKeys: before.authority.encryptedKeys,
          organizationId: this.organizationId,
          kind: 5,
          logicalId: this.logicalId,
          revision: "1",
          keyVersion: before.directory.keyVersion,
          plaintext: toBase64(plaintext),
        }),
      });
    } finally {
      plaintext.fill(0);
    }
    let body: Uint8Array;
    try {
      if (typeof encrypted !== "string" || encrypted.length > 87384)
        throw new Error();
      body = fromBase64(encrypted);
      if (
        body.length < 32 ||
        body.length > 65536 ||
        toBase64(body) !== encrypted ||
        new TextDecoder().decode(body.slice(0, 4)) !== "FME1"
      )
        throw new Error();
    } catch {
      throw new HandoverReviewError("invalid_ciphertext");
    }
    const assertCurrent = async () => {
      await prepared.assertCurrent();
      if ((await this.context(input)).pin !== before.pin)
        throw new HandoverReviewError("state_changed");
    };
    await assertCurrent();
    const tx = this.chain.sdk.productRecord.save({
      organizationId: this.organizationId,
      humanId: before.authority.humanId,
      grantId: this.grantId,
      kind: "checkpoint",
      logicalId: this.logicalId,
      expectedRevision: 0n,
      keyVersion: before.directory.keyVersion,
      encryptedBody: body,
      tx: prepared.transaction,
    });
    const quote = await this.manager.prepare({
      requestId: this.requestId,
      transaction: tx,
      gasBudget: 200_000_000n,
    });
    await assertCurrent();
    this.plans.set(quote, { assertCurrent });
    return quote;
  }
  async submit(quote: SelfPayFeeQuote): Promise<SelfPayTransactionOutcome> {
    if (this.submitting) {
      if (this.submitting.quote !== quote)
        throw new HandoverReviewError("invalid_quote");
      return this.submitting.outcome;
    }
    const outcome = this.submitOnce(quote);
    this.submitting = { quote, outcome };
    try {
      return await outcome;
    } finally {
      this.submitting = undefined;
    }
  }
  private async submitOnce(quote: SelfPayFeeQuote) {
    const prior = await this.query();
    if (prior) return prior;
    const plan = this.plans.get(quote);
    if (!plan || quote.requestId !== this.requestId)
      throw new HandoverReviewError("invalid_quote");
    await plan.assertCurrent();
    this.signingGuard = plan.assertCurrent;
    try {
      return await this.manager.submit(quote);
    } finally {
      this.signingGuard = undefined;
    }
  }
  async restore() {
    const originalOutcome = await this.query();
    await this.verifier.verifyOrganization(this.organizationId, "read");
    const directory = await this.directory();
    if (!directory.ticket)
      return {
        status: "ticket_not_observed" as const,
        ticket: null,
        run: null,
        originalOutcome,
      };
    const plain = await this.records.read(directory.ticket);
    let ticket: HandoverReviewTicket;
    try {
      ticket = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(plain),
      ) as HandoverReviewTicket;
      if (
        ticket.schema !== "fractalmind.handover-review-ticket.v1" ||
        !id.test(ticket.specRecordId) ||
        Object.keys(ticket).some(
          (k) => !["schema", "specRecordId", "input"].includes(k),
        ) ||
        Object.keys(ticket.input).some(
          (k) =>
            ![
              "command",
              "membershipId",
              "bindingId",
              "managedAgentId",
              "nativeFilePlan",
            ].includes(k),
        )
      )
        throw new HandoverReviewError("invalid_source");
      await verifySignedNodeCommand(ticket.input.command);
    } finally {
      plain.fill(0);
    }
    const c = ticket.input.command,
      p = c.payload.handover_review as HandoverProposal;
    if (
      !p ||
      c.action !== "status" ||
      c.scope !== "observation" ||
      c.target.organization_id !== this.organizationId ||
      ![
        ticket.input.membershipId,
        ticket.input.bindingId,
        ticket.input.managedAgentId,
        c.capability.id,
        c.target.node_id,
      ].every((v) => id.test(v)) ||
      ticket.input.managedAgentId !== p.managed_agent_id ||
      c.budget ||
      Object.keys(c.payload).some((k) => k !== "handover_review")
    )
      throw new HandoverReviewError("invalid_source");
    handoverProposalHash(p);
    ticket.input.nativeFilePlan = parseNativeFileOkrPlan(
      ticket.input.nativeFilePlan,
    );
    if (
      bytesToHex(executionBoundaryHash(ticket.input.nativeFilePlan.paths)) !==
      bytesToHex(executionBoundaryHash(p.paths))
    )
      throw new HandoverReviewError("invalid_source");
    const record = await this.chain.sdk.productRecord.getRecord(
      directory.ticket.record_id,
    );
    if (
      record.writer_device !== c.signer ||
      record.writer_human !== this.chain.profile.humanId
    )
      throw new HandoverReviewError("invalid_source");
    const { object: provenance } =
      await this.chain.sdk.client.client.core.getObject({
        objectId: directory.ticket.record_id,
        include: { previousTransaction: true },
      });
    if (
      provenance.objectId !== directory.ticket.record_id ||
      provenance.owner.$kind !== "Immutable" ||
      provenance.type !==
        (await this.chain.sdk.client.coreType(
          "product_record",
          "EncryptedRecord",
        )) ||
      !provenance.previousTransaction ||
      !isValidTransactionDigest(provenance.previousTransaction) ||
      (originalOutcome &&
        originalOutcome.digest !== provenance.previousTransaction)
    )
      throw new HandoverReviewError("invalid_source");
    const coverage = await this.chain.sdk.nodeExecution.readAgentExecutions(
      this.organizationId,
      ticket.input.managedAgentId,
    );
    const matching = coverage.executions.filter(
      (r) =>
        bytesToHex(Uint8Array.from(r.run.intent_hash)) ===
        bytesToHex(nodeCommandIntentHash(c)),
    );
    if (matching.length !== 1) throw new HandoverReviewError("invalid_source");
    const run = matching[0].run;
    if (
      run.org_id !== this.organizationId ||
      run.managed_agent !== ticket.input.managedAgentId ||
      run.membership_id !== ticket.input.membershipId ||
      run.capability_id !== c.capability.id ||
      run.capability_version !== c.capability.revocation_version ||
      run.delegate !== c.signer ||
      run.command_id !== c.command_id ||
      run.nonce !== c.nonce ||
      run.idempotency_key !== c.idempotency_key ||
      run.node_id !== c.target.node_id ||
      run.agent_id !== c.target.agent_id ||
      run.action !== c.action ||
      run.scope !== c.scope ||
      run.human_id !== record.writer_human ||
      run.grant_id !== record.grant_id ||
      run.grant_version !== record.grant_version ||
      run.created_at_ms !== record.created_at_ms ||
      run.budget_asset ||
      run.budget_amount !== "0" ||
      run.issued_at_ms !== String(c.issued_at_ms) ||
      run.expires_at_ms !== String(c.expires_at_ms)
    )
      throw new HandoverReviewError("invalid_source");
    const after = await this.directory();
    if (canonical(after.ticket) !== canonical(directory.ticket))
      throw new HandoverReviewError("state_changed");
    await this.verifier.verifyOrganization(this.organizationId, "read");
    return {
      status: "restored" as const,
      ticket,
      run,
      pointer: directory.ticket,
      originalOutcome,
      preparationDigest: provenance.previousTransaction,
    };
  }
  async send(confirm: false | true) {
    if (!confirm) throw new HandoverReviewError("confirmation_required");
    if (this.deliveryAttempted)
      throw new HandoverReviewError("delivery_already_attempted");
    const restored = await this.restore();
    if (
      !restored.ticket ||
      !restored.run ||
      restored.run.state !== 0 ||
      restored.run.stop_requested ||
      restored.run.grant_id !== this.grantId ||
      restored.ticket.input.command.signer !== this.signer.device.address
    )
      throw new HandoverReviewError("invalid_source");
    const input = restored.ticket.input,
      before = await this.context(input, true);
    if (
      before.directory.keyVersion !== restored.pointer!.key_version ||
      restored.ticket.specRecordId !== before.okr.spec_record
    )
      throw new HandoverReviewError("state_changed");
    const assertCurrent = await this.results.preflight(input);
    const delivery = await new CoordinatorReadClient(
      this.chain,
      this.signer,
      this.grantId,
      this.organizationId,
      this.transport,
    ).prepareCommand(input.bindingId, input.command);
    await assertCurrent();
    if ((await this.context(input, true)).pin !== before.pin)
      throw new HandoverReviewError("state_changed");
    const current = await this.chain.sdk.nodeExecution.getExecution(
      restored.run.id,
    );
    if (canonical(current) !== canonical(restored.run))
      throw new HandoverReviewError("state_changed");
    this.deliveryAttempted = true;
    await delivery.send();
    return { executionId: restored.run.id };
  }
  async readAcceptance() {
    const restored = await this.restore();
    if (!restored.ticket || !restored.run)
      throw new HandoverReviewError("invalid_source");
    return new NativeExecutionResults(
      this.chain,
      this.signer,
      this.grantId,
      this.organizationId,
      this.invoke,
    ).readReview({
      executionId: restored.run.id,
      command: restored.ticket.input.command,
      proposal: restored.ticket.input.command.payload
        .handover_review as HandoverProposal,
    });
  }
}
