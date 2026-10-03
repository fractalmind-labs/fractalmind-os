import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSuiAddress as id } from "@mysten/sui/utils";
import {
  OkrBcs,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { normalizeDraft } from "../src/okr-draft";
import {
  OkrIntervention,
  specificationDraft,
  type OkrInterventionView,
} from "../src/okr-intervention";
import {
  OkrProjection,
  OkrProjectionError,
  parseOkrProjection,
  projectionMetricStatus,
  renderOkrProjection,
} from "../src/okr-projection";

// Projection/source race fixture, not OS/chain/Host proof. The separate native
// localnet scenario exercises the authoritative reader and signed replacement.
function fixture() {
  const spec = normalizeDraft({
    objective: "Deliver a independently checked outcome",
    successCriteria: "Human accepts original evidence",
    deadlineMs: String(Date.now() + 7200000),
    priority: 1,
    allowedPaths: ["docs"],
    prohibitedActions: ["network.*"],
    maxCalls: "10",
    krs: [
      {
        title: "Measured result",
        unit: "count",
        precision: 2,
        baseline: "0.00",
        target: "1.00",
        weight: "1",
        maxAgeMinutes: "60",
        verificationRule: "Check the original source",
      },
    ],
  });
  const okr = OkrBcs.parse(
    OkrBcs.serialize({
      id: id("4"),
      org_id: id("1"),
      owner_human: id("2"),
      logical_id: "test-projection",
      state: 0,
      version: "1",
      agreement_version: "0",
      priority: 1,
      deadline_ms: spec.deadlineMs,
      spec_record: id("5"),
      spec_revision: "1",
      metrics: spec.krs.map((k) => ({
        baseline: k.baseline,
        target: k.target,
        weight: k.weight,
        max_age_ms: k.maxAgeMs,
        current: null,
        sampled_at_ms: "0",
        run_id: null,
        evidence_id: null,
        verified: false,
        verification_id: null,
      })),
      next_kr: "0",
      observations: { id: id("6"), size: "0" },
      managed_agent: null,
      managed_version: "0",
      membership_id: null,
      membership_version: "0",
      workspace_hash: [],
      boundary_hash: [],
      budget_asset: "",
      budget_limit: "0",
      expires_at_ms: "0",
      activated_at_ms: "0",
      agreement_record: null,
      acceptance_record: null,
      accepted_by_human: null,
      accepted_at_ms: "0",
    }).toBytes(),
  );
  const source: OkrInterventionView = {
    okr,
    spec,
    executions: [],
    budget: null,
    actions: ["read", "approve"],
    authorityExpiresAtMs: String(Date.now() + 3600000),
    agreementBody: null,
    provenance: {
      network: "localnet",
      chainIdentifier: "test-chain",
      originalPackageId: id("a"),
      originalOkrPackageId: id("b"),
      organizationId: id("1"),
      humanId: id("2"),
      okrId: id("4"),
      sourceVersion: "1",
      agreementVersion: "0",
      specRecordId: id("5"),
      specRevision: "1",
      agreementRecordId: null,
      agreementRevision: null,
      keyVersion: "1",
      chainReadAtMs: "10000000",
    },
  };
  let reads = 0,
    quotes = 0,
    submits = 0,
    live = true;
  let onRead = async () => {},
    onPrepare = () => {},
    prior: SelfPayTransactionOutcome | undefined;
  const assertLive = () => {
    if (!live) throw new OkrProjectionError("state_changed");
  };
  const intervention = {
    okrId: okr.id,
    read: async (options: any) => {
      assertLive();
      assert.equal(options.includeAgreement, true);
      reads++;
      const v = structuredClone(source);
      await onRead();
      assertLive();
      return v;
    },
    assertCurrentRead: async () => {
      assertLive();
    },
    query: async () => {
      assertLive();
      return prior;
    },
    prepare: async (intent: any, input: any) => {
      assertLive();
      quotes++;
      assert.equal(intent.kind, "replace");
      assert.equal(input.reviewed, true);
      assert.equal(intent.expectedVersion, source.okr.version);
      onPrepare();
      return { requestId: "original-proposal" } as any;
    },
    submit: async () => {
      assertLive();
      submits++;
      return {
        status: "unknown",
        requestId: "original-proposal",
        digest: "original",
      } as SelfPayTransactionOutcome;
    },
  } as unknown as OkrIntervention;
  const controller = new OkrProjection(intervention, assertLive);
  return {
    source,
    controller,
    counts: () => ({ reads, quotes, submits }),
    change: () => {
      source.okr.version = "2";
      source.provenance.sourceVersion = "2";
    },
    close: () => {
      live = false;
    },
    onRead: (fn: () => Promise<void>) => {
      onRead = fn;
    },
    onPrepare: (fn: () => void) => {
      onPrepare = fn;
    },
    setPrior: (value: SelfPayTransactionOutcome) => {
      prior = value;
    },
  };
}
async function changed(f: ReturnType<typeof fixture>) {
  const view = await f.controller.read(),
    proposal = specificationDraft(view.snapshot.specification);
  proposal.successCriteria =
    "Review all original immutable evidence, then accept";
  return f.controller.review(renderOkrProjection(view.snapshot, proposal));
}
test("projection preserves complete provenance, exact fixed-point values and unknown samples without a quote", async () => {
  const f = fixture(),
    v = await f.controller.read();
  const parsed = parseOkrProjection(v.text);
  assert.deepEqual(parsed.snapshot, v.snapshot);
  assert.equal(parsed.snapshot.provenance.organizationId, id("1"));
  assert.equal(parsed.snapshot.specification.krs[0].target, "100");
  assert.equal(parsed.proposal.krs[0].target, "1.00");
  assert.equal(parsed.snapshot.metrics[0].current, null);
  assert.equal(
    projectionMetricStatus(parsed.snapshot.metrics[0], "10000000"),
    "unknown",
  );
  assert.equal(f.counts().quotes, 0);
  assert.equal(f.counts().submits, 0);
});
test("local proposal is unsubmitted, lists exact differences, and requires independent confirmation before quotation", async () => {
  const f = fixture(),
    v = await f.controller.read(),
    clean = await f.controller.review(v.text);
  assert.equal(clean.status, "CLEAN");
  await assert.rejects(f.controller.prepare(clean, { reviewed: true }), {
    code: "unchanged_proposal",
  });
  const review = await changed(f);
  assert.equal(review.status, "UNSUBMITTED");
  assert.deepEqual(
    review.changes.map((c) => c.field),
    ["successCriteria"],
  );
  await assert.rejects(f.controller.prepare(review, { reviewed: false }), {
    code: "confirmation_required",
  });
  assert.equal(f.counts().quotes, 0);
  assert.equal(
    f.source.spec.successCriteria,
    "Human accepts original evidence",
  );
  const quote = await f.controller.prepare(review, { reviewed: true });
  assert.ok(!("status" in quote));
  assert.equal(f.counts().quotes, 1);
  assert.equal(f.counts().submits, 0);
  const outcome = await f.controller.submit(quote);
  assert.equal(outcome.status, "unknown");
  assert.equal(f.counts().submits, 1);
});
test("Windows line endings and JSON formatting do not change proposal meaning", async () => {
  const f = fixture(),
    v = await f.controller.read(),
    parsed = parseOkrProjection(v.text);
  const pretty = JSON.stringify(parsed.proposal, null, 2),
    compact = JSON.stringify({
      ...parsed.proposal,
      objective: "A new objective",
    });
  const text = v.text.replace(pretty, compact).replaceAll("\n", "\r\n");
  const review = await f.controller.review(text);
  assert.equal(review.status, "UNSUBMITTED");
  assert.deepEqual(
    review.changes.map((c) => c.field),
    ["objective"],
  );
  assert.equal(f.counts().quotes, 0);
});
test("read-only provenance, metric verification, budget, extra prose and unknown proposal fields cannot be submitted", async (t) => {
  for (const mode of [
    "organization",
    "version",
    "verified",
    "budget",
    "prose",
    "extra",
  ] as const)
    await t.test(mode, async () => {
      const f = fixture(),
        v = await f.controller.read(),
        snapshot = structuredClone(v.snapshot);
      if (mode === "organization") snapshot.provenance.organizationId = id("9");
      if (mode === "version") snapshot.provenance.sourceVersion = "9";
      if (mode === "verified") snapshot.metrics[0].verified = true;
      if (mode === "budget")
        snapshot.budget = {
          asset: "TOOL_CALLS",
          limit: "1000",
          spent: "0",
          reserved: "0",
        };
      let text = renderOkrProjection(snapshot);
      if (mode === "prose")
        text = text.replace("not execution authority", "execution authority");
      if (mode === "extra")
        text = renderOkrProjection(snapshot, {
          ...specificationDraft(snapshot.specification),
          verified: true,
        } as any);
      await assert.rejects(f.controller.review(text), OkrProjectionError);
      assert.equal(f.counts().quotes, 0);
      assert.equal(f.counts().submits, 0);
    });
});
test("export requires an approved plaintext destination and rejects a changed source", async () => {
  const f = fixture(),
    v = await f.controller.read();
  await assert.rejects(f.controller.export(v, { reviewed: false }), {
    code: "confirmation_required",
  });
  assert.equal(
    (await f.controller.export(v, { reviewed: true })).name,
    "OKR.md",
  );
  f.change();
  await assert.rejects(f.controller.export(v, { reviewed: true }), {
    code: "state_changed",
  });
  assert.equal(f.counts().submits, 0);
});
test("stale versions and execution/budget changes reject import, quotation and late submission", async (t) => {
  for (const mode of [
    "import",
    "prepare",
    "quote",
    "submit",
    "budget",
  ] as const)
    await t.test(mode, async () => {
      const f = fixture(),
        v = await f.controller.read();
      if (mode === "import") {
        f.change();
        await assert.rejects(f.controller.review(v.text), {
          code: "state_changed",
        });
        return;
      }
      const review = await changed(f);
      if (mode === "prepare") {
        f.change();
        await assert.rejects(f.controller.prepare(review, { reviewed: true }), {
          code: "state_changed",
        });
      }
      if (mode === "quote") {
        f.onPrepare(f.change);
        await assert.rejects(f.controller.prepare(review, { reviewed: true }), {
          code: "state_changed",
        });
      }
      if (mode === "submit" || mode === "budget") {
        const quote = await f.controller.prepare(review, { reviewed: true });
        assert.ok(!("status" in quote));
        if (mode === "submit") f.change();
        else
          f.source.budget = {
            asset: "TOOL_CALLS",
            spent: 2n,
            reserved: 1n,
            claimsId: id("8"),
          };
        await assert.rejects(f.controller.submit(quote), {
          code: "state_changed",
        });
      }
      assert.equal(f.counts().submits, 0);
    });
});
test("a local ACTIVE proposal needs pause; file edits cannot resume or accept a goal", async () => {
  const f = fixture();
  f.source.okr.state = 1;
  const review = await changed(f);
  await assert.rejects(f.controller.prepare(review, { reviewed: true }), {
    code: "pause_required",
  });
  assert.equal(f.source.okr.state, 1);
  assert.equal(f.counts().quotes, 0);
});
test("a retained original unknown request is queried without creating a new quote", async () => {
  const f = fixture(),
    review = await changed(f);
  const reads = f.counts().reads;
  f.setPrior({
    status: "unknown",
    requestId: "original",
    digest: "retained",
    journalSynced: true,
  });
  f.change();
  const outcome = await f.controller.prepare(review, { reviewed: false });
  assert.ok("status" in outcome);
  assert.equal(outcome.digest, "retained");
  assert.equal(f.counts().reads, reads);
  assert.equal(f.counts().quotes, 0);
});
test("closing during native source reads prevents late private context or export", async () => {
  const f = fixture();
  f.onRead(async () => f.close());
  await assert.rejects(f.controller.read(), { code: "state_changed" });
  assert.equal(f.counts().quotes, 0);
});
test("sampling freshness retains original evidence and never rounds large u64 values", () => {
  const metric = fixture().source.okr.metrics[0];
  metric.current = "9007199254740993";
  metric.sampled_at_ms = "10000000";
  metric.run_id = id("7");
  metric.evidence_id = id("8");
  assert.equal(
    projectionMetricStatus(metric, "10000001"),
    "measured_unverified",
  );
  metric.verified = true;
  assert.equal(projectionMetricStatus(metric, "10000001"), "human_verified");
  assert.equal(projectionMetricStatus(metric, "20000000"), "stale");
  assert.equal(projectionMetricStatus(metric, "9999999"), "stale");
  assert.equal(metric.current, "9007199254740993");
  assert.equal(metric.evidence_id, id("8"));
  assert.equal(metric.verified, true);
});
