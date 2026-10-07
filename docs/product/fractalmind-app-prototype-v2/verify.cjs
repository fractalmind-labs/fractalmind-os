#!/usr/bin/env node
/* Regression checks for the prototype v2 domain model and demo fixtures.
 * Run from the repository root: node docs/product/fractalmind-app-prototype-v2/verify.cjs
 * These validate the simulation's rules, not deployed contracts or runtimes. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('./js/model.js');
const F = require('./js/fixtures.js');

const { MIN, HOUR, DAY } = M;
const T0 = Date.UTC(2026, 8, 29, 8, 0, 0);
let failures = 0;
let passed = 0;
const groups = new Map();

function check(group, name, fn) {
  try {
    fn();
    passed++;
    groups.set(group, (groups.get(group) || 0) + 1);
  } catch (err) {
    failures++;
    console.error(`✗ ${group} › ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n  ') : err}`);
  }
}

const fresh = () => F.createDemoProfile(T0, M);
const personal = p => p.data[F.P];
const okrOf = (p, id, orgId) => M.find(p.data[orgId || F.P].okrs, id);
const krOf = (okr, id) => M.find(okr.krs, id);
const ctxFor = (p, deviceId, action, orgId, now) => Object.assign(M.can(p, deviceId, orgId || F.P, action, now || T0), { deviceId });
const approve = (p, id, decision, now, orgId) => M.decide(p, p.data[orgId || F.P], id, decision, ctxFor(p, 'dev-mbp', 'approve', orgId, now), now);
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/* -------------------------------------------------- Achievement (§8.1) */

check('achievement', 'increasing metric', () => {
  near(M.krProgress({ metric: { baseline: 40, current: 82, target: 95 } }), 42 / 55);
});
check('achievement', 'decreasing metric uses the same formula', () => {
  near(M.krProgress({ metric: { baseline: 900, current: 450, target: 300 } }), 0.75);
});
check('achievement', 'overshoot and regression are clamped', () => {
  assert.equal(M.krProgress({ metric: { baseline: 900, current: 250, target: 300 } }), 1);
  assert.equal(M.krProgress({ metric: { baseline: 40, current: 120, target: 95 } }), 1);
  assert.equal(M.krProgress({ metric: { baseline: 40, current: 20, target: 95 } }), 0);
});
check('achievement', 'baseline equal to target is invalid, not 0% or 100%', () => {
  assert.equal(M.krProgress({ metric: { baseline: 5, current: 5, target: 5 } }), null);
});
check('achievement', 'weights are normalized', () => {
  const mk = w => ({ krs: [0.2, 0.6, 1].map((v, i) => ({ id: `k${i}`, weight: w[i], metric: { baseline: 0, target: 10, current: v * 10 } })) });
  near(M.achievement(mk([1, 1, 2]), T0).value, M.achievement(mk([25, 25, 50]), T0).value);
  near(M.achievement(mk([1, 1, 2]), T0).value, (0.2 + 0.6 + 2) / 4);
});
check('achievement', 'binary results count only when verified', () => {
  assert.equal(M.krProgress({ binary: { verified: false } }), 0);
  assert.equal(M.krProgress({ binary: { verified: true } }), 1);
});
check('achievement', 'fixture values: 61%, 35%, 24% with unknowns flagged', () => {
  const p = fresh();
  near(M.achievement(okrOf(p, 'okr-alpha'), T0).value, 0.3 + 0.4 * (42 / 55));
  near(M.achievement(okrOf(p, 'okr-mobile'), T0).value, 0.5 * (12 / 39) + 0.5 * (2.8 / 7));
  const mem = M.achievement(okrOf(p, 'okr-memory'), T0);
  near(mem.value, 0.24);
  assert.deepEqual(mem.unknown, ['kr1', 'kr2'], 'stale and missing KRs are unknown, not 0%');
});

/* ------------------------------------------- Completion is not 100% */

check('completion', 'target reached without verified evidence does not complete', () => {
  const okr = { id: 'o', krs: [{ id: 'k', deps: [], verifyBy: 'preauthorized', metric: { baseline: 0, current: 10, target: 10 }, verification: { state: 'passed' } }] };
  const res = M.completeKr(okr, okr.krs[0], [], T0);
  assert.equal(res.ok, false);
  assert.ok(res.blockers.includes('no_verified_evidence'));
});
check('completion', 'verified but not accepted stays in progress', () => {
  const p = fresh();
  const okr = okrOf(p, 'okr-alpha');
  const kr1 = krOf(okr, 'kr1');
  assert.equal(M.krProgress(kr1), 1);
  assert.deepEqual(M.krBlockers(okr, kr1, personal(p).evidence, T0), ['not_accepted']);
  assert.equal(M.krTrust(kr1), 'verified');
});
check('completion', 'dependencies unlock only after verification completes', () => {
  const p = fresh();
  const okr = okrOf(p, 'okr-alpha');
  assert.equal(krOf(okr, 'kr3').status, 'PENDING');
  assert.equal(approve(p, 'apv-kr1-accept', 'approve', T0).ok, true);
  assert.equal(krOf(okr, 'kr1').status, 'COMPLETE');
  assert.equal(krOf(okr, 'kr3').status, 'PENDING', 'kr2 is still incomplete');
  assert.equal(M.krTrust(krOf(okr, 'kr1')), 'accepted');
});

/* ------------------------------------------------------ Draft quality */

const goodDraft = () => ({
  title: '让发布流程可重复', priority: 'P1', ownerAgentId: 'agent-builder',
  criteria: ['三平台发布成功率 ≥ 95%'],
  krs: [{ id: 'kr1', title: '发布成功率', baseline: 60, target: 95, weight: 1, deps: [], criterion: 0 }],
  constraints: { workspaceId: 'ws-app', budget: 20, deadline: new Date(T0 + 10 * DAY).toISOString(), verification: 'Reviewer 复核' },
});
check('draft', 'a complete draft passes', () => assert.equal(M.validateDraft(goodDraft(), T0).ok, true));
check('draft', 'success criteria must be quantified', () => {
  const d = goodDraft(); d.criteria = ['发布更稳定'];
  assert.ok(M.validateDraft(d, T0).errors.some(e => e.code === 'quantified'));
});
check('draft', 'baseline equal to target is rejected', () => {
  const d = goodDraft(); d.krs[0].target = 60;
  assert.ok(M.validateDraft(d, T0).errors.some(e => e.code === 'baseline_equals_target'));
});
check('draft', 'every success criterion maps to a KR', () => {
  const d = goodDraft(); d.criteria.push('冷启动 p95 ≤ 300 ms');
  assert.ok(M.validateDraft(d, T0).errors.some(e => e.code === 'unmapped' && e.field === 'criteria1'));
});
check('draft', 'circular dependencies are rejected', () => {
  const d = goodDraft();
  d.krs = [{ id: 'a', title: 'A', baseline: 0, target: 1, weight: 1, deps: ['b'] }, { id: 'b', title: 'B', baseline: 0, target: 1, weight: 1, deps: ['a'] }];
  assert.ok(M.validateDraft(d, T0).errors.some(e => e.code === 'cycle'));
});
check('draft', 'task-like KRs are flagged, past deadlines rejected', () => {
  const d = goodDraft(); d.krs[0].title = '实现自动发布脚本'; d.constraints.deadline = new Date(T0 - DAY).toISOString();
  const r = M.validateDraft(d, T0);
  assert.ok(r.warnings.some(w => w.code === 'looks_like_task'));
  assert.ok(r.errors.some(e => e.code === 'future'));
});

/* ------------------------------------------------- Lifecycle and cap */

check('lifecycle', 'a fourth ACTIVE goes to the candidate pool', () => {
  const p = fresh();
  const org = personal(p);
  assert.equal(M.activeCount(org), 3);
  const res = M.requestActivation(org, okrOf(p, 'okr-explorer'), T0);
  assert.equal(res.code, 'active_limit');
  assert.equal(okrOf(p, 'okr-explorer').lifecycle, 'CANDIDATE');
});
check('lifecycle', 'activation is confirmed on chain and idempotent', () => {
  const p = fresh();
  const org = personal(p);
  okrOf(p, 'okr-memory').lifecycle = 'ARCHIVED';
  const okr = okrOf(p, 'okr-explorer');
  assert.equal(M.requestActivation(org, okr, T0).ok, true);
  assert.equal(M.requestActivation(org, okr, T0).code, 'already_active');
  const tx = M.beginTx(p, { kind: 'okr.activate', orgId: F.P, payload: { okrId: okr.id } }, T0).tx;
  assert.equal(M.commitTx(p, tx.id, T0 + 1000).ok, true);
  assert.equal(okr.lifecycle, 'ACTIVE');
  assert.equal(krOf(okr, 'kr1').status, 'IN_PROGRESS');
});
check('lifecycle', 'archiving frees a slot but never interrupts executing work', () => {
  const p = fresh();
  const org = personal(p);
  assert.equal(M.archiveOkr(org, okrOf(p, 'okr-alpha'), T0).code, 'run_active');
  assert.equal(M.archiveOkr(org, okrOf(p, 'okr-mobile'), T0).ok, true);
  assert.equal(M.find(org.approvals, 'apv-testflight').state, 'invalidated');
  assert.equal(M.find(org.runs, 'R-0140').state, 'cancelled');
  assert.equal(M.activeCount(org), 2);
  assert.equal(M.archiveOkr(org, okrOf(p, 'okr-first'), T0).code, 'not_archivable');
});
check('lifecycle', 'readiness failures keep the goal as a candidate', () => {
  const p = fresh();
  const org = personal(p);
  okrOf(p, 'okr-memory').lifecycle = 'ARCHIVED';
  const okr = okrOf(p, 'okr-explorer');
  okr.hostId = 'host-pi';
  const res = M.requestActivation(org, okr, T0);
  assert.equal(res.code, 'not_ready');
  assert.ok(res.issues.includes('host_not_accepting'));
  assert.equal(okr.lifecycle, 'CANDIDATE');
});

/* ------------------------------------------------ Heartbeat storyline */

check('heartbeat', 'full path: progress, verification, acceptance, gate, approval, achievement', () => {
  const p = fresh();
  const org = personal(p);
  const okr = okrOf(p, 'okr-alpha');
  let t = T0;
  const hb = id => M.heartbeat(p, F.P, 'okr-alpha', (t += MIN), id);

  assert.equal(hb('h1').value, 86);
  assert.equal(okr.constraints.budget.spent, 1280);
  assert.equal(hb('h1').code, 'duplicate', 'reconnect replays are ignored');
  assert.equal(okr.constraints.budget.spent, 1280);
  hb('h2'); hb('h3');
  assert.equal(krOf(okr, 'kr2').metric.current, 95);
  assert.equal(hb('h4').code, 'verify_start');
  assert.notEqual(krOf(okr, 'kr2').status, 'COMPLETE', 'a measurement at target does not light the checkpoint');
  assert.equal(hb('h5').code, 'kr_complete');
  assert.equal(krOf(okr, 'kr2').status, 'COMPLETE');
  assert.equal(krOf(okr, 'kr3').status, 'PENDING');

  assert.equal(M.condition(org, okr, t).reason, 'awaiting_acceptance');
  assert.equal(hb('h6').code, 'waiting');
  assert.equal(approve(p, 'apv-kr1-accept', 'approve', t).ok, true);
  assert.equal(krOf(okr, 'kr3').status, 'IN_PROGRESS');

  const gate = hb('h7');
  assert.equal(gate.code, 'approval_requested');
  assert.equal(M.condition(org, okr, t).code, 'boundary');
  assert.equal(hb('h8').code, 'boundary');
  assert.equal(approve(p, gate.approvalId, 'approve', t).ok, true);
  const apv = M.find(org.approvals, gate.approvalId);
  assert.equal(apv.state, 'approved');
  assert.equal(apv.execution, undefined, 'approved is not executed');
  assert.equal(hb('h9').value, 520);
  assert.equal(apv.execution.result, 'executed');
  hb('h10'); hb('h11');
  assert.equal(krOf(okr, 'kr3').metric.current, 290);
  hb('h12');
  const acc = hb('h13');
  assert.equal(acc.code, 'acceptance_requested');
  assert.equal(approve(p, acc.approvalId, 'approve', t).ok, true);
  assert.equal(krOf(okr, 'kr3').status, 'COMPLETE');
  const fin = hb('h14');
  assert.equal(fin.code, 'final_review');
  assert.equal(okr.lifecycle, 'ACTIVE', 'all KRs complete is not yet ACHIEVED');
  assert.equal(approve(p, fin.approvalId, 'approve', t).ok, true);
  assert.equal(okr.lifecycle, 'ACHIEVED');
  assert.ok(org.results.some(r => r.okrId === 'okr-alpha'));
  assert.ok(org.memories.some(m => m.okrId === 'okr-alpha' && m.kind === 'result'));
});

function toGate(p) {
  const okr = okrOf(p, 'okr-alpha');
  ['kr1', 'kr2'].forEach(id => Object.assign(krOf(okr, id), { status: 'COMPLETE', verification: { state: 'passed' }, acceptance: { state: 'accepted' } }));
  krOf(okr, 'kr2').metric.current = 95;
  krOf(okr, 'kr3').status = 'IN_PROGRESS';
  personal(p).approvals.forEach(a => { if (a.id === 'apv-kr1-accept') a.state = 'approved'; });
  return okr;
}

check('heartbeat', 'rejection blocks the path; route B never approves the external request', () => {
  const p = fresh();
  const org = personal(p);
  const okr = toGate(p);
  const gate = M.heartbeat(p, F.P, 'okr-alpha', T0 + MIN);
  assert.equal(approve(p, gate.approvalId, 'reject', T0 + 2 * MIN).ok, true);
  assert.equal(M.condition(org, okr, T0).code, 'blocked');
  assert.equal(M.heartbeat(p, F.P, 'okr-alpha', T0 + 3 * MIN).code, 'blocked');
  assert.equal(M.switchRoute(p, org, okr, 'B', T0 + 4 * MIN).ok, true);
  assert.equal(M.condition(org, okr, T0 + 4 * MIN).code, 'on_track');
  const r = M.heartbeat(p, F.P, 'okr-alpha', T0 + 5 * MIN);
  assert.deepEqual([r.value, r.cost], [610, 20]);
  assert.equal(M.find(org.approvals, gate.approvalId).state, 'rejected');
});
check('heartbeat', 'budget boundary stops new spending until the agreement changes', () => {
  const p = fresh();
  const org = personal(p);
  const okr = okrOf(p, 'okr-alpha');
  okr.constraints.budget.limit = okr.constraints.budget.spent + okr.constraints.budget.reserved + 10;
  assert.equal(M.condition(org, okr, T0).reason, 'budget');
  assert.equal(M.heartbeat(p, F.P, 'okr-alpha', T0 + MIN).code, 'boundary');
  assert.equal(okr.constraints.budget.spent, 1240);
  M.updateConstraints(org, okr, { budgetLimit: 3000 }, T0 + 2 * MIN);
  assert.equal(okr.constraints.version, 4);
  assert.equal(M.heartbeat(p, F.P, 'okr-alpha', T0 + 3 * MIN).code, 'progress');
});
check('heartbeat', 'a new agreement version invalidates pending boundary approvals', () => {
  const p = fresh();
  const org = personal(p);
  const okr = okrOf(p, 'okr-mobile');
  M.updateConstraints(org, okr, { budgetLimit: 2500 }, T0);
  assert.equal(M.find(org.approvals, 'apv-testflight').state, 'invalidated');
  const again = M.heartbeat(p, F.P, 'okr-mobile', T0 + MIN);
  assert.equal(again.code, 'approval_requested', 'the Agent asks again under the new version');
  assert.equal(M.find(org.approvals, again.approvalId).boundVersion, 3);
});
check('heartbeat', 'a returned result is reworked before resubmission', () => {
  const p = fresh();
  const org = personal(p);
  const okr = okrOf(p, 'okr-alpha');
  const r = approve(p, 'apv-kr1-accept', 'reject', T0);
  assert.equal(r.ok, true);
  assert.equal(krOf(okr, 'kr1').acceptance.state, 'returned');
  assert.equal(krOf(okr, 'kr1').status, 'IN_PROGRESS');
  assert.ok(org.activity.some(a => a.kind === 'returned'));
});

/* ----------------------------------------------------------- Approvals */

check('approvals', 'expired approvals cannot be decided', () => {
  const p = fresh();
  const late = T0 + 21 * HOUR;
  const r = M.decide(p, personal(p), 'apv-testflight', 'approve', ctxFor(p, 'dev-mbp', 'approve', F.P, late), late);
  assert.equal(r.code, 'expired');
  assert.equal(M.find(personal(p).approvals, 'apv-testflight').state, 'expired');
});
check('approvals', 'permissions come from org role, device grant and data access', () => {
  const p = fresh();
  assert.equal(ctxFor(p, 'dev-iphone', 'approve').ok, true);
  assert.equal(ctxFor(p, 'dev-pixel', 'approve').code, 'data_not_synced');
  assert.equal(ctxFor(p, 'dev-mbp', 'approve', F.LABS).code, 'role_insufficient');
  assert.equal(ctxFor(p, 'dev-iphone', 'read', F.LABS).code, 'org_not_granted');
  assert.equal(ctxFor(p, 'dev-ipad', 'read').code, 'revoked');
  const r = M.decide(p, p.data[F.LABS], 'apv-labs-1', 'approve', ctxFor(p, 'dev-mbp', 'approve', F.LABS), T0);
  assert.equal(r.code, 'role_insufficient');
  assert.equal(M.find(p.data[F.LABS].approvals, 'apv-labs-1').state, 'pending');
});
check('approvals', 'decisions are re-validated when the transaction commits', () => {
  const p = fresh();
  const tx = M.beginTx(p, { kind: 'approval.decide', orgId: F.P, payload: { approvalId: 'apv-testflight', decision: 'approve', deviceId: 'dev-mbp' } }, T0).tx;
  M.updateConstraints(personal(p), okrOf(p, 'okr-mobile'), { budgetLimit: 2400 }, T0 + 1);
  const res = M.commitTx(p, tx.id, T0 + 2);
  assert.equal(res.ok, false);
  assert.equal(tx.state, 'failed');
  assert.equal(M.find(personal(p).approvals, 'apv-testflight').state, 'invalidated');
});

/* ---------------------------------------------------------------- Runs */

check('runs', 'cancel shows stopping until the execution device confirms', () => {
  const p = fresh();
  const org = personal(p);
  const run = M.find(org.runs, 'R-0142');
  assert.equal(M.requestStop(run).ok, true);
  assert.equal(run.state, 'running');
  assert.equal(run.stopping, true);
  assert.equal(M.confirmStop(org, run, T0).ok, true);
  assert.equal(run.state, 'cancelled');
  assert.equal(okrOf(p, 'okr-alpha').nav.pausedReason, 'run_cancelled');
  assert.equal(run.sideEffects.length, 1, 'side effects stay on record');
});
check('runs', 'unconfirmed side effects: a retry is a new Run', () => {
  const p = fresh();
  const org = personal(p);
  const run = M.find(org.runs, 'R-0137');
  const res = M.resolveConfirmation(p, org, run, 'not_executed', T0);
  const retry = M.find(org.runs, res.retryId);
  assert.equal(run.state, 'failed');
  assert.equal(retry.parentRunId, 'R-0137');
  assert.equal(retry.attempt, 2);
  assert.deepEqual(retry.sideEffects, []);
  assert.equal(M.resolveConfirmation(p, org, run, 'executed', T0).code, 'not_pending');
});

/* ----------------------------------------------------------- Scenarios */

check('scenarios', 'drift, loop, waiting and unknown each hold progress', () => {
  const p = fresh();
  const org = personal(p);
  const okr = okrOf(p, 'okr-alpha');
  for (const code of ['drift', 'loop', 'waiting', 'unknown', 'blocked', 'boundary']) {
    M.injectScenario(p, org, okr, code, T0);
    assert.equal(M.condition(org, okr, T0).code, code);
    assert.equal(M.heartbeat(p, F.P, 'okr-alpha', T0 + MIN).code, code);
  }
  assert.equal(krOf(okr, 'kr2').metric.current, 82);
  M.injectScenario(p, org, okr, 'normal', T0);
  assert.equal(M.condition(org, okr, T0).code, 'on_track');
});
check('scenarios', 'reconnecting reconciles and waits for an explicit resume', () => {
  const p = fresh();
  const org = personal(p);
  const okr = okrOf(p, 'okr-alpha');
  M.injectScenario(p, org, okr, 'unknown', T0);
  M.resolveScenario(p, org, okr, 'reconnect', T0);
  assert.equal(M.condition(org, okr, T0).code, 'paused');
  assert.equal(M.resumeOkr(p, org, okr, T0).ok, true);
  assert.equal(M.condition(org, okr, T0).code, 'on_track');
});
check('scenarios', 'an offline host makes the map unknown without failing the run', () => {
  const p = fresh();
  const org = personal(p);
  assert.equal(M.condition(org, okrOf(p, 'okr-memory'), T0).code, 'unknown');
  assert.equal(M.find(org.runs, 'R-0135').state, 'running');
});

/* --------------------------------------------------------------- Hosts */

check('hosts', 'read-only devices and offline hosts cannot run commands', () => {
  const p = fresh();
  const org = personal(p);
  assert.equal(M.hostCommand(p, org, 'host-mini', 'inst-builder-1', 'restart', ctxFor(p, 'dev-pixel', 'operate'), T0).ok, false);
  assert.equal(M.hostCommand(p, org, 'host-nas', 'inst-researcher-2', 'status', ctxFor(p, 'dev-mbp', 'operate'), T0).code, 'host_offline');
});
check('hosts', 'stopping an instance pauses only its OKRs', () => {
  const p = fresh();
  const org = personal(p);
  const r = M.hostCommand(p, org, 'host-mini', 'inst-builder-1', 'stop', ctxFor(p, 'dev-mbp', 'operate'), T0);
  assert.equal(r.receipt.state, 'sent');
  M.ackCommand(p, org, r.receipt.id, T0 + 500);
  assert.equal(okrOf(p, 'okr-alpha').nav.pausedReason, 'instance_stopped');
  assert.equal(okrOf(p, 'okr-mobile').nav.paused, false);
  assert.equal(M.resumeOkr(p, org, okrOf(p, 'okr-alpha'), T0).code, 'agent_stopped');
});
check('hosts', 'reassignment checks target and source, then waits to continue', () => {
  const p = fresh();
  const org = personal(p);
  assert.equal(M.reassign(p, org, okrOf(p, 'okr-memory'), 'host-mbp', 'inst-researcher-1', T0).code, 'source_unreachable');
  assert.ok(M.assignIssues(org, okrOf(p, 'okr-mobile'), 'host-pi', 'inst-tester-2').includes('target_not_accepting'));
  const okr = okrOf(p, 'okr-mobile');
  assert.equal(M.reassign(p, org, okr, 'host-gpu', 'inst-tester-2', T0).ok, true);
  assert.equal(okr.hostId, 'host-gpu');
  assert.equal(okr.nav.pausedReason, 'reassigned');
  assert.equal(M.find(org.runs, 'R-0140').state, 'cancelled');
});

/* ------------------------------------------------------------- Invites */

function signedInvite(p, opts) {
  const org = personal(p);
  const dg = M.digest(`code:${Math.random()}`);
  const inv = M.createInvite(p, org, Object.assign({ ttl: '1h' }, opts), dg, T0).invite;
  const tx = M.beginTx(p, { kind: 'invite.create', orgId: F.P, payload: { inviteId: inv.id } }, T0).tx;
  M.commitTx(p, tx.id, T0 + 1000);
  return inv;
}
const hostDevice = (inv, key) => ({ name: `Host ${key}`, os: 'Ubuntu 24.04', deviceKey: key, proof: M.redeemProof(inv.id, inv.codeDigest, key) });

check('invites', 'unsigned invitations cannot be redeemed; signing makes them active', () => {
  const p = fresh();
  const org = personal(p);
  const inv = M.createInvite(p, org, { ttl: '15m' }, M.digest('x'), T0).invite;
  assert.equal(M.redeemInvite(p, org, inv.id, hostDevice(inv, 'k'), T0).code, 'pending');
  const tx = M.beginTx(p, { kind: 'invite.create', orgId: F.P, payload: { inviteId: inv.id } }, T0).tx;
  M.commitTx(p, tx.id, T0);
  assert.equal(M.inviteStatus(inv, T0), 'active');
  assert.equal(M.inviteStatus(inv, T0 + 16 * MIN), 'expired');
});
check('invites', 'a new organization binds a connection entry first', () => {
  const org = F.emptyOrgData();
  assert.equal(M.createInvite({ seq: 0 }, org, { ttl: '1h' }, 'd', T0).code, 'no_binding');
});
check('invites', 'one atomic redemption; copied proofs and second hosts fail', () => {
  const p = fresh();
  const org = personal(p);
  const before = org.hosts.length;
  const inv = signedInvite(p, { desktop: true });
  const copied = Object.assign(hostDevice(inv, 'keyC'), { proof: hostDevice(inv, 'keyA').proof });
  assert.equal(M.redeemInvite(p, org, inv.id, copied, T0 + 2000).code, 'bad_proof');
  assert.equal(M.inviteStatus(inv, T0 + 2000), 'active', 'a failed redemption consumes nothing');
  const a = M.beginTx(p, { kind: 'invite.redeem', orgId: F.P, payload: { inviteId: inv.id, device: hostDevice(inv, 'keyA') } }, T0).tx;
  const b = M.beginTx(p, { kind: 'invite.redeem', orgId: F.P, payload: { inviteId: inv.id, device: hostDevice(inv, 'keyB') } }, T0).tx;
  assert.equal(M.commitTx(p, a.id, T0 + 3000).ok, true);
  const second = M.commitTx(p, b.id, T0 + 3001);
  assert.equal(second.code, 'consumed');
  assert.equal(org.hosts.length, before + 1);
  const host = org.hosts[org.hosts.length - 1];
  assert.equal(host.membership.state, 'active');
  assert.equal(host.grant.expiresAt, T0 + 3000 + 7 * DAY, 'execution grant has its own 7-day validity');
  assert.equal(M.revokeInvite(org, inv.id, T0).code, 'consumed', 'revoke the host, not the used invitation');
});
check('invites', 'failed and unknown transactions: retry or query, never replay', () => {
  const p = fresh();
  const org = personal(p);
  const inv = signedInvite(p, {});
  const failed = M.beginTx(p, { kind: 'invite.redeem', orgId: F.P, payload: { inviteId: inv.id, device: hostDevice(inv, 'k1') } }, T0).tx;
  M.commitTx(p, failed.id, T0 + 10, 'fail');
  assert.equal(M.inviteStatus(inv, T0 + 10), 'active');
  assert.equal(failed.charged, M.FAIL_FEE, 'failure fee follows the transaction result');
  const unknown = M.beginTx(p, { kind: 'invite.redeem', orgId: F.P, payload: { inviteId: inv.id, device: hostDevice(inv, 'k1') } }, T0).tx;
  assert.equal(M.commitTx(p, unknown.id, T0 + 20, 'rpc').code, 'unknown');
  assert.equal(M.queryTx(p, unknown.id, T0 + 30, 'rpc').code, 'unknown');
  const hostsBefore = org.hosts.length;
  assert.equal(M.queryTx(p, unknown.id, T0 + 40).ok, true);
  assert.equal(M.commitTx(p, unknown.id, T0 + 50).code, 'already_settled');
  assert.equal(org.hosts.length, hostsBefore + 1);
});
check('invites', 'membership survives an unreachable coordinator; reconnect needs no code', () => {
  const p = fresh();
  const org = personal(p);
  const inv = signedInvite(p, {});
  const res = M.redeemInvite(p, org, inv.id, hostDevice(inv, 'k'), T0);
  assert.equal(M.connectHost(org, res.host.id, false, T0).code, 'coordinator_unreachable');
  assert.equal(res.host.status, 'waiting_connection');
  assert.equal(M.connectHost(org, res.host.id, true, T0 + 1000).ok, true);
  assert.equal(inv.state, 'consumed');
});
check('invites', 'unused invitations can be revoked; fixture states are distinct', () => {
  const p = fresh();
  const org = personal(p);
  assert.deepEqual(org.invites.map(i => M.inviteStatus(i, T0)), ['consumed', 'expired', 'revoked']);
  const inv = signedInvite(p, {});
  assert.equal(M.revokeInvite(org, inv.id, T0).ok, true);
  assert.equal(M.redeemInvite(p, org, inv.id, hostDevice(inv, 'k'), T0).code, 'revoked');
});

/* -------------------------------------------------------------- Devices */

check('devices', 'pairing grants nothing until a manager approves and the grant confirms', () => {
  const p = fresh();
  const req = M.createPairing(p, { platform: 'android', name: 'Galaxy' }, T0, () => 0.5);
  assert.equal(M.approvePairing(p, req.id, {}, 'dev-iphone', T0).code, 'not_manager');
  const res = M.approvePairing(p, req.id, {}, 'dev-mbp', T0);
  const dev = res.device;
  assert.equal(dev.grant.expiresAt, T0 + 7 * DAY);
  assert.deepEqual(dev.grant.scopes, [{ orgId: F.P, actions: ['read'] }]);
  assert.equal(M.can(p, dev.id, F.P, 'read', T0).code, 'grant_pending');
  M.confirmGrant(p, dev.id);
  assert.equal(M.can(p, dev.id, F.P, 'read', T0).code, 'data_not_synced');
  M.syncData(p, dev.id);
  assert.equal(M.can(p, dev.id, F.P, 'read', T0).ok, true);
  assert.equal(M.can(p, dev.id, F.P, 'approve', T0).code, 'action_not_granted');
  assert.equal(M.can(p, dev.id, F.P, 'manage_identity', T0).code, 'not_manager');
  assert.equal(M.can(p, dev.id, F.P, 'read', T0 + 8 * DAY).code, 'expired');
});
check('devices', 'expired pairing requests cannot be approved', () => {
  const p = fresh();
  const req = M.createPairing(p, { platform: 'ios', name: 'iPhone' }, T0, () => 0.1);
  assert.equal(M.approvePairing(p, req.id, {}, 'dev-mbp', T0 + 6 * MIN).code, 'expired');
});
check('devices', 'revocation and lock both block protected actions', () => {
  const p = fresh();
  assert.equal(M.revokeDevice(p, 'dev-iphone', 'dev-mbp', T0).ok, true);
  assert.equal(M.can(p, 'dev-iphone', F.P, 'read', T0).code, 'revoked');
  assert.equal(M.revokeDevice(p, 'dev-mbp', 'dev-mbp', T0).code, 'self');
  p.locked = true;
  assert.equal(M.can(p, 'dev-mbp', F.P, 'read', T0).code, 'locked');
});

/* ------------------------------------------------------------- Recovery */

check('recovery', 'codes carry version, network and check; input is normalized', () => {
  const code = F.demoRecoveryCode(M);
  assert.match(code, /^FMR1-T-[0-9A-Z]{5}(-[0-9A-Z]{5}){3}-[0-9A-Z]$/);
  assert.equal(M.parseRecoveryCode(code.toLowerCase().replace(/-/g, ' ')).ok, true);
  const last = code.slice(-1);
  assert.equal(M.parseRecoveryCode(code.slice(0, -1) + (last === '0' ? '1' : '0')).code, 'checksum');
  assert.equal(M.parseRecoveryCode(code.replace('-T-', '-M-')).code, 'network');
  assert.equal(M.parseRecoveryCode(code.replace('FMR1', 'FMR2')).code, 'version');
  assert.equal(M.parseRecoveryCode('hello').code, 'format');
});
check('recovery', 'lookup finds the identity without granting anything', () => {
  const p = fresh();
  const parsed = M.parseRecoveryCode(F.demoRecoveryCode(M));
  const hit = M.lookupRecovery([p], parsed);
  assert.equal(hit.humanId, 'HMN-7Q2K-4F9D');
  assert.equal(M.can(p, 'dev-iphone', F.P, 'read', T0).ok, true, 'lookup changes no device');
});
check('recovery', 'recovery is a chain transaction carrying only the digest', () => {
  const p = fresh();
  const parsed = M.parseRecoveryCode(F.demoRecoveryCode(M));
  const tx = M.beginTx(p, { kind: 'recovery.apply', payload: { digest: parsed.digest, device: { name: 'New Mac', platform: 'macos' } } }, T0).tx;
  assert.ok(!JSON.stringify(tx).includes('FMR1'), 'the raw code never enters the transaction');
  assert.equal(M.commitTx(p, tx.id, T0 + 1).ok, true);
  assert.equal(p.recovery.state, 'consumed');
  const again = M.beginTx(p, { kind: 'recovery.apply', payload: { digest: parsed.digest, device: { name: 'Race', platform: 'ios' } } }, T0).tx;
  assert.equal(M.commitTx(p, again.id, T0 + 2).code, 'stale', 'a concurrent or replayed recovery fails');
});
check('recovery', 'recovery revokes old devices, keeps identity and work, and consumes the code', () => {
  const p = fresh();
  const parsed = M.parseRecoveryCode(F.demoRecoveryCode(M));
  const okrs = personal(p).okrs.length;
  const res = M.applyRecovery(p, parsed, { name: 'New Mac', platform: 'macos' }, T0);
  assert.equal(res.ok, true);
  assert.equal(p.human.id, 'HMN-7Q2K-4F9D');
  assert.equal(personal(p).okrs.length, okrs);
  assert.ok(p.devices.filter(d => d.id !== res.device.id).every(d => d.grant.state === 'revoked'));
  assert.equal(res.device.dataSync, 'pending', 'encrypted data is restored separately');
  assert.equal(M.can(p, res.device.id, F.P, 'read', T0).code, 'data_not_synced');
  assert.equal(M.applyRecovery(p, parsed, { name: 'Again', platform: 'macos' }, T0).code, 'stale');
  assert.equal(M.lookupRecovery([p], parsed).code, 'consumed');
  const next = M.parseRecoveryCode(M.makeRecoveryCode(n => Uint8Array.from({ length: n }, (_, i) => i * 7)));
  M.setRecovery(p, next, T0);
  assert.equal(M.lookupRecovery([p], next).humanId, p.human.id);
});

/* ------------------------------------------------------------ Run fees */

check('fees', 'payment sources are checked before signing', () => {
  const p = fresh();
  p.wallet.balance = 1000;
  assert.equal(M.beginTx(p, { kind: 'okr.activate' }, T0).code, 'insufficient');
  p.wallet.source = 'sponsor';
  p.wallet.sponsor = { online: false, quota: 1e9 };
  assert.equal(M.beginTx(p, { kind: 'okr.activate' }, T0).code, 'sponsor_offline');
  p.wallet.sponsor = { online: true, quota: 10 };
  assert.equal(M.beginTx(p, { kind: 'okr.activate' }, T0).code, 'sponsor_quota');
});
check('fees', 'charges follow the transaction result', () => {
  const p = fresh();
  const bal = p.wallet.balance;
  const tx = M.beginTx(p, { kind: 'memory.archive', orgId: F.P, payload: { memoryId: 'mem-1' } }, T0).tx;
  M.commitTx(p, tx.id, T0);
  assert.equal(p.wallet.balance, bal - Math.round(M.feeFor('memory.archive') * 0.92));
  assert.equal(p.wallet.records[0].state, 'confirmed');
  assert.equal(M.find(personal(p).memories, 'mem-1').state, 'archived');
});

/* -------------------------------------------------------- Conversations */

check('conversation', 'read-only or offline: no send, the draft is kept', () => {
  const p = fresh();
  const org = personal(p);
  const r = M.sendMessage(p, org, okrOf(p, 'okr-alpha'), 'ask', '为什么？', ctxFor(p, 'dev-pixel', 'operate'), T0);
  assert.equal(r.ok, false);
  assert.equal(org.conversations['okr-alpha'].draft, '为什么？');
  assert.equal(M.sendMessage(p, org, okrOf(p, 'okr-memory'), 'ask', 'hi', ctxFor(p, 'dev-mbp', 'operate'), T0).code, 'host_offline');
});
check('conversation', 'plans pause the attempt; adopting re-checks the state version', () => {
  const p = fresh();
  const org = personal(p);
  const okr = toGate(p);
  M.heartbeat(p, F.P, 'okr-alpha', T0);
  const ctx = ctxFor(p, 'dev-mbp', 'operate');
  const sent = M.sendMessage(p, org, okr, 'plan', '有本地方案吗？', ctx, T0 + 1);
  assert.equal(M.condition(org, okr, T0 + 1).code, 'paused');
  const reply = M.agentReply(p, org, okr, sent.msg.id, T0 + 2).reply;
  assert.equal(reply.proposal.route, 'B');
  assert.equal(M.adoptProposal(p, org, okr, reply.proposal.id, ctx, T0 + 3).ok, true);
  assert.equal(krOf(okr, 'kr3').route, 'B');
  assert.equal(M.condition(org, okr, T0 + 3).code, 'on_track');
  assert.ok(org.approvals.some(a => a.okrId === 'okr-alpha' && a.superseded), 'the external request is superseded, not approved');
});
check('conversation', 'stale and superseded proposals cannot be adopted', () => {
  const p = fresh();
  const org = personal(p);
  const okr = toGate(p);
  const ctx = ctxFor(p, 'dev-mbp', 'operate');
  const s1 = M.sendMessage(p, org, okr, 'plan', 'A', ctx, T0);
  const p1 = M.agentReply(p, org, okr, s1.msg.id, T0).reply.proposal;
  okr.version += 1;
  assert.equal(M.adoptProposal(p, org, okr, p1.id, ctx, T0).code, 'stale');
  const s2 = M.sendMessage(p, org, okr, 'plan', 'B', ctx, T0);
  const p2 = M.agentReply(p, org, okr, s2.msg.id, T0).reply.proposal;
  M.sendMessage(p, org, okr, 'inform', '先别动外部服务', ctx, T0);
  assert.equal(p2.state, 'superseded');
});

/* ------------------------------------------------------ Discovery (J11) */

check('discovery', 'scan, observe-only import, duplicates and unverified identities', () => {
  const p = fresh();
  const org = personal(p);
  const seen = F.observedSessions(T0);
  assert.equal(M.scanHost(org, 'host-nas', seen, T0).code, 'offline');
  const mini = M.scanHost(org, 'host-mini', seen, T0).sessions;
  assert.equal(mini.length, 2);
  const inst = M.importObserve(p, org, mini[0], T0).instance;
  assert.equal(inst.imported, 'observe');
  assert.equal(M.importObserve(p, org, mini[0], T0).code, 'duplicate');
  const gpu = M.scanHost(org, 'host-gpu', seen, T0).sessions;
  assert.equal(gpu[0].name, mini[0].name);
  assert.equal(M.importObserve(p, org, gpu[0], T0).code, 'identity_unverified', 'same name on another host is not merged');
  assert.equal(M.scanHost(org, 'host-build', seen, T0).sessions[0].importedAs, 'inst-tester-1');
});
check('discovery', 'only constraint-capable, freshly observed instances join an OKR', () => {
  const p = fresh();
  const org = personal(p);
  const seen = F.observedSessions(T0);
  const [native, tmux] = M.scanHost(org, 'host-mini', seen, T0).sessions;
  const a = M.importObserve(p, org, native, T0).instance;
  const b = M.importObserve(p, org, tmux, T0).instance;
  M.confirmImport(org, a.id); M.confirmImport(org, b.id);
  const all = { budget: 1, deadline: 1, tools: 1, escalation: 1, checkpoint: 1, stopped: 1 };
  assert.ok(M.includeIssues(org, b, okrOf(p, 'okr-alpha'), all, T0).includes('observe_only'));
  assert.ok(M.includeIssues(org, a, okrOf(p, 'okr-alpha'), all, T0 + 6 * MIN).includes('observation_stale'));
  assert.ok(M.includeIssues(org, a, okrOf(p, 'okr-alpha'), { budget: 1 }, T0).includes('checks_incomplete'));
  assert.equal(M.includeInOkr(p, org, a.id, 'okr-alpha', all, T0 + MIN).ok, true);
  assert.equal(okrOf(p, 'okr-alpha').instanceId, a.id);
  assert.equal(okrOf(p, 'okr-alpha').nav.pausedReason, 'handoff');
});

/* ------------------------------------------- Direct conversations (J12) */

const mgr = (p, id) => Object.assign(ctxFor(p, id || 'dev-mbp', 'operate'), { manager: true });
const ask = (p, agentId, req, ctx, t) => {
  const org = personal(p);
  const sent = M.sendDirect(p, org, agentId, req, ctx || mgr(p), t || T0);
  if (!sent.ok) return sent;
  return M.directReply(p, org, agentId, sent.msg.id, t || T0);
};

check('direct', 'questions are answered without runs or spending', () => {
  const p = fresh();
  const runs = personal(p).runs.length;
  const r = ask(p, 'agent-reviewer', { kind: 'ask', text: '签名报告怎么看？' });
  assert.equal(r.reply.outcome, 'answer');
  assert.equal(personal(p).runs.length, runs);
});
check('direct', 'actions inside the standing policy run without any OKR budget', () => {
  const p = fresh();
  const org = personal(p);
  const b = okrOf(p, 'okr-alpha').constraints.budget.spent;
  const r = ask(p, 'agent-builder', { kind: 'action', action: 'test', text: '跑测试' });
  assert.equal(r.reply.outcome, 'executed');
  const run = M.find(org.runs, r.reply.runId);
  assert.equal(run.direct, true);
  assert.equal(run.okrId, null);
  assert.equal(M.find(org.agents, 'agent-builder').standing.spentToday, 100);
  assert.equal(okrOf(p, 'okr-alpha').constraints.budget.spent, b);
});
check('direct', 'outside the policy, over budget, or busy workspace: never executed silently', () => {
  const p = fresh();
  const org = personal(p);
  assert.equal(ask(p, 'agent-reviewer', { kind: 'action', action: 'test' }).reply.outcome, 'approval_requested');
  const ext = ask(p, 'agent-builder', { kind: 'action', action: 'external' });
  assert.deepEqual(M.find(org.approvals, ext.reply.approvalId).reasons, ['outside_standing']);
  const busy = ask(p, 'agent-builder', { kind: 'action', action: 'edit_sandbox' });
  assert.deepEqual(M.find(org.approvals, busy.reply.approvalId).reasons, ['workspace_busy'], 'builder-1 is running an OKR');
  M.find(org.agents, 'agent-builder').standing.spentToday = 495;
  assert.equal(ask(p, 'agent-builder', { kind: 'action', action: 'test' }).reply.outcome, 'budget_exhausted');
  assert.equal(M.find(org.agents, 'agent-builder').standing.spentToday, 495);
});
check('direct', 'standing approvals: approved is not executed; a new policy version invalidates', () => {
  const p = fresh();
  const org = personal(p);
  const a = ask(p, 'agent-builder', { kind: 'action', action: 'external' }).reply.approvalId;
  assert.equal(approve(p, a, 'approve', T0).ok, true);
  assert.equal(M.find(org.approvals, a).execution, undefined);
  const res = M.executeStandingApproval(p, org, a, T0 + 1);
  assert.equal(M.find(org.runs, res.run.id).approvalId, a);
  assert.equal(M.executeStandingApproval(p, org, a, T0 + 2).code, 'already_executed');
  const b = ask(p, 'agent-reviewer', { kind: 'action', action: 'test' }).reply.approvalId;
  M.updateStanding(p, org, 'agent-reviewer', { actions: ['test', 'external'] }, 1, T0);
  assert.equal(M.find(org.approvals, b).state, 'invalidated');
  assert.deepEqual(M.find(org.agents, 'agent-reviewer').standing.actions, ['test'], 'non-grantable actions never enter a policy');
  assert.equal(M.updateStanding(p, org, 'agent-reviewer', { dailyBudget: 1 }, 1, T0).code, 'version_conflict');
});
check('direct', 'threads stay on their instance; offline hosts keep a draft', () => {
  const p = fresh();
  const org = personal(p);
  M.setDirectInstance(org, 'agent-researcher', 'inst-researcher-2');
  const r = M.sendDirect(p, org, 'agent-researcher', { kind: 'ask', text: '索引进度？' }, mgr(p), T0);
  assert.equal(r.code, 'host_offline', 'no silent switch to another instance');
  assert.equal(org.direct['agent-researcher'].draft, '索引进度？');
  M.setDirectInstance(org, 'agent-researcher', 'inst-researcher-1');
  assert.equal(M.sendDirect(p, org, 'agent-researcher', { kind: 'ask', text: 'hi' }, mgr(p), T0).ok, true);
});
check('direct', 'unconstrained agents: managers only, execution outside FractalMind', () => {
  const p = fresh();
  const org = personal(p);
  assert.equal(M.sendDirect(p, org, 'agent-desktop', { kind: 'ask' }, ctxFor(p, 'dev-iphone', 'operate'), T0).code, 'unconstrained_requires_manager');
  const r = ask(p, 'agent-desktop', { kind: 'action', action: 'edit_sandbox' });
  assert.equal(r.reply.outcome, 'unconstrained');
  assert.ok(M.assignIssues(org, okrOf(p, 'okr-explorer'), 'host-mbp', 'inst-desktop-1').includes('observe_only'));
});
check('direct', 'channel identities are limited; requests become standalone tasks', () => {
  const p = fresh();
  const org = personal(p);
  assert.equal(M.channelCan(p, 'telegram', F.P, 'chat').ok, true);
  assert.equal(M.channelCan(p, 'telegram', F.P, 'approve').code, 'action_not_granted');
  assert.equal(M.channelCan(p, 'telegram', F.LABS, 'chat').code, 'channel_not_linked');
  const sent = M.sendDirect(p, org, 'agent-builder', { kind: 'ask', text: '整理发布说明', source: 'telegram' }, M.channelCan(p, 'telegram', F.P, 'chat'), T0);
  assert.equal(sent.msg.source, 'telegram');
  const t = M.promoteDirect(p, org, 'agent-builder', sent.msg.id, T0).task;
  assert.deepEqual([t.okrId, t.krId, t.state], [null, null, 'Created']);
  assert.equal(M.promoteDirect(p, org, 'agent-builder', sent.msg.id, T0).code, 'already_promoted');
});

/* -------------------------------------------- Organization and export */

check('organization', 'switching changes context; old async results are recognized', () => {
  const p = fresh();
  const token = M.contextToken(p);
  assert.equal(M.switchOrg(p, 'org-unknown').code, 'not_member');
  M.switchOrg(p, F.LABS);
  assert.equal(M.sameContext(p, token), false);
  M.heartbeat(p, F.P, 'okr-alpha', T0);
  assert.equal(p.data[F.LABS].activity.filter(a => a.okrId === 'okr-alpha').length, 0);
});
check('organization', 'exports cover one organization, exclude secrets and list gaps', () => {
  const p = fresh();
  const out = M.buildExport(p, F.P, { okrs: 1, records: 1, memories: 1, artifacts: 1 }, T0);
  const json = JSON.stringify(out);
  assert.ok(!json.includes('okr-labs'));
  assert.ok(!/FMR1|FMI1|codeDigest|digest/.test(json));
  assert.equal(out.manifest.complete, false);
  assert.ok(out.manifest.missing.some(m => m.hostId === 'host-nas'));
});

/* -------------------------------------------- Create and import (#67) */

check('agents', 'the ROM catalog matches roms/agent-os-roms manifests', () => {
  const dir = path.join(__dirname, '../../../roms/agent-os-roms/roms');
  const names = fs.readdirSync(dir).filter(d => fs.existsSync(path.join(dir, d, 'manifest.yaml'))).sort();
  assert.deepEqual(M.ROMS.map(r => r.id).sort(), names);
  M.ROMS.forEach(r => {
    const text = fs.readFileSync(path.join(dir, r.id, 'manifest.yaml'), 'utf8');
    assert.equal(text.match(/^rom_version:\s*(\S+)/m)[1], r.version, `${r.id} version`);
    assert.equal(text.match(/^rom_family:\s*(\S+)/m)[1], r.family, `${r.id} family`);
    assert.equal(text.match(/^compatibility_status:\s*(\S+)/m)[1], r.compat, `${r.id} compatibility`);
    const block = (key) => {
      const m = text.match(new RegExp(`^${key}:\\n((?:[ ]+.*\\n)+)`, 'm'));
      return m ? m[1] : '';
    };
    const files = (text.match(/creates_files:\n((?:\s+- .*\n)+)/) || [])[1].match(/- (\S+)/g).map(x => x.slice(2));
    assert.deepEqual([...r.files].sort(), files.sort(), `${r.id} install files`);
    const skillNames = b => [...b.matchAll(/^  - (?:name: )?([\w-]+)\s*$/gm)].map(x => x[1]);
    assert.deepEqual(r.included, skillNames(block('included_skills')), `${r.id} included skills`);
    assert.deepEqual(r.optional, skillNames(block('optional_skills')), `${r.id} optional skills`);
  });
});

check('agents', 'a new Agent needs a name, an empty or new Home and a ROM on this computer', () => {
  const p = fresh();
  const org = personal(p);
  const base = { name: 'writer', home: '~/agents/writer', romId: 'manager-heavy-core', hostId: p.localService.hostId, launcher: 'codex', profileId: 'main' };
  assert.deepEqual(M.createAgentIssues(p, org, base), []);
  const issue = (patch, code) => assert.ok(M.createAgentIssues(p, org, Object.assign({}, base, patch)).includes(code), code);
  issue({ name: 'Writer' }, 'name');
  issue({ name: 'builder' }, 'name_taken');
  issue({ home: '' }, 'home');
  issue({ home: '~/work-assistant' }, 'home_is_agent');
  issue({ home: '~/Documents' }, 'home_not_empty');
  issue({ romId: '' }, 'rom');
  issue({ romId: 'trinity', optionalSkills: ['notifier'] }, 'skills');
  issue({ hostId: 'host-build' }, 'host_not_local');
  issue({ launcher: 'codex', profileId: 'nope' }, 'launcher');
  assert.deepEqual(M.createAgentIssues(p, org, Object.assign({}, base, { home: '~/agents/empty' })), [], 'an empty folder is fine');
  M.setLocalServiceRunning(p, org, false, T0);
  issue({}, 'service_stopped');
});

check('agents', 'creation installs the ROM in one transaction; a failure leaves nothing behind', () => {
  const p = fresh();
  const org = personal(p);
  const before = { agents: org.agents.length, instances: org.instances.length };
  const input = { name: 'writer', home: '~/agents/writer', romId: 'manager-heavy-core', optionalSkills: ['notifier'], hostId: p.localService.hostId, launcher: 'codex', profileId: 'main' };
  const res = M.createAgent(p, org, input, T0);
  assert.equal(res.ok, true);
  assert.deepEqual(res.skills, ['agent-manager', 'team-manager', 'notifier']);
  assert.ok(res.files.includes('SOUL.md') && res.files.includes('okrs/Candidate.md'));
  assert.match(res.frontmatter, /namespace: writer/);
  assert.match(res.frontmatter, /launcher_args: \["--profile", "main"\]/);
  assert.match(res.frontmatter, /rom: \{ name: manager-heavy-core, version: 0\.6\.0 \}/);
  assert.equal(res.instance.sessionKey, 'tmux:writer--main');
  assert.deepEqual(res.agent.standing.actions, [], 'no standing actions by default');
  assert.equal(M.createAgentIssues(p, org, Object.assign({}, input, { name: 'other' }))[0], 'home_is_agent', 'the Home is now an Agent Home');
  const tx = M.beginTx(p, { kind: 'agent.create', orgId: F.P, payload: { instanceId: res.instance.id } }, T0).tx;
  assert.equal(M.commitTx(p, tx.id, T0 + 1000).ok, true);
  assert.equal(res.instance.status, 'running');
  const again = M.beginTx(p, { kind: 'agent.create', orgId: F.P, payload: { instanceId: res.instance.id } }, T0).tx;
  assert.equal(M.commitTx(p, again.id, T0 + 2000).code, 'not_creating', 'never applied twice');
  const failed = M.createAgent(p, org, Object.assign({}, input, { name: 'other', home: '~/agents/other' }), T0);
  M.dropCreatedAgent(org, failed.instance.id);
  assert.equal(org.agents.length, before.agents + 1);
  assert.equal(org.instances.length, before.instances + 1);
  assert.deepEqual(M.createAgentIssues(p, org, Object.assign({}, input, { name: 'other', home: '~/agents/other' })), [], 'a failed creation frees its Home');
});

check('agents', 'importing a running Agent takes its definition from AGENTS.md', () => {
  const p = fresh();
  const org = personal(p);
  const sessions = M.scanHost(org, 'host-mbp', F.observedSessions(T0), T0).sessions;
  const research = sessions.find(x => x.key === 'tmux:research--main');
  const res = M.importObserve(p, org, research, T0);
  const agent = M.find(org.agents, res.instance.agentId);
  assert.equal(agent.name, 'research');
  assert.equal(agent.home, '~/research-desk');
  assert.equal(agent.profileId, 'research');
  assert.equal(agent.rom, null, 'no ROM recorded');
  assert.equal(res.instance.imported, 'observe');
  assert.equal(M.importObserve(p, org, research, T0).code, 'duplicate');
  const home = sessions.find(x => x.key === 'tmux:home--main');
  assert.deepEqual(M.find(org.agents, M.importObserve(p, org, home, T0).instance.agentId).rom, { id: 'hermes-agent', version: '0.1.0' });
  const main = sessions.find(x => x.key === 'tmux:main');
  const mainAgent = M.find(org.agents, M.importObserve(p, org, main, T0).instance.agentId);
  assert.equal(mainAgent.subAgents, 10, 'employee Agents are listed, not imported');
  assert.equal(org.instances.filter(i => i.workspace === '~/work-assistant').length, 1);
  const fresh2 = F.emptyOrgData();
  fresh2.hosts.push({ id: 'host-new', status: 'online', isThisDevice: true, membership: { state: 'active' } });
  assert.equal(M.scanHost(fresh2, 'host-new', F.observedSessions(T0), T0).sessions.length, 4, 'a new identity sees this computer\'s running Agents');
});

check('agents', 'new identities start with no Agents; onboarding tracks host, Agent and OKR', () => {
  const empty = F.createEmptyProfile({ name: 'N', deviceName: 'Mac', platform: 'macos', orgName: 'O', wallet: {} }, T0, M);
  assert.deepEqual(empty.onboarding, { host: false, agent: false, okr: false });
  assert.equal(Object.values(empty.data)[0].agents.length, 0);
});

/* ------------------------------------------------------------ Fixtures */

check('fixtures', 'references resolve in every organization', () => {
  const p = fresh();
  for (const [orgId, org] of Object.entries(p.data)) {
    const has = (list, id) => assert.ok(M.find(org[list], id), `${orgId}: ${list} ${id}`);
    org.okrs.forEach(o => { has('workspaces', o.workspaceId); has('hosts', o.hostId); has('instances', o.instanceId); has('agents', o.ownerAgentId); });
    org.instances.forEach(i => { has('hosts', i.hostId); has('agents', i.agentId); });
    org.approvals.forEach(a => (a.kind === 'standing' ? has('agents', a.agentId) : has('okrs', a.okrId)));
    org.runs.forEach(r => { if (r.direct) has('agents', r.agentId); else has('okrs', r.okrId); has('hosts', r.hostId); has('instances', r.instanceId); });
    org.agents.forEach(a => assert.ok(a.standing && Number.isInteger(a.standing.version), `${a.id} standing policy`));
    Object.values(org.direct || {}).forEach(c => { has('agents', c.agentId); if (c.instanceId) has('instances', c.instanceId); });
    (org.channels || []).forEach(c => has('hosts', c.hostId));
    org.evidence.forEach(e => has('okrs', e.okrId));
    org.hosts.forEach(h => assert.ok(org.bindings.some(b => b.id === h.bindingId), `${h.id} binding`));
  }
  assert.equal(new Set(p.devices.map(d => d.id)).size, p.devices.length);
});
check('fixtures', 'bilingual sample text is complete', () => {
  const walk = (v, where) => {
    if (!v || typeof v !== 'object') return;
    const keys = Object.keys(v);
    if (keys.length === 2 && keys.includes('zh') && keys.includes('en')) {
      assert.ok(String(v.zh).trim() && String(v.en).trim(), `empty translation at ${where}`);
      return;
    }
    keys.forEach(k => walk(v[k], `${where}.${k}`));
  };
  walk(fresh(), 'profile');
  walk(F.networkDirectory(T0, M), 'network');
  walk(F.observedSessions(T0), 'sessions');
});
check('fixtures', 'a new identity starts empty and inherits nothing', () => {
  const p = F.createEmptyProfile({ name: 'Lin', orgName: 'Lin 的组织', platform: 'windows', deviceName: 'Desktop', unlock: 'windows_hello', wallet: { balance: 5e6, source: 'self', records: [] } }, T0, M);
  const org = p.data[p.currentOrgId];
  assert.equal(org.okrs.length + org.hosts.length + org.memories.length, 0);
  assert.equal(p.recovery.state, 'unset');
  assert.equal(M.can(p, 'dev-first', p.currentOrgId, 'approve', T0).ok, true);
});

/* ---------------------------------------------------------- Page shell */

check('local-host', 'one PTB binds this computer\'s coordinator and signs the invite', () => {
  const p = fresh();
  const org = F.emptyOrgData();
  p.data[F.P] = org;
  const b = { id: 'bind-local', endpoint: 'http://127.0.0.1:7443', scope: 'loopback', state: 'pending', online: false, version: 1 };
  org.bindings.push(b);
  const inv = M.createInvite(p, org, { ttl: '15m', desktop: true, bindingId: b.id }, M.digest('code'), T0).invite;
  assert.equal(inv.bindingId, b.id, 'the invite targets the binding in the same PTB');
  const tx = M.beginTx(p, { kind: 'host.prepare', orgId: F.P, payload: { bindingId: b.id, inviteId: inv.id } }, T0).tx;
  assert.equal(M.commitTx(p, tx.id, T0 + 1000).ok, true);
  assert.equal(b.state, 'confirmed');
  assert.equal(M.inviteStatus(inv, T0 + 1000), 'active');
  const again = M.beginTx(p, { kind: 'host.prepare', orgId: F.P, payload: { bindingId: b.id, inviteId: inv.id } }, T0).tx;
  assert.equal(M.commitTx(p, again.id, T0 + 2000).code, 'not_pending', 'never applied twice');
  const r = M.beginTx(p, { kind: 'invite.redeem', orgId: F.P, payload: { inviteId: inv.id, device: hostDevice(inv, 'local') } }, T0).tx;
  const done = M.commitTx(p, r.id, T0 + 3000);
  assert.equal(done.ok, true);
  assert.equal(done.host.bindingId, b.id);
});
check('local-host', 'only loopback may use HTTP; other scopes need HTTPS', () => {
  assert.equal(M.validEndpoint('loopback', 'http://127.0.0.1:7443'), true);
  assert.equal(M.validEndpoint('loopback', 'http://192.168.1.5:7443'), false);
  assert.equal(M.validEndpoint('lan', 'http://fm.local:7443'), false);
  assert.equal(M.validEndpoint('lan', 'https://fm.local:7443'), true);
  assert.equal(M.validEndpoint('public', 'https://coordinator.example.org'), true);
  assert.equal(M.validEndpoint('public', 'https://127.0.0.1:7443'), false);
  assert.equal(M.validEndpoint('cloud', 'https://x.example'), false);
});
check('local-host', 'a new endpoint version supersedes old invites; hosts reconnect', () => {
  const p = fresh();
  const org = personal(p);
  const inv = signedInvite(p, { desktop: true });
  const b = M.find(org.bindings, inv.bindingId);
  const host = org.hosts.find(h => h.bindingId === b.id && h.status === 'online');
  const before = b.version || 1;
  assert.equal(M.updateBinding(org, b.id, 'lan', 'http://fm.local:7443', T0).code, 'invalid_endpoint');
  assert.equal(b.version || 1, before, 'a rejected endpoint changes nothing');
  const res = M.updateBinding(org, b.id, 'lan', 'https://fm.local:7443', T0);
  assert.equal(res.ok, true);
  assert.equal(b.version, before + 1);
  assert.equal(inv.state, 'revoked');
  assert.equal(M.redeemInvite(p, org, inv.id, hostDevice(inv, 'late'), T0 + 1).code, 'revoked');
  if (host) assert.equal(host.status, 'connecting', 'hosts on the binding reconnect to the new endpoint');
});
check('local-host', 'the demo MacBook runs Host + Coordinator; new identities start without a service', () => {
  const p = fresh();
  const svc = p.localService;
  const host = M.find(personal(p).hosts, svc.hostId);
  assert.equal(svc.state, 'running');
  assert.equal(host.isThisDevice, true);
  assert.deepEqual(host.roles, ['host', 'coordinator']);
  assert.equal(M.find(personal(p).bindings, svc.bindingId).scope, 'lan');
  const empty = F.createEmptyProfile({ name: 'N', deviceName: 'Mac', platform: 'macos', orgName: 'O', wallet: {} }, T0, M);
  assert.equal(empty.localService.state, 'not_installed');
});
check('local-host', 'invites for an old binding version cannot be redeemed', () => {
  const p = fresh();
  const org = personal(p);
  const inv = signedInvite(p, { desktop: true });
  M.find(org.bindings, inv.bindingId).version = 5;
  assert.equal(M.redeemInvite(p, org, inv.id, hostDevice(inv, 'k'), T0 + 1).code, 'binding_changed');
});
check('local-host', 'stopping the service takes this computer offline; starting reconnects', () => {
  const p = fresh();
  const org = personal(p);
  const inv = signedInvite(p, { desktop: true });
  const r = M.beginTx(p, { kind: 'invite.redeem', orgId: F.P, payload: { inviteId: inv.id, device: hostDevice(inv, 'svc') } }, T0).tx;
  const host = M.commitTx(p, r.id, T0 + 10).host;
  delete p.localService;
  const svc = M.localServiceFor(p);
  assert.equal(M.setLocalServiceRunning(p, org, false, T0).code, 'not_installed');
  Object.assign(svc, { state: 'running', hostId: host.id, bindingId: inv.bindingId, keys: true });
  M.setLocalServiceRunning(p, org, false, T0 + 20);
  assert.equal(svc.state, 'stopped');
  assert.equal(host.status, 'offline');
  assert.equal(host.membership.state, 'active', 'stopping the service keeps chain membership');
  assert.equal(M.setLocalServiceRunning(p, org, true, T0 + 30).ok, true);
  assert.equal(host.status, 'online');
  M.removeLocalService(p);
  assert.deepEqual([svc.state, svc.keys, svc.hostId], ['not_installed', false, null]);
});

check('page', 'index.html loads only local files that exist', () => {
  const dir = __dirname;
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 4);
  refs.forEach(ref => {
    assert.ok(!/^[a-z]+:/i.test(ref), `external reference: ${ref}`);
    assert.ok(fs.existsSync(path.join(dir, ref)), `missing file: ${ref}`);
  });
  const sources = ['styles.css', ...fs.readdirSync(path.join(dir, 'js')).map(f => `js/${f}`)];
  sources.forEach(f => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/.test(text), `${f} must not make network requests`);
    assert.ok(!/@import\s+url|https?:\/\/(?!www\.w3\.org)/.test(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `${f} must not load remote assets`);
  });
});

check('page', 'every script index.html loads parses', () => {
  const vm = require('node:vm');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.includes('js/view-direct.js'));
  scripts.forEach(f => {
    try { new vm.Script(fs.readFileSync(path.join(__dirname, f), 'utf8'), { filename: f }); } catch (e) { assert.fail(`${f}: ${e.message}`); }
  });
});

for (const [group, n] of groups) console.log(`✓ ${group} (${n})`);
console.log(failures ? `\n${failures} failed, ${passed} passed` : `\nAll ${passed} checks passed`);
process.exit(failures ? 1 : 0);
