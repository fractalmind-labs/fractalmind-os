import test from "node:test";
import assert from "node:assert/strict";
import { agentDiscovery } from "../src/agent-discovery";

async function fixture() {
  const workspace = "/Users/developer/project";
  const hash = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(workspace)),
  ).toString("hex");
  return {
    format: 1,
    state: "complete",
    observed_at: new Date().toISOString(),
    instances: [
      {
        instance_id: "tmux-" + "a".repeat(64),
        session: "agent-existing",
        pane: "%1",
        state: "observed",
        runtime: "tmux-observe",
        continuity: "kernel-process-v1",
        workspace,
        workspace_hash: hash,
      },
    ],
  };
}
test("Host discovery preserves observation-only continuity and independent scan expiry", async () => {
  const f = await fixture(),
    now = Date.now();
  const actual = await agentDiscovery(f, now + 30000, now + 90000);
  assert.equal(actual.state, "complete");
  assert.equal(actual.instances[0].instanceId, f.instances[0].instance_id);
  assert.equal(actual.instances[0].runtime, "tmux-observe");
  assert.equal(actual.expiresAtMs, Date.parse(f.observed_at) + 60000);
  // Renewing a heartbeat cannot extend the original scan's expiry.
  const renewed = await agentDiscovery(f, now + 59000, now + 119000);
  assert.equal(renewed.expiresAtMs, actual.expiresAtMs);
});
test("unverified identity, forged capability and malformed workspace cannot enter the discovery list", async () => {
  const mutations: Array<(f: any) => void> = [
    (f) => (f.instances[0].runtime = "bounded-process-v1"),
    (f) => (f.instances[0].continuity = "agent-name"),
    (f) => (f.instances[0].workspace_hash = "0".repeat(64)),
    (f) => (f.instances[0].workspace = "../relative"),
    (f) => (f.instances[0].state = "unverified"),
    (f) => (f.instances[0].state = "dead"),
    (f) => f.instances.push(structuredClone(f.instances[0])),
    (f) => (f.state = "unavailable"),
    (f) => (f.state = "unsupported"),
    (f) => (f.observed_at = new Date(Date.now() + 60000).toISOString()),
    (f) => (f.instances[0].session = "agent-\nspoof"),
    (f) => (f.instances[0].instance_id = "agent-existing"),
  ];
  for (const mutate of mutations) {
    const f = await fixture();
    mutate(f);
    const d = await agentDiscovery(f, Date.now(), Date.now() + 60000);
    assert.equal(d.state, "unknown");
    assert.deepEqual(d.instances, []);
  }
});
test("no instances, failed scan, unsupported platform and legacy missing schema are distinct", async () => {
  for (const state of ["complete", "unavailable", "unsupported"]) {
    const f = await fixture();
    f.state = state;
    f.instances = [];
    const d = await agentDiscovery(f, Date.now(), Date.now() + 60000);
    assert.equal(d.state, state);
    assert.deepEqual(d.instances, []);
  }
  assert.equal(
    (await agentDiscovery(undefined, Date.now(), Date.now() + 60000)).state,
    "unknown",
  );
  const f = await fixture();
  Object.assign(f.instances[0], {
    instance_id: "",
    state: "unverified",
    continuity: "unverified",
    workspace: "",
    workspace_hash: "",
  });
  const d = await agentDiscovery(f, Date.now(), Date.now() + 60000);
  assert.equal(d.state, "complete");
  assert.equal(d.instances[0].state, "unverified");
  assert.equal(d.instances[0].instanceId, "");
});
