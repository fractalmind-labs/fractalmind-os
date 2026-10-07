import test from "node:test";
import assert from "node:assert/strict";
import { fleetRows, type BindingRead } from "../src/host-fleet";
import type { Membership, OrganizationSnapshot } from "../src/domain";
import type { VerifiedHostObservation } from "../src/host-signatures";

const a = (n: string) => `0x${n.repeat(64)}`;
const NOW = 1_800_000_000_000;
const member = (over: Partial<Membership> = {}) =>
  ({
    id: a("1"),
    host_address: a("2"),
    name: "Mac mini",
    coordinator_binding: a("3"),
    revoked: false,
    expires_at_ms: String(NOW + 30 * 86_400_000),
    ...over,
  }) as unknown as Membership;
const snapshot = (
  m: Membership | null,
  extra: Partial<OrganizationSnapshot> = {},
) =>
  ({
    hosts: {
      value: [
        { address: a("2"), current: { value: m }, history: m ? [m] : [] },
      ],
    },
    agents: { value: [] },
    okrs: { value: [] },
    bindings: { value: [] },
    ...extra,
  }) as unknown as OrganizationSnapshot;
const seen = (fresh: boolean): VerifiedHostObservation => ({
  address: a("2"),
  state: fresh ? "verified" : "expired",
  observation: {
    address: a("2"),
    hostname: "mini",
    heartbeatMs: NOW - 5000,
    agentCount: 1,
    system: { os: "darwin", arch: "arm64", cpu: 10 },
  },
  membershipId: a("1"),
  expiresAtMs: NOW + 60_000,
  freshUntilMs: fresh ? NOW + 30_000 : NOW - 1,
  discovery: null,
});
const reads = (r?: BindingRead) => new Map(r ? [[a("3"), r]] : []);
const row = (
  m: Membership | null,
  r?: BindingRead,
  local: string | null = null,
) => fleetRows(snapshot(m), reads(r), local, NOW, BigInt(NOW))[0];

test("liveness is unknown until a coordinator read succeeds", () => {
  const r = row(member());
  assert.equal(r.live, "unknown");
  assert.equal(r.attention, false);
  assert.equal(
    row(member(), { state: "failed", at: NOW, error: "x" }).live,
    "unknown",
  );
});

test("a fresh signed heartbeat is online; a stale or missing one is no heartbeat", () => {
  const online = row(member(), { state: "ok", at: NOW, rows: [seen(true)] });
  assert.equal(online.live, "online");
  assert.deepEqual(online.system, { os: "darwin", arch: "arm64", cpu: 10 });
  assert.equal(
    row(member(), { state: "ok", at: NOW, rows: [seen(false)] }).live,
    "no_heartbeat",
  );
  const missing = row(member(), { state: "ok", at: NOW, rows: [] });
  assert.equal(missing.live, "no_heartbeat");
  assert.equal(missing.attention, true);
});

test("a verified heartbeat stays current for a while after its read, then is unknown", () => {
  const old = { state: "ok" as const, at: NOW - 91_000, rows: [seen(true)] };
  assert.equal(row(member(), { ...old, at: NOW - 60_000 }).live, "online");
  assert.equal(row(member(), old).live, "unknown");
  assert.equal(
    fleetRows(snapshot(member()), reads(), null, NOW, BigInt(NOW), true)[0]
      .live,
    "checking",
  );
});

test("this computer shows its own service state until a heartbeat is read", () => {
  const local = (
    service: "running" | "stopped" | "starting",
    listening = true,
  ) => ({ address: a("2"), service, listening });
  const r = (l: ReturnType<typeof local>, read?: BindingRead) =>
    fleetRows(snapshot(member()), reads(read), l, NOW, BigInt(NOW))[0];
  assert.deepEqual(
    [r(local("running")).live, r(local("running")).liveSource],
    ["online", "local"],
  );
  assert.deepEqual(
    [r(local("stopped")).live, r(local("stopped")).attention],
    ["stopped", true],
  );
  assert.equal(r(local("starting", false)).live, "checking");
  assert.equal(r(local("running", false)).live, "unknown");
  // A verified heartbeat wins over the local guess; a stopped service wins over both.
  assert.equal(
    r(local("running"), { state: "ok", at: NOW, rows: [seen(true)] })
      .liveSource,
    "heartbeat",
  );
  assert.equal(
    r(local("stopped"), { state: "ok", at: NOW, rows: [seen(true)] }).live,
    "stopped",
  );
});

test("revoked, expired and expiring memberships need attention", () => {
  assert.equal(row(member({ revoked: true })).membership, "revoked");
  assert.equal(
    row(member({ revoked: true }), { state: "ok", at: NOW, rows: [seen(true)] })
      .live,
    "unknown",
  );
  assert.equal(
    row(member({ expires_at_ms: String(NOW - 1) } as Partial<Membership>))
      .membership,
    "expired",
  );
  assert.equal(
    row(
      member({
        expires_at_ms: String(NOW + 86_400_000),
      } as Partial<Membership>),
    ).attention,
    true,
  );
  assert.equal(row(null).membership, "none");
});

test("this computer, its Agents and active OKRs are attached by address and membership", () => {
  const s = snapshot(member(), {
    agents: {
      value: [
        { host_address: a("2"), revoked: false },
        { host_address: a("2"), revoked: true },
        { host_address: a("9"), revoked: false },
      ],
    },
    okrs: {
      value: [
        { okr: { state: 1, membership_id: a("1") } },
        { okr: { state: 4, membership_id: a("1") } },
        { okr: { state: 1, membership_id: a("8") } },
      ],
    },
  } as unknown as Partial<OrganizationSnapshot>);
  const r = fleetRows(s, reads(), a("2"), NOW, BigInt(NOW))[0];
  assert.equal(r.local, true);
  assert.equal(r.agents.length, 1);
  assert.equal(r.okrs.length, 1);
});
