import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  bytesToHex,
  executionBoundaryHash,
  handoverProposalHash,
  verifyHandoverAcceptanceSignature,
  type HandoverAcceptance,
  OkrBcs,
  PRODUCT_RECORD_KINDS,
  SelfPayTransactionManager,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import {
  NativeExecutionResults,
  type ExecutionResult,
} from "./execution-results";
import {
  canonical,
  parseOkrSpecification,
  validateHandoverPlan,
  type OkrSpecification,
} from "./handover-plan";
import {
  NativeDeviceSigner,
  call,
  scopedNativeInvoke,
  type NativeInvoke,
} from "./native-device";
import { PrivateRecords } from "./private-records";
import { readRecordPointer } from "./record-pointer";
import { awaitTransactionVisible } from "./transaction-visibility";

type Okr = ReturnType<typeof OkrBcs.parse>;
export type HumanReviewIntent = {
  kind: "verify" | "accept";
  okrVersion: string;
  agreementVersion: string;
  krIndex: string;
};
export type HumanReviewEvidence = {
  krIndex: number;
  metric: Okr["metrics"][number];
  result: ExecutionResult;
  files: {
    path: string;
    content: string;
    expectedHash: string;
    observedHash: string;
  }[];
  priorVerification?: {
    recordId: string;
    executionAgreementVersion: string;
    reviewedAgreementVersion: string;
    reason: string;
    writerHuman: string;
    writerDevice: string;
  };
};
export type HumanReviewView = {
  okr: Okr;
  spec: OkrSpecification;
  evidence: HumanReviewEvidence[];
};
export class OkrHumanReviewError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "confirmation_required"
      | "invalid_source"
      | "state_changed"
      | "measurement_stale"
      | "unsettled_execution"
      | "invalid_quote"
      | "invalid_ciphertext"
      | "sync_pending",
  ) {
    super(code);
  }
}
const id = /^0x[0-9a-f]{64}$/;
const positive = (v: string) =>
  typeof v === "string" &&
  /^[1-9][0-9]*$/.test(v) &&
  v.length <= 20 &&
  BigInt(v) <= 0xffffffffffffffffn;
/** Historical evidence can be reviewed against an unchanged specification and
 * exact current file plan. This only admits a result for independent review;
 * it cannot authorize an old command under a renewed execution agreement. */
export function reviewableEvidenceAgreement(
  executionVersion: string,
  currentVersion: string,
  originalBoundary: number[],
  currentBoundary: number[],
) {
  if (
    !positive(executionVersion) ||
    !positive(currentVersion) ||
    BigInt(executionVersion) > BigInt(currentVersion) ||
    originalBoundary.length !== 32 ||
    currentBoundary.length !== 32
  )
    return false;
  return (
    executionVersion !== currentVersion ||
    canonical(originalBoundary) === canonical(currentBoundary)
  );
}
function object(v: unknown): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new OkrHumanReviewError("invalid_source");
  return v as Record<string, any>;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
async function textHash(content: string) {
  return bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)),
    ),
  );
}
export function humanReviewIntent(okr: Okr): HumanReviewIntent {
  return {
    kind: Number(okr.next_kr) < okr.metrics.length ? "verify" : "accept",
    okrVersion: okr.version,
    agreementVersion: okr.agreement_version,
    krIndex: okr.next_kr,
  };
}

/** Separate Human decisions. Reading evidence never verifies a KR; verifying
 * advances only its cursor. Final acceptance requires another explicit review,
 * fee and signature. No Host delivery or runner is available in this class. */
export class OkrHumanReview {
  readonly intent: Readonly<HumanReviewIntent>;
  readonly requestId: string;
  private readonly verifier: DeviceIdentityVerifier;
  private readonly records: PrivateRecords;
  private readonly results: NativeExecutionResults;
  private readonly manager: SelfPayTransactionManager;
  private readonly invoke: NativeInvoke;
  private readonly views = new WeakMap<HumanReviewView, string>();
  private readonly quotes = new WeakMap<SelfPayFeeQuote, () => Promise<void>>();
  private signingGuard?: () => Promise<void>;
  private flight?: {
    quote: SelfPayFeeQuote;
    result: Promise<SelfPayTransactionOutcome>;
  };
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    readonly okrId: string,
    intent: HumanReviewIntent,
    invoke: NativeInvoke,
    journal: TransactionJournal,
    private readonly assertActive: () => void = () => {},
  ) {
    if (
      ![grantId, organizationId, okrId].every((v) => id.test(v)) ||
      !["verify", "accept"].includes(intent.kind) ||
      !positive(intent.okrVersion) ||
      !positive(intent.agreementVersion) ||
      !/^[0-3]$/.test(intent.krIndex)
    )
      throw new OkrHumanReviewError("invalid_input");
    this.intent = Object.freeze({ ...intent });
    this.requestId = `okr-human:${okrId}:${intent.agreementVersion}:${intent.okrVersion}:${intent.kind}:${intent.krIndex}`;
    this.invoke = scopedNativeInvoke(invoke, assertActive);
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.records = new PrivateRecords(
      chain,
      signer,
      grantId,
      organizationId,
      this.invoke,
    );
    this.results = new NativeExecutionResults(
      chain,
      signer,
      grantId,
      organizationId,
      this.invoke,
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
          if (!guard) throw new OkrHumanReviewError("invalid_quote");
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
    this.assertActive();
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      "approve",
    );
    if (!authority.actions.includes("read") || !authority.encryptedKeys)
      throw new OkrHumanReviewError("invalid_source");
    const okr = await this.chain.sdk.okr.getOkr(this.okrId);
    if (
      okr.org_id !== this.organizationId ||
      okr.owner_human !== authority.humanId ||
      okr.state !== 1 ||
      okr.version !== this.intent.okrVersion ||
      okr.agreement_version !== this.intent.agreementVersion ||
      okr.next_kr !== this.intent.krIndex ||
      !okr.managed_agent ||
      !okr.agreement_record
    )
      throw new OkrHumanReviewError("state_changed");
    const index = Number(okr.next_kr),
      final = this.intent.kind === "accept";
    if (
      (final && index !== okr.metrics.length) ||
      (!final && index >= okr.metrics.length)
    )
      throw new OkrHumanReviewError("invalid_source");
    const indices = final ? okr.metrics.map((_, i) => i) : [index];
    for (const i of indices) {
      const m = okr.metrics[i];
      if (
        m.current === null ||
        !m.run_id ||
        !m.evidence_id ||
        (final
          ? !m.verified || !m.verification_id
          : m.verified || m.verification_id)
      )
        throw new OkrHumanReviewError("invalid_source");
      if (
        BigInt(m.sampled_at_ms) > authority.clockMs ||
        authority.clockMs - BigInt(m.sampled_at_ms) > BigInt(m.max_age_ms)
      )
        throw new OkrHumanReviewError("measurement_stale");
      if (
        BigInt(m.target) > BigInt(m.baseline)
          ? BigInt(m.current) < BigInt(m.target)
          : BigInt(m.current) > BigInt(m.target)
      )
        throw new OkrHumanReviewError("invalid_source");
    }
    const [specHead, verificationHead, acceptanceHead, budget, policy] =
      await Promise.all([
        readRecordPointer(
          this.chain,
          this.organizationId,
          "okr",
          `okr-${okr.logical_id}-spec`,
        ),
        readRecordPointer(
          this.chain,
          this.organizationId,
          "evidence",
          `okr-${okr.logical_id}-verification`,
        ),
        readRecordPointer(
          this.chain,
          this.organizationId,
          "evidence",
          `okr-${okr.logical_id}-acceptance`,
        ),
        this.chain.sdk.okr.getBudget(okr.id),
        this.chain.sdk.handover.getPolicy(okr.id),
      ]);
    if (
      !specHead.pointer ||
      specHead.pointer.record_id !== okr.spec_record ||
      specHead.pointer.revision !== okr.spec_revision ||
      verificationHead.keyVersion !== specHead.keyVersion ||
      acceptanceHead.keyVersion !== specHead.keyVersion ||
      acceptanceHead.pointer
    )
      throw new OkrHumanReviewError("state_changed");
    if (this.intent.kind === "accept" && budget.reserved !== 0n)
      throw new OkrHumanReviewError("unsettled_execution");
    if (
      policy.agreement_version !== okr.agreement_version ||
      policy.managed_version !== okr.managed_version
    )
      throw new OkrHumanReviewError("state_changed");
    const executions: Awaited<
      ReturnType<ChainReadSession["sdk"]["okr"]["listExecutions"]>
    >["executions"] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await this.chain.sdk.okr.listExecutions(okr.id, cursor, 100);
      executions.push(...page.executions);
      if (
        executions.length > 1000 ||
        (page.hasNextPage && (!page.cursor || seen.has(page.cursor)))
      )
        throw new OkrHumanReviewError("invalid_source");
      cursor = page.hasNextPage ? page.cursor : null;
      if (cursor) seen.add(cursor);
    } while (cursor);
    let deferredReserved = 0n;
    for (const e of executions) {
      if (e.run.scope !== "control" || e.claim.settled) continue;
      const deferred =
        this.intent.kind === "verify" &&
        e.run.state === 0 &&
        !e.run.stop_requested &&
        e.run.action === "assign" &&
        e.run.managed_agent === okr.managed_agent &&
        e.run.membership_id === okr.membership_id &&
        e.contract.agreement_version === okr.agreement_version &&
        e.claim.agreement_version === okr.agreement_version &&
        e.contract.kr_index === e.claim.kr_index &&
        BigInt(e.contract.kr_index) > BigInt(okr.next_kr) &&
        Number(e.contract.kr_index) < okr.metrics.length &&
        canonical(e.contract.boundary_hash) === canonical(okr.boundary_hash);
      if (!deferred) throw new OkrHumanReviewError("unsettled_execution");
      deferredReserved += BigInt(e.claim.reserved);
    }
    if (deferredReserved !== budget.reserved)
      throw new OkrHumanReviewError("unsettled_execution");
    const selected = indices.map((i) => {
      const m = okr.metrics[i],
        matches = executions.filter((e) => e.run.id === m.run_id);
      if (matches.length !== 1) throw new OkrHumanReviewError("invalid_source");
      const e = matches[0];
      if (
        e.run.state !== 2 ||
        e.run.result_record !== m.evidence_id ||
        e.run.managed_agent !== okr.managed_agent ||
        e.run.membership_id !== okr.membership_id ||
        e.run.scope !== "control" ||
        e.run.action !== "assign" ||
        !e.claim.settled ||
        !reviewableEvidenceAgreement(
          e.contract.agreement_version,
          okr.agreement_version,
          e.contract.boundary_hash,
          okr.boundary_hash,
        ) ||
        e.contract.kr_index !== String(i) ||
        e.claim.agreement_version !== e.contract.agreement_version
      )
        throw new OkrHumanReviewError("invalid_source");
      return { index: i, ...e };
    });
    if (canonical(await this.chain.sdk.okr.getOkr(okr.id)) !== canonical(okr))
      throw new OkrHumanReviewError("state_changed");
    this.assertActive();
    return {
      authority,
      okr,
      selected,
      specHead,
      verificationHead,
      acceptanceHead,
      budget,
      policy,
      pin: canonical([
        authority.authorityPin,
        okr,
        selected,
        specHead,
        verificationHead,
        acceptanceHead,
        budget,
        policy,
      ]),
    };
  }
  private async jsonRecord(
    recordId: string,
    kind: number,
    logicalId: string,
    historical = false,
  ) {
    const record = await this.chain.sdk.productRecord.getRecord(recordId);
    if (
      record.organization_id !== this.organizationId ||
      record.kind !== kind ||
      record.logical_id !== logicalId
    )
      throw new OkrHumanReviewError("invalid_source");
    const plaintext = await this.records.read(
      {
        kind,
        logicalId,
        record_id: record.id,
        revision: record.revision,
        key_version: record.key_version,
      },
      historical,
    );
    try {
      return {
        record,
        value: object(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
          ),
        ),
      };
    } finally {
      plaintext.fill(0);
    }
  }
  async read(): Promise<HumanReviewView> {
    const before = await this.source(),
      okr = before.okr;
    const specRecord = await this.jsonRecord(
        okr.spec_record,
        1,
        `okr-${okr.logical_id}-spec`,
      ),
      spec = parseOkrSpecification(specRecord.value);
    const agreement = await this.jsonRecord(
      okr.agreement_record!,
      2,
      `okr-${okr.logical_id}-agreement`,
    );
    if (
      agreement.value.format !== 1 ||
      agreement.value.specRecordId !== okr.spec_record ||
      agreement.record.writer_human !== okr.owner_human
    )
      throw new OkrHumanReviewError("invalid_source");
    const acceptance = object(
      agreement.value.hostAcceptance,
    ) as unknown as HandoverAcceptance;
    const proposal = object(acceptance.proposal);
    if (
      acceptance.organization_id !== this.organizationId ||
      acceptance.human_id !== okr.owner_human ||
      acceptance.membership_id !== okr.membership_id ||
      proposal.okr_id !== okr.id ||
      proposal.managed_agent_id !== okr.managed_agent ||
      proposal.spec_revision !== okr.spec_revision ||
      proposal.workspace_hash !==
        bytesToHex(Uint8Array.from(okr.workspace_hash)) ||
      proposal.budget_asset !== okr.budget_asset ||
      proposal.budget_limit !== okr.budget_limit ||
      String(proposal.expires_at_ms) !== okr.expires_at_ms ||
      proposal.max_calls !== before.policy.max_calls ||
      bytesToHex(handoverProposalHash(acceptance.proposal)) !==
        bytesToHex(Uint8Array.from(before.policy.proposal_hash))
    )
      throw new OkrHumanReviewError("invalid_source");
    // Authenticate the original accepted proof without renewing its expiry or
    // requiring a historical Host to remain admitted for Human review.
    await verifyHandoverAcceptanceSignature(
      acceptance,
      acceptance.host_address,
    );
    const { plan } = validateHandoverPlan(
      specRecord.value,
      agreement.value.nativeFilePlan,
      agreement.value.hostAcceptance?.proposal,
    );
    if (
      bytesToHex(executionBoundaryHash(plan.paths)) !==
        bytesToHex(Uint8Array.from(okr.boundary_hash)) ||
      spec.priority !== okr.priority ||
      spec.deadlineMs !== okr.deadline_ms ||
      spec.krs.length !== okr.metrics.length ||
      spec.krs.some(
        (m, i) =>
          m.baseline !== okr.metrics[i].baseline ||
          m.target !== okr.metrics[i].target ||
          m.weight !== okr.metrics[i].weight ||
          m.maxAgeMs !== okr.metrics[i].max_age_ms,
      )
    )
      throw new OkrHumanReviewError("invalid_source");
    const evidence: HumanReviewEvidence[] = [];
    for (const selected of before.selected) {
      const result = await this.results.read(
          selected.run.id,
          okr.managed_agent!,
        ),
        response = object(result.response),
        body = object(response.result),
        kr = plan.krs[selected.index];
      if (
        !response.ok ||
        body.status !== "submitted" ||
        !Array.isArray(body.evidence) ||
        body.evidence.length !== kr.files.length ||
        result.recordId !== okr.metrics[selected.index].evidence_id
      )
        throw new OkrHumanReviewError("invalid_source");
      const files: HumanReviewEvidence["files"] = [];
      for (const file of kr.files) {
        const matches = body.evidence.filter((f: any) => f.path === file.path);
        const expectedHash = await textHash(file.content);
        if (
          matches.length !== 1 ||
          matches[0].verified !== true ||
          matches[0].expected_hash !== expectedHash ||
          matches[0].observed_hash !== expectedHash
        )
          throw new OkrHumanReviewError("invalid_source");
        files.push({
          ...file,
          expectedHash,
          observedHash: matches[0].observed_hash,
        });
      }
      const item: HumanReviewEvidence = {
        krIndex: selected.index,
        metric: okr.metrics[selected.index],
        result,
        files,
      };
      if (this.intent.kind === "accept") {
        const verified = await this.jsonRecord(
            item.metric.verification_id!,
            4,
            `okr-${okr.logical_id}-verification`,
            true,
          ),
          v = verified.value;
        if (
          v.schema !== "fractalmind.okr-human-review.v1" ||
          v.kind !== "verify" ||
          v.organizationId !== this.organizationId ||
          v.okrId !== okr.id ||
          !positive(v.agreementVersion) ||
          BigInt(v.agreementVersion) > BigInt(okr.agreement_version) ||
          BigInt(v.agreementVersion) <
            BigInt(selected.contract.agreement_version) ||
          v.specRecordId !== okr.spec_record ||
          v.krIndex !== String(selected.index) ||
          v.reviewerHuman !== verified.record.writer_human ||
          v.reviewerHuman !== okr.owner_human ||
          v.reviewerGrant !== verified.record.grant_id ||
          v.reviewed !== true ||
          typeof v.reason !== "string" ||
          !v.reason.trim() ||
          new TextEncoder().encode(v.reason).length > 4096 ||
          !Array.isArray(v.evidence) ||
          v.evidence.length !== 1 ||
          v.evidence[0].krIndex !== String(selected.index) ||
          (v.evidence[0].executionAgreementVersion ?? v.agreementVersion) !==
            selected.contract.agreement_version ||
          v.evidence[0].runId !== result.run.id ||
          v.evidence[0].resultRecordId !== result.recordId ||
          v.evidence[0].resultCreationDigest !== result.transactionDigest ||
          v.evidence[0].current !== item.metric.current ||
          v.evidence[0].sampledAtMs !== item.metric.sampled_at_ms
        )
          throw new OkrHumanReviewError("invalid_source");
        item.priorVerification = {
          recordId: verified.record.id,
          executionAgreementVersion: selected.contract.agreement_version,
          reviewedAgreementVersion: v.agreementVersion,
          reason: v.reason,
          writerHuman: verified.record.writer_human,
          writerDevice: verified.record.writer_device,
        };
      }
      evidence.push(item);
    }
    if ((await this.source()).pin !== before.pin)
      throw new OkrHumanReviewError("state_changed");
    const view = freeze({ okr, spec, evidence });
    this.views.set(view, before.pin);
    return view;
  }
  async prepare(
    view: HumanReviewView,
    decision: { reviewed: boolean; reason: string },
  ) {
    const prior = await this.query();
    if (prior) return prior;
    if (decision.reviewed !== true)
      throw new OkrHumanReviewError("confirmation_required");
    const reason =
      typeof decision.reason === "string" ? decision.reason.trim() : "";
    if (
      !reason ||
      new TextEncoder().encode(reason).length > 4096 ||
      !this.views.has(view)
    )
      throw new OkrHumanReviewError("invalid_input");
    const before = await this.source();
    if (this.views.get(view) !== before.pin)
      throw new OkrHumanReviewError("state_changed");
    const guard = async () => {
      if ((await this.source()).pin !== before.pin)
        throw new OkrHumanReviewError("state_changed");
    };
    const logicalId = `okr-${before.okr.logical_id}-${this.intent.kind === "verify" ? "verification" : "acceptance"}`;
    const expectedRevision =
      this.intent.kind === "verify"
        ? (before.verificationHead.pointer?.revision ?? "0")
        : "0";
    const plaintext = new TextEncoder().encode(
      JSON.stringify({
        schema: "fractalmind.okr-human-review.v1",
        kind: this.intent.kind,
        organizationId: this.organizationId,
        okrId: this.okrId,
        okrVersion: this.intent.okrVersion,
        agreementVersion: this.intent.agreementVersion,
        specRecordId: before.okr.spec_record,
        krIndex: this.intent.krIndex,
        reviewerHuman: before.authority.humanId,
        reviewerGrant: this.grantId,
        reviewed: true,
        reason,
        evidence: view.evidence.map((e) => ({
          krIndex: String(e.krIndex),
          runId: e.result.run.id,
          resultRecordId: e.result.recordId,
          resultCreationDigest: e.result.transactionDigest,
          current: e.metric.current,
          sampledAtMs: e.metric.sampled_at_ms,
          executionAgreementVersion: before.selected.find(
            (s) => s.index === e.krIndex,
          )!.contract.agreement_version,
          verificationId: e.priorVerification?.recordId,
        })),
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
          kind: PRODUCT_RECORD_KINDS.evidence,
          logicalId,
          revision: String(BigInt(expectedRevision) + 1n),
          keyVersion: before.specHead.keyVersion,
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
        toBase64(body) !== encrypted ||
        body.length < 32 ||
        body.length > 65536 ||
        new TextDecoder().decode(body.slice(0, 4)) !== "FME1"
      )
        throw new Error();
    } catch {
      throw new OkrHumanReviewError("invalid_ciphertext");
    }
    await guard();
    const args = {
      organizationId: this.organizationId,
      humanId: before.authority.humanId,
      grantId: this.grantId,
      okrId: this.okrId,
      expectedVersion: this.intent.okrVersion,
      keyVersion: before.specHead.keyVersion,
      encryptedBody: body,
    };
    const tx =
      this.intent.kind === "verify"
        ? this.chain.sdk.okr.verifyKr({
            ...args,
            krIndex: this.intent.krIndex,
            expectedRecordRevision: expectedRevision,
          })
        : this.chain.sdk.okr.achieve({
            ...args,
            successCriteriaConfirmed: true,
          });
    const quote = await this.manager.prepare({
      requestId: this.requestId,
      transaction: tx,
      gasBudget: 200000000n,
    });
    await guard();
    this.quotes.set(quote, guard);
    return quote;
  }
  submit(quote: SelfPayFeeQuote) {
    if (!this.quotes.has(quote))
      return Promise.reject(new OkrHumanReviewError("invalid_quote"));
    if (this.flight)
      return this.flight.quote === quote
        ? this.flight.result
        : Promise.reject(new OkrHumanReviewError("invalid_quote"));
    const result = this.submitOnce(quote).finally(() => {
      this.flight = undefined;
    });
    this.flight = { quote, result };
    return result;
  }
  private async submitOnce(quote: SelfPayFeeQuote) {
    const prior = await this.query();
    if (prior) return prior;
    const guard = this.quotes.get(quote)!;
    await guard();
    this.signingGuard = guard;
    try {
      return await this.manager.submit(quote);
    } finally {
      this.signingGuard = undefined;
    }
  }
  async confirmed(outcome: SelfPayTransactionOutcome) {
    if (
      outcome.requestId !== this.requestId ||
      outcome.status !== "confirmed" ||
      outcome.transaction?.digest !== outcome.digest
    )
      throw new OkrHumanReviewError("invalid_source");
    if (!(await awaitTransactionVisible(this.chain, outcome)))
      throw new OkrHumanReviewError("sync_pending");
    const recordType = await this.chain.sdk.client.coreType(
      "product_record",
      "EncryptedRecord",
    );
    const records = outcome.transaction.effects.changedObjects.filter(
      (o) =>
        o.idOperation === "Created" &&
        outcome.transaction?.objectTypes?.[o.objectId] === recordType,
    );
    if (records.length !== 1) throw new OkrHumanReviewError("invalid_source");
    const record = await this.chain.sdk.productRecord.getRecord(
        records[0].objectId,
      ),
      { object: provenance } =
        await this.chain.sdk.client.client.core.getObject({
          objectId: record.id,
          include: { previousTransaction: true },
        });
    const okr = await this.chain.sdk.okr.getOkr(this.okrId);
    if (
      provenance.previousTransaction !== outcome.digest ||
      record.organization_id !== this.organizationId ||
      record.kind !== 4 ||
      record.writer_human !== this.chain.profile.humanId ||
      record.writer_device !== this.signer.device.address ||
      record.grant_id !== this.grantId ||
      record.logical_id !==
        `okr-${okr.logical_id}-${this.intent.kind === "verify" ? "verification" : "acceptance"}` ||
      (this.intent.kind === "verify"
        ? okr.metrics[Number(this.intent.krIndex)].verification_id !==
            record.id || !okr.metrics[Number(this.intent.krIndex)].verified
        : okr.state !== 3 ||
          okr.acceptance_record !== record.id ||
          okr.accepted_by_human !== this.chain.profile.humanId)
    )
      throw new OkrHumanReviewError("state_changed");
    this.assertActive();
    return { record, okr };
  }
}
