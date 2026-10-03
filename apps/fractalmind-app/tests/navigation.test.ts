import test from "node:test";
import assert from "node:assert/strict";
import { navigation, clockNow, memberStatus } from "../src/domain";
import type {
  OkrSnapshot,
  OrganizationSnapshot,
  Membership,
  Agent,
  Binding,
  Okr,
  Execution,
} from "../src/domain";

function fixture() {
  const metric = {
    baseline: "0",
    target: "10",
    weight: "1",
    max_age_ms: "1000",
    current: "10",
    sampled_at_ms: "1000",
    run_id: "run-one",
    evidence_id: "evidence-one",
    verified: false,
    verification_id: null,
  };
  const okr = {
    id: "okr-one",
    org_id: "org-one",
    state: 1,
    metrics: [metric],
    next_kr: "0",
    agreement_version: "2",
    budget_limit: "20",
    budget_asset: "TOOL_CALLS",
    expires_at_ms: "10000",
    membership_id: "host-one",
    membership_version: "2",
    managed_agent: "agent-one",
    managed_version: "3",
    acceptance_record: null,
    accepted_by_human: null,
  } as unknown as Okr;
  const member = {
    id: "host-one",
    org_id: "org-one",
    host_address: "host-key",
    coordinator_binding: "binding-one",
    version: "2",
    revoked: false,
    expires_at_ms: "10000",
  } as Membership;
  const agent = {
    id: "agent-one",
    membership_id: member.id,
    host_address: member.host_address,
    version: "3",
    revoked: false,
  } as Agent;
  const binding = { id: "binding-one", revoked: false } as Binding;
  const focus: OkrSnapshot = {
    okr,
    budget: { value: { asset: "TOOL_CALLS", spent: 2n, reserved: 0n } },
    executions: { value: [] },
    observations: { value: [] },
  };
  const snapshot = {
    organization: { isActive: true, objectId: "org-one" },
    clockMs: 1000n,
    loadedAtMs: 1000,
    memberships: { value: [member] },
    agents: { value: [agent] },
    bindings: { value: [binding] },
    okrs: { value: [focus] },
  } as OrganizationSnapshot;
  const run = (state: number, reserved = true) =>
    ({
      run: {
        id: "run-one",
        state,
        updated_at_ms: "1000",
        expires_at_ms: "10000",
        stop_requested: false,
      },
      claim: { settled: !reserved },
      contract: { agreement_version: "2", kr_index: "0" },
    }) as unknown as Execution;
  return {
    metric,
    focus,
    snapshot,
    member,
    agent,
    run,
    nav: (now = 1000n, reachable = true) =>
      navigation(focus, snapshot, now, reachable),
  };
}

test("measured target does not move a verified checkpoint or accept an OKR", () => {
  const f = fixture(),
    result = f.nav();
  assert.equal(result.progress, 1);
  assert.equal(result.verifiedCheckpoints, 0);
  assert.equal(result.condition, "verification");
  f.metric.verified = true;
  f.focus.okr.next_kr = "1";
  assert.equal(f.nav().condition, "acceptance");
  assert.equal(f.nav().verifiedCheckpoints, 1);
  f.focus.okr.state = 3;
  f.focus.okr.acceptance_record = "acceptance-one";
  f.focus.okr.accepted_by_human = "human-one";
  assert.equal(f.nav().condition, "achieved");
});

test("old/future observations and failed reads remain unknown instead of advancing", () => {
  const f = fixture();
  f.focus.executions.value = [f.run(2, false)];
  assert.equal(f.nav(2001n).condition, "unknown");
  assert.equal(f.nav(999n).progress, null);
  f.focus.budget = { value: null, failure: "unavailable" };
  assert.equal(f.nav().reason, "run_or_budget_not_readable");
  assert.equal(f.nav(1000n, false).reason, "rpc_unavailable");
});

test("unknown outcomes retain a query-first state and budget reservations", () => {
  const f = fixture();
  f.focus.executions.value = [f.run(4)];
  f.focus.budget.value!.reserved = 18n;
  assert.equal(f.nav().condition, "unknown");
  assert.equal(f.nav().reason, "execution_outcome_unknown");
  assert.equal(f.focus.budget.value!.reserved, 18n);
});

test("a current Run can use its existing reservation when no new budget remains", () => {
  const f = fixture();
  f.focus.executions.value = [f.run(1)];
  f.focus.budget.value!.reserved = 18n;
  assert.equal(f.nav().condition, "running");
  f.focus.executions.value![0].run.stop_requested = true;
  assert.equal(f.nav().reason, "stop_requested_not_confirmed");
  f.focus.executions.value = [];
  f.metric.current = "5";
  assert.equal(f.nav().condition, "budget");
});

test("authority and goal direction are separate; revoked, expired or changed bindings cannot look valid", () => {
  const f = fixture();
  f.metric.current = "5";
  assert.equal(f.nav().boundary, "valid");
  assert.equal(f.nav().condition, "ready");
  f.member.revoked = true;
  assert.equal(f.nav().boundary, "invalid");
  assert.equal(f.nav().condition, "permission");
  f.member.revoked = false;
  f.agent.version = "4";
  assert.equal(f.nav().condition, "permission");
  assert.equal(
    memberStatus({ ...f.member, expires_at_ms: "1000" }, 1000n),
    "expired",
  );
  assert.equal(f.nav(10000n).condition, "expired");
});

test("historical agreement Runs never become the current position; competing in-flight Runs are ambiguous", () => {
  const f = fixture();
  f.metric.current = "5";
  const old = f.run(1);
  old.contract.agreement_version = "1";
  f.focus.executions.value = [old];
  assert.equal(f.nav().latest, undefined);
  f.focus.executions.value = [f.run(1), f.run(0)];
  assert.equal(f.nav().reason, "multiple_unsettled_runs");
});

test("Clock-based freshness ages even if the same cached snapshot stays open", () => {
  const f = fixture();
  assert.equal(clockNow(f.snapshot, 1500), 1500n);
  assert.equal(clockNow(f.snapshot, 999), 1000n);
  assert.equal(f.nav(clockNow(f.snapshot, 2001)).progress, null);
  f.snapshot.memberships = { value: null, failure: "unavailable" };
  assert.equal(f.nav().boundary, "unknown");
});

test("expiry and replanning do not resolve unknown side effects from an earlier agreement", () => {
  const f = fixture();
  const pending = f.run(4);
  pending.contract.agreement_version = "1";
  f.focus.executions.value = [pending];
  const result = f.nav(10000n);
  assert.equal(result.condition, "unknown");
  assert.equal(result.reason, "execution_outcome_unknown");
  assert.equal(result.boundary, "invalid");
  assert.equal(result.latest!.run.id, pending.run.id);
});

test("v2 decision inbox keeps unknown side effects ahead of budget or verification", async () => {
  const { decisionFacts } = await import("../src/v2-model");
  const f = fixture();
  f.focus.executions.value = [f.run(4)];
  f.focus.budget.value!.reserved = 18n;
  const facts = decisionFacts(f.snapshot, 1000n, true);
  assert.equal(facts.unavailable, null);
  assert.equal(facts.items.length, 1);
  assert.equal(facts.items[0].nav.reason, "execution_outcome_unknown");
  assert.equal(f.focus.budget.value!.reserved, 18n);
  assert.equal(
    decisionFacts(f.snapshot, 1000n, false).unavailable,
    "connection",
  );
  f.snapshot.okrs.value = null;
  assert.equal(decisionFacts(f.snapshot, 1000n, true).unavailable, "okrs");
});

test("v2 trust ladder separates fresh measurements, historical verification and independent acceptance", async () => {
  const { trustState } = await import("../src/v2-model");
  const f = fixture();
  assert.deepEqual(trustState(f.focus.okr, 0, 1000n), {
    level: "measured",
    stale: false,
  });
  assert.deepEqual(trustState(f.focus.okr, 0, 2001n), {
    level: null,
    stale: true,
  });
  assert.deepEqual(trustState(f.focus.okr, 0, 999n), {
    level: null,
    stale: true,
  });
  f.metric.verified = true;
  assert.deepEqual(trustState(f.focus.okr, 0, 2001n), {
    level: "verified",
    stale: true,
  });
  f.focus.okr.state = 3;
  assert.equal(trustState(f.focus.okr, 0, 1000n).level, "verified");
  f.focus.okr.acceptance_record = "acceptance";
  assert.equal(trustState(f.focus.okr, 0, 1000n).level, "verified");
  f.focus.okr.accepted_by_human = "human";
  assert.equal(trustState(f.focus.okr, 0, 1000n).level, "accepted");
  f.metric.current = null as unknown as string;
  f.metric.verified = false;
  f.focus.okr.state = 1;
  assert.deepEqual(trustState(f.focus.okr, 0, 1000n), {
    level: null,
    stale: false,
  });
});
