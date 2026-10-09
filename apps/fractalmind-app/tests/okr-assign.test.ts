import test from "node:test";
import assert from "node:assert/strict";
import {
  bytesToHex,
  MemoryTransactionJournal,
  type SelfPayFeeQuote,
} from "@fractalmind-labs/fractalmind-sdk";
import { Transaction } from "@mysten/sui/transactions";
import { toBase64 } from "@mysten/sui/utils";
import {
  AgentManagerAssignment,
  OkrAssignError,
  agentManagerBoundary,
  validateAgentManagerAgreement,
} from "../src/okr-assign";
import { deliveryTask } from "../src/okr-delivery";
import { draftInput, problems } from "../src/v2/pages/OkrNew";
import { normalizeDraft } from "../src/okr-draft";
import type { ChainReadSession } from "../src/chain";
import type { NativeDeviceSigner } from "../src/native-device";
import type { Okr } from "../src/domain";

const a = (n: string) => `0x${n.repeat(64)}`;
const ws = new Uint8Array(32).fill(7);
const assignedOkr = {
  id: a("1"),
  spec_record: a("9"),
  managed_agent: a("2"),
  managed_version: "1",
  membership_id: a("3"),
  workspace_hash: Array.from(ws),
  budget_asset: "TOOL_CALLS",
  budget_limit: "200",
  expires_at_ms: "5000",
  boundary_hash: Array.from(agentManagerBoundary(["."])),
} as unknown as Okr;
const agreement = {
  format: 1,
  kind: "agent-manager-v1",
  specRecordId: a("9"),
  managedAgentId: a("2"),
  managedVersion: "1",
  membershipId: a("3"),
  instanceId: "tmux-x",
  workspaceHash: bytesToHex(ws),
  allowedPaths: ["."],
  budget: { asset: "TOOL_CALLS", limit: "200" },
  expiresAtMs: "5000",
  enforced: ["deliver", "stop", "record_claimed"],
  notEnforced: ["tool_use", "model_spending"],
};

test("an agent-manager agreement must match its chain OKR exactly", () => {
  assert.equal(
    validateAgentManagerAgreement(agreement, assignedOkr).kind,
    "agent-manager-v1",
  );
  for (const change of [
    { kind: "bounded-process-v1" },
    { managedAgentId: a("8") },
    { allowedPaths: ["src"] },
    { budget: { asset: "TOOL_CALLS", limit: "201" } },
    { expiresAtMs: "5001" },
    { workspaceHash: bytesToHex(new Uint8Array(32)) },
  ])
    assert.throws(
      () =>
        validateAgentManagerAgreement({ ...agreement, ...change }, assignedOkr),
      OkrAssignError,
    );
  // The declared boundary is the file read/write boundary over those paths.
  assert.notEqual(
    bytesToHex(agentManagerBoundary(["."])),
    bytesToHex(agentManagerBoundary(["src"])),
  );
});

function fixture(
  over: {
    runtime?: string;
    control?: boolean;
    state?: number;
    active?: Partial<Okr>[];
  } = {},
) {
  const calls: string[] = [];
  const okr = {
    id: a("1"),
    org_id: a("5"),
    state: over.state ?? 0,
    version: "1",
    logical_id: "g",
    spec_record: a("9"),
    deadline_ms: "9000",
  };
  const managed = {
    id: a("2"),
    org_id: a("5"),
    revoked: false,
    control_confirmed: over.control ?? true,
    runtime: over.runtime ?? "agent-manager-v1",
    membership_id: a("3"),
    host_address: a("4"),
    workspace_hash: Array.from(ws),
    version: "1",
    instance_id: "tmux-x",
  };
  const sdk = {
    okr: {
      getOkr: async () => okr,
      listOkrs: async () => ({
        okrs: over.active ?? [],
        cursor: null,
        hasNextPage: false,
      }),
      isMissingIndex: () => false,
      assignAgentManager: (input: Record<string, unknown>) => {
        calls.push(
          `assign:${input.okrId}:${input.managedAgentId}:${input.budgetLimit}`,
        );
        return new Transaction();
      },
    },
    host: {
      getManagedAgent: async () => managed,
      getMembership: async () => ({
        id: a("3"),
        org_id: a("5"),
        revoked: false,
        host_address: a("4"),
        expires_at_ms: "99999",
        coordinator_binding: a("6"),
      }),
      getCoordinatorBinding: async () => ({
        id: a("6"),
        org_id: a("5"),
        revoked: false,
      }),
    },
    productRecord: {
      listCurrent: async () => ({
        keyVersion: "1",
        records: [],
        cursor: null,
        hasNextPage: false,
      }),
    },
    client: { client: {}, coreType: async () => "x" },
  };
  const chain = {
    sdk,
    profile: { network: "testnet", humanId: a("7") },
  } as unknown as ChainReadSession;
  const signer = {
    device: { profile: "testnet", address: a("8") },
    getPublicKey: () => null,
  } as unknown as NativeDeviceSigner;
  const invoke = async (command: string) => {
    calls.push(command);
    return toBase64(new Uint8Array([70, 77, 69, 49, ...new Array(40).fill(1)]));
  };
  const flow = new AgentManagerAssignment(
    chain,
    signer,
    a("a"),
    a("5"),
    invoke as never,
    new MemoryTransactionJournal(),
  );
  (flow as unknown as { verifier: unknown }).verifier = {
    verifyOrganization: async () => ({
      clockMs: 10n,
      authorityPin: "pin",
      encryptedKeys: [],
    }),
  };
  (flow.manager as unknown as Record<string, unknown>).query = async () =>
    undefined;
  (flow.manager as unknown as Record<string, unknown>).prepare = async (input: {
    requestId: string;
  }) =>
    ({
      requestId: input.requestId,
      estimatedGas: "1",
    }) as unknown as SelfPayFeeQuote;
  return { flow, calls };
}
const input = {
  okrId: a("1"),
  managedAgentId: a("2"),
  budgetLimit: "200",
  allowedPaths: ["."],
};

test("only a controllable agent-manager Agent without another active goal is assigned", async () => {
  const ok = fixture();
  const quote = await ok.flow.prepare(input);
  assert.equal((quote as SelfPayFeeQuote).requestId, `okr-assign:${a("1")}:1`);
  assert.deepEqual(ok.calls, [
    "fm_device_encrypt_record",
    `assign:${a("1")}:${a("2")}:200`,
  ]);
  const refused = async (f: ReturnType<typeof fixture>, code: string) =>
    assert.rejects(
      f.flow.prepare(input),
      (e) => e instanceof OkrAssignError && e.code === code,
    );
  await refused(
    fixture({ runtime: "bounded-process-v1" }),
    "agent_not_controllable",
  );
  await refused(fixture({ control: false }), "agent_not_controllable");
  await refused(fixture({ state: 1 }), "not_assignable");
  await refused(
    fixture({ active: [{ id: a("e"), state: 1, managed_agent: a("2") }] }),
    "agent_busy",
  );
  await refused(
    fixture({
      active: [1, 2, 3].map((n) => ({
        id: a(String(n)),
        state: 1,
        managed_agent: a("f"),
      })),
    }),
    "active_limit",
  );
  await assert.rejects(
    ok.flow.prepare({ ...input, budgetLimit: "0" }),
    (e) => e instanceof OkrAssignError && e.code === "invalid_input",
  );
});

test("the delivery task points the Agent at the written file", () => {
  const task = deliveryTask({
    objective: "Ship v1",
    deadlineMs: String(Date.UTC(2026, 10, 1)),
    okrId: a("1"),
  });
  assert.match(task, /\{OKR_PATH\}/);
  assert.match(task, /Objective: Ship v1/);
  assert.match(task, /2026-11-01/);
  assert.match(task, /Agent-claimed/);
});

test("the wizard form becomes a draft the chain spec accepts", () => {
  const t = (zh: string) => zh;
  const form = {
    logicalId: "00000000-0000-4000-8000-000000000000",
    step: 5,
    objective: "让周报一键生成",
    priority: 1 as const,
    days: "30",
    agentId: "",
    criteria: ["成功率 ≥ 95%", ""],
    krs: [
      {
        title: "成功率",
        baseline: "80",
        target: "95.5",
        unit: "%",
        weight: "1",
        verify: "user" as const,
      },
    ],
    maxCalls: "200",
    paths: ".\nsrc",
    escalate: [true, false, true, true],
  };
  assert.deepEqual(problems(form), {});
  const draft = draftInput(form, t, 1_000);
  assert.equal(draft.deadlineMs, String(1_000 + 30 * 86_400_000));
  assert.equal(draft.krs[0].precision, 1);
  assert.deepEqual(draft.allowedPaths, [".", "src"]);
  assert.equal(draft.prohibitedActions.length, 3);
  assert.equal(draft.successCriteria, "成功率 ≥ 95%");
  assert.equal(normalizeDraft(draft).krs[0].target, "955");
  const bad = problems({
    ...form,
    objective: " ",
    criteria: ["没有数字"],
    krs: [{ ...form.krs[0], target: "80" }],
    escalate: [false, false, false, false],
  });
  assert.deepEqual(Object.keys(bad).sort(), [
    "criteria",
    "escalate",
    "kr0.metric",
    "objective",
  ]);
});

test("an Agent's OKR proposal fills the wizard but stays unsubmitted until reviewed", async () => {
  const { parseOkrProposal, OkrProposalError } =
    await import("../src/okr-proposal");
  const { formFromProposal } = await import("../src/v2/pages/OkrNew");
  const now = 1_000_000;
  const text = JSON.stringify({
    schema: "fractalmind.okr-proposal.v1",
    objective: "Validate the strategy in simulation",
    successCriteria: ["≥ 1000 settled markets", "Net profit after fees > 0"],
    priority: 0,
    deadlineMs: String(now + 10 * 86_400_000),
    krs: [
      {
        title: "Settled markets",
        unit: "markets",
        baseline: "0",
        target: "1000",
        weight: "2",
      },
    ],
    allowedPaths: ["experiments", "output"],
    prohibitedActions: ["No real funds or wallet signatures"],
    maxCalls: "500",
    source: "OKR.md",
  });
  const p = parseOkrProposal(text, now);
  assert.equal(p.krs[0].verify, "user");
  const base = {
    logicalId: "x",
    step: 3,
    objective: "",
    priority: 1 as const,
    days: "30",
    agentId: "a",
    criteria: [""],
    krs: [],
    maxCalls: "200",
    paths: ".",
    escalate: [true, true, true, true],
  };
  const f = formFromProposal(p, base, "burry", now);
  assert.equal(f.step, 1);
  assert.equal(f.agentId, "a");
  assert.equal(f.days, "10");
  assert.equal(f.paths, "experiments\noutput");
  assert.deepEqual(f.escalate, [false, false, false, false]);
  const draft = draftInput(f, (zh: string) => zh, now);
  assert.equal(draft.deadlineMs, String(now + 10 * 86_400_000));
  assert.deepEqual(draft.prohibitedActions, [
    "No real funds or wallet signatures",
  ]);
  assert.deepEqual(problems(f, now), {});
  // Wrong schema, past deadline, non-numeric target or too many KRs are refused.
  const bad = (patch: object) =>
    assert.throws(
      () =>
        parseOkrProposal(
          JSON.stringify({ ...JSON.parse(text), ...patch }),
          now,
        ),
      OkrProposalError,
    );
  bad({ schema: "other" });
  bad({ deadlineMs: String(now - 1) });
  bad({ krs: [{ title: "x", baseline: "0", target: "lots" }] });
  bad({
    krs: [1, 2, 3, 4].map(() => ({ title: "x", baseline: "0", target: "1" })),
  });
});

test("a paused goal tells its Agent to stop", async () => {
  const { stopTask } = await import("../src/okr-delivery");
  const task = stopTask({
    objective: "Beat the market",
    okrId: a("1"),
    state: "PAUSED",
  });
  assert.match(task, /paused this goal: stop working on it now/);
  assert.match(task, /\{OKR_PATH\}/);
  assert.match(
    stopTask({ objective: "x", okrId: a("1"), state: "ARCHIVED" }),
    /archived this goal/,
  );
});
