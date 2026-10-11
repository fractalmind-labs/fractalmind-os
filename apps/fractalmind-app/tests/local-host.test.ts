import assert from "node:assert/strict";
import test from "node:test";
import {
  HOST_FUNDING_MIST,
  LocalHostError,
  LocalHostNative,
  canHostLocally,
  chainConfig,
  endpointPort,
  fundingFor,
  setupLocalHost,
  type JoinResult,
  type LocalHostStatus,
  type SetupContext,
} from "../src/local-host";
import type { HostDirectory } from "../src/host-admission";

const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const keys = {
  format: "1",
  profile: "app-testnet",
  host_address: id(0xa1),
  signing_public_key: "ab".repeat(32),
  encryption_public_key: "cd".repeat(32),
};
const keyBytes = Array.from({ length: 32 }, () => 0xab);
const profile = {
  network: "testnet",
  rpcUrl: "https://fullnode.testnet.sui.io:443",
  chainIdentifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
  packageId: id(1),
  originalPackageId: id(2),
  okrPackageId: id(3),
  directPackageId: id(4),
  registryId: id(5),
  humanId: id(6),
} as never;
const outcome = (status: string, n = 1) => ({ status, digest: `D${n}`, requestId: `r${n}` }) as never;

function world(opts: { joinPrior?: JoinResult | null; join?: JoinResult; inviteStatus?: string; binding?: "existing" | "none"; balance?: bigint } = {}) {
  const directory: HostDirectory = {
    chainIdentifier: "69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD",
    bindings: [],
    invitations: [],
    memberships: [],
    clockMs: 1000n,
    loadedAtMs: 0,
    activeHostsTableId: null,
    instancesTableId: null,
  };
  const bind = () =>
    directory.bindings.push({ id: id(0xb1), org_id: id(7), coordinator_address: keys.host_address, public_key: keyBytes, endpoint: "http://127.0.0.1:7444", version: "1", revoked: false } as never);
  if (opts.binding === "existing") bind();
  const calls: string[] = [];
  const prepared: unknown[] = [];
  const admission = {
    directory: async () => structuredClone(directory),
    prepare: async (op: { kind: string }, attempt: string) => {
      calls.push(`prepare:${op.kind}:${attempt.length}`);
      prepared.push(op);
      return { quote: op.kind } as never;
    },
    submit: async (q: { quote: string }) => {
      calls.push(`submit:${q.quote}`);
      if (q.quote === "binding") bind();
      return outcome(q.quote === "invite" ? (opts.inviteStatus ?? "confirmed") : "confirmed");
    },
    awaitVisible: async () => true,
    createdInvite: async () => ({ invite: {}, code: "FHI1:secret" }),
  };
  let joined = false;
  const native = {
    keys: async () => keys,
    configure: async (_p: string, chain: unknown, org: unknown) => {
      calls.push("configure");
      prepared.push({ chain, org });
      return {} as never;
    },
    join: async (_p: string, code: string | null, fresh: boolean) => {
      calls.push(`join:${code ? "code" : "none"}:${!!fresh}`);
      if (!code) {
        if (opts.joinPrior === undefined) throw new LocalHostError("native_failed", "empty");
        return opts.joinPrior!;
      }
      const result = opts.join ?? { state: "confirmed", actual_fee_mist: "5" };
      if (result.state === "confirmed") {
        joined = true;
        directory.memberships.push({ id: id(0xc1), host_address: keys.host_address, coordinator_binding: id(0xb1), revoked: false, expires_at_ms: "999999" } as never);
      }
      return result;
    },
    service: async (_p: string, a: string) => void calls.push(`service:${a}`),
    status: async () => ({ service: "running", listening: true }) as LocalHostStatus,
  } as unknown as LocalHostNative;
  const store = new Map<string, string>();
  const ctx: SetupContext = {
    native,
    chain: { profile, sdk: { client: { client: { core: { getBalance: async () => ({ balance: { balance: String(opts.balance ?? 0n) } }) } } } } } as never,
    admission: admission as never,
    deviceProfile: "testnet",
    organizationId: id(7),
    hostName: "Mac",
    port: 7444,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    sleep: async () => {},
  };
  return { ctx, calls, prepared, store, joined: () => joined };
}

test("fresh setup: binding, config, funded invite, stdin join, service", async () => {
  const w = world();
  const result = await setupLocalHost(w.ctx);
  assert.deepEqual(w.calls, [
    "prepare:binding:36",
    "submit:binding",
    "configure",
    "join:none:false",
    "prepare:invite:36",
    "submit:invite",
    "join:code:false",
    "service:install",
  ]);
  assert.equal(result.membershipId, id(0xc1));
  assert.equal(result.endpoint, "http://127.0.0.1:7444");
  assert.equal(result.joinFee, "5");
  const invite = w.prepared.find((p) => (p as { kind?: string }).kind === "invite") as { fund: { address: string; mist: string }; ttlMinutes: number };
  assert.deepEqual(invite.fund, { address: keys.host_address, mist: HOST_FUNDING_MIST.toString() });
  assert.equal(invite.ttlMinutes, 15);
  const cfg = w.prepared.find((p) => (p as { org?: unknown }).org) as { org: { bindingId: string; port: number }; chain: { originalPackageId: string; okrPackageId: string } };
  assert.equal(cfg.org.bindingId, id(0xb1));
  assert.equal(cfg.org.port, 7444);
  assert.equal(cfg.chain.originalPackageId, id(2));
  // The invitation never reaches browser storage.
  assert.ok(![...w.store.values()].some((v) => v.includes("FHI1")));
});

test("resume after join: nothing is signed or broadcast again", async () => {
  const w = world({ binding: "existing" });
  await setupLocalHost(w.ctx);
  const again = world({ binding: "existing", joinPrior: { state: "confirmed" } });
  // Membership already visible: only configuration and the service are touched.
  again.ctx.admission = { ...(again.ctx.admission as object), directory: async () => (await w.ctx.admission.directory()) } as never;
  await setupLocalHost(again.ctx);
  assert.deepEqual(again.calls, ["configure", "service:install"]);
});

test("unknown original join stops before any new invitation", async () => {
  const w = world({ binding: "existing", joinPrior: { state: "unknown", digest: "J" } });
  await assert.rejects(setupLocalHost(w.ctx), (e: LocalHostError) => e.code === "join_unknown" && e.detail === "J");
  assert.ok(!w.calls.some((c) => c.startsWith("prepare")));
});

test("failed original join prepares an explicit new attempt", async () => {
  const w = world({ binding: "existing", joinPrior: { state: "failed" } });
  await setupLocalHost(w.ctx);
  assert.ok(w.calls.includes("join:code:true"));
});

test("a cancelled or failed join is reported, the service is not installed", async () => {
  for (const [state, code] of [["cancelled", "join_cancelled"], ["failed", "join_failed"]]) {
    const w = world({ binding: "existing", join: { state } });
    await assert.rejects(setupLocalHost(w.ctx), (e: LocalHostError) => e.code === code);
    assert.ok(!w.calls.some((c) => c.startsWith("service")));
  }
});

test("a failed invite transaction needs an explicit retry", async () => {
  const w = world({ binding: "existing", inviteStatus: "failed" });
  await assert.rejects(setupLocalHost(w.ctx), (e: LocalHostError) => e.code === "invite_failed");
  assert.equal(w.calls.filter((c) => c === "submit:invite").length, 1);
});

test("a funded Host is not funded again", async () => {
  const w = world({ binding: "existing", balance: 80_000_000n });
  await setupLocalHost(w.ctx);
  const invite = w.prepared.find((p) => (p as { kind?: string }).kind === "invite") as { fund?: unknown };
  assert.equal(invite.fund, undefined);
  assert.equal(fundingFor(79_999_999n), HOST_FUNDING_MIST);
});

test("helpers: loopback ports, chain origins, desktop only", () => {
  assert.equal(endpointPort("http://127.0.0.1:7443"), 7443);
  assert.equal(endpointPort("http://127.0.0.1:7463"), null);
  assert.equal(endpointPort("https://127.0.0.1:7443"), null);
  assert.equal(endpointPort("http://localhost:7443"), null);
  const c = chainConfig(profile, "CHAIN");
  assert.equal(c.originalOkrPackageId, id(3));
  assert.equal(c.originalDirectPackageId, id(4));
  assert.equal(c.chainIdentifier, "CHAIN");
  assert.equal(canHostLocally("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), true);
  assert.equal(canHostLocally("Mozilla/5.0 (Linux; Android 15)"), false);
  assert.equal(canHostLocally("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"), false);
});

test("native errors map to stable codes", async () => {
  const native = new LocalHostNative(async () => {
    throw "EnvdUnavailable";
  });
  await assert.rejects(native.status("testnet"), (e: LocalHostError) => e.code === "envd_unavailable");
  const failing = new LocalHostNative(async () => {
    throw "EnvdFailed: boom";
  });
  await assert.rejects(failing.join("testnet", null), (e: LocalHostError) => e.code === "native_failed" && e.detail === "EnvdFailed: boom");
});
