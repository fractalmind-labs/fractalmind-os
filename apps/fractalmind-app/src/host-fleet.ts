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
  | {
      state: "ok";
      at: number;
      rows: VerifiedHostObservation[];
      /** A later read failed; this one stays visible with its own time. */
      lastError?: { at: number; error: string };
    }
  | { state: "failed"; at: number; error: string };

/** This computer's own service, read from the OS (not a signed observation). */
export type LocalService = {
  address: string;
  service: "not_installed" | "stopped" | "starting" | "running" | "unknown" | "unsupported";
  listening: boolean;
};
/** A verified heartbeat counts as current for this long after the read that
 * returned it: reads come every 30 s and take a while on testnet. */
export const READ_VALID_MS = 90_000;

/** Hosts & compute (#73): one row per Host address. Chain facts (membership,
 * Agents, OKRs) and signed observations (liveness, system) stay separate;
 * without a successful read liveness is unknown, never assumed. This
 * computer's row may also use its own service state, labelled as such. */
export type FleetRow = {
  address: string;
  name: string | null;
  member: Membership | null;
  history: Membership[];
  local: boolean;
  membership: "valid" | "revoked" | "expired" | "none" | "unknown";
  live: "online" | "no_heartbeat" | "stopped" | "checking" | "unknown";
  /** Where “online” or “stopped” came from. */
  liveSource: "heartbeat" | "local" | null;
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
  local: LocalService | string | null,
  nowMs: number,
  clockMs: bigint,
  /** A read is in progress and has not answered yet. */
  checking = false,
): FleetRow[] {
  const here = typeof local === "string" ? { address: local, service: "unknown" as const, listening: false } : local;
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
    // Verified at read time, and that read is recent.
    const fresh =
      read?.state === "ok" &&
      observation?.state === "verified" &&
      nowMs - read.at < READ_VALID_MS;
    const isLocal = here?.address === host.address;
    let live: FleetRow["live"] = "unknown";
    let liveSource: FleetRow["liveSource"] = null;
    if (membership === "revoked" || membership === "expired") live = "unknown";
    else if (isLocal && (here!.service === "stopped" || here!.service === "not_installed")) {
      live = "stopped";
      liveSource = "local";
    } else if (fresh) {
      live = "online";
      liveSource = "heartbeat";
    } else if (isLocal && here!.service === "running" && here!.listening) {
      live = "online";
      liveSource = "local";
    } else if (read?.state === "ok" && nowMs - read.at < READ_VALID_MS) live = "no_heartbeat";
    else if (checking || (isLocal && here!.service === "starting")) live = "checking";
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
      local: isLocal,
      membership,
      live,
      liveSource,
      heartbeatMs: observation?.observation?.heartbeatMs ?? null,
      system: observation?.observation?.system ?? null,
      observation,
      binding,
      agents,
      okrs,
      attention:
        membership !== "valid" || live === "no_heartbeat" || live === "stopped" || expiring,
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
