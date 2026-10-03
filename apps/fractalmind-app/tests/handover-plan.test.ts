import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSuiAddress as id } from "@mysten/sui/utils";
import type {
  HandoverProposal,
  NativeFileOkrPlan,
} from "@fractalmind-labs/fractalmind-sdk";
import { normalizeDraft } from "../src/okr-draft";
import {
  parseOkrSpecification,
  validateHandoverPlan,
} from "../src/handover-plan";

function fixture() {
  const spec = normalizeDraft({
    objective: "Publish documentation",
    successCriteria: "Human reviews both files",
    priority: 1,
    deadlineMs: String(Date.now() + 3600000),
    allowedPaths: ["docs"],
    prohibitedActions: ["external network", "write outside project"],
    maxCalls: "9",
    krs: ["Readme", "Example"].map((title) => ({
      title,
      unit: "files",
      precision: 0,
      baseline: "0",
      target: "1",
      weight: "1",
      maxAgeMinutes: "5",
      verificationRule: "Check original file evidence",
    })),
  });
  const plan: NativeFileOkrPlan = {
    format: 1,
    paths: { "file.read": ["docs"], "file.write": ["docs"] },
    krs: [
      {
        files: [{ path: "docs/README.md", content: "Reviewed" }],
        maxCalls: "3",
      },
      {
        files: [{ path: "docs/EXAMPLE.md", content: "Example" }],
        maxCalls: "3",
      },
    ],
  };
  const proposal: HandoverProposal = {
    version: "1",
    managed_agent_id: id("0x1"),
    managed_version: "1",
    okr_id: id("0x2"),
    okr_version: "1",
    spec_revision: "1",
    workspace_hash: "aa".repeat(32),
    paths: structuredClone(plan.paths),
    budget_asset: "TOOL_CALLS",
    budget_limit: "9",
    max_calls: "3",
    expires_at_ms: Date.now() + 120000,
    nonce: "bb".repeat(32),
    review_expires_at_ms: Date.now() + 50000,
  };
  return { spec, plan, proposal };
}
test("native plan matches normalized encrypted spec and exact Host boundary, with independent human rules retained", () => {
  const f = fixture();
  const result = validateHandoverPlan(f.spec, f.plan, f.proposal);
  assert.deepEqual(result.spec, f.spec);
  assert.deepEqual(result.plan, f.plan);
  f.plan.krs[0].files[0].content = "caller mutation";
  assert.equal(result.plan.krs[0].files[0].content, "Reviewed");
  const decimal = structuredClone(f.spec);
  decimal.krs[0] = {
    ...decimal.krs[0],
    precision: 2,
    scale: "100",
    baseline: "1250",
    target: "225",
  };
  assert.deepEqual(parseOkrSpecification(decimal), decimal);
});
test("reject path prefix escapes, different review bounds, metric drift, overspend and unsupported prose", () => {
  const mutations: Array<(f: ReturnType<typeof fixture>) => void> = [
    (f) => {
      f.plan.krs[0].files[0].path = "docs-other/README.md";
    },
    (f) => {
      f.plan.paths["file.write"] = ["."];
      f.proposal.paths = structuredClone(f.plan.paths);
    },
    (f) => {
      f.proposal.paths["file.read"] = ["docs/subdir"];
    },
    (f) => {
      f.spec.krs[0].target = "2";
    },
    (f) => {
      f.spec.krs[0].baseline = "1";
      f.spec.krs[0].target = "2";
    },
    (f) => {
      f.proposal.budget_limit = "10";
    },
    (f) => {
      f.plan.krs[0].maxCalls = "4";
    },
    (f) => {
      f.proposal.budget_limit = "5";
    },
    (f) => {
      f.spec.constraints.prohibitedActions.push("file.write");
    },
    (f) => {
      f.spec.constraints.prohibitedActions.push("don't change important files");
    },
    (f) => {
      (f.spec as any).schema = "fractalmind.okr-spec.v2";
    },
    (f) => {
      (f.spec as any).unrecognized = true;
    },
    (f) => {
      f.spec.krs[0].scale = "100";
    },
    (f) => {
      f.spec.krs[0].maxAgeMs = "60001";
    },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateHandoverPlan(f.spec, f.plan, f.proposal));
  }
});
