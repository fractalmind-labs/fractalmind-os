import { fromBase64, toBase64 } from "@mysten/sui/utils";
import {
  SelfPayTransactionManager,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import {
  NativeDeviceSigner,
  call,
  scopedNativeInvoke,
  type NativeInvoke,
} from "./native-device";
import { PrivateRecords } from "./private-records";
import { readRecordPointer } from "./record-pointer";
import {
  canonical,
  parseOkrSpecification,
  type OkrSpecification,
} from "./handover-plan";
import { normalizeDraft, type DraftInput } from "./okr-draft";
import { awaitTransactionVisible } from "./transaction-visibility";

export class OkrInterventionError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "confirmation_required"
      | "invalid_source"
      | "state_changed"
      | "unsettled_execution"
      | "invalid_quote"
      | "sync_pending",
  ) {
    super(code);
  }
}
export type OkrInterventionIntent =
  | { kind: "pause" | "replace"; expectedVersion: string }
  | { kind: "stop"; runId: string };
const id = /^0x[0-9a-f]{64}$/;
const positive = (v: string) =>
  typeof v === "string" &&
  /^[1-9][0-9]{0,19}$/.test(v) &&
  BigInt(v) <= 0xffffffffffffffffn;
export function interventionRequestId(
  okrId: string,
  intent: OkrInterventionIntent,
) {
  if (
    !id.test(okrId) ||
    !intent ||
    !["pause", "replace", "stop"].includes(intent.kind)
  )
    throw new OkrInterventionError("invalid_input");
  if (intent.kind === "stop") {
    if (!id.test(intent.runId)) throw new OkrInterventionError("invalid_input");
    return `okr-stop:${intent.runId}`;
  }
  if (!positive(intent.expectedVersion))
    throw new OkrInterventionError("invalid_input");
  return `okr-intervene:${okrId}:${intent.expectedVersion}:${intent.kind}`;
}
/** Display decimal metrics without rounding the chain's u64 fixed-point values. */
export function specificationDraft(spec: OkrSpecification): DraftInput {
  const decimal = (value: string, precision: number) => {
    if (!precision) return value;
    const padded = value.padStart(precision + 1, "0");
    return `${padded.slice(0, -precision)}.${padded.slice(-precision)}`;
  };
  return {
    objective: spec.objective,
    successCriteria: spec.successCriteria,
    priority: spec.priority,
    deadlineMs: spec.deadlineMs,
    allowedPaths: [...spec.constraints.allowedPaths],
    prohibitedActions: [...spec.constraints.prohibitedActions],
    maxCalls: spec.constraints.budget.limit,
    krs: spec.krs.map((k) => ({
      title: k.title,
      unit: k.unit,
      precision: k.precision,
      baseline: decimal(k.baseline, k.precision),
      target: decimal(k.target, k.precision),
      weight: k.weight,
      maxAgeMinutes: (BigInt(k.maxAgeMs) / 60000n).toString(),
      verificationRule: k.verificationRule,
    })),
  };
}

/** On-chain intervention only. No resume shortcut, Host dispatch, automatic
 * retry or historical evidence deletion is available from this controller. */
export class OkrIntervention {
  private readonly verifier: DeviceIdentityVerifier;
  private readonly records: PrivateRecords;
  private readonly invoke: NativeInvoke;
  private readonly manager: SelfPayTransactionManager;
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
    invoke: NativeInvoke,
    journal: TransactionJournal,
    private readonly assertActive: () => void = () => {},
  ) {
    if (![grantId, organizationId, okrId].every((v) => id.test(v)))
      throw new OkrInterventionError("invalid_input");
    this.invoke = scopedNativeInvoke(invoke, assertActive);
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.records = new PrivateRecords(
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
          if (!guard) throw new OkrInterventionError("invalid_quote");
          await guard();
          const signed = await signer.signTransaction(bytes);
          await guard();
          return signed;
        },
      },
    });
  }
  async query(requestId: string) {
    this.assertActive();
    await this.chain.checkNetwork();
    const result = await this.manager.query(requestId);
    this.assertActive();
    return result;
  }
  private async source(action: "read" | "operate" | "approve" = "read") {
    this.assertActive();
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      action,
    );
    if (!authority.actions.includes("read") || !authority.encryptedKeys)
      throw new OkrInterventionError("invalid_source");
    const okr = await this.chain.sdk.okr.getOkr(this.okrId);
    if (
      okr.org_id !== this.organizationId ||
      okr.owner_human !== authority.humanId
    )
      throw new OkrInterventionError("invalid_source");
    const [spec, agreement] = await Promise.all([
      readRecordPointer(
        this.chain,
        this.organizationId,
        "okr",
        `okr-${okr.logical_id}-spec`,
      ),
      readRecordPointer(
        this.chain,
        this.organizationId,
        "contract",
        `okr-${okr.logical_id}-agreement`,
      ),
    ]);
    if (
      !spec.pointer ||
      spec.pointer.record_id !== okr.spec_record ||
      spec.pointer.revision !== okr.spec_revision ||
      agreement.keyVersion !== spec.keyVersion ||
      (agreement.pointer?.record_id ?? null) !== okr.agreement_record
    )
      throw new OkrInterventionError("state_changed");
    if (
      canonical(await this.chain.sdk.okr.getOkr(this.okrId)) !== canonical(okr)
    )
      throw new OkrInterventionError("state_changed");
    this.assertActive();
    return {
      authority,
      okr,
      spec,
      agreement,
      pin: canonical([authority.authorityPin, okr, spec, agreement]),
    };
  }
  async read() {
    const before = await this.source(),
      plaintext = await this.records.read(before.spec.pointer!);
    let spec: OkrSpecification;
    try {
      spec = parseOkrSpecification(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
      );
    } finally {
      plaintext.fill(0);
    }
    const okr = before.okr;
    if (
      spec.priority !== okr.priority ||
      spec.deadlineMs !== okr.deadline_ms ||
      spec.krs.length !== okr.metrics.length ||
      spec.krs.some(
        (k, i) =>
          k.baseline !== okr.metrics[i].baseline ||
          k.target !== okr.metrics[i].target ||
          k.weight !== okr.metrics[i].weight ||
          k.maxAgeMs !== okr.metrics[i].max_age_ms,
      )
    )
      throw new OkrInterventionError("invalid_source");
    const executions = await this.executions();
    const budget = okr.managed_agent
      ? await this.chain.sdk.okr.getBudget(okr.id)
      : null;
    if ((await this.source()).pin !== before.pin)
      throw new OkrInterventionError("state_changed");
    return {
      okr,
      spec,
      executions,
      budget,
      actions: before.authority.actions,
      authorityExpiresAtMs: before.authority.expiresAtMs,
    };
  }
  private async executions() {
    const rows: Awaited<
      ReturnType<ChainReadSession["sdk"]["okr"]["listExecutions"]>
    >["executions"] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await this.chain.sdk.okr.listExecutions(
        this.okrId,
        cursor,
        100,
      );
      rows.push(...page.executions);
      if (
        rows.length > 1000 ||
        (page.hasNextPage && (!page.cursor || seen.has(page.cursor)))
      )
        throw new OkrInterventionError("invalid_source");
      cursor = page.hasNextPage ? page.cursor : null;
      if (cursor) seen.add(cursor);
    } while (cursor);
    return rows;
  }
  private async encrypt(
    s: Awaited<ReturnType<OkrIntervention["source"]>>,
    kind: number,
    logicalId: string,
    revision: string,
    value: unknown,
  ) {
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    try {
      if (plaintext.length > 65504)
        throw new OkrInterventionError("invalid_input");
      const encoded = await call(this.invoke, "fm_device_encrypt_record", {
        profile: this.signer.device.profile,
        record: JSON.stringify({
          network: this.chain.profile.network,
          encryptedKeys: s.authority.encryptedKeys,
          organizationId: this.organizationId,
          kind,
          logicalId,
          revision,
          keyVersion: s.spec.keyVersion,
          plaintext: toBase64(plaintext),
        }),
      });
      if (typeof encoded !== "string" || encoded.length > 87384)
        throw new OkrInterventionError("invalid_source");
      const body = fromBase64(encoded);
      if (
        body.length < 32 ||
        body.length > 65536 ||
        toBase64(body) !== encoded ||
        new TextDecoder().decode(body.slice(0, 4)) !== "FME1"
      )
        throw new OkrInterventionError("invalid_source");
      return { keyVersion: s.spec.keyVersion, encryptedBody: body };
    } finally {
      plaintext.fill(0);
    }
  }
  async prepare(
    rawIntent: OkrInterventionIntent,
    input: { reviewed: boolean; reason?: string; replacement?: DraftInput },
  ): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    const intent = structuredClone(rawIntent),
      requestId = interventionRequestId(this.okrId, intent);
    const prior = await this.query(requestId);
    if (prior) return prior;
    if (input.reviewed !== true)
      throw new OkrInterventionError("confirmation_required");
    const action = intent.kind === "replace" ? "approve" : "operate";
    const before = await this.source(action);
    const guard = async () => {
      if ((await this.source(action)).pin !== before.pin)
        throw new OkrInterventionError("state_changed");
    };
    const target = {
      okrId: this.okrId,
      organizationId: this.organizationId,
      humanId: this.chain.profile.humanId,
      grantId: this.grantId,
      expectedVersion: before.okr.version,
    };
    let transaction;
    if (intent.kind === "pause") {
      if (
        before.okr.version !== intent.expectedVersion ||
        before.okr.state !== 1 ||
        !before.agreement.pointer
      )
        throw new OkrInterventionError("state_changed");
      const reason = input.reason?.trim();
      if (!reason || new TextEncoder().encode(reason).length > 4096)
        throw new OkrInterventionError("invalid_input");
      transaction = this.chain.sdk.okr.pause({
        ...target,
        expectedRecordRevision: before.agreement.pointer.revision,
        ...(await this.encrypt(
          before,
          2,
          `okr-${before.okr.logical_id}-agreement`,
          String(BigInt(before.agreement.pointer.revision) + 1n),
          {
            schema: "fractalmind.okr-intervention.v1",
            format: 1,
            action: "pause",
            okrId: this.okrId,
            basedOnVersion: before.okr.version,
            basedOnAgreement: before.okr.agreement_version,
            priorAgreementRecord: before.okr.agreement_record,
            reason,
          },
        )),
      });
    } else if (intent.kind === "stop") {
      const rows = await this.executions(),
        original = rows.filter((e) => e.run.id === intent.runId);
      if (
        original.length !== 1 ||
        original[0].claim.settled ||
        ![0, 1, 4].includes(original[0].run.state) ||
        original[0].run.stop_requested
      )
        throw new OkrInterventionError("state_changed");
      // Historical settlement does not require the old agreement/Host to remain live.
      const pin = canonical(original[0]);
      const originalGuard = guard;
      const check = async () => {
        await originalGuard();
        const now = (await this.executions()).filter(
          (e) => e.run.id === intent.runId,
        );
        if (now.length !== 1 || canonical(now[0]) !== pin)
          throw new OkrInterventionError("state_changed");
      };
      transaction = this.chain.sdk.nodeExecution.requestStop({
        ...target,
        executionId: intent.runId,
        capabilityId: original[0].run.capability_id,
      });
      await check();
      const quote = await this.manager.prepare({
        requestId,
        transaction,
        gasBudget: 200000000n,
      });
      await check();
      this.quotes.set(quote, check);
      return quote;
    } else {
      if (
        before.okr.version !== intent.expectedVersion ||
        ![0, 2].includes(before.okr.state) ||
        !input.replacement
      )
        throw new OkrInterventionError("state_changed");
      const spec = normalizeDraft(structuredClone(input.replacement));
      if (
        BigInt(spec.deadlineMs) <= before.authority.clockMs ||
        BigInt(spec.deadlineMs) <= BigInt(Date.now())
      )
        throw new OkrInterventionError("invalid_input");
      let extra = "";
      if (before.okr.managed_agent) {
        const [budget, coverage] = await Promise.all([
          this.chain.sdk.okr.getBudget(this.okrId),
          this.chain.sdk.nodeExecution.readAgentExecutions(
            this.organizationId,
            before.okr.managed_agent,
          ),
        ]);
        if (budget.reserved || coverage.unsettledControl)
          throw new OkrInterventionError("unsettled_execution");
        if (BigInt(spec.constraints.budget.limit) < budget.spent)
          throw new OkrInterventionError("invalid_input");
        extra = canonical([budget, coverage.revision]);
      }
      const replacementGuard = async () => {
        await guard();
        if (before.okr.managed_agent) {
          const [budget, coverage] = await Promise.all([
            this.chain.sdk.okr.getBudget(this.okrId),
            this.chain.sdk.nodeExecution.readAgentExecutions(
              this.organizationId,
              before.okr.managed_agent,
            ),
          ]);
          if (canonical([budget, coverage.revision]) !== extra)
            throw new OkrInterventionError("state_changed");
        }
      };
      transaction = this.chain.sdk.okr.replaceSpec({
        ...target,
        priority: spec.priority,
        deadlineMs: spec.deadlineMs,
        baselines: spec.krs.map((k) => k.baseline),
        targets: spec.krs.map((k) => k.target),
        weights: spec.krs.map((k) => k.weight),
        maxAgesMs: spec.krs.map((k) => k.maxAgeMs),
        ...(await this.encrypt(
          before,
          1,
          `okr-${before.okr.logical_id}-spec`,
          String(BigInt(before.okr.spec_revision) + 1n),
          spec,
        )),
      });
      await replacementGuard();
      const quote = await this.manager.prepare({
        requestId,
        transaction,
        gasBudget: 200000000n,
      });
      await replacementGuard();
      this.quotes.set(quote, replacementGuard);
      return quote;
    }
    await guard();
    const quote = await this.manager.prepare({
      requestId,
      transaction,
      gasBudget: 200000000n,
    });
    await guard();
    this.quotes.set(quote, guard);
    return quote;
  }
  submit(quote: SelfPayFeeQuote) {
    if (!this.quotes.has(quote))
      return Promise.reject(new OkrInterventionError("invalid_quote"));
    if (this.flight)
      return this.flight.quote === quote
        ? this.flight.result
        : Promise.reject(new OkrInterventionError("invalid_quote"));
    const result = this.submitOnce(quote).finally(() => {
      this.flight = undefined;
    });
    this.flight = { quote, result };
    return result;
  }
  private async submitOnce(quote: SelfPayFeeQuote) {
    const guard = this.quotes.get(quote)!;
    await guard();
    this.signingGuard = guard;
    let result: SelfPayTransactionOutcome;
    try {
      result = await this.manager.submit(quote);
    } finally {
      this.signingGuard = undefined;
    }
    this.assertActive();
    if (
      result.status === "confirmed" &&
      !(await awaitTransactionVisible(this.chain, result))
    )
      throw new OkrInterventionError("sync_pending");
    return result;
  }
}

export type OkrInterventionView = Awaited<ReturnType<OkrIntervention["read"]>>;
