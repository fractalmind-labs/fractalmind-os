import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentError,
  AgentNative,
  agentDefinition,
  defaultHome,
  definitionName,
  sessionName,
  validAgentName,
} from "../src/agents";
import { agentDiscovery } from "../src/agent-discovery";

test("names become namespace and tmux session", () => {
  for (const ok of ["writer", "research-2", "ab"]) assert.equal(validAgentName(ok), true, ok);
  for (const bad of ["", "w", "Writer", "1x", "a--b", "x-", "a_b", "a".repeat(32)]) assert.equal(validAgentName(bad), false, bad);
  assert.equal(sessionName("writer"), "writer--main");
  assert.equal(defaultHome("writer"), "~/agents/writer");
  assert.equal(defaultHome(""), "");
});

test("a discovered definition is parsed strictly or dropped", () => {
  const def = agentDefinition({ home: "/Users/u/research", name: "main", namespace: "research", launcher: "codex", profile: "research", model: "ornith", heartbeat: "0 * * * *", schedules: 4, rom: { name: "hermes-agent", version: "0.1.0" }, skills: 30, sub_agents: 2 });
  assert.deepEqual(def, { home: "/Users/u/research", name: "main", namespace: "research", description: null, launcher: "codex", profile: "research", model: "ornith", heartbeat: "0 * * * *", schedules: 4, rom: { name: "hermes-agent", version: "0.1.0" }, skills: 30, subAgents: 2 });
  assert.equal(definitionName(def!), "research");
  assert.equal(definitionName({ ...def!, namespace: null }), "main");
  assert.equal(agentDefinition(undefined), null);
  assert.equal(agentDefinition({ home: "relative", name: "main" }), null);
  assert.equal(agentDefinition({ home: "/h", name: "main\u0001" }), null);
  assert.equal(agentDefinition({ home: "/h", name: "main", skills: -1 }), null);
  assert.equal(agentDefinition({ home: "/h", name: "main", rom: "x" })!.rom, null);
});

test("discovery keeps instances and attaches only valid definitions", async () => {
  const workspace = "/Users/u/research";
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(workspace))), (x) => x.toString(16).padStart(2, "0")).join("");
  const instance = (agent: unknown) => ({ instance_id: `tmux-${"a".repeat(64)}`, session: "research--main", pane: "%1", state: "observed", runtime: "tmux-observe", continuity: "kernel-process-v1", workspace, workspace_hash: hash, agent });
  const now = Date.now();
  const scan = (agent: unknown) => agentDiscovery({ format: 1, state: "complete", observed_at: new Date(now).toISOString(), instances: [instance(agent)] }, now, now + 60000);
  const good = await scan({ home: workspace, name: "main", namespace: "research" });
  assert.equal(good.state, "complete");
  assert.equal(good.instances[0].agent?.namespace, "research");
  const bad = await scan({ home: workspace, name: "x\u0000" });
  assert.equal(bad.state, "complete", "a bad definition never hides the instance");
  assert.equal(bad.instances[0].agent, null);
  assert.equal((await scan(undefined)).instances[0].agent, null);
});

test("native errors keep their code and detail", async () => {
  const native = new AgentNative(async () => {
    throw "AgentStartFailed: tmux missing";
  });
  await assert.rejects(native.start("~/agents/w"), (e: AgentError) => e.code === "AgentStartFailed" && e.detail === "tmux missing");
  const calls: unknown[] = [];
  const ok = new AgentNative((async (cmd: string, args: unknown) => {
    calls.push([cmd, args]);
    return { state: "new", path: "/Users/u/agents/w" };
  }) as never);
  assert.equal((await ok.checkHome("~/agents/w")).state, "new");
  assert.deepEqual(calls, [["fm_agent_home_check", { home: "~/agents/w" }]]);
});
