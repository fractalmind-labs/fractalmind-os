import { navigation } from "./domain";
import type { Okr, OrganizationSnapshot } from "./domain";

export type TrustLevel =
  | "claimed"
  | "measured"
  | "verified"
  | "accepted"
  | null;
/** A missing observation is not an Agent claim. Historical verification and
 * freshness are independent; only a separate human record proves acceptance. */
export function trustState(
  okr: Okr,
  index: number,
  now: bigint,
): { level: TrustLevel; stale: boolean } {
  const metric = okr.metrics[index];
  if (!metric) return { level: null, stale: false };
  const sampled = BigInt(metric.sampled_at_ms);
  const fresh =
    metric.current !== null &&
    sampled <= now &&
    now - sampled <= BigInt(metric.max_age_ms);
  const accepted =
    okr.state === 3 &&
    Boolean(okr.acceptance_record) &&
    Boolean(okr.accepted_by_human);
  return {
    level: accepted
      ? "accepted"
      : metric.verified
        ? "verified"
        : fresh
          ? "measured"
          : null,
    stale: metric.current !== null && !fresh,
  };
}
const actionRequired = new Set([
  "unknown",
  "verification",
  "acceptance",
  "permission",
  "budget",
  "expired",
  "failed",
]);
/** Read projections only. Approval requests and runtime drift cannot be inferred
 * from these records; unavailable reads never produce an empty approvals badge. */
export function decisionFacts(
  snapshot: OrganizationSnapshot,
  now: bigint,
  reachable: boolean,
) {
  if (!reachable) return { unavailable: "connection" as const, items: [] };
  if (!snapshot.okrs.value) return { unavailable: "okrs" as const, items: [] };
  return {
    unavailable: null,
    items: snapshot.okrs.value.flatMap((row) => {
      const nav = navigation(row, snapshot, now, reachable);
      return actionRequired.has(nav.condition) ? [{ row, nav }] : [];
    }),
  };
}
