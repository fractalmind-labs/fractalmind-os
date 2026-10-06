import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDraft,
  scaledMetric,
  OkrDraftError,
  type DraftInput,
} from "../src/okr-draft";
const input = (): DraftInput => ({
  objective: "Improve measured quality",
  successCriteria:
    "All measurements and independent evidence meet the criteria",
  priority: 1,
  deadlineMs: String(Date.now() + 3600000),
  allowedPaths: ["src", "docs"],
  prohibitedActions: ["external network", "write outside project"],
  maxCalls: "20",
  krs: [
    {
      title: "Reduce failure rate",
      unit: "%",
      precision: 2,
      baseline: "12.50",
      target: "2.25",
      weight: "2",
      maxAgeMinutes: "5",
      verificationRule: "A separate verifier reviews fresh test evidence",
    },
  ],
});
test("fixed-point metrics are exact above Number precision and support decreasing targets without rounding", () => {
  assert.equal(scaledMetric("9007199254740993", 0), "9007199254740993");
  assert.equal(scaledMetric("12.50", 2), "1250");
  const spec = normalizeDraft(input());
  assert.equal(spec.krs[0].target, "225");
  assert.equal(spec.krs[0].scale, "100");
  assert.equal(spec.krs[0].maxAgeMs, "300000");
  assert.deepEqual(spec.constraints.allowedPaths, ["src", "docs"]);
  assert.equal(spec.constraints.budget.limit, "20");
  for (const value of [
    "1.005",
    "-1",
    "1e2",
    "01",
    "NaN",
    "18446744073709551616",
  ])
    assert.throws(() => scaledMetric(value, 2), OkrDraftError);
});
test("drafts require explicit complete result criteria, 1–3 measurable KRs and safe nonempty boundaries", () => {
  for (const mutate of [
    (v: DraftInput) => {
      v.objective = "";
    },
    (v: DraftInput) => {
      v.successCriteria = "";
    },
    (v: DraftInput) => {
      v.krs = [];
    },
    (v: DraftInput) => {
      v.krs = [...v.krs, ...v.krs, ...v.krs, ...v.krs];
    },
    (v: DraftInput) => {
      v.krs[0].target = v.krs[0].baseline;
    },
    (v: DraftInput) => {
      v.krs[0].verificationRule = "";
    },
    (v: DraftInput) => {
      v.krs[0].maxAgeMinutes = "43201";
    },
    (v: DraftInput) => {
      v.krs[0].weight = "0";
    },
    (v: DraftInput) => {
      v.allowedPaths = ["../secrets"];
    },
    (v: DraftInput) => {
      v.allowedPaths = ["/etc"];
    },
    (v: DraftInput) => {
      v.allowedPaths = ["C:\\Users"];
    },
    (v: DraftInput) => {
      v.allowedPaths = ["src", "src"];
    },
    (v: DraftInput) => {
      v.maxCalls = "0";
    },
    (v: DraftInput) => {
      v.prohibitedActions = [];
    },
    (v: DraftInput) => {
      v.priority = 3;
    },
  ]) {
    const v = input();
    mutate(v);
    assert.throws(() => normalizeDraft(v), OkrDraftError);
  }
});
