import {
  bytesToHex,
  executionBoundaryHash,
  verifyHandoverAcceptanceSignature,
  handoverProposalHash,
  type HandoverAcceptance,
  type NativeFileOkrPlan,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { canonical, validateHandoverPlan } from "./handover-plan";
import {
  OkrIntervention,
  interventionRequestId,
  specificationDraft,
  type OkrInterventionView,
} from "./okr-intervention";
import { normalizeDraft, type DraftInput } from "./okr-draft";
import { AGENT_MANAGER_RUNTIME, validateAgentManagerAgreement } from "./okr-assign";

export class OkrProjectionError extends Error {
  constructor(
    readonly code:
      | "invalid_projection"
      | "state_changed"
      | "confirmation_required"
      | "unchanged_proposal"
      | "pause_required"
      | "invalid_quote",
  ) {
    super(code);
  }
}
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new OkrProjectionError("invalid_projection");
  return value as Record<string, any>;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const states = ["DRAFT", "ACTIVE", "PAUSED", "ACHIEVED", "ARCHIVED"];
export type OkrProjectionSnapshot = {
  schema: "fractalmind.okr-projection.v1";
  provenance: OkrInterventionView["provenance"];
  specification: OkrInterventionView["spec"];
  state: string;
  nextKr: string;
  metrics: OkrInterventionView["okr"]["metrics"];
  agreement: {
    recordId: string | null;
    version: string;
    managedAgentId: string | null;
    managedVersion: string;
    membershipId: string | null;
    membershipVersion: string;
    workspaceHash: string;
    boundaryHash: string;
    expiresAtMs: string;
    approvedPlan: NativeFileOkrPlan | null;
    approvalId: string | null;
    maxCallsPerRun: string | null;
    /** Only for an agent-manager Agent (#75): declared paths, and what
     * FractalMind does not enforce. Absent for bounded-process agreements. */
    agentManager?: { allowedPaths: string[]; notEnforced: string[] };
  };
  budget: {
    asset: string;
    limit: string;
    spent: string;
    reserved: string;
  } | null;
  executions: OkrInterventionView["executions"];
  acceptance: { recordId: string | null; humanId: string | null; atMs: string };
};
export type OkrProjectionView = {
  snapshot: OkrProjectionSnapshot;
  text: string;
  authorityExpiresAtMs: string;
  actions: string[];
};
export type OkrProposalReview = {
  snapshot: OkrProjectionSnapshot;
  proposal: DraftInput;
  status: "CLEAN" | "UNSUBMITTED";
  changes: { field: keyof DraftInput; before: unknown; after: unknown }[];
  authorityExpiresAtMs: string;
  actions: string[];
};

/** A local snapshot is context, never authority or a live metric. Retain
 * sampled_at_ms even when stale; a missing sample is not a zero value. */
export function projectionMetricStatus(
  metric: OkrProjectionSnapshot["metrics"][number],
  nowMs: string,
) {
  if (metric.current === null || metric.sampled_at_ms === "0") return "unknown";
  const now = BigInt(nowMs),
    sampled = BigInt(metric.sampled_at_ms);
  if (sampled > now || now - sampled > BigInt(metric.max_age_ms))
    return "stale";
  return metric.verified ? "human_verified" : "measured_unverified";
}

const intro =
  "# FractalMind OKR\n\nThis is a plaintext local snapshot, not execution authority. " +
  "Refresh from Sui before acting. Edit only the local proposal block; edits are UNSUBMITTED. " +
  "App review, fee confirmation and an authorized device signature are required to commit them. " +
  "ACTIVE goals must pause and settle old Runs first. A revised goal needs a new approved agreement. " +
  "Host measurements, Human KR verification and final acceptance are separate.\n\n";
const snapshotMarker = "```fractalmind-okr-snapshot\n";
const proposalMarker = "```fractalmind-okr-proposal\n";
const end = "\n```\n";

export function renderOkrProjection(
  snapshot: OkrProjectionSnapshot,
  proposal = specificationDraft(snapshot.specification),
) {
  const p = snapshot.provenance;
  const text =
    intro +
    `State: ${snapshot.state}; current KR index: ${snapshot.nextKr} (zero-based).\n` +
    `Source version: ${p.sourceVersion}; agreement: ${p.agreementVersion}; chain read: ${p.chainReadAtMs} ms.\n\n` +
    "## Chain facts — read only\n\n" +
    snapshotMarker +
    JSON.stringify(snapshot, null, 2) +
    end +
    "\n## Local proposal — editable\n\n" +
    proposalMarker +
    JSON.stringify(proposal, null, 2) +
    end;
  if (new TextEncoder().encode(text).length > 262144)
    throw new OkrProjectionError("invalid_projection");
  return text;
}

/** Strict framing prevents ignored prose edits, extra blocks and fake status
 * fields from being treated as a valid proposal. JSON integers stay strings. */
export function parseOkrProjection(text: string) {
  try {
    if (
      typeof text !== "string" ||
      new TextEncoder().encode(text).length > 262144 ||
      new TextDecoder().decode(new TextEncoder().encode(text)) !== text
    )
      throw new Error();
    text = text.replaceAll("\r\n", "\n");
    const start = text.indexOf(snapshotMarker),
      middle = text.indexOf(proposalMarker);
    if (start < 0 || middle <= start || !text.endsWith(end)) throw new Error();
    const snapshotEnd = text.indexOf(end, start);
    const snapshot = object(
      JSON.parse(text.slice(start + snapshotMarker.length, snapshotEnd)),
    ) as OkrProjectionSnapshot;
    const raw = object(
      JSON.parse(text.slice(middle + proposalMarker.length, -end.length)),
    );
    const proposal = specificationDraft(normalizeDraft(raw as DraftInput));
    const keys = (value: object) => canonical(Object.keys(value).sort());
    const framed =
      text.slice(0, start + snapshotMarker.length) +
      JSON.stringify(snapshot, null, 2) +
      text.slice(snapshotEnd, middle + proposalMarker.length) +
      JSON.stringify(proposal, null, 2) +
      end;
    if (
      snapshot.schema !== "fractalmind.okr-projection.v1" ||
      keys(raw) !== keys(proposal) ||
      raw.krs.some(
        (kr: unknown, i: number) => keys(object(kr)) !== keys(proposal.krs[i]),
      ) ||
      framed !== renderOkrProjection(snapshot, proposal)
    )
      throw new Error();
    return { snapshot, proposal };
  } catch {
    throw new OkrProjectionError("invalid_projection");
  }
}

// Read time changes on a refresh. All actual source versions, metrics,
// budgets, agreements and original Runs must still match.
function pin(snapshot: OkrProjectionSnapshot) {
  return canonical({
    ...snapshot,
    provenance: { ...snapshot.provenance, chainReadAtMs: undefined },
  });
}

async function snapshotOf(
  view: OkrInterventionView,
  intervention: OkrIntervention,
): Promise<OkrProjectionSnapshot> {
  const { okr, spec } = view;
  let approvedPlan: NativeFileOkrPlan | null = null;
  let approvalId: string | null = null,
    maxCallsPerRun: string | null = null;
  let agentManager: { allowedPaths: string[]; notEnforced: string[] } | undefined;
  const agentManagerBody =
    okr.agreement_record &&
    (view.agreementBody as { kind?: unknown } | null)?.kind === AGENT_MANAGER_RUNTIME;
  if ([1, 3, 4].includes(okr.state) && agentManagerBody) {
    try {
      const a = validateAgentManagerAgreement(view.agreementBody, okr);
      agentManager = { allowedPaths: a.allowedPaths, notEnforced: a.notEnforced };
    } catch {
      throw new OkrProjectionError("invalid_projection");
    }
  } else if ([1, 3, 4].includes(okr.state) && okr.agreement_record) {
    const body = object(view.agreementBody),
      acceptance = object(body.hostAcceptance) as HandoverAcceptance,
      proposal = object(acceptance.proposal);
    if (
      body.format !== 1 ||
      body.specRecordId !== okr.spec_record ||
      acceptance.organization_id !== okr.org_id ||
      acceptance.human_id !== okr.owner_human ||
      acceptance.membership_id !== okr.membership_id ||
      proposal.okr_id !== okr.id ||
      proposal.managed_agent_id !== okr.managed_agent ||
      BigInt(proposal.managed_version) + 1n !== BigInt(okr.managed_version) ||
      proposal.spec_revision !== okr.spec_revision ||
      proposal.budget_asset !== okr.budget_asset ||
      proposal.budget_limit !== okr.budget_limit ||
      String(proposal.expires_at_ms) !== okr.expires_at_ms ||
      proposal.workspace_hash !==
        bytesToHex(Uint8Array.from(okr.workspace_hash))
    )
      throw new OkrProjectionError("invalid_projection");
    await verifyHandoverAcceptanceSignature(
      acceptance,
      acceptance.host_address,
    );
    const policy = await intervention.chain.sdk.handover.getPolicy(okr.id);
    if (
      policy.managed_version !== okr.managed_version ||
      (okr.state === 1 && policy.agreement_version !== okr.agreement_version) ||
      policy.max_calls !== proposal.max_calls ||
      bytesToHex(handoverProposalHash(acceptance.proposal)) !==
        bytesToHex(Uint8Array.from(policy.proposal_hash))
    )
      throw new OkrProjectionError("invalid_projection");
    approvalId = policy.approval_id;
    maxCallsPerRun = policy.max_calls;
    approvedPlan = validateHandoverPlan(
      spec,
      body.nativeFilePlan,
      acceptance.proposal,
    ).plan;
    if (
      bytesToHex(executionBoundaryHash(approvedPlan.paths)) !==
      bytesToHex(Uint8Array.from(okr.boundary_hash))
    )
      throw new OkrProjectionError("invalid_projection");
  }
  return structuredClone({
    schema: "fractalmind.okr-projection.v1",
    provenance: view.provenance,
    specification: spec,
    state: states[okr.state],
    nextKr: okr.next_kr,
    metrics: okr.metrics,
    agreement: {
      recordId: okr.agreement_record,
      version: okr.agreement_version,
      managedAgentId: okr.managed_agent,
      managedVersion: okr.managed_version,
      membershipId: okr.membership_id,
      membershipVersion: okr.membership_version,
      workspaceHash: bytesToHex(Uint8Array.from(okr.workspace_hash)),
      boundaryHash: bytesToHex(Uint8Array.from(okr.boundary_hash)),
      expiresAtMs: okr.expires_at_ms,
      approvedPlan,
      approvalId,
      maxCallsPerRun,
      ...(agentManager ? { agentManager } : {}),
    },
    budget: view.budget
      ? {
          asset: view.budget.asset,
          limit: okr.budget_limit,
          spent: view.budget.spent.toString(),
          reserved: view.budget.reserved.toString(),
        }
      : null,
    executions: view.executions
      .slice()
      .sort((a, b) => a.run.id.localeCompare(b.run.id)),
    acceptance: {
      recordId: okr.acceptance_record,
      humanId: okr.accepted_by_human,
      atMs: okr.accepted_at_ms,
    },
  });
}

/** Export/import use the same authoritative reader and replacement controller.
 * No Host delivery, status edits, auto signing, verification or acceptance. */
export class OkrProjection {
  private readonly views = new WeakMap<OkrProjectionView, string>();
  private readonly reviews = new WeakMap<OkrProposalReview, string>();
  private readonly quotes = new WeakMap<SelfPayFeeQuote, string>();
  constructor(
    readonly intervention: OkrIntervention,
    private readonly assertActive: () => void = () => {},
  ) {}
  async read(): Promise<OkrProjectionView> {
    this.assertActive();
    const view = await this.intervention.read({ includeAgreement: true });
    const snapshot = await snapshotOf(view, this.intervention);
    await this.intervention.assertCurrentRead(view);
    this.assertActive();
    const result = freeze({
      snapshot,
      text: renderOkrProjection(snapshot),
      authorityExpiresAtMs: view.authorityExpiresAtMs,
      actions: view.actions,
    });
    this.views.set(result, canonical(result));
    return result;
  }
  async export(view: OkrProjectionView, input: { reviewed: boolean }) {
    this.assertActive();
    if (input.reviewed !== true)
      throw new OkrProjectionError("confirmation_required");
    if (this.views.get(view) !== canonical(view))
      throw new OkrProjectionError("state_changed");
    const fresh = await this.read();
    if (pin(fresh.snapshot) !== pin(view.snapshot))
      throw new OkrProjectionError("state_changed");
    return { name: "OKR.md", content: fresh.text };
  }
  async review(text: string): Promise<OkrProposalReview> {
    this.assertActive();
    const parsed = parseOkrProjection(text),
      fresh = await this.read();
    if (pin(parsed.snapshot) !== pin(fresh.snapshot))
      throw new OkrProjectionError("state_changed");
    const time = parsed.snapshot.provenance.chainReadAtMs;
    if (
      typeof time !== "string" ||
      !/^[1-9][0-9]{0,19}$/.test(time) ||
      BigInt(time) > BigInt(fresh.snapshot.provenance.chainReadAtMs)
    )
      throw new OkrProjectionError("invalid_projection");
    const original = specificationDraft(fresh.snapshot.specification),
      changes = (Object.keys(original) as (keyof DraftInput)[])
        .filter((k) => canonical(original[k]) !== canonical(parsed.proposal[k]))
        .map((field) => ({
          field,
          before: original[field],
          after: parsed.proposal[field],
        }));
    const result = freeze({
      snapshot: fresh.snapshot,
      proposal: parsed.proposal,
      status: changes.length ? ("UNSUBMITTED" as const) : ("CLEAN" as const),
      changes,
      authorityExpiresAtMs: fresh.authorityExpiresAtMs,
      actions: fresh.actions,
    });
    this.reviews.set(result, canonical(result));
    return result;
  }
  query(requestId: string) {
    return this.intervention.query(requestId);
  }
  async prepare(
    review: OkrProposalReview,
    input: { reviewed: boolean },
  ): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    this.assertActive();
    if (this.reviews.get(review) !== canonical(review))
      throw new OkrProjectionError("state_changed");
    const intent = {
      kind: "replace" as const,
      expectedVersion: review.snapshot.provenance.sourceVersion,
    };
    const prior = await this.query(
      interventionRequestId(this.intervention.okrId, intent),
    );
    if (prior) return prior;
    if (input.reviewed !== true)
      throw new OkrProjectionError("confirmation_required");
    if (review.status !== "UNSUBMITTED")
      throw new OkrProjectionError("unchanged_proposal");
    if (!["DRAFT", "PAUSED"].includes(review.snapshot.state))
      throw new OkrProjectionError("pause_required");
    const expected = pin(review.snapshot);
    if (pin((await this.read()).snapshot) !== expected)
      throw new OkrProjectionError("state_changed");
    const quote = await this.intervention.prepare(intent, {
      reviewed: true,
      replacement: review.proposal,
    });
    if ("status" in quote) return quote;
    if (pin((await this.read()).snapshot) !== expected)
      throw new OkrProjectionError("state_changed");
    this.quotes.set(quote, expected);
    return quote;
  }
  async submit(quote: SelfPayFeeQuote) {
    this.assertActive();
    const expected = this.quotes.get(quote);
    if (!expected) throw new OkrProjectionError("invalid_quote");
    if (pin((await this.read()).snapshot) !== expected)
      throw new OkrProjectionError("state_changed");
    return this.intervention.submit(quote);
  }
}
