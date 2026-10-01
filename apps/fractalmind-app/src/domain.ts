import {
  metricProgress,
  weightedProgress,
} from "@fractalmind-labs/fractalmind-sdk";
import type {
  FractalMindSDK,
  NetworkName,
  OrganizationData,
} from "@fractalmind-labs/fractalmind-sdk";

export type ConnectionProfile = {
  network: NetworkName;
  rpcUrl: string;
  packageId: string;
  originalPackageId?: string;
  registryId: string;
  humanId: string;
  chainIdentifier?: string;
};
export type Human = Awaited<ReturnType<FractalMindSDK["identity"]["getHuman"]>>;
export type Grant = Awaited<
  ReturnType<FractalMindSDK["identity"]["getDeviceGrant"]>
>;
export type Okr = Awaited<ReturnType<FractalMindSDK["okr"]["getOkr"]>>;
export type Membership = Awaited<
  ReturnType<FractalMindSDK["host"]["getMembership"]>
>;
export type Agent = Awaited<
  ReturnType<FractalMindSDK["host"]["getManagedAgent"]>
>;
export type Binding = Awaited<
  ReturnType<FractalMindSDK["host"]["getCoordinatorBinding"]>
>;
export type Execution = Awaited<
  ReturnType<FractalMindSDK["okr"]["listExecutions"]>
>["executions"][number];
export type Observation = Awaited<
  ReturnType<FractalMindSDK["okr"]["listObservations"]>
>["observations"][number];
export type Budget = { asset: string; spent: bigint; reserved: bigint };
export type ReadSection<T> = { value: T | null; failure?: string };
export type HostRecord = {
  address: string;
  current: ReadSection<Membership>;
  history: Membership[];
};
export type OkrSnapshot = {
  okr: Okr;
  budget: ReadSection<Budget>;
  executions: ReadSection<Execution[]>;
  observations: ReadSection<Observation[]>;
};
export type OrganizationSnapshot = {
  organization: OrganizationData;
  clockMs: bigint;
  loadedAtMs: number;
  okrs: ReadSection<OkrSnapshot[]>;
  memberships: ReadSection<Membership[]>;
  agents: ReadSection<Agent[]>;
  bindings: ReadSection<Binding[]>;
  hosts: ReadSection<HostRecord[]>;
};
export type Navigation = {
  condition:
    | "achieved"
    | "archived"
    | "draft"
    | "paused"
    | "unknown"
    | "expired"
    | "permission"
    | "budget"
    | "queued"
    | "running"
    | "stopped"
    | "failed"
    | "measurement"
    | "verification"
    | "acceptance"
    | "ready";
  reason: string;
  verifiedCheckpoints: number;
  currentKr: number;
  metricProgress: Array<number | null>;
  progress: number | null;
  latest?: Execution;
  boundary: "unknown" | "invalid" | "valid";
};

export function clockNow(
  snapshot: Pick<OrganizationSnapshot, "clockMs" | "loadedAtMs">,
  wallMs: number,
) {
  return (
    snapshot.clockMs +
    BigInt(Math.max(0, Math.floor(wallMs - snapshot.loadedAtMs)))
  );
}
export function memberStatus(
  member: Membership,
  now: bigint,
): "revoked" | "expired" | "valid" {
  return member.revoked
    ? "revoked"
    : BigInt(member.expires_at_ms) <= now
      ? "expired"
      : "valid";
}
/** A factual projection of chain records. It never authorizes an action, guesses
 * that a Host is online, or derives direction/dead-end claims from time alone. */
export function navigation(
  focus: OkrSnapshot,
  snapshot: OrganizationSnapshot,
  now: bigint,
  reachable: boolean,
): Navigation {
  const { okr } = focus;
  const metricValues = okr.metrics.map((metric) =>
    metricProgress(
      {
        baseline: metric.baseline,
        target: metric.target,
        current: metric.current,
        sampledAtMs: metric.sampled_at_ms,
        maxAgeMs: metric.max_age_ms,
      },
      now,
    ),
  );
  let verified = 0;
  while (verified < okr.metrics.length && okr.metrics[verified].verified)
    verified++;
  const current = Number(okr.next_kr);
  const base: Navigation = {
    condition: "unknown",
    reason: "missing_facts",
    verifiedCheckpoints: verified,
    currentKr: current,
    metricProgress: metricValues,
    progress: weightedProgress(
      metricValues.map((progress, i) => ({
        progress,
        weight: okr.metrics[i].weight,
      })),
    ),
    boundary: "unknown",
  };
  const result = (
    condition: Navigation["condition"],
    reason: string,
    detail: Partial<Navigation> = {},
  ): Navigation => ({ ...base, condition, reason, ...detail });
  const members = snapshot.memberships.value,
    agents = snapshot.agents.value,
    bindings = snapshot.bindings.value;
  const member = members?.find((row) => row.id === okr.membership_id),
    agent = agents?.find((row) => row.id === okr.managed_agent);
  const binding =
    member && bindings?.find((row) => row.id === member.coordinator_binding);
  const expired = BigInt(okr.expires_at_ms) <= now;
  if (members && agents && bindings)
    base.boundary =
      expired ||
      !member ||
      !agent ||
      !binding ||
      memberStatus(member, now) !== "valid" ||
      agent.revoked ||
      binding.revoked ||
      !snapshot.organization.isActive ||
      member.version !== okr.membership_version ||
      agent.version !== okr.managed_version ||
      agent.membership_id !== member.id ||
      agent.host_address !== member.host_address
        ? "invalid"
        : "valid";
  else if (expired) base.boundary = "invalid";
  if (!reachable) return result("unknown", "rpc_unavailable");
  if (okr.state === 3 && okr.acceptance_record && okr.accepted_by_human)
    return result("achieved", "human_accepted");
  if (okr.state === 4) return result("archived", "archived");
  // Old agreement or expired authority does not resolve an unknown side effect.
  // Keep its original Run visible for reconciliation before any new attempt.
  const unresolved = focus.executions.value?.filter(
    (row) => row.run.state === 4 && !row.claim.settled,
  );
  if (unresolved?.length)
    return result("unknown", "execution_outcome_unknown", {
      latest: unresolved.length === 1 ? unresolved[0] : undefined,
    });
  if (okr.state === 0) return result("draft", "not_approved");
  if (okr.state === 2) return result("paused", "chain_paused");
  if (BigInt(okr.expires_at_ms) <= now)
    return result("expired", "agreement_expired", { boundary: "invalid" });
  if (!members || !agents || !bindings)
    return result("unknown", "authority_not_readable");
  if (base.boundary === "invalid")
    return result("permission", "authority_invalid");
  base.boundary = "valid";
  if (!focus.executions.value || !focus.budget.value)
    return result("unknown", "run_or_budget_not_readable");
  const matching = focus.executions.value.filter(
    (row) =>
      row.contract.agreement_version === okr.agreement_version &&
      row.contract.kr_index === okr.next_kr,
  );
  const unsettled = matching.filter((row) => !row.claim.settled);
  if (unsettled.length > 1) return result("unknown", "multiple_unsettled_runs");
  const ordered = [...matching].sort((a, b) =>
    BigInt(a.run.updated_at_ms) > BigInt(b.run.updated_at_ms)
      ? -1
      : BigInt(a.run.updated_at_ms) < BigInt(b.run.updated_at_ms)
        ? 1
        : a.run.id.localeCompare(b.run.id),
  );
  const latest = unsettled[0] ?? ordered[0];
  base.latest = latest;
  if (latest?.run.state === 4)
    return result("unknown", "execution_outcome_unknown");
  if (latest?.run.state === 1)
    return result(
      "running",
      latest.run.stop_requested
        ? "stop_requested_not_confirmed"
        : "chain_running",
    );
  if (latest?.run.state === 0)
    return BigInt(latest.run.expires_at_ms) <= now
      ? result("expired", "queued_command_expired")
      : result("queued", "prepared_not_started");
  if (latest?.run.state === 5)
    return result("stopped", "host_or_chain_cancelled");
  if (latest?.run.state === 3) return result("failed", "execution_failed");
  if (verified === okr.metrics.length)
    return result("acceptance", "separate_human_acceptance");
  if (metricValues[current] === 1 && !okr.metrics[current].verified)
    return result("verification", "measurement_not_verification");
  if (
    latest?.run.state === 2 &&
    (!okr.metrics[current]?.run_id ||
      okr.metrics[current].run_id !== latest.run.id)
  )
    return result("measurement", "result_without_current_measurement");
  if (latest?.run.state === 2 && metricValues[current] === null)
    return result("unknown", "measurement_stale");
  const budget = focus.budget.value;
  if (budget.spent + budget.reserved >= BigInt(okr.budget_limit))
    return result("budget", "no_unreserved_budget");
  return result("ready", "no_current_execution");
}
