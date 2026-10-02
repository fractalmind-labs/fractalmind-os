import { bcs } from "@mysten/sui/bcs";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  OkrBcs,
  PRODUCT_RECORD_KINDS,
  SelfPayTransactionManager,
  bytesToHex,
  verifySignedNodeCommand,
  type HandoverProposal,
  type NativeFileOkrPlan,
  type SignedNodeCommand,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import { NativeDeviceSigner, call, type NativeInvoke } from "./native-device";
import { NativeExecutionResults } from "./execution-results";
import { hostDirectory } from "./host-admission";
import { managedInstance } from "./agent-import";
import { PrivateRecords, type RecordPointer } from "./private-records";
import { canonical, validateHandoverPlan } from "./handover-plan";

export class HandoverApprovalError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "invalid_source"
      | "state_changed"
      | "invalid_quote"
      | "invalid_ciphertext",
  ) {
    super(code);
  }
}
export type HandoverApprovalInput = {
  command: SignedNodeCommand;
  nativeFilePlan: NativeFileOkrPlan;
};
const id = /^0x[0-9a-f]{64}$/;
const positive = (v: string) =>
  /^[1-9][0-9]*$/.test(v) && v.length <= 20 && BigInt(v) <= 0xffffffffffffffffn;

/** Approves one exact successful Host review. Product state remains on Sui;
 * quotes and plaintext are ephemeral. Approval never dispatches continuation.
 * A retained original digest is queried before fresh authority/proof checks. */
export class HandoverApproval {
  readonly requestId: string;
  private readonly manager: SelfPayTransactionManager;
  private readonly verifier: DeviceIdentityVerifier;
  private readonly results: NativeExecutionResults;
  private readonly records: PrivateRecords;
  private readonly plans = new WeakMap<
    SelfPayFeeQuote,
    { input: HandoverApprovalInput; pin: string }
  >();
  private signingGuard?: () => Promise<void>;
  private flight?: {
    quote: SelfPayFeeQuote;
    outcome: Promise<SelfPayTransactionOutcome>;
  };
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    readonly executionId: string,
    private readonly invoke: NativeInvoke,
    journal: TransactionJournal,
    private readonly assertActive: () => void = () => {},
  ) {
    if (![organizationId, grantId, executionId].every((v) => id.test(v)))
      throw new HandoverApprovalError("invalid_input");
    this.requestId = `handover-approve:${executionId}`;
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.results = new NativeExecutionResults(
      chain,
      signer,
      grantId,
      organizationId,
      invoke,
    );
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
          const guard = this.signingGuard;
          if (!guard) throw new HandoverApprovalError("invalid_quote");
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
  private async directory(logicalId: string) {
    const records: RecordPointer[] = [],
      seen = new Set<string>();
    let cursor: string | null = null,
      keyVersion: string | undefined;
    do {
      const page = await this.chain.sdk.productRecord.listCurrent(
        this.organizationId,
        cursor,
        50,
      );
      if (
        !positive(page.keyVersion) ||
        (keyVersion && keyVersion !== page.keyVersion)
      )
        throw new HandoverApprovalError("state_changed");
      keyVersion = page.keyVersion;
      for (const row of page.records) {
        if (
          !id.test(row.record_id) ||
          !positive(row.revision) ||
          !positive(row.key_version) ||
          records.some(
            (r) => r.kind === row.kind && r.logicalId === row.logicalId,
          )
        )
          throw new HandoverApprovalError("invalid_source");
        records.push(row);
      }
      if (records.length > 1000)
        throw new HandoverApprovalError("invalid_source");
      if (!page.hasNextPage) break;
      if (!page.cursor || seen.has(page.cursor))
        throw new HandoverApprovalError("invalid_source");
      cursor = page.cursor;
      seen.add(cursor);
    } while (cursor);
    return {
      keyVersion: keyVersion!,
      agreement: records.find(
        (r) =>
          r.kind === PRODUCT_RECORD_KINDS.contract &&
          r.logicalId === `okr-${logicalId}-agreement`,
      ),
    };
  }
  private async source(input: HandoverApprovalInput) {
    const c = input.command,
      proposal = c.payload.handover_review as HandoverProposal;
    if (
      c.signer !== this.signer.device.address ||
      c.target.organization_id !== this.organizationId ||
      !proposal ||
      !id.test(proposal.okr_id) ||
      !id.test(proposal.managed_agent_id)
    )
      throw new HandoverApprovalError("invalid_input");
    await verifySignedNodeCommand(c);
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      "approve",
    );
    if (
      !authority.authorityPin ||
      authority.humanId !== this.chain.profile.humanId ||
      !(["read", "operate", "approve", "manage_hosts"] as const).every((a) =>
        authority.actions.includes(a),
      )
    )
      throw new HandoverApprovalError("invalid_source");
    const review = await this.results.readReview({
      executionId: this.executionId,
      command: c,
      proposal,
    });
    const a = review.acceptance;
    if (a.human_id !== authority.humanId || a.grant_id !== this.grantId)
      throw new HandoverApprovalError("invalid_source");
    const hosts = await hostDirectory(this.chain, this.organizationId);
    const member = hosts.memberships.find(
      (m) =>
        m.id === a.membership_id &&
        !m.revoked &&
        m.host_address === a.host_address &&
        m.coordinator_binding === a.binding_id &&
        BigInt(m.expires_at_ms) > hosts.clockMs,
    );
    const binding = hosts.bindings.find(
      (b) => b.id === a.binding_id && !b.revoked,
    );
    if (
      !member ||
      !binding ||
      !hosts.activeHostsTableId ||
      BigInt(proposal.expires_at_ms) > BigInt(member.expires_at_ms) ||
      BigInt(proposal.expires_at_ms) > BigInt(authority.expiresAtMs)
    )
      throw new HandoverApprovalError("invalid_source");
    const { dynamicField } =
      await this.chain.sdk.client.client.core.getDynamicField({
        parentId: hosts.activeHostsTableId,
        name: {
          type: "address",
          bcs: bcs.Address.serialize(a.host_address).toBytes(),
        },
      });
    if (
      !["0x2::object::ID", `0x${"2".padStart(64, "0")}::object::ID`].includes(
        dynamicField.value.type,
      ) ||
      bcs.Address.parse(dynamicField.value.bcs) !== member.id
    )
      throw new HandoverApprovalError("invalid_source");
    const managed = await managedInstance(
      this.chain,
      this.organizationId,
      a.host_address,
      a.instance_id,
    );
    if (
      !managed ||
      managed.id !== proposal.managed_agent_id ||
      managed.revoked ||
      managed.membership_id !== member.id ||
      managed.runtime !== "bounded-process-v1" ||
      managed.version !== proposal.managed_version ||
      bytesToHex(Uint8Array.from(managed.workspace_hash)) !==
        proposal.workspace_hash
    )
      throw new HandoverApprovalError("invalid_source");
    const coverage = await this.chain.sdk.nodeExecution.readAgentExecutions(
      this.organizationId,
      managed.id,
    );
    const original = coverage.executions.find(
      (r) => r.run.id === this.executionId,
    );
    if (
      coverage.unsettledControl !== 0 ||
      BigInt(coverage.revision) !== BigInt(a.coverage_revision) + 1n ||
      canonical(coverage.managed) !== canonical(managed) ||
      !original ||
      original.control ||
      !original.settled ||
      canonical(original.run) !== canonical(review.run)
    )
      throw new HandoverApprovalError("invalid_source");
    const { object } = await this.chain.sdk.client.client.core.getObject({
      objectId: proposal.okr_id,
      include: { content: true },
    });
    if (
      object.objectId !== proposal.okr_id ||
      object.owner.$kind !== "Shared" ||
      !object.content ||
      object.type !== `${this.chain.sdk.client.typesPackageId}::okr::Okr`
    )
      throw new HandoverApprovalError("invalid_source");
    const okr = OkrBcs.parse(object.content);
    if (
      okr.id !== proposal.okr_id ||
      okr.org_id !== this.organizationId ||
      okr.owner_human !== a.human_id ||
      ![0, 2].includes(okr.state) ||
      okr.version !== proposal.okr_version ||
      okr.spec_revision !== proposal.spec_revision ||
      BigInt(proposal.expires_at_ms) > BigInt(okr.deadline_ms) ||
      BigInt(proposal.expires_at_ms) <= hosts.clockMs ||
      BigInt(proposal.expires_at_ms) <= BigInt(Date.now())
    )
      throw new HandoverApprovalError("invalid_source");
    const specHead = await this.chain.sdk.productRecord.getCurrent(
      this.organizationId,
      "okr",
      `okr-${okr.logical_id}-spec`,
    );
    if (
      specHead.record_id !== okr.spec_record ||
      specHead.revision !== okr.spec_revision
    )
      throw new HandoverApprovalError("invalid_source");
    const plaintext = await this.records.read({
      ...specHead,
      kind: PRODUCT_RECORD_KINDS.okr,
      logicalId: `okr-${okr.logical_id}-spec`,
    });
    let validated: ReturnType<typeof validateHandoverPlan>;
    try {
      validated = validateHandoverPlan(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
        input.nativeFilePlan,
        proposal,
      );
    } finally {
      plaintext.fill(0);
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
      throw new HandoverApprovalError("invalid_source");
    const records = await this.directory(okr.logical_id),
      agreement = records.agreement;
    if (
      Boolean(agreement) !== Boolean(okr.agreement_record) ||
      (agreement && agreement.record_id !== okr.agreement_record)
    )
      throw new HandoverApprovalError("invalid_source");
    let budget = null;
    if (okr.state === 2) {
      budget = await this.chain.sdk.okr.getBudget(okr.id);
      const remainingCaps = plan.krs
        .slice(Number(okr.next_kr))
        .reduce((sum, kr) => sum + BigInt(kr.maxCalls), 0n);
      if (
        budget.reserved !== 0n ||
        budget.asset !== proposal.budget_asset ||
        budget.spent + remainingCaps > BigInt(proposal.budget_limit)
      )
        throw new HandoverApprovalError("invalid_source");
    }
    return {
      authority,
      acceptance: a,
      okr,
      plan,
      keyVersion: records.keyVersion,
      expectedRevision: agreement?.revision ?? "0",
      pin: canonical([
        authority.authorityPin,
        member,
        binding,
        managed,
        hosts.activeHostsTableId,
        coverage.revision,
        original.run,
        okr,
        specHead,
        records,
        budget,
      ]),
    };
  }
  async prepare(
    raw: HandoverApprovalInput,
  ): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    const input = structuredClone(raw),
      prior = await this.query();
    if (prior) return prior;
    const before = await this.source(input);
    const plaintext = new TextEncoder().encode(
      JSON.stringify({
        format: 1,
        hostAcceptance: before.acceptance,
        nativeFilePlan: before.plan,
        specRecordId: before.okr.spec_record,
      }),
    );
    let encrypted: unknown;
    try {
      encrypted = await call(this.invoke, "fm_device_encrypt_record", {
        profile: this.signer.device.profile,
        record: JSON.stringify({
          network: this.chain.profile.network,
          encryptedKeys: before.authority.encryptedKeys,
          organizationId: this.organizationId,
          kind: PRODUCT_RECORD_KINDS.contract,
          logicalId: `okr-${before.okr.logical_id}-agreement`,
          revision: (BigInt(before.expectedRevision) + 1n).toString(),
          keyVersion: before.keyVersion,
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
      throw new HandoverApprovalError("invalid_ciphertext");
    }
    const assertCurrent = async () => {
      if ((await this.source(input)).pin !== before.pin)
        throw new HandoverApprovalError("state_changed");
    };
    await assertCurrent();
    const transaction = await this.chain.sdk.handover.confirmOkr({
      acceptance: before.acceptance,
      capabilityId: input.command.capability.id,
      expectedRecordRevision: before.expectedRevision,
      keyVersion: before.keyVersion,
      encryptedAgreement: body,
    });
    await assertCurrent();
    const quote = await this.manager.prepare({
      transaction,
      requestId: this.requestId,
      gasBudget: 200_000_000n,
    });
    await assertCurrent();
    this.plans.set(quote, { input, pin: before.pin });
    return quote;
  }
  async submit(quote: SelfPayFeeQuote): Promise<SelfPayTransactionOutcome> {
    if (this.flight) {
      if (this.flight.quote !== quote)
        throw new HandoverApprovalError("invalid_quote");
      return this.flight.outcome;
    }
    const outcome = this.submitOnce(quote);
    this.flight = { quote, outcome };
    try {
      return await outcome;
    } finally {
      this.flight = undefined;
    }
  }
  private async submitOnce(quote: SelfPayFeeQuote) {
    const prior = await this.query();
    if (prior) return prior;
    const plan = this.plans.get(quote);
    if (!plan || quote.requestId !== this.requestId)
      throw new HandoverApprovalError("invalid_quote");
    const assertCurrent = async () => {
      if ((await this.source(plan.input)).pin !== plan.pin)
        throw new HandoverApprovalError("state_changed");
    };
    await assertCurrent();
    this.signingGuard = assertCurrent;
    try {
      return await this.manager.submit(quote);
    } finally {
      this.signingGuard = undefined;
    }
  }
}
