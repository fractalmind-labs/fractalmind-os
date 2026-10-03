import {
  okrRunnerTicketName,
  type OkrRunnerState,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import { canonical } from "./handover-plan";
import { NativeOkrRunner } from "./native-okr-runner";
import { NativeDeviceSigner, type NativeInvoke } from "./native-device";
import { OkrControl } from "./okr-control";
import {
  okrDeliveryKey,
  type OkrDeliveryJournal,
} from "./okr-delivery-journal";

type Description = Awaited<ReturnType<NativeOkrRunner["describe"]>>;
type Authority = Awaited<
  ReturnType<DeviceIdentityVerifier["verifyOrganization"]>
>;
export type AutonomyReview = Description & {
  authorityExpiresAtMs: string;
  pin: string;
  budget: Awaited<ReturnType<ChainReadSession["sdk"]["okr"]["getBudget"]>>;
  assignment: Awaited<ReturnType<NativeOkrAutonomy["assignment"]>>;
};
export type AutonomyState = {
  active: boolean;
  runner: OkrRunnerState;
  observedAtMs: number;
  gasCommitted: string;
  gasLimit: string;
  expiresAtMs?: string;
};
export class OkrAutonomyError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "confirmation_required"
      | "state_changed"
      | "session_expired"
      | "gas_limit"
      | "original_run_needs_review"
      | "journal_unavailable",
  ) {
    super(code);
  }
}
const zero = `0x${"0".repeat(64)}`;
const positive = (v: string) =>
  typeof v === "string" &&
  /^[1-9][0-9]{0,19}$/.test(v) &&
  BigInt(v) <= 0xffffffffffffffffn;
/** One explicit, memory-only session, fixed to a reviewed agreement. Human KR
 * verification and final acceptance are always separate. Closed/backgrounded
 * sessions cannot create work. All durable execution facts remain on Sui. */
export class NativeOkrAutonomy {
  private readonly runner: NativeOkrRunner;
  private readonly verifier: DeviceIdentityVerifier;
  private readonly reviews = new WeakMap<AutonomyReview, string>();
  private session?: {
    pin: string;
    expiresAtMs: string;
    gasLimit: bigint;
    gasCommitted: bigint;
    charged: Set<string>;
  };
  private activeRequest?: string;
  private starting = false;
  private feeFailure?: string;
  private flight?: Promise<AutonomyState>;
  private epoch = 0;
  private observed?: AutonomyState;
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    readonly okrId: string,
    invoke: NativeInvoke,
    private readonly journal: TransactionJournal,
    private readonly deliveryJournal: OkrDeliveryJournal,
    private readonly hooks: {
      onQuote?: (quote: SelfPayFeeQuote) => Promise<void>;
      onSubmission?: (outcome: SelfPayTransactionOutcome) => Promise<void>;
    } = {},
    transport: typeof fetch = fetch,
    private readonly assertActive: () => void = () => {},
  ) {
    if (
      ![grantId, organizationId, okrId].every((v) => /^0x[0-9a-f]{64}$/.test(v))
    )
      throw new OkrAutonomyError("invalid_input");
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.runner = new NativeOkrRunner(
      chain,
      signer,
      grantId,
      organizationId,
      invoke,
      journal,
      async (q) => {
        try {
          return await this.authorizeFee(q);
        } catch (error) {
          this.feeFailure =
            error instanceof OkrAutonomyError
              ? error.code
              : "fee_confirmation_failed";
          throw error;
        }
      },
      transport,
      () => {
        this.assertActive();
        if (this.activeRequest) this.assertSession();
      },
    );
  }
  private pin(
    authority: Authority,
    okr: Description["okr"],
    policy: Description["policy"],
    assignment: Awaited<ReturnType<NativeOkrAutonomy["assignment"]>>,
  ) {
    return canonical([
      authority.authorityContextPin,
      this.chain.profile,
      okr.id,
      okr.org_id,
      okr.owner_human,
      okr.spec_record,
      okr.spec_revision,
      okr.agreement_record,
      okr.agreement_version,
      okr.managed_agent,
      okr.managed_version,
      okr.membership_id,
      okr.membership_version,
      okr.workspace_hash,
      okr.boundary_hash,
      okr.budget_asset,
      okr.budget_limit,
      okr.deadline_ms,
      okr.expires_at_ms,
      policy,
      assignment,
    ]);
  }
  private async authority() {
    this.assertActive();
    const a = await this.verifier.verifyOrganization(
      this.organizationId,
      "approve",
    );
    if (
      !(["read", "operate", "approve"] as const).every((x) =>
        a.actions.includes(x),
      ) ||
      !a.encryptedKeys ||
      !a.authorityContextPin
    )
      throw new OkrAutonomyError("state_changed");
    this.assertActive();
    return a;
  }
  private async assignment(okr: Description["okr"], clockMs: bigint) {
    if (!okr.membership_id || !okr.managed_agent)
      throw new OkrAutonomyError("state_changed");
    const [member, managed] = await Promise.all([
      this.chain.sdk.host.getMembership(okr.membership_id),
      this.chain.sdk.host.getManagedAgent(okr.managed_agent),
    ]);
    const binding = await this.chain.sdk.host.getCoordinatorBinding(
      member.coordinator_binding,
    );
    if (
      member.org_id !== this.organizationId ||
      member.id !== okr.membership_id ||
      member.version !== okr.membership_version ||
      member.revoked ||
      BigInt(member.expires_at_ms) <= clockMs ||
      managed.org_id !== this.organizationId ||
      managed.id !== okr.managed_agent ||
      managed.version !== okr.managed_version ||
      managed.revoked ||
      !managed.control_confirmed ||
      managed.runtime !== "bounded-process-v1" ||
      managed.membership_id !== member.id ||
      managed.host_address !== member.host_address ||
      canonical(managed.workspace_hash) !== canonical(okr.workspace_hash) ||
      binding.id !== member.coordinator_binding ||
      binding.org_id !== this.organizationId ||
      binding.revoked
    )
      throw new OkrAutonomyError("state_changed");
    return { member, managed, binding };
  }
  async review(): Promise<AutonomyReview> {
    const a = await this.authority(),
      description = await this.runner.describe(this.okrId);
    if (
      description.okr.state !== 1 ||
      description.okr.owner_human !== a.humanId ||
      BigInt(description.okr.expires_at_ms) <= a.clockMs
    )
      throw new OkrAutonomyError("state_changed");
    const budget = await this.chain.sdk.okr.getBudget(this.okrId);
    const assignment = await this.assignment(description.okr, a.clockMs);
    if (
      canonical(await this.chain.sdk.okr.getOkr(this.okrId)) !==
      canonical(description.okr)
    )
      throw new OkrAutonomyError("state_changed");
    const v = {
      ...description,
      budget,
      assignment,
      authorityExpiresAtMs: a.expiresAtMs,
      pin: this.pin(a, description.okr, description.policy, assignment),
    };
    this.reviews.set(v, canonical(v));
    return v;
  }
  async start(
    view: AutonomyReview,
    input: { reviewed: boolean; gasLimit: string; expiresAtMs: string },
  ) {
    if (this.session || this.flight || this.starting)
      throw new OkrAutonomyError("state_changed");
    if (input.reviewed !== true)
      throw new OkrAutonomyError("confirmation_required");
    if (!positive(input.gasLimit) || !positive(input.expiresAtMs))
      throw new OkrAutonomyError("invalid_input");
    const saved = this.reviews.get(view);
    if (!saved || saved !== canonical(view))
      throw new OkrAutonomyError("state_changed");
    const epoch = this.epoch;
    this.starting = true;
    try {
      const fresh = await this.review();
      if (epoch !== this.epoch || saved !== canonical(fresh))
        throw new OkrAutonomyError("state_changed");
      const expiry = BigInt(input.expiresAtMs);
      if (
        expiry <= BigInt(Date.now()) ||
        expiry > BigInt(Date.now() + 3600000) ||
        expiry > BigInt(fresh.authorityExpiresAtMs) ||
        expiry > BigInt(fresh.okr.expires_at_ms)
      )
        throw new OkrAutonomyError("invalid_input");
      this.epoch++;
      this.session = {
        pin: fresh.pin,
        expiresAtMs: input.expiresAtMs,
        gasLimit: BigInt(input.gasLimit),
        gasCommitted: 0n,
        charged: new Set(),
      };
      this.feeFailure = undefined;
      this.observed = {
        active: true,
        runner: {
          okrId: this.okrId,
          status: "idle",
          krIndex: view.okr.next_kr,
        },
        observedAtMs: Date.now(),
        gasCommitted: "0",
        gasLimit: input.gasLimit,
        expiresAtMs: input.expiresAtMs,
      };
      return this.observed;
    } finally {
      this.starting = false;
    }
  }
  stop(reason = "session_stopped") {
    this.epoch++;
    if (this.observed)
      this.observed = {
        ...this.observed,
        gasCommitted:
          this.session?.gasCommitted.toString() ?? this.observed.gasCommitted,
        active: false,
        runner: { ...this.observed.runner, status: "paused", reason },
        observedAtMs: Date.now(),
      };
    this.session = undefined;
    return this.observed;
  }
  get state() {
    return this.observed;
  }
  private assertSession() {
    this.assertActive();
    if (!this.session) throw new OkrAutonomyError("state_changed");
    if (BigInt(this.session.expiresAtMs) <= BigInt(Date.now()))
      throw new OkrAutonomyError("session_expired");
  }
  private async current() {
    this.assertSession();
    const a = await this.authority(),
      okr = await this.chain.sdk.okr.getOkr(this.okrId);
    if (okr.org_id !== this.organizationId || okr.owner_human !== a.humanId)
      throw new OkrAutonomyError("state_changed");
    if (okr.state !== 1) return { okr, authority: a, policy: null };
    const policy = await this.chain.sdk.handover.getPolicy(okr.id);
    const assignment = await this.assignment(okr, a.clockMs);
    this.assertSession();
    if (
      this.pin(a, okr, policy, assignment) !== this.session!.pin ||
      BigInt(okr.expires_at_ms) <= a.clockMs
    )
      throw new OkrAutonomyError("state_changed");
    return { okr, authority: a, policy };
  }
  private async authorizeFee(quote: SelfPayFeeQuote) {
    this.assertSession();
    if (
      quote.requestId !== this.activeRequest ||
      quote.sender !== this.signer.device.address ||
      quote.maxSuiSpend !== "0" ||
      !positive(quote.gasBudget) ||
      quote.expiresAtMs <= Date.now()
    )
      throw new OkrAutonomyError("invalid_input");
    const session = this.session!,
      epoch = this.epoch;
    if (session.charged.has(quote.requestId))
      throw new OkrAutonomyError("state_changed");
    if (session.gasCommitted + BigInt(quote.gasBudget) > session.gasLimit)
      throw new OkrAutonomyError("gas_limit");
    await this.hooks.onQuote?.(quote);
    const current = await this.current();
    if (epoch !== this.epoch || current.okr.state !== 1 || !current.policy)
      throw new OkrAutonomyError("state_changed");
    const expected = [
      `okr-control:${this.okrId}:${current.okr.agreement_version}:${current.okr.next_kr}`,
      okrRunnerTicketName(
        this.okrId,
        current.okr.agreement_version,
        current.okr.next_kr,
      ),
    ];
    if (!expected.includes(quote.requestId))
      throw new OkrAutonomyError("state_changed");
    session.charged.add(quote.requestId);
    session.gasCommitted += BigInt(quote.gasBudget);
    return true;
  }
  heartbeat(): Promise<AutonomyState> {
    if (this.flight) return this.flight;
    const epoch = this.epoch;
    const promise = this.advance(epoch)
      .catch((error) => {
        if (this.observed && !this.observed.active) return this.observed;
        this.stop(error?.code ?? error?.message ?? "current_facts_unavailable");
        if (!this.observed) throw error;
        return this.observed;
      })
      .finally(() => {
        this.activeRequest = undefined;
        this.flight = undefined;
      });
    this.flight = promise;
    return promise;
  }
  private display(runner: OkrRunnerState, epoch: number, end = false) {
    this.assertSession();
    if (epoch !== this.epoch) throw new OkrAutonomyError("state_changed");
    const s = this.session!;
    this.observed = {
      active: !end,
      runner,
      observedAtMs: Date.now(),
      gasCommitted: s.gasCommitted.toString(),
      gasLimit: s.gasLimit.toString(),
      expiresAtMs: s.expiresAtMs,
    };
    if (end) {
      this.session = undefined;
      this.epoch++;
    }
    return this.observed;
  }
  private async advance(epoch: number) {
    if (!this.session && this.observed) return this.observed;
    const current = await this.current(),
      okr = current.okr;
    if (okr.state !== 1)
      return this.display(
        {
          okrId: okr.id,
          krIndex: okr.next_kr,
          status: okr.state === 3 ? "achieved" : "paused",
          reason: "objective_not_active",
        },
        epoch,
        true,
      );
    // This call can only discover/query original chain facts; no create/release flags.
    const original = await this.runner.step({
      okrId: this.okrId,
      capabilityId: zero,
    });
    this.assertSession();
    if (original.status !== "idle") {
      if (original.status === "queued")
        return this.display(
          {
            ...original,
            status: "paused",
            reason: "original_run_needs_explicit_review",
          },
          epoch,
          true,
        );
      return this.display(
        original,
        epoch,
        [
          "paused",
          "blocked",
          "awaiting_approval",
          "awaiting_confirmation",
          "awaiting_acceptance",
          "achieved",
        ].includes(original.status),
      );
    }
    if (!current.policy) throw new OkrAutonomyError("state_changed");
    const control = new OkrControl(
      this.chain,
      this.signer,
      this.grantId,
      this.organizationId,
      this.okrId,
      okr.agreement_version,
      okr.next_kr,
      this.journal,
      () => this.assertSession(),
      { okrVersion: okr.version, policyPin: canonical(current.policy) },
    );
    this.activeRequest = control.requestId;
    const quote = await control.prepare();
    this.assertSession();
    let receipt: SelfPayTransactionOutcome;
    if ("status" in quote) receipt = quote;
    else {
      await this.authorizeFee(quote);
      receipt = await control.submit(quote);
      await this.hooks.onSubmission?.(receipt);
    }
    if (receipt.status !== "confirmed")
      return this.display(
        {
          okrId: this.okrId,
          krIndex: okr.next_kr,
          status:
            receipt.status === "failed" ? "blocked" : "awaiting_confirmation",
          transactionDigest: receipt.digest,
          reason: "original_control_request_not_confirmed",
        },
        epoch,
        true,
      );
    const capabilityId = await control.confirmed(receipt);
    this.activeRequest = okrRunnerTicketName(
      this.okrId,
      okr.agreement_version,
      okr.next_kr,
    );
    const prior = this.runner.lastSubmission;
    const prepared = await this.runner.step({
      okrId: this.okrId,
      capabilityId,
      createIfMissing: true,
      prepareOnly: true,
    });
    const submission = this.runner.lastSubmission;
    if (submission && submission !== prior)
      await this.hooks.onSubmission?.(submission);
    this.assertSession();
    if (prepared.status !== "queued")
      return this.display(
        {
          ...prepared,
          ...(this.feeFailure ? { reason: this.feeFailure } : {}),
        },
        epoch,
        true,
      );
    // Only this session's new confirmed atomic ticket/Run may be delivered.
    if (
      !prepared.executionId ||
      !submission ||
      submission === prior ||
      submission.status !== "confirmed" ||
      submission.digest !== prepared.transactionDigest ||
      submission.requestId !== this.activeRequest
    )
      throw new OkrAutonomyError("original_run_needs_review");
    const latest = await this.current();
    if (
      latest.okr.state !== 1 ||
      latest.okr.agreement_version !== okr.agreement_version ||
      latest.okr.next_kr !== okr.next_kr
    )
      throw new OkrAutonomyError("state_changed");
    let claimed: boolean;
    try {
      claimed = await this.deliveryJournal.claim(
        okrDeliveryKey(
          this.chain.profile.network,
          latest.authority.chainIdentifier,
          this.signer.device.address,
          prepared.executionId,
        ),
      );
    } catch {
      throw new OkrAutonomyError("journal_unavailable");
    }
    this.assertSession();
    if (!claimed) throw new OkrAutonomyError("original_run_needs_review");
    await this.current();
    const sent = await this.runner.step({
      okrId: this.okrId,
      capabilityId,
      releaseQueued: true,
      expectedExecutionId: prepared.executionId,
      expectedAgreementVersion: okr.agreement_version,
      expectedKrIndex: okr.next_kr,
    });
    return this.display(
      sent,
      epoch,
      [
        "paused",
        "blocked",
        "awaiting_approval",
        "awaiting_confirmation",
        "awaiting_acceptance",
        "achieved",
      ].includes(sent.status),
    );
  }
}
