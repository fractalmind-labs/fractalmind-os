import { CoordinatorReadError } from "./coordinator-read";
export type CoordinatorHost = {
  address: string;
  hostname: string;
  heartbeatMs: number | null;
  agentCount: number;
  system: { os: string; arch: string; cpu: number } | null;
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) bad();
  return value as Record<string, unknown>;
}
function bad(): never {
  throw new CoordinatorReadError("invalid_observation");
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    bad();
  return value;
}
function integer(value: unknown, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    bad();
  return value;
}
/** Coordinator endorsement, never independent Host online evidence. */
export function coordinatorHosts(
  value: unknown,
  now = Date.now(),
): CoordinatorHost[] {
  const envelope = object(value),
    rows = envelope.sentinels;
  if (
    !Array.isArray(rows) ||
    rows.length > 1000 ||
    envelope.count !== rows.length
  )
    bad();
  const seen = new Set<string>();
  return rows.map((value) => {
    const row = object(value),
      address = text(row.host_id, 66);
    if (
      !/^0x[0-9a-f]{64}$/.test(address) ||
      row.id !== address ||
      seen.has(address)
    )
      bad();
    seen.add(address);
    let heartbeatMs: number | null = null;
    if (row.last_heartbeat !== null) {
      const timestamp = text(row.last_heartbeat, 64);
      if (!/^\d{4}-\d\d-\d\dT/.test(timestamp)) bad();
      heartbeatMs = Date.parse(timestamp);
      if (
        !Number.isSafeInteger(heartbeatMs) ||
        heartbeatMs < 0 ||
        heartbeatMs > now + 60_000
      )
        bad();
    }
    let system: CoordinatorHost["system"] = null;
    if (row.system !== null) {
      const source = object(row.system);
      system = {
        os: text(source.os, 32),
        arch: text(source.arch, 32),
        cpu: integer(source.num_cpu, 65536),
      };
      if (!system.os || !system.arch || system.cpu < 1) bad();
    }
    return {
      address,
      hostname: text(row.hostname, 253),
      heartbeatMs,
      agentCount: integer(row.agent_count, 10000),
      system,
    };
  });
}
