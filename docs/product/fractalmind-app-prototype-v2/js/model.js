/* FractalMind App prototype v2 — domain model.
 *
 * Pure functions over plain JSON: no DOM, timers or storage. The UI calls these
 * and persists the result; verify.cjs requires this file directly.
 * Chain writes, measurements and verification are simulations for product
 * review. They are not a Sui protocol, a scheduler or a security boundary.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.FM = root.FM || {}).model = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const MAX_ACTIVE = 3;
  const OBSERVATION_TTL = 5 * MIN; // J11 discovery snapshots (demo threshold)
  const PAIRING_TTL = 5 * MIN;
  const INVITE_TTL = { '15m': 15 * MIN, '1h': HOUR, '24h': DAY };
  const MIST = 1e9;

  const RUN_STATES = ['queued', 'running', 'awaiting_approval', 'recovering', 'needs_confirmation', 'succeeded', 'failed', 'cancelled'];
  const APPROVAL_STATES = ['pending', 'approved', 'rejected', 'expired', 'invalidated'];
  const CONDITIONS = ['on_track', 'boundary', 'drift', 'loop', 'blocked', 'waiting', 'unknown', 'paused', 'achieved', 'idle'];
  const TRUST = ['claimed', 'measured', 'verified', 'accepted'];
  const ACTIONS = ['read', 'operate', 'approve', 'manage_hosts'];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const find = (list, id) => (list || []).find(x => x.id === id);

  function fnv1a(str, seed) {
    let h = (seed === undefined ? 0x811c9dc5 : seed) >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /** Demo digest for lookups. Not a cryptographic hash or a production protocol. */
  function digest(str) {
    return fnv1a(str).toString(16).padStart(8, '0') + fnv1a(str, 0x2545f491).toString(16).padStart(8, '0');
  }

  function nextId(profile, prefix) {
    profile.seq = (profile.seq || 0) + 1;
    return `${prefix}-${profile.seq.toString(36).padStart(3, '0')}`;
  }

  function nextRunId(profile) {
    profile.runSeq = (profile.runSeq || 150) + 1;
    return `R-${String(profile.runSeq).padStart(4, '0')}`;
  }

  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function txDigest(profile) {
    let n = fnv1a(`${profile.id}:${profile.seq}:${(profile.txs || []).length}`);
    let m = fnv1a(`${profile.seq}:${profile.id}`, 0x9e3779b9);
    let out = '';
    for (let i = 0; i < 22; i++) {
      const v = i % 2 ? n : m;
      out += B58[v % 58];
      if (i % 2) n = Math.imul(n ^ (n >>> 13), 0x5bd1e995) >>> 0;
      else m = Math.imul(m ^ (m >>> 15), 0x27d4eb2d) >>> 0;
    }
    return out;
  }

  const orgData = (profile, orgId) => profile.data[orgId || profile.currentOrgId];

  /* ------------------------------------------------------------------ OKR */

  /** clamp((current - baseline) / (target - baseline), 0, 1); null when unknown or invalid. */
  function krProgress(kr) {
    if (kr.binary) return kr.binary.verified ? 1 : 0;
    const m = kr.metric;
    if (!m || m.current === null || m.current === undefined || !isFinite(m.current)) return null;
    if (m.target === m.baseline) return null;
    return clamp((m.current - m.baseline) / (m.target - m.baseline), 0, 1);
  }

  function krStale(kr, now) {
    const m = kr.metric;
    return !!(m && m.staleAfter && m.sampledAt != null && now - m.sampledAt > m.staleAfter);
  }

  function achievement(okr, now) {
    const parts = okr.krs.map(kr => ({
      id: kr.id,
      weight: Math.max(0, Number(kr.weight) || 0),
      progress: krProgress(kr),
      stale: krStale(kr, now),
    }));
    const total = parts.reduce((s, p) => s + p.weight, 0);
    const unknown = parts.filter(p => p.progress === null || p.stale).map(p => p.id);
    if (!total) return { value: null, parts, unknown, atTarget: false };
    parts.forEach(p => { p.share = p.weight / total; });
    const value = parts.reduce((s, p) => s + (p.progress || 0) * p.weight, 0) / total;
    return { value, parts, unknown, atTarget: parts.length > 0 && parts.every(p => p.progress === 1) };
  }

  function krTrust(kr) {
    if (kr.acceptance && kr.acceptance.state === 'accepted') return 'accepted';
    if (kr.verification && kr.verification.state === 'passed') return 'verified';
    if (kr.metric && kr.metric.current !== null && kr.metric.current !== undefined && kr.metric.sampledAt) return 'measured';
    if (kr.claimed) return 'claimed';
    return null;
  }

  const depsMet = (okr, kr) => (kr.deps || []).every(d => (find(okr.krs, d) || {}).status === 'COMPLETE');

  /** Why a KR cannot be COMPLETE yet. Completion is separate from reaching 100%. */
  function krBlockers(okr, kr, evidence, now) {
    const out = [];
    if (krProgress(kr) !== 1) out.push('below_target');
    if (krStale(kr, now)) out.push('stale');
    const own = (evidence || []).filter(e => e.okrId === okr.id && e.krId === kr.id);
    if (!own.some(e => e.trust === 'verified' || e.trust === 'accepted')) out.push('no_verified_evidence');
    if (!kr.verification || kr.verification.state !== 'passed') out.push('not_verified');
    if (kr.verifyBy === 'user' && (!kr.acceptance || kr.acceptance.state !== 'accepted')) out.push('not_accepted');
    if (!depsMet(okr, kr)) out.push('deps_incomplete');
    return out;
  }

  function completeKr(okr, kr, evidence, now) {
    const blockers = krBlockers(okr, kr, evidence, now);
    if (blockers.length) return { ok: false, code: blockers[0], blockers };
    kr.status = 'COMPLETE';
    kr.completedAt = now;
    const unlocked = [];
    okr.krs.forEach(k => {
      if (k.status === 'PENDING' && depsMet(okr, k)) { k.status = 'IN_PROGRESS'; unlocked.push(k.id); }
    });
    return { ok: true, unlocked };
  }

  function criteriaReview(okr) {
    return okr.criteria.map(c => ({
      id: c.id,
      passed: c.krIds.length > 0 && c.krIds.every(id => (find(okr.krs, id) || {}).status === 'COMPLETE'),
    }));
  }

  const okrAchievable = okr => okr.krs.length > 0 && okr.krs.every(k => k.status === 'COMPLETE') && criteriaReview(okr).every(c => c.passed);

  const TASK_RE = /^(安装|实现|编写|开发|运行|跑|执行|修复|部署|重构|搭建)|^(install|implement|write|run|fix|deploy|refactor|set up|setup)\b/i;

  function hasCycle(krs) {
    const graph = new Map(krs.map((k, i) => [k.id || `kr${i}`, k.deps || []]));
    const mark = new Map();
    const visit = id => {
      if (mark.get(id) === 1) return true;
      if (mark.get(id) === 2) return false;
      mark.set(id, 1);
      for (const d of graph.get(id) || []) if (graph.has(d) && visit(d)) return true;
      mark.set(id, 2);
      return false;
    };
    return [...graph.keys()].some(visit);
  }

  /** Quality gate from okr-manager: quantified criteria, result-oriented KRs, confirmed limits. */
  function validateDraft(d, now) {
    const errors = [], warnings = [];
    const req = (cond, field, code) => { if (!cond) errors.push({ field, code }); };
    req(d.title && d.title.trim().length >= 4, 'title', 'required');
    req(['P0', 'P1', 'P2'].includes(d.priority), 'priority', 'required');
    req(!!d.ownerAgentId, 'owner', 'required');
    const crit = (d.criteria || []).map(s => String(s || '').trim()).filter(Boolean);
    req(crit.length >= 1 && crit.length <= 3, 'criteria', 'count');
    req(crit.some(s => /\d/.test(s)), 'criteria', 'quantified');
    const krs = d.krs || [];
    req(krs.length >= 1 && krs.length <= 3, 'krs', 'count');
    krs.forEach((k, i) => {
      req(k.title && String(k.title).trim(), `kr${i}.title`, 'required');
      const b = Number(k.baseline), t = Number(k.target);
      const numeric = k.baseline !== '' && k.target !== '' && k.baseline != null && k.target != null && isFinite(b) && isFinite(t);
      req(numeric, `kr${i}.metric`, 'numbers');
      if (numeric) req(b !== t, `kr${i}.metric`, 'baseline_equals_target');
      req(Number(k.weight) > 0, `kr${i}.weight`, 'positive');
      if (TASK_RE.test(String(k.title || '').trim())) warnings.push({ field: `kr${i}.title`, code: 'looks_like_task' });
    });
    if (hasCycle(krs)) errors.push({ field: 'krs', code: 'cycle' });
    // Every success criterion maps to at least one KR; free text alone cannot pass acceptance.
    const mapped = new Set(krs.map(k => Number(k.criterion)).filter(n => Number.isInteger(n)));
    crit.forEach((_, i) => { if (!mapped.has(i)) errors.push({ field: `criteria${i}`, code: 'unmapped' }); });
    const c = d.constraints || {};
    req(!!c.workspaceId, 'constraints.workspace', 'required');
    req(Number(c.budget) > 0, 'constraints.budget', 'positive');
    req(!!c.deadline && Date.parse(c.deadline) > now, 'constraints.deadline', 'future');
    req(c.verification && String(c.verification).trim(), 'constraints.verification', 'required');
    return { ok: errors.length === 0, errors, warnings };
  }

  const activeCount = org => org.okrs.filter(o => o.lifecycle === 'ACTIVE' || o.lifecycle === 'ACTIVATING').length;

  /** FR-40: workspace, deployed Agent, reachable host and authority before activation. */
  function readiness(org, okr, now) {
    const issues = [];
    if (!find(org.workspaces, okr.workspaceId)) issues.push('workspace_missing');
    const inst = find(org.instances, okr.instanceId);
    if (!inst) issues.push('agent_not_deployed');
    else if (inst.status === 'stopped') issues.push('agent_stopped');
    const host = find(org.hosts, okr.hostId);
    if (!host) issues.push('host_missing');
    else {
      if (host.status !== 'online') issues.push('host_offline');
      if (!host.accepting) issues.push('host_not_accepting');
      if (!host.membership || host.membership.state !== 'active') issues.push('host_not_member');
      else if (host.grant && host.grant.expiresAt && host.grant.expiresAt < now) issues.push('grant_expired');
    }
    return issues;
  }

  function requestActivation(org, okr, now) {
    if (okr.lifecycle === 'ACTIVE' || okr.lifecycle === 'ACTIVATING') return { ok: false, code: 'already_active' };
    if (activeCount(org) >= MAX_ACTIVE) {
      okr.lifecycle = 'CANDIDATE';
      okr.candidateReason = 'active_limit';
      return { ok: false, code: 'active_limit' };
    }
    const issues = readiness(org, okr, now);
    if (issues.length) {
      okr.lifecycle = 'CANDIDATE';
      okr.candidateReason = issues[0];
      return { ok: false, code: 'not_ready', issues };
    }
    okr.lifecycle = 'ACTIVATING';
    return { ok: true };
  }

  /**
   * Archiving keeps chain history. Work that is executing must be stopped first;
   * a run only waiting for approval executes nothing, so its request is invalidated.
   */
  function archiveOkr(org, okr, now) {
    if (!okr || okr.lifecycle === 'ACHIEVED' || okr.lifecycle === 'ARCHIVED') return { ok: false, code: 'not_archivable' };
    if (org.runs.some(r => r.okrId === okr.id && ['queued', 'running', 'recovering'].includes(r.state))) return { ok: false, code: 'run_active' };
    org.runs.forEach(r => {
      if (r.okrId === okr.id && r.state === 'awaiting_approval') { r.state = 'cancelled'; r.endedAt = now; r.note = 'archived'; }
    });
    org.approvals.forEach(a => {
      if (a.okrId === okr.id && a.state === 'pending') { a.state = 'invalidated'; a.invalidatedAt = now; }
    });
    okr.lifecycle = 'ARCHIVED';
    okr.archivedAt = now;
    okr.version += 1;
    return { ok: true };
  }

  function confirmActivation(org, okr, now) {
    if (okr.lifecycle !== 'ACTIVATING') return { ok: false, code: 'not_activating' };
    okr.lifecycle = 'ACTIVE';
    okr.activatedAt = now;
    okr.candidateReason = null;
    okr.krs.forEach(k => { if (k.status === 'PENDING' && depsMet(okr, k)) k.status = 'IN_PROGRESS'; });
    return { ok: true };
  }

  /* ------------------------------------------------------------ Budget */

  const budgetLeft = b => b.limit - b.spent - (b.reserved || 0);

  /** A new agreement version invalidates pending boundary approvals bound to the old one. */
  function updateConstraints(org, okr, patch, now) {
    if (patch.budgetLimit != null) okr.constraints.budget.limit = patch.budgetLimit;
    if (patch.deadline != null) okr.constraints.deadline = patch.deadline;
    okr.constraints.version += 1;
    okr.constraints.confirmedAt = now;
    okr.version += 1;
    const invalidated = [];
    org.approvals.forEach(a => {
      if (a.okrId === okr.id && a.kind === 'boundary' && a.state === 'pending' && a.boundVersion !== okr.constraints.version) {
        a.state = 'invalidated';
        a.invalidatedAt = now;
        invalidated.push(a.id);
      }
    });
    const s = okr.nav.scenario;
    if (s && s.code === 'boundary' && s.need <= budgetLeft(okr.constraints.budget)) okr.nav.scenario = null;
    return { ok: true, invalidated };
  }

  function expireApprovals(org, now) {
    let n = 0;
    org.approvals.forEach(a => {
      if (a.state === 'pending' && a.expiresAt && now > a.expiresAt) { a.state = 'expired'; n++; }
    });
    return n;
  }

  /* -------------------------------------------------------- Navigation */

  const currentKr = okr => okr.krs.find(k => k.status === 'IN_PROGRESS' && !awaitingAcceptance(k) && depsMet(okr, k)) || null;
  const awaitingAcceptance = kr => !!(kr.acceptance && kr.acceptance.state === 'pending');
  const lastVerifiedKr = okr => [...okr.krs].reverse().find(k => k.verification && k.verification.state === 'passed') || null;

  function nextStep(okr) {
    const kr = currentKr(okr);
    if (!kr || !kr.plan) return null;
    const route = kr.plan[kr.route || 'A'];
    if (!route) return null;
    return route.steps[kr.stepIndex || 0] || null;
  }

  function currentRun(org, okr) {
    return org.runs.find(r => r.okrId === okr.id && ['queued', 'running', 'awaiting_approval', 'recovering'].includes(r.state)) || null;
  }

  /** Road condition (PRD §8.2). Direction and authorization are reported separately. */
  function condition(org, okr, now) {
    if (okr.lifecycle === 'ACHIEVED') return { code: 'achieved' };
    if (okr.lifecycle !== 'ACTIVE') return { code: 'idle' };
    const host = find(org.hosts, okr.hostId);
    if (!host || host.status !== 'online') return { code: 'unknown', reason: 'host_offline', since: host ? host.lastHeartbeatAt : null };
    if (okr.nav.observation === 'lost') return { code: 'unknown', reason: 'observation_lost', since: okr.nav.lostAt };
    const s = okr.nav.scenario;
    if (s) return { code: s.code, reason: s.reason, scenario: true, since: s.at };
    if (okr.nav.paused) return { code: 'paused', reason: okr.nav.pausedReason || 'user_paused' };
    const pending = org.approvals.find(a => a.okrId === okr.id && a.kind === 'boundary' && approvalStatus(a, now) === 'pending');
    if (pending) return { code: 'boundary', reason: 'awaiting_approval', approvalId: pending.id };
    if (okr.nav.blocked) return { code: 'blocked', reason: okr.nav.blocked.reason, krId: okr.nav.blocked.krId };
    const c = okr.constraints;
    if (c.deadline && now > c.deadline) return { code: 'boundary', reason: 'deadline' };
    if (!host.membership || host.membership.state !== 'active' || (host.grant && host.grant.expiresAt && host.grant.expiresAt < now)) {
      return { code: 'boundary', reason: 'permission' };
    }
    const step = nextStep(okr);
    if (step && step.cost > budgetLeft(c.budget)) return { code: 'boundary', reason: 'budget', need: step.cost, left: budgetLeft(c.budget) };
    const w = okr.nav.waiting;
    if (w) return { code: 'waiting', reason: w.reason, on: w.on, until: w.until, overdue: now > w.until };
    if (!currentKr(okr)) {
      const pendingAcceptance = okr.krs.find(awaitingAcceptance);
      if (pendingAcceptance) return { code: 'waiting', reason: 'awaiting_acceptance', krId: pendingAcceptance.id };
      if (org.approvals.some(a => a.okrId === okr.id && a.kind === 'okr_acceptance' && approvalStatus(a, now) === 'pending')) {
        return { code: 'waiting', reason: 'awaiting_final_acceptance' };
      }
    }
    return { code: 'on_track' };
  }

  /* ---------------------------------------------------------- Activity */

  function log(profile, org, entry, now) {
    org.activity.unshift(Object.assign({ id: nextId(profile, 'act'), at: now }, entry));
    if (org.activity.length > 80) org.activity.length = 80;
  }

  function addEvidence(profile, org, e, now) {
    const ev = Object.assign({ id: nextId(profile, 'ev'), at: now, demo: true }, e);
    org.evidence.unshift(ev);
    return ev;
  }

  /* ------------------------------------------------ Heartbeat simulator */

  function ensureRun(profile, org, okr, kr, now) {
    let run = currentRun(org, okr);
    if (run && run.krId === kr.id) return run;
    if (run) { run.state = 'succeeded'; run.endedAt = now; }
    let task = org.tasks.find(t => t.okrId === okr.id && t.krId === kr.id && t.state !== 'Completed');
    if (!task) {
      task = { id: nextId(profile, 'task'), okrId: okr.id, krId: kr.id, title: kr.taskTitle || kr.title, state: 'Assigned', createdAt: now };
      org.tasks.push(task);
    }
    run = {
      id: nextRunId(profile), okrId: okr.id, krId: kr.id, taskId: task.id,
      hostId: okr.hostId, instanceId: okr.instanceId, state: 'running', attempt: 1, startedAt: now,
      title: kr.runTitle || kr.taskTitle || kr.title, sideEffects: [],
    };
    org.runs.unshift(run);
    return run;
  }

  function verifierPass(profile, org, okr, kr, now) {
    kr.verification = { state: 'passed', by: kr.verifier || 'agent-reviewer', ruleVersion: kr.ruleVersion || 'v2', at: now };
    org.evidence.forEach(e => {
      if (e.okrId === okr.id && e.krId === kr.id && e.kind === 'measurement' && e.trust === 'measured') e.trust = 'verified';
    });
    addEvidence(profile, org, {
      okrId: okr.id, krId: kr.id, kind: 'verification', trust: 'verified', result: 'pass',
      verifier: kr.verification.by, ruleVersion: kr.verification.ruleVersion,
    }, now);
  }

  /**
   * One simulated heartbeat for an OKR. It advances only unblocked work inside the
   * confirmed agreement, and only notifies on progress, blockers or decisions.
   * Duplicate heartbeat ids (reconnect replays) are ignored.
   */
  function heartbeat(profile, orgId, okrId, now, hbId) {
    const org = orgData(profile, orgId);
    const okr = find(org.okrs, okrId);
    if (!okr) return { ok: false, code: 'missing' };
    org.seenHeartbeats = org.seenHeartbeats || [];
    if (hbId) {
      if (org.seenHeartbeats.includes(hbId)) return { ok: false, code: 'duplicate' };
      org.seenHeartbeats.push(hbId);
      if (org.seenHeartbeats.length > 200) org.seenHeartbeats.shift();
    }
    expireApprovals(org, now);
    const cond = condition(org, okr, now);
    if (cond.code !== 'on_track') return { ok: false, code: cond.code, cond };

    const kr = currentKr(okr);
    if (!kr) {
      if (okrAchievable(okr) && !org.approvals.some(a => a.okrId === okr.id && a.kind === 'okr_acceptance' && a.state === 'pending')) {
        const apv = createApproval(profile, org, {
          kind: 'okr_acceptance', okrId: okr.id, boundVersion: okr.constraints.version, expiresAt: now + 3 * DAY,
        }, now);
        log(profile, org, { okrId: okr.id, kind: 'criteria_review', approvalId: apv.id }, now);
        return { ok: true, code: 'final_review', approvalId: apv.id };
      }
      return { ok: false, code: 'nothing_to_do' };
    }

    const run = ensureRun(profile, org, okr, kr, now);
    const task = find(org.tasks, run.taskId);

    // A returned result is reworked (evidence supplemented) before it is resubmitted.
    if (kr.rework) {
      kr.rework = false;
      log(profile, org, { okrId: okr.id, krId: kr.id, runId: run.id, kind: 'rework' }, now);
      okr.version += 1;
      return { ok: true, code: 'rework' };
    }

    // At target: verification before completion. A measurement alone never lights a checkpoint.
    if (krProgress(kr) === 1) {
      if (!kr.verification || kr.verification.state === 'none') {
        kr.verification = { state: 'pending', at: now };
        if (task) task.state = 'Submitted';
        log(profile, org, { okrId: okr.id, krId: kr.id, runId: run.id, kind: 'verify_start' }, now);
        okr.version += 1;
        return { ok: true, code: 'verify_start' };
      }
      if (kr.verification.state === 'pending') {
        verifierPass(profile, org, okr, kr, now);
        if (task) task.state = 'Verified';
        run.state = 'succeeded';
        run.endedAt = now;
        okr.version += 1;
        if (kr.verifyBy === 'user') {
          kr.acceptance = { state: 'pending', at: now };
          const apv = createApproval(profile, org, {
            kind: 'acceptance', okrId: okr.id, krId: kr.id, boundVersion: okr.constraints.version, expiresAt: now + 3 * DAY,
          }, now);
          log(profile, org, { okrId: okr.id, krId: kr.id, kind: 'verify_pass', needsAcceptance: true, approvalId: apv.id }, now);
          return { ok: true, code: 'acceptance_requested', approvalId: apv.id };
        }
        kr.acceptance = { state: 'accepted', by: kr.verification.by, preauthorized: true, at: now };
        org.evidence.forEach(e => { if (e.okrId === okr.id && e.krId === kr.id && e.kind === 'verification') e.trust = 'accepted'; });
        const res = completeKr(okr, kr, org.evidence, now);
        if (task && res.ok) task.state = 'Completed';
        log(profile, org, { okrId: okr.id, krId: kr.id, kind: 'complete', unlocked: res.unlocked || [] }, now);
        return { ok: true, code: 'kr_complete', unlocked: res.unlocked };
      }
      return { ok: false, code: 'verification_failed' };
    }

    const routeKey = kr.route || 'A';
    const route = kr.plan && kr.plan[routeKey];
    if (!route) return { ok: false, code: 'no_plan' };

    // Gate: an action outside the agreement needs an approval bound to this route and
    // agreement version. An approved action executes here; approval alone is not execution.
    const gated = org.approvals.filter(a => a.okrId === okr.id && a.krId === kr.id && a.kind === 'boundary' && a.route === routeKey);
    const executed = gated.some(a => a.state === 'approved' && a.execution);
    const approved = gated.find(a => a.state === 'approved' && !a.execution);
    if (route.gate && !executed && !approved) {
      if (gated.some(a => a.state === 'rejected')) {
        okr.nav.blocked = { reason: 'external_rejected', krId: kr.id };
        run.state = 'awaiting_approval';
        return { ok: false, code: 'blocked' };
      }
      const apv = createApproval(profile, org, Object.assign({
        kind: 'boundary', okrId: okr.id, krId: kr.id, runId: run.id, route: routeKey,
        boundVersion: okr.constraints.version, expiresAt: now + 20 * HOUR,
      }, route.gate), now);
      run.state = 'awaiting_approval';
      log(profile, org, { okrId: okr.id, krId: kr.id, runId: run.id, kind: 'gate', approvalId: apv.id }, now);
      okr.version += 1;
      return { ok: true, code: 'approval_requested', approvalId: apv.id };
    }

    const step = route.steps[kr.stepIndex || 0];
    if (!step) return { ok: false, code: 'no_step' };
    const b = okr.constraints.budget;
    if (step.cost > budgetLeft(b)) return { ok: false, code: 'boundary', cond: { code: 'boundary', reason: 'budget' } };

    if (approved) {
      approved.execution = { runId: run.id, at: now, result: 'executed' };
      log(profile, org, { okrId: okr.id, krId: kr.id, runId: run.id, kind: 'approved_exec', approvalId: approved.id }, now);
    }
    run.state = 'running';
    b.spent += step.cost;
    kr.metric.current = step.value;
    kr.metric.sampledAt = now;
    kr.stepIndex = (kr.stepIndex || 0) + 1;
    okr.trend.push({ at: now, value: achievement(okr, now).value });
    if (okr.trend.length > 24) okr.trend.shift();
    addEvidence(profile, org, {
      okrId: okr.id, krId: kr.id, runId: run.id, kind: 'measurement', trust: 'measured',
      value: step.value, unit: kr.metric.unit,
    }, now);
    log(profile, org, { okrId: okr.id, krId: kr.id, runId: run.id, kind: 'measure', value: step.value, cost: step.cost, route: routeKey }, now);
    okr.version += 1;
    return { ok: true, code: 'progress', value: step.value, cost: step.cost };
  }

  /* --------------------------------------------------------- Approvals */

  function createApproval(profile, org, fields, now) {
    const a = Object.assign({ id: nextId(profile, 'apv'), state: 'pending', createdAt: now }, fields);
    org.approvals.unshift(a);
    return a;
  }

  function approvalStatus(a, now) {
    return a.state === 'pending' && a.expiresAt && now > a.expiresAt ? 'expired' : a.state;
  }

  /** Checks shared by the pre-signing check and the confirmation (re-validated at commit). */
  function checkDecision(org, a, ctx, now) {
    if (!a) return { ok: false, code: 'missing' };
    if (a.state !== 'pending') return { ok: false, code: 'not_pending' };
    if (a.expiresAt && now > a.expiresAt) return { ok: false, code: 'expired' };
    const okr = find(org.okrs, a.okrId);
    if (a.kind === 'boundary' && okr && a.boundVersion !== okr.constraints.version) return { ok: false, code: 'invalidated' };
    if (a.kind === 'standing') {
      const ag = find(org.agents, a.agentId);
      if (!ag || a.boundVersion !== ag.standing.version) return { ok: false, code: 'invalidated' };
    }
    if (!ctx || !ctx.ok) return { ok: false, code: (ctx && ctx.code) || 'no_permission' };
    return { ok: true };
  }

  /** Records a decision. "Approved" authorizes one bound action; it does not mean executed. */
  function decide(profile, org, id, decision, ctx, now) {
    const a = find(org.approvals, id);
    const chk = checkDecision(org, a, ctx, now);
    if (!chk.ok) {
      if (a && chk.code === 'expired') a.state = 'expired';
      if (a && chk.code === 'invalidated') a.state = 'invalidated';
      return chk;
    }
    const approve = decision === 'approve';
    a.state = approve ? 'approved' : 'rejected';
    a.decidedAt = now;
    a.decidedBy = ctx.deviceId || null;
    if (a.kind === 'standing') {
      log(profile, org, { agentId: a.agentId, kind: approve ? 'standing_approved' : 'standing_rejected', approvalId: a.id }, now);
      return { ok: true };
    }
    const okr = find(org.okrs, a.okrId);
    if (!okr) return { ok: true };
    okr.version += 1;
    if (a.kind === 'boundary') {
      if (!approve) okr.nav.blocked = { reason: 'external_rejected', krId: a.krId };
      log(profile, org, { okrId: okr.id, krId: a.krId, kind: approve ? 'approved' : 'rejected', approvalId: a.id }, now);
    } else if (a.kind === 'acceptance') {
      const kr = find(okr.krs, a.krId);
      if (approve) {
        kr.acceptance = { state: 'accepted', by: ctx.deviceId || 'user', at: now };
        org.evidence.forEach(e => { if (e.okrId === okr.id && e.krId === kr.id && e.kind === 'verification') e.trust = 'accepted'; });
        const res = completeKr(okr, kr, org.evidence, now);
        const task = org.tasks.find(t => t.okrId === okr.id && t.krId === kr.id && t.state === 'Verified');
        if (task && res.ok) task.state = 'Completed';
        log(profile, org, { okrId: okr.id, krId: kr.id, kind: 'accepted', unlocked: res.unlocked || [] }, now);
      } else {
        kr.acceptance = { state: 'returned', at: now, reason: ctx.reason || null };
        kr.verification = { state: 'none' };
        kr.status = 'IN_PROGRESS';
        kr.rework = true;
        kr.returned = (kr.returned || 0) + 1;
        const task = org.tasks.find(t => t.okrId === okr.id && t.krId === kr.id && t.state !== 'Completed');
        if (task) task.state = 'Assigned';
        log(profile, org, { okrId: okr.id, krId: kr.id, kind: 'returned' }, now);
      }
    } else if (a.kind === 'okr_acceptance') {
      if (approve) achieveOkr(profile, org, okr, now);
      else log(profile, org, { okrId: okr.id, kind: 'final_returned' }, now);
    }
    return { ok: true };
  }

  function achieveOkr(profile, org, okr, now) {
    okr.lifecycle = 'ACHIEVED';
    okr.achievedAt = now;
    org.results.unshift({ id: nextId(profile, 'res'), okrId: okr.id, at: now, evidenceIds: org.evidence.filter(e => e.okrId === okr.id && e.trust === 'accepted').map(e => e.id) });
    org.memories.unshift({
      id: nextId(profile, 'mem'), kind: 'result', okrId: okr.id, title: okr.title, body: null,
      source: { okrId: okr.id }, version: 1, updatedAt: now, state: 'active', encrypted: true,
    });
    log(profile, org, { okrId: okr.id, kind: 'achieved' }, now);
  }

  /* -------------------------------------------------------------- Runs */

  function requestStop(run) {
    if (!['queued', 'running', 'awaiting_approval', 'recovering'].includes(run.state)) return { ok: false, code: 'not_stoppable' };
    if (run.stopping) return { ok: false, code: 'already_stopping' };
    run.stopping = true;
    return { ok: true };
  }

  /** Only the execution device's confirmation turns "stopping" into "cancelled". */
  function confirmStop(org, run, now) {
    if (!run.stopping) return { ok: false, code: 'not_stopping' };
    run.stopping = false;
    run.state = 'cancelled';
    run.endedAt = now;
    const okr = find(org.okrs, run.okrId);
    if (okr) { okr.nav.paused = true; okr.nav.pausedReason = 'run_cancelled'; okr.version += 1; }
    return { ok: true };
  }

  /** J3: a retry is a new Run; the earlier record and its side effects stay. */
  function resolveConfirmation(profile, org, run, outcome, now) {
    if (run.state !== 'needs_confirmation') return { ok: false, code: 'not_pending' };
    if (outcome === 'executed') {
      run.state = 'succeeded';
      run.resolution = 'confirmed_executed';
      run.endedAt = now;
      return { ok: true };
    }
    run.state = 'failed';
    run.resolution = 'confirmed_not_executed';
    run.endedAt = now;
    const retry = {
      id: nextRunId(profile), okrId: run.okrId, krId: run.krId, taskId: run.taskId,
      hostId: run.hostId, instanceId: run.instanceId, state: 'queued', attempt: (run.attempt || 1) + 1,
      parentRunId: run.id, startedAt: now, title: run.title, sideEffects: [],
    };
    org.runs.unshift(retry);
    return { ok: true, retryId: retry.id };
  }

  /* --------------------------------------------- Scenarios and resume */

  /**
   * Review-only: inject a labeled observation for the road-condition map. The
   * product UI resolves each one through the same checks as real execution.
   */
  function injectScenario(profile, org, okr, code, now) {
    okr.nav.scenario = null;
    okr.nav.waiting = null;
    okr.nav.observation = 'ok';
    if (code === 'normal') {
      okr.nav.blocked = null;
      okr.nav.paused = false;
      okr.nav.pausedReason = null;
    } else if (code === 'waiting') {
      okr.nav.waiting = { reason: 'dependency', on: 'device_farm', until: now + 20 * MIN };
    } else if (code === 'unknown') {
      okr.nav.observation = 'lost';
      okr.nav.lostAt = now;
    } else if (code === 'boundary') {
      okr.nav.scenario = { code, reason: 'budget_reservation', need: budgetLeft(okr.constraints.budget) + 600, at: now };
    } else {
      const reason = { drift: 'unrelated_actions', loop: 'repeated_failure', blocked: 'path_excluded' }[code];
      if (!reason) return { ok: false, code: 'unknown_scenario' };
      okr.nav.scenario = { code, reason, at: now };
    }
    okr.version += 1;
    log(profile, org, { okrId: okr.id, kind: 'scenario', scenario: code }, now);
    return { ok: true };
  }

  function resolveScenario(profile, org, okr, action, now) {
    const s = okr.nav.scenario;
    if (action === 'dependency_returned') {
      if (!okr.nav.waiting) return { ok: false, code: 'not_waiting' };
      okr.nav.waiting = null;
    } else if (action === 'reconnect') {
      if (okr.nav.observation !== 'lost') return { ok: false, code: 'not_lost' };
      okr.nav.observation = 'ok';
      okr.nav.paused = true;
      okr.nav.pausedReason = 'reconciled';
    } else {
      if (!s) return { ok: false, code: 'no_scenario' };
      if (action === 'reroute' || action === 'cheaper' || action === 'replan') {
        const kr = currentKr(okr);
        if (kr && kr.plan && kr.plan.B && (kr.route || 'A') !== 'B') {
          okr.nav.scenario = null;
          return switchRoute(profile, org, okr, 'B', now);
        }
      }
      okr.nav.scenario = null;
    }
    okr.version += 1;
    log(profile, org, { okrId: okr.id, kind: 'resolved', action }, now);
    return { ok: true };
  }

  /** Explicit continue after pause, stop, reassignment or reconnection. */
  function resumeOkr(profile, org, okr, now) {
    if (!okr.nav.paused) return { ok: false, code: 'not_paused' };
    const host = find(org.hosts, okr.hostId);
    if (!host || host.status !== 'online') return { ok: false, code: 'host_offline' };
    if (!host.membership || host.membership.state !== 'active') return { ok: false, code: 'revoked' };
    const inst = find(org.instances, okr.instanceId);
    if (!inst || inst.status === 'stopped') return { ok: false, code: 'agent_stopped' };
    okr.nav.paused = false;
    okr.nav.pausedReason = null;
    okr.version += 1;
    log(profile, org, { okrId: okr.id, kind: 'resumed' }, now);
    return { ok: true };
  }

  /* ------------------------------------------------------------- Hosts */

  function assignIssues(org, okr, hostId, instanceId) {
    const issues = [];
    const host = find(org.hosts, hostId);
    const inst = find(org.instances, instanceId);
    if (!host) return ['host_missing'];
    // Without the source's confirmed stop, a move could run the same work twice.
    const src = find(org.hosts, okr.hostId);
    if (src && src.id !== hostId && src.status !== 'online') issues.push('source_unreachable');
    if (host.status !== 'online') issues.push('target_offline');
    if (!host.accepting) issues.push('target_not_accepting');
    if (!host.membership || host.membership.state !== 'active') issues.push('target_not_member');
    if (!inst || inst.hostId !== hostId) issues.push('instance_missing');
    else {
      if (inst.agentId !== okr.ownerAgentId) issues.push('agent_mismatch');
      if (inst.status === 'stopped') issues.push('agent_stopped');
      if (!constrainable(inst)) issues.push('observe_only');
    }
    const ws = find(org.workspaces, okr.workspaceId);
    if (ws && !ws.hostIds.includes(hostId)) issues.push('workspace_unavailable');
    return issues;
  }

  /** FR-29: pause the old loop, keep the checkpoint, and wait for an explicit continue. */
  function reassign(profile, org, okr, hostId, instanceId, now) {
    if (okr.hostId === hostId && okr.instanceId === instanceId) return { ok: false, code: 'same_target' };
    const issues = assignIssues(org, okr, hostId, instanceId);
    if (issues.length) return { ok: false, code: issues[0], issues };
    const run = currentRun(org, okr);
    if (run) { run.state = 'cancelled'; run.endedAt = now; run.note = 'reassigned'; }
    const from = { hostId: okr.hostId, instanceId: okr.instanceId };
    okr.hostId = hostId;
    okr.instanceId = instanceId;
    okr.nav.paused = true;
    okr.nav.pausedReason = 'reassigned';
    okr.version += 1;
    log(profile, org, { okrId: okr.id, kind: 'reassigned', from, to: { hostId, instanceId }, runId: run ? run.id : null }, now);
    return { ok: true };
  }

  function hostCommand(profile, org, hostId, instanceId, cmd, ctx, now) {
    if (!ctx || !ctx.ok) return { ok: false, code: (ctx && ctx.code) || 'no_permission' };
    const host = find(org.hosts, hostId);
    if (!host) return { ok: false, code: 'missing' };
    if (host.status !== 'online') return { ok: false, code: 'host_offline' };
    if (!host.membership || host.membership.state !== 'active') return { ok: false, code: 'revoked' };
    const receipt = { id: nextId(profile, 'cmd'), cmd, hostId, instanceId: instanceId || null, at: now, state: 'sent' };
    org.receipts.unshift(receipt);
    if (org.receipts.length > 40) org.receipts.length = 40;
    return { ok: true, receipt };
  }

  function ackCommand(profile, org, receiptId, now) {
    const r = find(org.receipts, receiptId);
    if (!r) return { ok: false, code: 'missing' };
    if (r.state === 'acked') return { ok: false, code: 'already_acked' };
    r.state = 'acked';
    r.ackedAt = now;
    const inst = find(org.instances, r.instanceId);
    if (inst && (r.cmd === 'stop' || r.cmd === 'restart')) {
      inst.status = r.cmd === 'stop' ? 'stopped' : 'idle';
      org.okrs.filter(o => o.instanceId === inst.id && o.lifecycle === 'ACTIVE').forEach(o => {
        o.nav.paused = true;
        o.nav.pausedReason = r.cmd === 'stop' ? 'instance_stopped' : 'instance_restarted';
        o.version += 1;
        const run = currentRun(org, o);
        if (run) { run.state = 'cancelled'; run.endedAt = now; run.note = r.cmd; }
      });
    }
    return { ok: true, receipt: r };
  }

  /* ----------------------------------------------------------- Invites */

  function inviteStatus(inv, now) {
    if ((inv.state === 'active') && now > inv.expiresAt) return 'expired';
    return inv.state;
  }

  function createInvite(profile, org, opts, codeDigest, now) {
    // A bootstrap PTB creates the binding and the invite together, so it may
    // target a binding that is still pending in the same transaction.
    const binding = opts.bindingId
      ? org.bindings.find(b => b.id === opts.bindingId && (b.state === 'confirmed' || b.state === 'pending'))
      : org.bindings.find(b => b.state === 'confirmed');
    if (!binding) return { ok: false, code: 'no_binding' };
    const ttl = INVITE_TTL[opts.ttl] ? opts.ttl : '1h';
    const inv = {
      id: nextId(profile, 'inv'), state: 'signing', ttl, createdAt: now, expiresAt: now + INVITE_TTL[ttl],
      grantDays: 7, desktop: !!opts.desktop, workspaceIds: opts.workspaceIds || [], bindingId: binding.id,
      codeDigest, maxUses: 1, pubKey: `ed25519:${codeDigest.slice(0, 12)}`,
      bindingVersion: binding.version || 1,
    };
    org.invites.unshift(inv);
    return { ok: true, invite: inv };
  }

  /**
   * Demo stand-in for the device-bound redemption proof: it binds the invitation
   * and the redeeming device key, so a copied proof cannot enroll another device.
   */
  const redeemProof = (inviteId, codeDigest, deviceKey) => digest(`fm-invite-proof:1:${inviteId}:${codeDigest}:${deviceKey}`);

  /** Atomic in the simulation: consume the invite, create membership and the capped grant. */
  function redeemInvite(profile, org, inviteId, device, now) {
    const inv = find(org.invites, inviteId);
    if (!inv) return { ok: false, code: 'missing' };
    const st = inviteStatus(inv, now);
    if (st !== 'active') return { ok: false, code: st === 'signing' ? 'pending' : st };
    if (!device || device.proof !== redeemProof(inv.id, inv.codeDigest, device.deviceKey)) return { ok: false, code: 'bad_proof' };
    const binding = find(org.bindings, inv.bindingId);
    if (!binding || binding.state !== 'confirmed' || (binding.version || 1) !== (inv.bindingVersion || 1)) return { ok: false, code: 'binding_changed' };
    inv.state = 'consumed';
    inv.consumedAt = now;
    const host = {
      id: nextId(profile, 'host'), name: device.name, kind: device.kind || 'local', location: device.location || null,
      os: device.os, arch: device.arch || 'x86_64', status: 'connecting', accepting: true,
      desktop: device.desktop && inv.desktop ? 'supported' : 'headless', lastHeartbeatAt: null, cpu: null, mem: null,
      bindingId: inv.bindingId, deviceKey: device.deviceKey,
      membership: { state: 'active', via: 'invite', inviteId: inv.id, since: now },
      grant: { actions: ['execute'], desktop: !!inv.desktop, expiresAt: now + inv.grantDays * DAY },
    };
    org.hosts.push(host);
    inv.consumedBy = host.id;
    return { ok: true, host };
  }

  /* ------------------------------------------- This computer's service */

  /** Coordinator endpoint scopes. Only loopback may use plain HTTP. */
  const ENDPOINT_SCOPES = ['loopback', 'lan', 'public'];
  function validEndpoint(scope, endpoint) {
    if (!ENDPOINT_SCOPES.includes(scope) || typeof endpoint !== 'string') return false;
    if (scope === 'loopback') return /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(endpoint);
    return /^https:\/\/[\w.-]+(:\d{2,5})?$/.test(endpoint) && !/^https:\/\/(127\.|localhost)/.test(endpoint);
  }

  /** Background service (envd as Host + Coordinator) on this computer. It is
   * device-local state; chain membership and bindings stay in the org. */
  function localServiceFor(profile) {
    if (!profile.localService) profile.localService = { state: 'not_installed', hostId: null, bindingId: null, startAtLogin: true, keys: false };
    return profile.localService;
  }

  function setLocalServiceRunning(profile, org, running, now) {
    const svc = localServiceFor(profile);
    if (svc.state === 'not_installed') return { ok: false, code: 'not_installed' };
    svc.state = running ? 'running' : 'stopped';
    const host = find(org.hosts, svc.hostId);
    const binding = find(org.bindings, svc.bindingId);
    if (binding) binding.online = running;
    if (host) {
      if (running) return connectHost(org, host.id, true, now);
      host.status = 'offline';
    }
    return { ok: true };
  }

  /** New endpoint for a binding: a new version; invites signed for the old
   * version can no longer be redeemed, and hosts reconnect to the new one. */
  function updateBinding(org, bindingId, scope, endpoint, now) {
    const b = find(org.bindings, bindingId);
    if (!b || b.state !== 'confirmed') return { ok: false, code: 'not_confirmed' };
    if (!validEndpoint(scope, endpoint)) return { ok: false, code: 'invalid_endpoint' };
    b.version = (b.version || 1) + 1;
    b.scope = scope;
    b.endpoint = endpoint;
    b.updatedAt = now;
    org.invites.forEach(inv => {
      if (inv.bindingId === b.id && (inv.state === 'active' || inv.state === 'signing') && (inv.bindingVersion || 1) !== b.version) {
        inv.state = 'revoked';
        inv.revokedAt = now;
        inv.superseded = true;
      }
    });
    org.hosts.forEach(h => { if (h.bindingId === b.id && h.status === 'online') h.status = 'connecting'; });
    return { ok: true, binding: b };
  }

  /* Agents (issue #67). An Agent is a Home directory with Agent OS files and
   * skills; its AGENTS.md frontmatter names it and says how to launch it
   * (launcher + profile, which decides the model) and when it wakes up
   * (heartbeat / schedules). agent-manager runs it in tmux as `<name>--main`.
   * A new Agent is created from a ROM (roms/agent-os-roms/roms). */
  const CORE_FILES = ['SYSTEM.md', 'SOUL.md', 'AGENTS.md', 'USER.md', 'HEARTBEAT.md', 'OKR.md', 'okrs/Candidate.md', 'memory/index.md'];
  const ROMS = [
    {
      id: 'hermes-agent', family: 'personal-home', version: '0.1.0', compat: 'fully-compatible', heartbeat: 'proactive',
      desc: { zh: '温和、以工具执行为主的个人与家庭助手；心跳与 dream 维护，先做后问。', en: 'A warm, tool-driven personal and household operator; heartbeat and dream maintenance, acts before asking.' },
      files: CORE_FILES.concat(['DREAM.md', 'TODO.md', 'MEMORY.md', 'TOOLS.md', 'IDENTITY.md']),
      included: [], optional: [],
    },
    {
      id: 'manager-heavy-core', family: 'manager-heavy', version: '0.6.0', compat: 'fully-compatible', heartbeat: 'proactive',
      desc: { zh: '以管理为先：多 Agent 协调、OKR 驱动执行、TODO 优先的心跳与 dream 维护边界。', en: 'Manager-first: multi-Agent coordination, OKR-driven execution, TODO-first heartbeat and dream boundaries.' },
      files: CORE_FILES.concat(['DREAM.md', 'TODO.md', 'MEMORY.md', 'TOOLS.md']),
      included: ['agent-manager', 'team-manager'], optional: ['agent-calendar', 'turbo-frequency', 'notifier'],
    },
    {
      id: 'mentor-coordinator-core', family: 'manager-heavy', version: '0.1.0', compat: 'draft-compatible', heartbeat: 'proactive',
      desc: { zh: '导师带领的协调型工作区：TODO 优先心跳、文件记忆，发送后核验。', en: 'Mentor-led coordination: TODO-first heartbeat, file memory, verify after sending.' },
      files: ['SYSTEM.md', 'SOUL.md', 'AGENTS.md', 'USER.md', 'HEARTBEAT.md', 'TODO.md', 'OKR.md'],
      included: ['agent-manager', 'planning-with-files', 'slack-workspace-inspector', 'sentry-event-query', 'use-fractalbot'], optional: [],
    },
    {
      id: 'trinity', family: 'manager-heavy', version: '0.1.0', compat: 'draft-compatible', heartbeat: 'proactive',
      desc: { zh: '“AI 员工”：关注指定会话与线程，严格跟进，以证据交付。', en: 'An “AI employee” for watched threads: strict follow-up and evidence-driven delivery.' },
      files: ['SYSTEM.md', 'SOUL.md', 'AGENTS.md', 'USER.md', 'HEARTBEAT.md', 'TODO.md', 'OKR.md', 'okrs/Candidate.md'],
      included: ['agent-manager', 'use-fractalbot', 'turbo-frequency'], optional: [],
    },
  ];
  const AGENT_NAME = /^[a-z][a-z0-9-]{1,30}$/;
  const HOME_PATH = /^(~|\/)[^\s]*[^/\s]$/;

  /** What the host reports about a folder before anything is written. */
  function homeState(host, path) {
    const known = ((host && host.folders) || {})[path];
    if (known) return known;
    return HOME_PATH.test(path || '') ? 'new' : 'invalid';
  }
  function createAgentIssues(profile, org, input) {
    const svc = localServiceFor(profile);
    const issues = [];
    const host = find(org.hosts, input && input.hostId);
    const name = String((input && input.name) || '').trim();
    const home = String((input && input.home) || '').trim();
    if (!AGENT_NAME.test(name)) issues.push('name');
    else if (org.agents.some(a => String(a.namespace || a.name).toLowerCase() === name)) issues.push('name_taken');
    const state = homeState(host, home);
    if (!home || state === 'invalid') issues.push('home');
    else if (state === 'agent_home') issues.push('home_is_agent');
    else if (state === 'not_empty') issues.push('home_not_empty');
    else if (org.agents.some(a => a.home === home && a.hostId === (input && input.hostId))) issues.push('home_taken');
    const rom = ROMS.find(r => r.id === (input && input.romId));
    if (!rom) issues.push('rom');
    else if ((input.optionalSkills || []).some(k => !rom.optional.includes(k))) issues.push('skills');
    if (!input || input.hostId !== svc.hostId) issues.push('host_not_local');
    else if (svc.state !== 'running') issues.push('service_stopped');
    const launcher = ((host && host.launchers) || []).find(l => l.id === (input && input.launcher));
    if (!launcher || !launcher.profiles.some(pr => pr.id === input.profileId)) issues.push('launcher');
    return issues;
  }
  /** The AGENTS.md frontmatter the App writes into the new Home. */
  function agentFrontmatter(input) {
    const rom = ROMS.find(r => r.id === input.romId) || {};
    const args = input.profileId && input.profileId !== 'default' ? ['--profile', input.profileId] : [];
    return [
      '---', `name: main`, `namespace: ${input.name}`, 'working_directory: ${REPO_ROOT}', `launcher: ${input.launcher}`,
      `launcher_args: [${args.map(a => JSON.stringify(a)).join(', ')}]`,
      `rom: { name: ${rom.id}, version: ${rom.version} }`,
      `skills: [${(rom.included || []).concat(input.optionalSkills || []).join(', ')}]`,
      'heartbeat:', '  cron: "0 * * * *"', '  session_mode: auto', '  enabled: true', '---',
    ].join('\n');
  }
  function createAgent(profile, org, input, now) {
    const issues = createAgentIssues(profile, org, input);
    if (issues.length) return { ok: false, code: issues[0], issues };
    const host = find(org.hosts, input.hostId);
    const rom = ROMS.find(r => r.id === input.romId);
    const launcher = host.launchers.find(l => l.id === input.launcher);
    const prof = launcher.profiles.find(pr => pr.id === input.profileId);
    const name = input.name.trim();
    const home = input.home.trim();
    const skills = rom.included.concat(input.optionalSkills || []);
    const agent = {
      id: nextId(profile, 'agent'), name, namespace: name, role: rom.desc, origin: 'app', hostId: host.id, home,
      rom: { id: rom.id, version: rom.version }, runtime: launcher.name, launcher: launcher.id, profileId: prof.id, model: prof.model,
      skills, heartbeat: { cron: '0 * * * *', by: 'agent-manager' },
      capabilities: skills.length ? skills.map(k => ({ zh: k, en: k })) : [{ zh: 'Agent OS 文件', en: 'Agent OS files' }],
      standing: { version: 1, actions: [], dailyBudget: 0, spentToday: 0, dayStart: now - (now % DAY), confirmedAt: now },
    };
    const inst = {
      id: nextId(profile, 'inst'), name: 'main', agentId: agent.id, hostId: host.id, sessionKey: `tmux:${name}--main`,
      runtime: launcher.name, adapter: 'agent-manager', origin: 'app', workspace: home, status: 'creating', okrIds: [],
    };
    org.agents.push(agent);
    org.instances.push(inst);
    host.folders = Object.assign({}, host.folders, { [home]: 'agent_home' });
    if (!org.workspaces.some(w => w.path === home)) org.workspaces.push({ id: nextId(profile, 'ws'), name, path: home, hostIds: [host.id], access: 'read_write', importedAt: now, files: rom.files.slice(0, 4) });
    return { ok: true, agent, instance: inst, files: rom.files, skills, frontmatter: agentFrontmatter(input) };
  }
  function confirmCreateAgent(org, instanceId) {
    const inst = find(org.instances, instanceId);
    if (!inst || inst.status !== 'creating') return { ok: false, code: 'not_creating' };
    inst.status = 'running';
    return { ok: true };
  }
  /** A creation that did not confirm leaves no Agent and frees its Home. */
  function dropCreatedAgent(org, instanceId) {
    const inst = find(org.instances, instanceId);
    if (!inst) return;
    const host = find(org.hosts, inst.hostId);
    if (host && host.folders) delete host.folders[inst.workspace];
    org.instances = org.instances.filter(i => i.id !== inst.id);
    org.agents = org.agents.filter(a => a.id !== inst.agentId);
  }

  /** Revoking this computer's host also uninstalls its service and keys. */
  function removeLocalService(profile) {
    const svc = localServiceFor(profile);
    svc.state = 'not_installed';
    svc.keys = false;
    svc.hostId = null;
    return { ok: true };
  }

  function revokeInvite(org, inviteId, now) {
    const inv = find(org.invites, inviteId);
    if (!inv) return { ok: false, code: 'missing' };
    const st = inviteStatus(inv, now);
    if (st === 'consumed') return { ok: false, code: 'consumed' };
    if (st !== 'active' && st !== 'signing') return { ok: false, code: st };
    inv.state = 'revoked';
    inv.revokedAt = now;
    return { ok: true };
  }

  /** Chain membership succeeded; connection is a separate, retryable step. */
  function connectHost(org, hostId, coordinatorUp, now) {
    const host = find(org.hosts, hostId);
    if (!host) return { ok: false, code: 'missing' };
    if (!host.membership || host.membership.state !== 'active') return { ok: false, code: 'revoked' };
    if (!coordinatorUp) { host.status = 'waiting_connection'; return { ok: false, code: 'coordinator_unreachable' }; }
    host.status = 'online';
    host.lastHeartbeatAt = now;
    host.cpu = 12; host.mem = 34; host.sampledAt = now;
    return { ok: true };
  }

  function revokeHost(org, hostId, now) {
    const host = find(org.hosts, hostId);
    if (!host) return { ok: false, code: 'missing' };
    if (!host.membership || host.membership.state !== 'active') return { ok: false, code: 'not_member' };
    host.membership.state = 'revoked';
    host.membership.revokedAt = now;
    if (host.grant) host.grant.revokedAt = now;
    host.accepting = false;
    org.okrs.filter(o => o.hostId === hostId && o.lifecycle === 'ACTIVE').forEach(o => {
      o.nav.paused = true; o.nav.pausedReason = 'host_revoked'; o.version += 1;
    });
    return { ok: true };
  }

  /* ----------------------------------------------- Devices and identity */

  const deviceActive = (d, now) => d.grant.state === 'active' && (!d.grant.expiresAt || d.grant.expiresAt > now);

  function actionsForRole(role) {
    if (role === 'admin') return ACTIONS.slice();
    if (role === 'member') return ['read', 'operate'];
    return ['read'];
  }

  /**
   * Organization role, device grant and data access together decide what this
   * device may do. Unlocking the app never substitutes for an on-chain grant.
   */
  function can(profile, deviceId, orgId, action, now) {
    const d = find(profile.devices, deviceId);
    if (!d) return { ok: false, code: 'unknown_device' };
    if (profile.locked) return { ok: false, code: 'locked' };
    if (d.grant.state === 'revoked') return { ok: false, code: 'revoked' };
    if (d.grant.state === 'pending') return { ok: false, code: 'grant_pending' };
    if (d.grant.expiresAt && now > d.grant.expiresAt) return { ok: false, code: 'expired' };
    if (action === 'manage_identity') return d.role === 'manage' ? { ok: true } : { ok: false, code: 'not_manager' };
    const scope = (d.grant.scopes || []).find(s => s.orgId === orgId);
    if (!scope) return { ok: false, code: 'org_not_granted' };
    if (d.dataSync !== 'synced') return { ok: false, code: 'data_not_synced' };
    const org = find(profile.orgs, orgId);
    if (!org) return { ok: false, code: 'not_member' };
    if (!actionsForRole(org.role).includes(action)) return { ok: false, code: 'role_insufficient' };
    if (!scope.actions.includes(action)) return { ok: false, code: 'action_not_granted' };
    return { ok: true, deviceId };
  }

  function createPairing(profile, req, now, rand) {
    const n = rand ? rand() : Math.random();
    const code = String(Math.floor(n * 900000) + 100000);
    const p = {
      id: nextId(profile, 'pair'), platform: req.platform, name: req.name, code,
      createdAt: now, expiresAt: now + PAIRING_TTL, state: 'waiting',
    };
    profile.pairings.unshift(p);
    return p;
  }

  function pairingStatus(p, now) {
    return p.state === 'waiting' && now > p.expiresAt ? 'expired' : p.state;
  }

  /** J8 defaults: current organization, read-only, 7 days. Pairing alone grants nothing. */
  function approvePairing(profile, pairingId, opts, approverId, now) {
    const p = find(profile.pairings, pairingId);
    if (!p) return { ok: false, code: 'missing' };
    const st = pairingStatus(p, now);
    if (st !== 'waiting') { if (st === 'expired') p.state = 'expired'; return { ok: false, code: st }; }
    const approver = find(profile.devices, approverId);
    if (!approver || approver.role !== 'manage' || !deviceActive(approver, now)) return { ok: false, code: 'not_manager' };
    const orgIds = opts.orgIds && opts.orgIds.length ? opts.orgIds : [profile.currentOrgId];
    const actions = opts.actions && opts.actions.length ? opts.actions : ['read'];
    const device = {
      id: nextId(profile, 'dev'), name: p.name, platform: p.platform, role: 'access', addedAt: now,
      grant: {
        state: 'pending', expiresAt: now + (opts.days || 7) * DAY,
        scopes: orgIds.map(orgId => ({ orgId, actions: actions.filter(a => a !== 'manage_hosts') })),
      },
      dataSync: 'none', shareData: opts.shareData !== false, pairingId: p.id,
    };
    profile.devices.push(device);
    p.state = 'approved';
    p.deviceId = device.id;
    return { ok: true, device };
  }

  function confirmGrant(profile, deviceId) {
    const d = find(profile.devices, deviceId);
    if (!d || d.grant.state !== 'pending') return { ok: false, code: 'not_pending' };
    d.grant.state = 'active';
    d.dataSync = d.shareData ? 'pending' : 'withheld';
    return { ok: true };
  }

  function syncData(profile, deviceId) {
    const d = find(profile.devices, deviceId);
    if (!d || d.grant.state !== 'active') return { ok: false, code: 'not_authorized' };
    if (d.dataSync === 'withheld') return { ok: false, code: 'withheld' };
    d.dataSync = 'synced';
    return { ok: true };
  }

  function revokeDevice(profile, deviceId, byId, now) {
    const by = find(profile.devices, byId);
    const d = find(profile.devices, deviceId);
    if (!d) return { ok: false, code: 'missing' };
    if (!by || by.role !== 'manage' || !deviceActive(by, now)) return { ok: false, code: 'not_manager' };
    if (deviceId === byId) return { ok: false, code: 'self' };
    if (d.grant.state === 'revoked') return { ok: false, code: 'already_revoked' };
    d.grant.state = 'revoked';
    d.revokedAt = now;
    return { ok: true };
  }

  /* ------------------------------------------------------------ Recovery */

  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

  function checkChar(body) {
    let v = 0;
    for (let i = 0; i < body.length; i++) v = (v * 7 + B32.indexOf(body[i]) * (i + 1)) % 32;
    return B32[v];
  }

  /** FMR1-<network>-XXXXX-XXXXX-XXXXX-XXXXX-<check>: version, network and check are visible. */
  function makeRecoveryCode(randomBytes, network) {
    const bytes = randomBytes(20);
    let body = '';
    for (let i = 0; i < 20; i++) body += B32[bytes[i] & 31];
    const net = network || 'T';
    return `FMR1-${net}-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}-${checkChar(body)}`;
  }

  function parseRecoveryCode(input, expectedNetwork) {
    const raw = String(input || '').toUpperCase().replace(/[\s\-_]/g, '');
    if (!raw) return { ok: false, code: 'empty' };
    if (!raw.startsWith('FMR')) return { ok: false, code: 'format' };
    if (raw.length !== 26) return { ok: false, code: 'format' };
    if (raw[3] !== '1') return { ok: false, code: 'version' };
    const net = raw[4];
    if (net !== (expectedNetwork || 'T')) return { ok: false, code: 'network' };
    const body = raw.slice(5, 25).replace(/O/g, '0').replace(/[IL]/g, '1');
    if ([...body].some(ch => !B32.includes(ch))) return { ok: false, code: 'format' };
    if (checkChar(body) !== raw[25].replace(/O/g, '0').replace(/[IL]/g, '1')) return { ok: false, code: 'checksum' };
    return { ok: true, network: net, digest: digest(`fm-recovery:1:${net}:${body}`) };
  }

  /** Simulates locating the chain recovery record. Finding it grants nothing. */
  function lookupRecovery(profiles, parsed) {
    for (const p of profiles) {
      if (p.recovery && p.recovery.state === 'saved' && p.recovery.digest === parsed.digest) {
        return {
          ok: true, profileId: p.id, humanId: p.human.id, name: p.human.name,
          orgs: p.orgs.map(o => ({ id: o.id, name: o.name, role: o.role })),
          activeDevices: p.devices.filter(d => d.grant.state === 'active').length,
        };
      }
      if (p.recovery && (p.recovery.history || []).includes(parsed.digest)) return { ok: false, code: 'consumed' };
    }
    return { ok: false, code: 'not_found' };
  }

  function setRecovery(profile, parsed, now) {
    const history = (profile.recovery && profile.recovery.history) || [];
    if (profile.recovery && profile.recovery.digest) history.push(profile.recovery.digest);
    profile.recovery = { state: 'saved', digest: parsed.digest, network: parsed.network, version: 1, savedAt: now, history };
    return { ok: true };
  }

  /** Atomic in the simulation: revoke old devices, grant this one, consume the code. */
  function applyRecovery(profile, parsed, device, now) {
    if (!profile.recovery || profile.recovery.state !== 'saved' || profile.recovery.digest !== parsed.digest) {
      return { ok: false, code: 'stale' };
    }
    profile.devices.forEach(d => {
      if (d.grant.state !== 'revoked') { d.grant.state = 'revoked'; d.revokedAt = now; d.revokedReason = 'recovery'; }
    });
    profile.pairings.forEach(p => { if (p.state === 'waiting') p.state = 'cancelled'; });
    const dev = {
      id: nextId(profile, 'dev'), name: device.name, platform: device.platform, role: 'manage', addedAt: now, via: 'recovery',
      grant: { state: 'active', expiresAt: null, scopes: profile.orgs.map(o => ({ orgId: o.id, actions: actionsForRole(o.role) })) },
      dataSync: 'pending', shareData: true,
    };
    profile.devices.push(dev);
    profile.currentDeviceId = dev.id;
    profile.locked = false;
    const history = (profile.recovery.history || []).concat(parsed.digest);
    profile.recovery = { state: 'consumed', digest: null, consumedAt: now, history };
    return { ok: true, device: dev };
  }

  /* --------------------------------------------------- Run fees and txs */

  const FEES = {
    'identity.create': 3000000, 'okr.activate': 1200000, 'okr.update': 800000, 'okr.archive': 600000, 'approval.decide': 400000,
    'invite.create': 900000, 'invite.redeem': 1100000, 'invite.revoke': 500000, 'binding.create': 900000,
    'host.prepare': 1500000, 'binding.update': 700000,
    'host.revoke': 600000, 'device.grant': 800000, 'device.revoke': 500000, 'recovery.set': 700000,
    'recovery.apply': 1500000, 'agent.import': 700000, 'agent.include': 900000, 'memory.write': 600000,
    'memory.archive': 400000, 'agent.policy': 600000, 'agent.create': 800000,
  };
  const FAIL_FEE = 600000;
  const feeFor = kind => FEES[kind] || 500000;

  function canPay(wallet, fee) {
    if (wallet.source === 'sponsor') {
      if (!wallet.sponsor || !wallet.sponsor.online) return { ok: false, code: 'sponsor_offline' };
      if (wallet.sponsor.quota < fee) return { ok: false, code: 'sponsor_quota' };
      return { ok: true, payer: 'sponsor' };
    }
    if (wallet.balance < fee) return { ok: false, code: 'insufficient' };
    return { ok: true, payer: 'self' };
  }

  /** One PTB registers several Agents: a base fee plus a smaller one per Agent. */
  const importFee = n => FEES['agent.import'] + 250000 * Math.max(0, n - 1);
  function beginTx(profile, spec, now) {
    const ids = spec.payload && spec.payload.instanceIds;
    const fee = spec.kind === 'agent.import' && Array.isArray(ids) ? importFee(ids.length) : feeFor(spec.kind);
    const pay = canPay(profile.wallet, fee);
    if (!pay.ok) return { ok: false, code: pay.code, fee };
    nextId(profile, 'tx');
    const tx = {
      id: txDigest(profile), kind: spec.kind, orgId: spec.orgId || null, payload: spec.payload || {},
      fee, payer: pay.payer, state: 'pending', createdAt: now,
    };
    profile.txs.unshift(tx);
    if (profile.txs.length > 60) profile.txs.length = 60;
    return { ok: true, tx };
  }

  function charge(profile, tx, outcome, now) {
    const amount = outcome === 'confirmed' ? Math.round(tx.fee * 0.92) : FAIL_FEE;
    if (tx.payer === 'sponsor' && profile.wallet.sponsor) profile.wallet.sponsor.quota -= amount;
    else profile.wallet.balance -= amount;
    tx.charged = amount;
    profile.wallet.records.unshift({ txId: tx.id, kind: tx.kind, amount, payer: tx.payer, state: outcome, at: now, error: tx.error || null });
    if (profile.wallet.records.length > 40) profile.wallet.records.length = 40;
  }

  function finishTx(profile, tx, outcome, code, now) {
    tx.state = outcome;
    tx.settledAt = now;
    tx.error = code || null;
    charge(profile, tx, outcome, now);
  }

  /**
   * Settles a pending transaction. `fault` is a review toggle: 'fail' aborts it,
   * 'rpc' leaves the outcome unknown (query the same transaction; never replay).
   * Effects are re-validated at commit: a stale confirmation page cannot bypass checks.
   */
  function commitTx(profile, txId, now, fault) {
    const tx = find(profile.txs, txId);
    if (!tx) return { ok: false, code: 'missing' };
    if (tx.state === 'confirmed' || tx.state === 'failed') return { ok: false, code: 'already_settled', tx };
    if (fault === 'rpc') { tx.state = 'unknown'; return { ok: false, code: 'unknown', tx }; }
    if (fault === 'fail') { finishTx(profile, tx, 'failed', 'simulated_failure', now); return { ok: false, code: 'simulated_failure', tx }; }
    const res = applyEffect(profile, tx, now);
    if (!res.ok) { finishTx(profile, tx, 'failed', res.code, now); return { ok: false, code: res.code, tx }; }
    finishTx(profile, tx, 'confirmed', null, now);
    return Object.assign({ tx }, res, { ok: true });
  }

  /** "Query the original transaction": the demo assumes it landed once RPC is back. */
  function queryTx(profile, txId, now, fault) {
    const tx = find(profile.txs, txId);
    if (!tx) return { ok: false, code: 'missing' };
    if (tx.state !== 'unknown') return { ok: tx.state === 'confirmed', code: tx.state, tx };
    if (fault === 'rpc') return { ok: false, code: 'unknown', tx };
    tx.state = 'pending';
    return commitTx(profile, txId, now, null);
  }

  function applyEffect(profile, tx, now) {
    const p = tx.payload;
    const org = tx.orgId ? orgData(profile, tx.orgId) : null;
    switch (tx.kind) {
      case 'okr.activate': return confirmActivation(org, find(org.okrs, p.okrId), now);
      case 'okr.archive': return archiveOkr(org, find(org.okrs, p.okrId), now);
      case 'okr.update': {
        const okr = find(org.okrs, p.okrId);
        if (okr.constraints.version !== p.fromVersion) return { ok: false, code: 'version_conflict' };
        return updateConstraints(org, okr, p.patch, now);
      }
      case 'approval.decide': return decide(profile, org, p.approvalId, p.decision, can(profile, p.deviceId, tx.orgId, 'approve', now), now);
      case 'invite.create': {
        const inv = find(org.invites, p.inviteId);
        if (!inv || inv.state !== 'signing') return { ok: false, code: 'not_signing' };
        inv.state = 'active';
        inv.txId = tx.id;
        return { ok: true };
      }
      case 'invite.redeem': return redeemInvite(profile, org, p.inviteId, p.device, now);
      // One device-signed PTB: confirm the Coordinator binding and activate the invite.
      case 'host.prepare': {
        const b = find(org.bindings, p.bindingId);
        const inv = find(org.invites, p.inviteId);
        if (!b || b.state !== 'pending' || !inv || inv.state !== 'signing' || inv.bindingId !== b.id) return { ok: false, code: 'not_pending' };
        b.state = 'confirmed';
        b.confirmedAt = now;
        inv.state = 'active';
        inv.txId = tx.id;
        return { ok: true };
      }
      case 'binding.update': return updateBinding(org, p.bindingId, p.scope, p.endpoint, now);
      case 'invite.revoke': return revokeInvite(org, p.inviteId, now);
      case 'binding.create': {
        const b = find(org.bindings, p.bindingId);
        if (!b || b.state !== 'pending') return { ok: false, code: 'not_pending' };
        b.state = 'confirmed';
        b.confirmedAt = now;
        return { ok: true };
      }
      case 'host.revoke': return revokeHost(org, p.hostId, now);
      case 'device.grant': return confirmGrant(profile, p.deviceId);
      case 'device.revoke': return revokeDevice(profile, p.deviceId, p.byId, now);
      case 'recovery.set': return setRecovery(profile, { digest: p.digest, network: p.network }, now);
      case 'recovery.apply': return applyRecovery(profile, { digest: p.digest }, p.device, now);
      case 'agent.import': return confirmImport(org, p.instanceIds || p.instanceId, now);
      case 'agent.create': return confirmCreateAgent(org, p.instanceId, now);
      case 'agent.include': return includeInOkr(profile, org, p.instanceId, p.okrId, p.checks, now);
      case 'memory.write': {
        const m = find(org.memories, p.memoryId);
        if (!m) return { ok: false, code: 'missing' };
        m.state = 'active'; m.version = (m.version || 0) + 1; m.updatedAt = now;
        if (p.patch) Object.assign(m, p.patch);
        return { ok: true };
      }
      case 'agent.policy': return updateStanding(profile, org, p.agentId, p.patch, p.fromVersion, now);
      case 'memory.archive': {
        const m = find(org.memories, p.memoryId);
        if (!m) return { ok: false, code: 'missing' };
        m.state = 'archived'; m.updatedAt = now;
        return { ok: true };
      }
      default: return { ok: true };
    }
  }

  /* ------------------------------------------------------ Conversations */

  function snapshot(org, okr, now) {
    const cond = condition(org, okr, now);
    const kr = currentKr(okr);
    const run = currentRun(org, okr);
    const lv = lastVerifiedKr(okr);
    return {
      krId: kr ? kr.id : null, runId: run ? run.id : null, hostId: okr.hostId, instanceId: okr.instanceId,
      condition: cond.code, reason: cond.reason || null, lastVerified: lv ? lv.id : null,
      constraintsVersion: okr.constraints.version, okrVersion: okr.version, at: now,
    };
  }

  function canMessage(org, okr, ctx) {
    if (!ctx || !ctx.ok) return { ok: false, code: (ctx && ctx.code) || 'no_permission' };
    const host = find(org.hosts, okr.hostId);
    if (!host || host.status !== 'online') return { ok: false, code: 'host_offline' };
    const inst = find(org.instances, okr.instanceId);
    if (!inst || inst.status === 'stopped') return { ok: false, code: 'agent_unavailable' };
    return { ok: true };
  }

  function conversation(org, okrId) {
    org.conversations[okrId] = org.conversations[okrId] || { messages: [], draft: '' };
    return org.conversations[okrId];
  }

  /** Messages are bound to the context at send time; new direction supersedes unadopted plans. */
  function sendMessage(profile, org, okr, purpose, text, ctx, now) {
    const conv = conversation(org, okr.id);
    const chk = canMessage(org, okr, ctx);
    if (!chk.ok) { conv.draft = text; return chk; }
    if (purpose !== 'ask') {
      conv.messages.forEach(m => { if (m.proposal && m.proposal.state === 'pending') m.proposal.state = 'superseded'; });
    }
    const msg = { id: nextId(profile, 'msg'), from: 'user', purpose, text, at: now, snapshot: snapshot(org, okr, now), delivery: 'delivered' };
    conv.messages.push(msg);
    conv.draft = '';
    if (purpose === 'pause' || purpose === 'plan') {
      okr.nav.paused = true;
      okr.nav.pausedReason = purpose === 'pause' ? 'user_paused' : 'awaiting_plan';
      okr.version += 1;
    }
    return { ok: true, msg };
  }

  function agentReply(profile, org, okr, msgId, now) {
    const conv = conversation(org, okr.id);
    const msg = find(conv.messages, msgId);
    if (!msg || msg.delivery === 'replied') return { ok: false, code: 'not_pending' };
    msg.delivery = 'replied';
    const reply = { id: nextId(profile, 'msg'), from: 'agent', replyTo: msg.id, purpose: msg.purpose, at: now, snapshot: msg.snapshot, demo: true };
    if (msg.purpose === 'plan') {
      const kr = currentKr(okr) || find(okr.krs, msg.snapshot.krId);
      const alt = kr && kr.plan && kr.plan.B;
      const cost = alt ? alt.steps.reduce((s, x) => s + x.cost, 0) : 0;
      reply.proposal = {
        id: nextId(profile, 'plan'), krId: kr ? kr.id : null, route: alt ? 'B' : null, cost,
        basedOnVersion: okr.version, state: alt ? 'pending' : 'unavailable',
      };
    }
    conv.messages.push(reply);
    return { ok: true, reply };
  }

  function adoptProposal(profile, org, okr, proposalId, ctx, now) {
    const conv = conversation(org, okr.id);
    const msg = conv.messages.find(m => m.proposal && m.proposal.id === proposalId);
    if (!msg) return { ok: false, code: 'missing' };
    const p = msg.proposal;
    if (p.state !== 'pending') return { ok: false, code: p.state };
    if (okr.version !== p.basedOnVersion) { p.state = 'stale'; return { ok: false, code: 'stale' }; }
    const chk = canMessage(org, okr, ctx);
    if (!chk.ok) return chk;
    if (p.cost > budgetLeft(okr.constraints.budget)) return { ok: false, code: 'budget' };
    const kr = find(okr.krs, p.krId);
    p.state = 'adopted';
    p.adoptedAt = now;
    kr.route = p.route;
    kr.stepIndex = 0;
    okr.nav.scenario = null;
    okr.nav.blocked = null;
    okr.nav.paused = false;
    okr.nav.pausedReason = null;
    okr.version += 1;
    org.approvals.forEach(a => {
      if (a.okrId === okr.id && a.krId === kr.id && a.kind === 'boundary' && a.state === 'pending') { a.state = 'invalidated'; a.superseded = true; }
    });
    log(profile, org, { okrId: okr.id, krId: kr.id, kind: 'reroute', route: p.route }, now);
    return { ok: true };
  }

  /** Switching to an alternative route never approves the abandoned external request. */
  function switchRoute(profile, org, okr, route, now) {
    const kr = currentKr(okr) || (okr.nav.blocked && find(okr.krs, okr.nav.blocked.krId));
    if (!kr || !kr.plan || !kr.plan[route]) return { ok: false, code: 'no_route' };
    kr.route = route;
    kr.stepIndex = 0;
    okr.nav.blocked = null;
    okr.nav.scenario = null;
    okr.version += 1;
    org.approvals.forEach(a => {
      if (a.okrId === okr.id && a.krId === kr.id && a.kind === 'boundary' && a.state === 'pending') { a.state = 'invalidated'; a.superseded = true; }
    });
    log(profile, org, { okrId: okr.id, krId: kr.id, kind: 'reroute', route }, now);
    return { ok: true };
  }

  /* ---------------------------------------------- Agent discovery (J11) */

  function scanHost(org, hostId, observed, now) {
    const host = find(org.hosts, hostId);
    if (!host) return { ok: false, code: 'missing' };
    if (!host.membership || host.membership.state !== 'active') return { ok: false, code: 'not_authorized' };
    if (host.status !== 'online') return { ok: false, code: 'offline' };
    // This computer reports the same running Agents whichever identity set it up.
    const seen = observed[hostId] || (host.isThisDevice ? observed.thisDevice : null) || [];
    const sessions = seen.map(s => Object.assign({}, s, {
      hostId, observedAt: now,
      importedAs: (org.instances.find(i => i.hostId === hostId && i.sessionKey === s.key) || {}).id || null,
    }));
    return { ok: true, sessions };
  }

  function importObserve(profile, org, session, now) {
    if (org.instances.some(i => i.hostId === session.hostId && i.sessionKey === session.key)) return { ok: false, code: 'duplicate' };
    if (session.identity !== 'verified') return { ok: false, code: 'identity_unverified' };
    let agentId = session.agentId || null;
    const def = session.agentFile;
    if (!agentId && def) {
      // A running Agent brings its own definition: name, Home, launcher,
      // schedule and (if recorded) ROM. Its employee Agents stay on the host.
      const agent = {
        id: nextId(profile, 'agent'), name: def.namespace || def.name, namespace: def.namespace || null, role: def.description || { zh: '已有 Agent', en: 'Existing Agent' },
        origin: 'imported', hostId: session.hostId, home: session.workspace, rom: def.rom || null, runtime: session.runtime, launcher: def.launcher, profileId: def.profile || 'default',
        model: def.model, skills: [], skillCount: def.skills || 0, heartbeat: def.heartbeat || null, subAgents: def.subAgents || 0,
        capabilities: [{ zh: `${def.skills || 0} 个技能`, en: `${def.skills || 0} skills` }],
        standing: { version: 1, actions: [], dailyBudget: 0, spentToday: 0, dayStart: now - (now % DAY), confirmedAt: now },
      };
      org.agents.push(agent);
      agentId = agent.id;
    }
    const inst = {
      id: nextId(profile, 'inst'), name: session.name, agentId, hostId: session.hostId,
      sessionKey: session.key, runtime: session.runtime, model: session.model || null, adapter: session.adapter,
      workspace: session.workspace, status: 'importing', imported: session.adapter === 'agent-manager' ? 'control' : 'observe', observedAt: session.observedAt, okrIds: [],
    };
    org.instances.push(inst);
    return { ok: true, instance: inst };
  }

  function confirmImport(org, instanceId) {
    const ids = Array.isArray(instanceId) ? instanceId : [instanceId];
    const insts = ids.map(id => find(org.instances, id));
    if (!insts.length || insts.some(i => !i || i.status !== 'importing')) return { ok: false, code: 'not_importing' };
    insts.forEach(i => { i.status = 'running'; });
    return { ok: true };
  }

  /* One-click import (#70): several sessions, one transaction. agent-manager
   * Homes are registered with control (agent-manager-v1) and can take OKRs;
   * other tmux sessions stay observe-only. */
  function importAgents(profile, org, sessions, now) {
    if (!sessions.length) return { ok: false, code: 'none_selected' };
    for (const s of sessions) {
      if (org.instances.some(i => i.hostId === s.hostId && i.sessionKey === s.key)) return { ok: false, code: 'duplicate' };
      if (s.identity !== 'verified') return { ok: false, code: 'identity_unverified' };
    }
    const instances = sessions.map(s => importObserve(profile, org, s, now).instance);
    return { ok: true, instances };
  }
  /** What FractalMind enforces for an agent-manager Agent, and what it cannot. */
  const AGENT_MANAGER_LIMITS = {
    enforced: [
      { zh: '投递目标：写入 Home 的 OKR.md，并通过 agent-manager 发送任务', en: 'Deliver the goal: written to OKR.md in its Home and sent through agent-manager' },
      { zh: '期限与停止：到期、撤销或手动停止时停止会话', en: 'Deadline and stop: the session is stopped on expiry, revocation or request' },
      { zh: '进度与证据：心跳和写回的结果，标为“Agent 声明”，由你验收', en: 'Progress and evidence: heartbeats and returned results, marked “Agent claimed” for your acceptance' },
    ],
    notEnforced: [
      { zh: '工具调用与模型花费：由 Agent 自己的启动配置决定，FractalMind 不能拦截', en: 'Tool use and model spending: decided by the Agent’s own launch configuration; FractalMind cannot intercept them' },
    ],
  };

  function includeIssues(org, inst, okr, checks, now) {
    const issues = [];
    if (!inst) return ['missing'];
    if (!constrainable(inst)) issues.push('observe_only');
    if (!inst.observedAt || now - inst.observedAt > OBSERVATION_TTL) issues.push('observation_stale');
    if (!okr || okr.lifecycle !== 'ACTIVE') issues.push('okr_not_active');
    else {
      const ws = find(org.workspaces, okr.workspaceId);
      if (!ws || ws.path !== inst.workspace) issues.push('workspace_mismatch');
    }
    const c = checks || {};
    if (inst.adapter === 'agent-manager') {
      // Its Home is the workspace; there is no running task to hand over.
      const i = issues.indexOf('workspace_mismatch');
      if (i >= 0) issues.splice(i, 1);
      const j = issues.indexOf('observation_stale');
      if (j >= 0) issues.splice(j, 1);
      if (!c.acknowledged) issues.push('checks_incomplete');
      return issues;
    }
    if (!(c.budget && c.deadline && c.tools && c.escalation && c.checkpoint && c.stopped)) issues.push('checks_incomplete');
    return issues;
  }

  function includeInOkr(profile, org, instanceId, okrId, checks, now) {
    const inst = find(org.instances, instanceId);
    const okr = find(org.okrs, okrId);
    const issues = includeIssues(org, inst, okr, checks, now);
    if (issues.length) return { ok: false, code: issues[0], issues };
    inst.imported = 'managed';
    inst.okrIds = [okrId];
    inst.agentId = inst.agentId || okr.ownerAgentId;
    const run = currentRun(org, okr);
    if (run) { run.state = 'cancelled'; run.endedAt = now; run.note = 'handoff'; }
    okr.hostId = inst.hostId;
    okr.instanceId = inst.id;
    okr.nav.paused = true;
    okr.nav.pausedReason = 'handoff';
    okr.version += 1;
    log(profile, org, { okrId, kind: 'handoff', instanceId }, now);
    return { ok: true };
  }

  /* ------------------------------------------------ Organization context */

  function switchOrg(profile, orgId) {
    if (!profile.orgs.some(o => o.id === orgId)) return { ok: false, code: 'not_member' };
    if (profile.currentOrgId === orgId) return { ok: true, same: true, epoch: profile.epoch };
    profile.currentOrgId = orgId;
    profile.epoch = (profile.epoch || 0) + 1;
    return { ok: true, epoch: profile.epoch };
  }

  /** Async results captured under an older context must not render into the new one. */
  const sameContext = (profile, token) => !!token && profile.id === token.profileId && profile.currentOrgId === token.orgId && profile.epoch === token.epoch;
  const contextToken = profile => ({ profileId: profile.id, orgId: profile.currentOrgId, epoch: profile.epoch });

  /* ------------------------------------------------------------- Export */

  /** J6: versioned manifest, current organization only, secrets excluded, gaps listed. */
  function buildExport(profile, orgId, opts, now) {
    const org = orgData(profile, orgId);
    const meta = find(profile.orgs, orgId);
    const included = [], missing = [];
    const data = {};
    if (opts.okrs) {
      data.okrs = org.okrs.map(o => ({
        id: o.id, title: o.title, priority: o.priority, lifecycle: o.lifecycle, criteria: o.criteria,
        krs: o.krs.map(k => ({ id: k.id, title: k.title, status: k.status, metric: k.metric, weight: k.weight, deps: k.deps })),
        constraints: o.constraints,
      }));
      included.push('okrs');
    }
    if (opts.records) {
      data.tasks = org.tasks;
      data.runs = org.runs.map(r => ({ id: r.id, okrId: r.okrId, krId: r.krId, state: r.state, attempt: r.attempt, parentRunId: r.parentRunId || null }));
      data.approvals = org.approvals.map(a => ({ id: a.id, kind: a.kind, okrId: a.okrId, krId: a.krId || null, state: a.state }));
      included.push('records');
    }
    if (opts.memories) { data.memories = org.memories.filter(m => m.state !== 'deleted'); included.push('memories'); }
    if (opts.artifacts) {
      data.artifacts = org.evidence.map(e => ({ id: e.id, okrId: e.okrId, krId: e.krId, kind: e.kind, trust: e.trust, hostId: e.hostId || null }));
      org.evidence.forEach(e => {
        const host = e.hostId && find(org.hosts, e.hostId);
        if (host && host.status !== 'online') missing.push({ id: e.id, hostId: host.id, reason: 'host_unreachable' });
      });
      included.push('artifacts');
    }
    return {
      manifest: {
        format: 'fractalmind-export', version: 1, demo: true,
        organization: { id: meta.id, chainId: meta.chainId, name: meta.name },
        exportedAt: new Date(now).toISOString(), included, missing, complete: missing.length === 0,
        secrets: 'excluded',
      },
      data,
    };
  }


  /* ------------------------------------ Direct conversations (J12) */

  /** Actions an Agent can be asked to do outside any OKR. Only grantable ones fit a standing policy. */
  const DIRECT_ACTIONS = {
    test: { cost: 20, grantable: true, writes: false },
    edit_sandbox: { cost: 40, grantable: true, writes: true },
    external: { cost: 300, grantable: false, writes: false },
    upload: { cost: 0, grantable: false, writes: false },
  };

  const constrainable = inst => !!inst && inst.adapter !== 'tmux-observe' && inst.adapter !== 'unconstrained';

  function standingToday(agent, now) {
    const st = agent.standing;
    if (!st.dayStart || now - st.dayStart >= DAY) {
      st.dayStart = now - (now % DAY);
      st.spentToday = 0;
    }
    return st;
  }

  function directConversation(org, agentId) {
    org.direct = org.direct || {};
    org.direct[agentId] = org.direct[agentId] || { agentId, instanceId: null, messages: [], draft: '' };
    return org.direct[agentId];
  }

  /** Role addressing picks an online instance; a thread then stays on it (no silent switching). */
  function pickInstance(org, agentId, preferred) {
    const candidates = org.instances.filter(i => i.agentId === agentId);
    const online = i => { const h = find(org.hosts, i.hostId); return h && h.status === 'online' && i.status !== 'stopped'; };
    if (preferred) {
      const inst = find(candidates, preferred);
      if (!inst) return { ok: false, code: 'instance_missing' };
      return online(inst) ? { ok: true, instance: inst } : { ok: false, code: 'host_offline', instance: inst };
    }
    const inst = candidates.filter(online).sort((a, b) => constrainable(b) - constrainable(a))[0];
    return inst ? { ok: true, instance: inst } : { ok: false, code: 'host_offline' };
  }

  function setDirectInstance(org, agentId, instanceId) {
    const conv = directConversation(org, agentId);
    const inst = find(org.instances, instanceId);
    if (!inst || inst.agentId !== agentId) return { ok: false, code: 'instance_missing' };
    conv.instanceId = instanceId;
    return { ok: true };
  }

  /**
   * Channel identities act for a linked Human with low-risk actions only.
   * Anything they trigger is still checked against the Agent's standing policy.
   */
  function channelCan(profile, channel, orgId, action) {
    const g = (profile.channelGrants || []).find(x => x.channel === channel && x.orgId === orgId && !x.revoked);
    if (!g) return { ok: false, code: 'channel_not_linked' };
    return g.actions.includes(action) ? { ok: true, channel } : { ok: false, code: 'action_not_granted' };
  }

  function sendDirect(profile, org, agentId, req, ctx, now) {
    const conv = directConversation(org, agentId);
    if (!ctx || !ctx.ok) { conv.draft = req.text || ''; return { ok: false, code: (ctx && ctx.code) || 'no_permission' }; }
    const pick = pickInstance(org, agentId, conv.instanceId);
    if (!pick.ok) { conv.draft = req.text || ''; return pick; }
    const inst = pick.instance;
    if (!constrainable(inst) && !ctx.manager) return { ok: false, code: 'unconstrained_requires_manager' };
    if (req.kind === 'action' && !DIRECT_ACTIONS[req.action]) return { ok: false, code: 'unknown_action' };
    conv.instanceId = inst.id;
    const msg = {
      id: nextId(profile, 'dm'), from: 'user', kind: req.kind, action: req.action || null, text: req.text || '',
      at: now, instanceId: inst.id, hostId: inst.hostId, source: req.source || 'app', delivery: 'delivered',
    };
    conv.messages.push(msg);
    conv.draft = '';
    return { ok: true, msg };
  }

  function runDirect(profile, org, agent, inst, action, now, approvalId) {
    const def = DIRECT_ACTIONS[action];
    const run = {
      id: nextRunId(profile), okrId: null, krId: null, agentId: agent.id, direct: true, hostId: inst.hostId,
      instanceId: inst.id, state: 'succeeded', attempt: 1, startedAt: now, endedAt: now, action, cost: def.cost,
      approvalId: approvalId || null, sideEffects: [],
    };
    org.runs.unshift(run);
    standingToday(agent, now).spentToday += def.cost;
    log(profile, org, { agentId: agent.id, kind: 'direct_exec', runId: run.id, action, cost: def.cost }, now);
    return run;
  }

  /** The Agent's side of a direct message: answer, execute within standing policy, or escalate. */
  function directReply(profile, org, agentId, msgId, now) {
    const conv = directConversation(org, agentId);
    const msg = find(conv.messages, msgId);
    if (!msg || msg.delivery === 'replied') return { ok: false, code: 'not_pending' };
    msg.delivery = 'replied';
    const agent = find(org.agents, agentId);
    const inst = find(org.instances, msg.instanceId);
    const reply = { id: nextId(profile, 'dm'), from: 'agent', replyTo: msg.id, at: now, instanceId: inst.id, demo: true };
    if (msg.kind !== 'action') reply.outcome = msg.kind === 'status' ? 'status' : 'answer';
    else if (!constrainable(inst)) reply.outcome = 'unconstrained';
    else {
      const def = DIRECT_ACTIONS[msg.action];
      const st = standingToday(agent, now);
      const reasons = [];
      if (!def.grantable || !st.actions.includes(msg.action)) reasons.push('outside_standing');
      const busy = org.okrs.some(o => o.lifecycle === 'ACTIVE' && o.instanceId === inst.id && currentRun(org, o));
      if (def.writes && busy) reasons.push('workspace_busy');
      if (!reasons.length && st.spentToday + def.cost > st.dailyBudget) reply.outcome = 'budget_exhausted';
      else if (reasons.length) {
        const apv = createApproval(profile, org, {
          kind: 'standing', agentId, instanceId: inst.id, action: msg.action, reasons, budgetImpact: def.cost,
          boundVersion: st.version, expiresAt: now + 20 * HOUR, messageId: msg.id,
        }, now);
        reply.outcome = 'approval_requested';
        reply.approvalId = apv.id;
      } else {
        reply.outcome = 'executed';
        reply.runId = runDirect(profile, org, agent, inst, msg.action, now).id;
      }
    }
    conv.messages.push(reply);
    return { ok: true, reply };
  }

  /** After approval the Agent proceeds once; the run links back to the approval. */
  function executeStandingApproval(profile, org, approvalId, now) {
    const a = find(org.approvals, approvalId);
    if (!a || a.kind !== 'standing' || a.state !== 'approved') return { ok: false, code: 'not_approved' };
    if (a.execution) return { ok: false, code: 'already_executed' };
    const agent = find(org.agents, a.agentId);
    const inst = find(org.instances, a.instanceId);
    const h = inst && find(org.hosts, inst.hostId);
    if (!h || h.status !== 'online') return { ok: false, code: 'host_offline' };
    const run = runDirect(profile, org, agent, inst, a.action, now, a.id);
    a.execution = { runId: run.id, at: now, result: 'executed' };
    directConversation(org, a.agentId).messages.push({ id: nextId(profile, 'dm'), from: 'agent', at: now, instanceId: inst.id, outcome: 'approved_executed', runId: run.id, approvalId: a.id, demo: true });
    return { ok: true, run };
  }

  /** A new standing-policy version invalidates pending approvals bound to the old one. */
  function updateStanding(profile, org, agentId, patch, fromVersion, now) {
    const agent = find(org.agents, agentId);
    if (!agent) return { ok: false, code: 'missing' };
    const st = agent.standing;
    if (fromVersion !== undefined && fromVersion !== st.version) return { ok: false, code: 'version_conflict' };
    if (patch.actions) st.actions = patch.actions.filter(x => DIRECT_ACTIONS[x] && DIRECT_ACTIONS[x].grantable);
    if (patch.dailyBudget != null) st.dailyBudget = patch.dailyBudget;
    st.version += 1;
    st.confirmedAt = now;
    org.approvals.forEach(a => {
      if (a.kind === 'standing' && a.agentId === agentId && a.state === 'pending') { a.state = 'invalidated'; a.invalidatedAt = now; }
    });
    log(profile, org, { agentId, kind: 'standing_updated', version: st.version }, now);
    return { ok: true };
  }

  /** Turn a direct request into a standalone task (not tied to any KR); context comes along. */
  function promoteDirect(profile, org, agentId, msgId, now) {
    const conv = directConversation(org, agentId);
    const msg = find(conv.messages, msgId);
    if (!msg || msg.from !== 'user') return { ok: false, code: 'missing' };
    if (msg.taskId) return { ok: false, code: 'already_promoted', taskId: msg.taskId };
    const task = { id: nextId(profile, 'task'), okrId: null, krId: null, agentId, title: msg.text, state: 'Created', createdAt: now, source: { agentId, messageId: msg.id } };
    org.tasks.push(task);
    msg.taskId = task.id;
    return { ok: true, task };
  }

  return {
    MIN, HOUR, DAY, MAX_ACTIVE, OBSERVATION_TTL, PAIRING_TTL, INVITE_TTL, MIST, FEES, FAIL_FEE,
    RUN_STATES, APPROVAL_STATES, CONDITIONS, TRUST, ACTIONS,
    clamp, find, digest, nextId, orgData,
    krProgress, krStale, achievement, krTrust, krBlockers, completeKr, depsMet, criteriaReview, okrAchievable,
    validateDraft, hasCycle, activeCount, readiness, requestActivation, confirmActivation, archiveOkr,
    budgetLeft, updateConstraints,
    currentKr, lastVerifiedKr, nextStep, currentRun, condition, heartbeat, log, addEvidence,
    createApproval, approvalStatus, expireApprovals, checkDecision, decide, achieveOkr,
    requestStop, confirmStop, resolveConfirmation, injectScenario, resolveScenario, resumeOkr,
    assignIssues, reassign, hostCommand, ackCommand,
    inviteStatus, createInvite, redeemProof, redeemInvite, revokeInvite, connectHost, revokeHost,
    ENDPOINT_SCOPES, validEndpoint, localServiceFor, setLocalServiceRunning, updateBinding, removeLocalService,
    ROMS, homeState, createAgentIssues, agentFrontmatter, createAgent, confirmCreateAgent, dropCreatedAgent,
    deviceActive, actionsForRole, can, createPairing, pairingStatus, approvePairing, confirmGrant, syncData, revokeDevice,
    B32, makeRecoveryCode, parseRecoveryCode, lookupRecovery, setRecovery, applyRecovery,
    feeFor, canPay, beginTx, commitTx, queryTx,
    snapshot, canMessage, conversation, sendMessage, agentReply, adoptProposal, switchRoute,
    scanHost, importObserve, importAgents, importFee, AGENT_MANAGER_LIMITS, confirmImport, includeIssues, includeInOkr,
    switchOrg, sameContext, contextToken, buildExport,
    DIRECT_ACTIONS, constrainable, standingToday, directConversation, pickInstance, setDirectInstance, channelCan,
    sendDirect, directReply, executeStandingApproval, updateStanding, promoteDirect,
  };
});
