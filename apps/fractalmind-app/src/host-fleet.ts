import type { VerifiedHostObservation } from "./host-signatures";
import type {
  Agent,
  Binding,
  HostRecord,
  Membership,
  OkrSnapshot,
  OrganizationSnapshot,
} from "./domain";
import { memberStatus } from "./domain";

/** One read of a coordinator's signed Host observations. */
export type BindingRead =
  | { state: "ok"; at: number; rows: VerifiedHostObservation[] }
  | { state: "failed"; at: number; error: string };

/** Hosts & compute (#73): one row per Host address. Chain facts (membership,
 * Agents, OKRs) and signed observations (liveness, system) stay separate;
 * without a successful read liveness is unknown, never assumed. */
export type FleetRow = {
  address: string;
  name: string | null;
  member: Membership | null;
  history: Membership[];
  local: boolean;
  membership: "valid" | "revoked" | "expired" | "none" | "unknown";
  live: "online" | "no_heartbeat" | "unknown";
  heartbeatMs: number | null;
  system: { os: string; arch: string; cpu: number } | null;
  observation: VerifiedHostObservation | null;
  binding: Binding | null;
  agents: Agent[];
  okrs: OkrSnapshot[];
  attention: boolean;
};
const DAY = 86_400_000;

export function fleetRows(
  snapshot: Pick<OrganizationSnapshot, "hosts" | "agents" | "okrs" | "bindings">,
  reads: ReadonlyMap<string, BindingRead>,
  localAddress: string | null,
  nowMs: number,
  clockMs: bigint,
): FleetRow[] {
  return (snapshot.hosts.value ?? []).map((host: HostRecord) => {
    const member = host.current.value ?? null;
    const membership = host.current.failure
      ? "unknown"
      : member
        ? memberStatus(member, clockMs)
        : "none";
    const binding =
      (member &&
        snapshot.bindings.value?.find(
          (b) => b.id === member.coordinator_binding,
        )) ||
      null;
    const read = member ? reads.get(member.coordinator_binding) : undefined;
    const observation =
      read?.state === "ok"
        ? (read.rows.find((r) => r.address === host.address) ?? null)
        : null;
    const fresh =
      observation?.state === "verified" &&
      observation.freshUntilMs !== null &&
      nowMs < observation.freshUntilMs;
    const live =
      membership === "revoked" || membership === "expired"
        ? "unknown"
        : fresh
          ? "online"
          : read?.state === "ok"
            ? "no_heartbeat"
            : "unknown";
    const memberIds = new Set(host.history.map((m) => m.id));
    if (member) memberIds.add(member.id);
    const agents = (snapshot.agents.value ?? []).filter(
      (a) => a.host_address === host.address && !a.revoked,
    );
    const okrs = (snapshot.okrs.value ?? []).filter(
      (row) =>
        row.okr.state === 1 &&
        row.okr.membership_id !== null &&
        memberIds.has(row.okr.membership_id),
    );
    const expiring =
      membership === "valid" &&
      !!member &&
      Number(BigInt(member.expires_at_ms) - clockMs) < 3 * DAY;
    return {
      address: host.address,
      name: member?.name?.trim() || host.history.at(-1)?.name?.trim() || null,
      member,
      history: host.history,
      local: host.address === localAddress,
      membership,
      live,
      heartbeatMs: observation?.observation?.heartbeatMs ?? null,
      system: observation?.observation?.system ?? null,
      observation,
      binding,
      agents,
      okrs,
      attention:
        membership !== "valid" || live === "no_heartbeat" || expiring,
    };
  });
}

/** "刚刚" / "3 分钟前" style age of a timestamp. */
export function age(
  ms: number | null,
  nowMs: number,
  t: (zh: string, en: string) => string,
) {
  if (ms === null) return "—";
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 30) return t("刚刚", "just now");
  if (s < 3600) {
    const m = Math.max(1, Math.round(s / 60));
    return t(`${m} 分钟前`, `${m} min ago`);
  }
  if (s < 86400) {
    const h = Math.round(s / 3600);
    return t(`${h} 小时前`, `${h} h ago`);
  }
  const d = Math.round(s / 86400);
  return t(`${d} 天前`, `${d} d ago`);
}
