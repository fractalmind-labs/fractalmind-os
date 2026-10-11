import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryTransactionJournal,
  type SelfPayFeeQuote,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  BatchImport,
  BatchImportError,
  importable,
  importRuntime,
} from "../src/agent-batch-import";
import type { DiscoveredInstance } from "../src/agent-discovery";
import type { AgentDefinition } from "../src/agents";
import type { ChainReadSession } from "../src/chain";
import type { NativeDeviceSigner } from "../src/native-device";

const hash = "a".repeat(64);
const instance = (
  over: Partial<DiscoveredInstance> = {},
): DiscoveredInstance => ({
  instanceId: `tmux-${"b".repeat(64)}`,
  session: "research--main",
  pane: "%1",
  state: "observed",
  runtime: "tmux-observe",
  continuity: "kernel-process-v1",
  workspace: "/home/research",
  workspaceHash: hash,
  agent: null,
  ...over,
});
const definition = { home: "/home/research", name: "main" } as AgentDefinition;

test("agent-manager Homes import with control; other sessions observe only", () => {
  assert.deepEqual(importRuntime(instance({ agent: definition })), {
    runtime: "agent-manager-v1",
    controlConfirmed: true,
  });
  assert.deepEqual(importRuntime(instance()), {
    runtime: "tmux-observe",
    controlConfirmed: false,
  });
  // A bounded native Agent keeps its reviewed handover even with a definition.
  assert.deepEqual(
    importRuntime(
      instance({ runtime: "bounded-process-v1", agent: definition }),
    ),
    {
      runtime: "bounded-process-v1",
      controlConfirmed: false,
    },
  );
});

test("only verified, well-formed sessions can be ticked", () => {
  assert.equal(importable(instance()), true);
  assert.equal(
    importable(instance({ instanceId: `native-${"c".repeat(64)}` })),
    true,
  );
  assert.equal(importable(instance({ state: "unverified" })), false);
  assert.equal(importable(instance({ state: "dead" })), false);
  assert.equal(importable(instance({ instanceId: "tmux-short" })), false);
  assert.equal(importable(instance({ workspaceHash: "zz" })), false);
});

function batch(
  localScan: () => Promise<DiscoveredInstance[]>,
  submitted: SelfPayFeeQuote[],
) {
  const chain = {
    sdk: { client: { client: {} } },
    profile: { network: "testnet" },
  } as unknown as ChainReadSession;
  const device = { address: "0x1" } as unknown as NativeDeviceSigner;
  const b = new BatchImport(
    chain,
    device,
    `0x${"2".repeat(64)}`,
    `0x${"3".repeat(64)}`,
    new MemoryTransactionJournal(),
    localScan,
  );
  (
    b.manager as unknown as { submit: (q: SelfPayFeeQuote) => Promise<unknown> }
  ).submit = async (q) => {
    submitted.push(q);
    return { status: "failed" };
  };
  return b;
}
const planned = (
  b: BatchImport,
  targets: DiscoveredInstance[],
  local = true,
) => {
  const quote = { requestId: "agent-batch:1" } as unknown as SelfPayFeeQuote;
  (b as unknown as { plans: Map<SelfPayFeeQuote, unknown> }).plans.set(
    quote,
    targets.map((i) => ({
      hostAddress: "0x4",
      bindingId: "0x5",
      instance: i,
      local,
    })),
  );
  return quote;
};

test("a local Agent that stopped or changed its Home is not signed", async () => {
  const submitted: SelfPayFeeQuote[] = [];
  const gone = batch(async () => [], submitted);
  await assert.rejects(
    gone.submit(planned(gone, [instance()])),
    (e) => e instanceof BatchImportError && e.code === "instance_gone",
  );
  const moved = batch(
    async () => [instance({ workspaceHash: "d".repeat(64) })],
    submitted,
  );
  await assert.rejects(
    moved.submit(planned(moved, [instance()])),
    (e) => e instanceof BatchImportError && e.code === "instance_gone",
  );
  assert.equal(submitted.length, 0);
});

test("a still-running local Agent and remote targets are submitted once", async () => {
  const submitted: SelfPayFeeQuote[] = [];
  const ok = batch(async () => [instance()], submitted);
  const quote = planned(ok, [instance()]);
  await ok.submit(quote);
  assert.equal(submitted.length, 1);
  // The plan is consumed; resubmitting the same quote cannot broadcast again.
  await assert.rejects(
    ok.submit(quote),
    (e) => e instanceof BatchImportError && e.code === "quote_changed",
  );
  const remote = batch(async () => [], submitted);
  await remote.submit(planned(remote, [instance()], false));
  assert.equal(submitted.length, 2);
});

test("an empty or unverified selection is never quoted", async () => {
  const b = batch(async () => [], []);
  await assert.rejects(
    b.quote([], "r"),
    (e) => e instanceof BatchImportError && e.code === "none_selected",
  );
  await assert.rejects(
    b.quote(
      [
        {
          hostAddress: "0x4",
          bindingId: "0x5",
          instance: instance({ state: "unverified" }),
          local: true,
        },
      ],
      "r",
    ),
    (e) => e instanceof BatchImportError && e.code === "not_importable",
  );
});
