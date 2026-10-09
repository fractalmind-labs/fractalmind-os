import test from "node:test";
import assert from "node:assert/strict";
import {
  encode,
  decode,
  loadCached,
  saveCached,
} from "../src/v2/snapshot-cache";
import { condOf, lifeOf, onboarding } from "../src/v2/model";
import { parseRoute } from "../src/v2/router";
import type { ConnectionProfile, OrganizationSnapshot } from "../src/domain";

const a = (n: string) => `0x${n.repeat(64)}`;
const profile = (human: string): ConnectionProfile => ({
  network: "testnet",
  rpcUrl: "https://fullnode.testnet.sui.io:443",
  packageId: a("1"),
  registryId: a("2"),
  humanId: human,
});
class Memory {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, v);
  removeItem = (k: string) => void this.map.delete(k);
}

test("the snapshot cache round-trips bigints and bytes exactly", () => {
  const value = {
    clock: 123n,
    hash: Uint8Array.from([1, 2, 255]),
    nested: [{ v: -5n }],
    plain: "x",
  };
  const back = decode<typeof value>(encode(value));
  assert.equal(back.clock, 123n);
  assert.deepEqual(Array.from(back.hash), [1, 2, 255]);
  assert.equal(back.nested[0].v, -5n);
  assert.equal(back.plain, "x");
});

test("a cached view is only shown to the identity that saved it", () => {
  const store = new Memory();
  const view = {
    identity: { human: { id: a("3") } } as never,
    snapshot: null,
    savedAtMs: 1,
  };
  saveCached(profile(a("3")), view, store);
  assert.equal(loadCached(profile(a("3")), store)?.savedAtMs, 1);
  assert.equal(loadCached(profile(a("4")), store), null);
  assert.equal(
    loadCached({ ...profile(a("3")), network: "devnet" }, store),
    null,
  );
});

test("chain conditions map to the prototype's road states", () => {
  assert.equal(condOf("running"), "on_track");
  assert.equal(condOf("budget"), "boundary");
  assert.equal(condOf("failed"), "blocked");
  assert.equal(condOf("acceptance"), "waiting");
  assert.equal(condOf("unknown"), "unknown");
  assert.equal(condOf("draft"), "idle");
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(lifeOf), [
    "DRAFT",
    "ACTIVE",
    "PAUSED",
    "ACHIEVED",
    "ARCHIVED",
    "DRAFT",
  ]);
});

test("the first-result guide follows host, Agent and OKR records", () => {
  const now = 1000n;
  const snap = (hosts: unknown[], agents: unknown[], okrs: unknown[]) =>
    ({
      hosts: { value: hosts },
      agents: { value: agents },
      okrs: { value: okrs },
    }) as unknown as OrganizationSnapshot;
  const member = { revoked: false, expires_at_ms: "2000" };
  assert.deepEqual(onboarding({ snapshot: snap([], [], []), now }), {
    host: false,
    agent: false,
    okr: false,
    done: false,
  });
  assert.deepEqual(
    onboarding({
      snapshot: snap(
        [{ current: { value: member } }],
        [{ revoked: false }],
        [],
      ),
      now,
    }),
    {
      host: true,
      agent: true,
      okr: false,
      done: false,
    },
  );
  // An expired membership or a revoked Agent does not count.
  const s = snap(
    [{ current: { value: { ...member, expires_at_ms: "500" } } }],
    [{ revoked: true }],
    [{}],
  );
  assert.deepEqual(onboarding({ snapshot: s, now }), {
    host: false,
    agent: false,
    okr: true,
    done: false,
  });
  // Unread sections are unknown, not “not done”.
  assert.equal(
    onboarding({
      snapshot: {
        hosts: { value: null },
        agents: { value: [] },
        okrs: { value: [] },
      } as never,
      now,
    }),
    null,
  );
});

test("hash routes resolve to known pages", () => {
  assert.deepEqual(parseRoute("#/hosts/0xabc"), {
    name: "hosts",
    parts: ["hosts", "0xabc"],
  });
  assert.deepEqual(parseRoute(""), { name: "workbench", parts: ["workbench"] });
  assert.deepEqual(parseRoute("#/nope/x"), {
    name: "workbench",
    parts: ["workbench"],
  });
});

test("notifications come from chain facts, newest first", async () => {
  const { activity } = await import("../src/v2/activity");
  const snap = {
    okrs: {
      value: [
        {
          okr: {
            id: a("1"),
            activated_at_ms: "100",
            agreement_version: "1",
            state: 3,
            accepted_at_ms: "400",
          },
          observations: {
            value: [
              {
                id: a("2"),
                recorded_at_ms: "200",
                kr_index: "0",
                current: "5",
              },
            ],
          },
          executions: {
            value: [
              {
                run: { id: a("3"), state: 2, issued_at_ms: "300" },
                contract: { kr_index: "0" },
              },
              {
                run: { id: a("4"), state: 1, issued_at_ms: "350" },
                contract: { kr_index: "1" },
              },
            ],
          },
        },
        {
          okr: {
            id: a("5"),
            activated_at_ms: "0",
            state: 0,
            accepted_at_ms: "0",
          },
          observations: { value: null },
          executions: { value: null },
        },
      ],
    },
    agents: {
      value: [
        { id: a("6"), revoked: false, imported_at_ms: "50" },
        { id: a("7"), revoked: true, imported_at_ms: "500" },
      ],
    },
  } as unknown as OrganizationSnapshot;
  const items = activity(snap, () => "Goal");
  assert.deepEqual(
    items.map((x) => [x.at, x.icon]),
    [
      [400, "flag"],
      [300, "check"],
      [200, "trend"],
      [100, "play"],
      [50, "users"],
    ],
  );
  // A running Run, a revoked Agent and a never-activated goal are not news.
  assert.deepEqual(
    activity(null, () => ""),
    [],
  );
  assert.equal(items.find((x) => x.icon === "trend")?.zh, "Goal · KR1 测得 5");
});

test("an agent-manager Agent is found by its Home after its session restarts", async () => {
  const { matchLocal } = await import("../src/v2/local-agents");
  const home = "ab".repeat(32);
  const session = (instanceId: string, workspaceHash: string, agent = true) =>
    ({
      instanceId,
      workspaceHash,
      state: "observed",
      agent: agent ? { home: "/h", name: "main" } : null,
    }) as never;
  const chainAgent = {
    instance_id: "tmux-old",
    runtime: "agent-manager-v1",
    workspace_hash: Array(32).fill(0xab),
  };
  const now = [
    session("tmux-new", home),
    session("tmux-other", "cd".repeat(32)),
  ];
  assert.equal(
    (matchLocal(now, chainAgent) as { instanceId: string }).instanceId,
    "tmux-new",
  );
  // Other runtimes stay bound to the exact instance.
  assert.equal(
    matchLocal(now, { ...chainAgent, runtime: "tmux-observe" }),
    null,
  );
  // A plain tmux session in the same folder is not an agent-manager Home.
  assert.equal(
    matchLocal([session("tmux-new", home, false)], chainAgent),
    null,
  );
});
