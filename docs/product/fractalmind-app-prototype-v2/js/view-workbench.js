/* FractalMind App prototype v2 — workbench: decisions first, then the focused
 * goal's run navigation (PRD §8.2), boundaries, observation and conversation. */
(function () {
  'use strict';
  const FM = window.FM;
  const U = FM.ui;
  const { M, T, L, esc, icon, P, O, can, ui, render, toast } = U;

  /* ------------------------------------------------------------ Helpers */

  const krLabel = (okr, id) => FM.krLabel(okr, id);
  const gateOf = kr => kr && kr.plan && kr.plan[kr.route || 'A'] && kr.plan[kr.route || 'A'].gate;
  const pendingDecisionTx = id => U.latestTx(t => t.kind === 'approval.decide' && t.payload.approvalId === id && (t.state === 'pending' || t.state === 'unknown'));

  function krState(okr, kr, cur) {
    if (kr.status === 'COMPLETE') return 'accepted';
    if (kr.verification && kr.verification.state === 'passed') return 'verified';
    if (kr.verification && kr.verification.state === 'pending') return 'verifying';
    if (cur && cur.id === kr.id) return 'current';
    if (kr.status === 'IN_PROGRESS') return 'progress';
    return 'pending';
  }

  /* -------------------------------------------------------- Condition */

  const REASON = {
    awaiting_approval: ['等待你批准越界操作', 'Waiting for your approval of an out-of-bounds action'],
    budget: ['下一动作的预算预留超过剩余额度', "The next action's reservation exceeds the remaining budget"],
    budget_reservation: ['下一动作的预算预留超过剩余额度（评审注入）', "The next action's reservation exceeds the remaining budget (injected)"],
    deadline: ['已超过约定的截止时间', 'The agreed deadline has passed'],
    permission: ['主机执行授权已到期或被撤销', 'The host execution grant expired or was revoked'],
    unrelated_actions: ['最近 2 个动作无法关联任何 KR，但仍在授权工作区内', 'The last 2 actions map to no KR, though still inside the authorized workspace'],
    repeated_failure: ['同一签名错误重试 3 次，指标无改善', 'The same signing error was retried 3 times without improvement'],
    path_excluded: ['路线 A 需要上传代码到第三方，被约定排除', 'Route A needs to upload code to a third party, which the agreement excludes'],
    external_rejected: ['外部操作请求已被拒绝', 'The external request was rejected'],
    dependency: ['等待真机池返回测试结果', 'Waiting for the device farm to return results'],
    awaiting_acceptance: ['前置 KR 等待你验收后才能解除依赖', 'An upstream KR needs your acceptance before dependents unlock'],
    awaiting_final_acceptance: ['全部 KR 已完成，成功标准已复核，等待最终验收', 'All KRs are complete and criteria re-checked; awaiting final acceptance'],
    host_offline: ['执行主机失去心跳，显示历史快照', 'The execution host stopped reporting; showing the last snapshot'],
    observation_lost: ['观测中断，暂停状态推断', 'Observation interrupted; status inference paused'],
    user_paused: ['你暂停了自主循环', 'You paused the autonomous loop'],
    awaiting_plan: ['等待新方案，当前尝试已暂停', 'Waiting for a new plan; the current attempt is paused'],
    run_cancelled: ['执行设备确认已取消，检查点保留', 'The execution device confirmed cancellation; checkpoints kept'],
    reassigned: ['已改派执行位置，等待你明确继续', 'Execution moved; waiting for your explicit continue'],
    instance_stopped: ['负责实例已停止', 'The responsible instance stopped'],
    instance_restarted: ['负责实例已重启，等待你明确继续', 'The responsible instance restarted; waiting for you to continue'],
    handoff: ['已交接给导入的实例，等待你明确继续', 'Handed off to an imported instance; waiting for you to continue'],
    reconciled: ['观测已恢复并完成对账，等待你明确继续', 'Observation restored and reconciled; waiting for you to continue'],
    host_revoked: ['主机资格已撤销', 'Host membership revoked'],
  };
  const reasonText = r => { const x = REASON[r]; return x ? T(x[0], x[1]) : ''; };

  const BASIS = {
    drift: [['动作 #41：重构日志格式（未关联 KR）', 'Action #41: reformatted logs (maps to no KR)'], ['动作 #42：升级 lint 规则（未关联 KR）', 'Action #42: upgraded lint rules (maps to no KR)'], ['两个动作都在授权工作区内；方向与权限分别判断', 'Both stayed inside the authorized workspace; direction and authority are judged separately']],
    loop: [['3 次相同输入与错误：签名服务返回 E0x51', '3 attempts with the same input and error: signing service E0x51'], ['KR2 指标 3 次采样无变化', 'KR2 metric unchanged across 3 samples'], ['探索额度剩余 1 次；已停止同策重试', '1 exploration attempt left; identical retries stopped']],
    blocked: [['路线 A 的必要动作：上传构建到外部服务', "Route A's required step: upload a build to an external service"], ['该动作被执行约定排除或已被拒绝', 'The agreement excludes it, or it was rejected'], ['只判定当前路径不可行；替代路线需验证', 'Only this path is judged infeasible; alternatives still need verification']],
    boundary: [['下一动作需预留预算或额外权限', 'The next action needs a budget reservation or more authority'], ['未获准的动作不会发起', 'Unapproved actions are not started'], ['可在约定内换路，或提出具体升级请求', 'Reroute inside the agreement, or raise a specific request']],
    waiting: [['依赖有负责人与有效心跳', 'The dependency has an owner and a live heartbeat'], ['在预期返回窗口内，不判为空转', 'Inside its expected window, so not treated as looping'], ['超时后再审计', 'Audited again after the window']],
    unknown: [['保留最后确认的位置与花费', 'The last confirmed position and spend are kept'], ['不推断当前状态，不自动重试', 'No inference about now, no automatic retries'], ['重连后先对账，再决定下一步', 'Reconcile on reconnect before deciding the next step']],
  };

  function bannerActions(okr, cond) {
    const b = [];
    const kr = M.currentKr(okr);
    const hasB = kr && kr.plan && kr.plan.B && (kr.route || 'A') !== 'B';
    if (cond.code === 'boundary' && cond.reason === 'awaiting_approval') b.push(U.btn({ action: 'approval-detail', data: { id: cond.approvalId }, label: T('审阅请求', 'Review request'), kind: 'primary', size: 'sm' }));
    if (cond.code === 'boundary' && ['budget', 'budget_reservation', 'deadline'].includes(cond.reason)) {
      b.push(U.btn({ action: 'edit-agreement', data: { id: okr.id }, label: T('调整约定', 'Adjust agreement'), size: 'sm', perm: 'approve' }));
      if (hasB || cond.scenario) b.push(U.btn({ action: 'resolve', data: { id: okr.id, how: 'cheaper' }, label: T('选择低成本路线', 'Choose a cheaper route'), size: 'sm', perm: 'operate' }));
    }
    if (cond.code === 'drift') b.push(U.btn({ action: 'resolve', data: { id: okr.id, how: 'correct' }, label: T('纠偏并继续', 'Correct course'), kind: 'primary', size: 'sm', perm: 'operate' }));
    if (cond.code === 'loop') b.push(U.btn({ action: 'resolve', data: { id: okr.id, how: 'replan' }, label: T('重新规划', 'Replan'), kind: 'primary', size: 'sm', perm: 'operate' }));
    if (cond.code === 'blocked') {
      const blockedKr = M.find(okr.krs, cond.krId) || kr;
      if (blockedKr && blockedKr.plan && blockedKr.plan.B) b.push(U.btn({ action: cond.scenario ? 'resolve' : 'switch-route', data: { id: okr.id, how: 'reroute', route: 'B' }, label: T('切换本地路线 B', 'Switch to local route B'), kind: 'primary', size: 'sm', perm: 'operate' }));
      b.push(U.btn({ action: 'talk', data: { id: okr.id, purpose: 'plan' }, label: T('请求新方案', 'Request a plan'), size: 'sm' }));
    }
    if (cond.code === 'waiting' && cond.reason === 'awaiting_acceptance') b.push(U.btn({ action: 'scroll-decisions', label: T('去验收', 'Go accept'), kind: 'primary', size: 'sm' }));
    if (cond.code === 'waiting' && cond.reason === 'awaiting_final_acceptance') b.push(U.btn({ action: 'scroll-decisions', label: T('最终验收', 'Final acceptance'), kind: 'primary', size: 'sm' }));
    if (cond.code === 'unknown' && cond.reason === 'observation_lost') b.push(U.btn({ action: 'resolve', data: { id: okr.id, how: 'reconnect' }, label: T('重新连接并对账', 'Reconnect and reconcile'), kind: 'primary', size: 'sm', perm: 'operate' }));
    if (cond.code === 'unknown' && cond.reason === 'host_offline') {
      b.push(`<a class="btn sm" href="#/hosts/${esc(okr.hostId)}">${icon('server', 'sm')}<span>${T('查看主机', 'View host')}</span></a>`);
      b.push(U.btn({ action: 'reassign', data: { id: okr.id }, label: T('改派主机', 'Reassign'), size: 'sm', perm: 'operate' }));
    }
    if (cond.code === 'paused') b.push(U.btn({ action: 'resume', data: { id: okr.id }, label: T('继续', 'Continue'), kind: 'primary', size: 'sm', icon: 'play', perm: 'operate' }));
    return b.join('');
  }

  function banner(okr, cond) {
    const org = O();
    let title = U.condName(cond.code);
    let sub = reasonText(cond.reason);
    const kr = M.currentKr(okr);
    if (cond.code === 'on_track') {
      title = kr ? T(`正常推进 · 朝 ${krLabel(okr, kr.id)} 前进`, `On track · heading to ${krLabel(okr, kr.id)}`) : title;
      sub = T('新测量支持当前路线，约束检查通过', 'New measurements support the route; constraint checks pass');
    }
    if (cond.code === 'boundary' && cond.reason === 'awaiting_approval') {
      const a = M.find(org.approvals, cond.approvalId);
      sub = a ? T(`等待你批准：${L(a.action)}`, `Waiting for your approval: ${L(a.action)}`) : sub;
    }
    if (cond.code === 'boundary' && cond.reason === 'budget') sub = T(`下一动作需 ${U.money(cond.need)}，剩余 ${U.money(cond.left)}`, `The next action needs ${U.money(cond.need)}; ${U.money(cond.left)} left`);
    if (cond.code === 'waiting' && cond.reason === 'awaiting_acceptance') sub = T(`${krLabel(okr, cond.krId)} 等待你验收后，下游 KR 才能开始`, `Downstream KRs start after you accept ${krLabel(okr, cond.krId)}`);
    if (cond.code === 'waiting' && cond.reason === 'dependency') sub = T(`等待真机池返回（${U.until(cond.until)}）`, `Waiting for the device farm (${U.until(cond.until)})`);
    if (cond.code === 'unknown' && cond.reason === 'host_offline') {
      const h = U.host(okr.hostId);
      sub = T(`${h ? h.name : ''} 最后心跳 ${U.ago(cond.since)}，显示历史快照`, `${h ? h.name : ''} last reported ${U.ago(cond.since)}; showing the last snapshot`);
    }
    if (cond.code === 'achieved') sub = T(`全部 KR 已验收，${U.date(okr.achievedAt)} 达成`, `All KRs accepted; achieved ${U.date(okr.achievedAt)}`);
    const scen = cond.scenario ? `<span class="demo-tag" title="${T('评审注入的演示观测', 'A demo observation injected for review')}">${T('评审注入', 'Injected')}</span>` : '';
    const basisKey = { drift: 'drift', loop: 'loop', blocked: 'blocked', boundary: 'boundary', waiting: 'waiting', unknown: 'unknown' }[cond.code];
    const basisBtn = basisKey ? `<button class="link-btn small" data-action="expand" data-key="basis-${esc(okr.id)}">${T('判断依据', 'Why')}${icon(ui.expanded[`basis-${okr.id}`] ? 'up' : 'down', 'xs')}</button>` : '';
    return `<div class="banner c-${cond.code}" role="status">
      <span class="b-ico">${icon(U.condIcon(cond.code))}</span>
      <div class="grow"><div class="row wrap gap-sm"><span class="b-t">${esc(title)}</span>${scen}</div><div class="b-s">${esc(sub)} ${basisBtn}</div></div>
    </div>`;
  }

  function basisBlock(okr, cond) {
    const key = { drift: 'drift', loop: 'loop', blocked: 'blocked', boundary: 'boundary', waiting: 'waiting', unknown: 'unknown' }[cond.code];
    if (!key || !ui.expanded[`basis-${okr.id}`]) return '';
    const items = BASIS[key].map(x => `<li>${esc(T(x[0], x[1]))}</li>`).join('');
    return `<div class="basis"><strong>${T('判断依据', 'Basis')}</strong>${cond.scenario ? ` <span class="tiny muted">${T('（演示观测）', '(demo observations)')}</span>` : ''}<ul>${items}</ul></div>`;
  }

  /* ---------------------------------------------------------------- Map */

  function points(okr) {
    const n = okr.krs.length;
    const x0 = 70, x1 = 930, yA = 176, yB = 112;
    const pts = [{ x: x0, y: yA, kind: 'start' }];
    okr.krs.forEach((kr, i) => pts.push({ x: x0 + (i + 1) * (x1 - x0) / (n + 1), y: i % 2 === 0 ? yB : yA, kind: 'kr', kr }));
    pts.push({ x: x1, y: n % 2 === 0 ? yB : yA, kind: 'finish' });
    return pts;
  }
  const seg = (a, b, dip) => { const dx = (b.x - a.x) / 2; const d = dip || 0; return [a, { x: a.x + dx, y: a.y + d }, { x: b.x - dx, y: b.y + d }, b]; };
  function bez(c, t) {
    const u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return { x: k[0] * c[0].x + k[1] * c[1].x + k[2] * c[2].x + k[3] * c[3].x, y: k[0] * c[0].y + k[1] * c[1].y + k[2] * c[2].y + k[3] * c[3].y };
  }
  function tan(c, t) {
    const u = 1 - t;
    const dx = 3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x);
    const dy = 3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y);
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }
  function split(c, t) {
    const lerp = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const p01 = lerp(c[0], c[1]), p12 = lerp(c[1], c[2]), p23 = lerp(c[2], c[3]);
    const p012 = lerp(p01, p12), p123 = lerp(p12, p23), p = lerp(p012, p123);
    return [[c[0], p01, p012, p], [p, p123, p23, c[3]]];
  }
  const dPath = c => `M${c[0].x.toFixed(1)},${c[0].y.toFixed(1)} C${c[1].x.toFixed(1)},${c[1].y.toFixed(1)} ${c[2].x.toFixed(1)},${c[2].y.toFixed(1)} ${c[3].x.toFixed(1)},${c[3].y.toFixed(1)}`;
  const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  function metricText(kr) {
    if (kr.binary) return kr.binary.verified ? T('已验证', 'verified') : T('未验证', 'unverified');
    const m = kr.metric;
    return `${U.num(m.current, m.unit)} / ${U.num(m.target, m.unit)}`;
  }

  function renderMap(okr, cond, opts) {
    const org = O();
    const pts = points(okr);
    const cur = M.currentKr(okr);
    const achieved = okr.lifecycle === 'ACHIEVED';
    const stale = cond.code === 'unknown';
    let out = '';
    let marker = null;
    const segs = [];

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const kr = b.kr;
      const routeB = kr && (kr.route || 'A') === 'B';
      const c = seg(a, b, routeB ? 70 : 0);
      segs.push(c);
      out += `<path class="road-bg" d="${dPath(c)}"/>`;
      if (routeB) out += `<path class="seg-plan faded" d="${dPath(seg(a, b))}"/><text class="sub" x="${(a.x + b.x) / 2}" y="${Math.min(a.y, b.y) - 16}" text-anchor="middle">${esc(T('路线 A（已替代）', 'Route A (superseded)'))}</text>`;
      if (!kr) {
        out += `<path class="${achieved ? 'seg-ok' : 'seg-plan'}" d="${dPath(c)}"/>`;
        continue;
      }
      const st = krState(okr, kr, cur);
      const p = M.krProgress(kr);
      if (st === 'accepted' || st === 'verified' || st === 'verifying') out += `<path class="${st === 'verifying' ? 'seg-info' : 'seg-ok'}" d="${dPath(c)}"/>`;
      else if (st === 'current' || st === 'progress') {
        const t = Math.max(0, Math.min(1, p || 0));
        const [done, rest] = split(c, Math.max(t, 0.001));
        out += `<path class="seg-plan" d="${dPath(rest)}"/>`;
        if (t > 0) out += `<path class="${st === 'current' ? 'seg-info' : 'seg-light'}" d="${dPath(done)}"/>`;
        if (st === 'current') marker = { c, t: Math.min(0.94, Math.max(0.06, t)), i };
      } else out += `<path class="seg-plan" d="${dPath(c)}"/>`;
      if (routeB) { const lp = bez(c, 0.66); out += `<text class="sub t-info" x="${lp.x.toFixed(1)}" y="${(lp.y + 20).toFixed(1)}" text-anchor="middle">${esc(T('路线 B', 'Route B'))} · ${esc(L(kr.plan.B.label))}</text>`; }
    }

    // Marker fallback: waiting at the last verified checkpoint, or at the finish.
    if (!marker && !achieved && okr.lifecycle === 'ACTIVE') {
      const lastIdx = (() => { let k = 0; okr.krs.forEach((kr, i) => { if (kr.verification && kr.verification.state === 'passed') k = i + 1; }); return k; })();
      const i = Math.min(lastIdx + 1, pts.length - 1);
      marker = { c: segs[i - 1], t: 0.04, i };
    }

    // Unauthorized zone, barriers and branches by road condition.
    let deco = '';
    if (marker) {
      const m = bez(marker.c, marker.t);
      const next = pts[marker.i];
      if (cond.code === 'boundary' && cond.reason === 'awaiting_approval') {
        const a = M.find(org.approvals, cond.approvalId);
        const zx = Math.min(Math.max((m.x + next.x) / 2 - 105, 20), 770), zy = Math.min(m.y, next.y) - 96;
        deco += `<path class="seg-warn" d="M${m.x},${m.y - 12} L${zx + 105},${zy + 52}"/>
          <rect class="zone" x="${zx}" y="${zy}" width="210" height="52" rx="10"/>
          <text class="lbl t-danger" x="${zx + 105}" y="${zy + 22}" text-anchor="middle">${esc(T('未授权区域', 'Unauthorized zone'))}</text>
          <text class="sub t-danger" x="${zx + 105}" y="${zy + 40}" text-anchor="middle">${esc(trunc(L(a ? a.action : ''), U.prefs.locale === 'en' ? 30 : 16))}</text>`;
      }
      if (cond.code === 'boundary' && cond.reason !== 'awaiting_approval') deco += barrier(bez(marker.c, Math.min(0.98, marker.t + 0.18)), T('预算/期限边界', 'Budget/deadline limit'), 'warn');
      if (cond.code === 'blocked') {
        deco += barrier(bez(marker.c, Math.min(0.98, marker.t + 0.2)), T('路径阻断', 'Blocked'), 'danger');
        const k = M.find(okr.krs, cond.krId) || cur;
        if (k && k.plan && k.plan.B && (k.route || 'A') !== 'B') {
          // The candidate detours above the road, clear of checkpoint labels.
          const alt = [m, { x: m.x + 70, y: m.y - 80 }, { x: next.x - 70, y: next.y - 10 }, next];
          const mid = bez(alt, 0.45);
          deco += `<path class="seg-alt" d="${dPath(alt)}"/><text class="sub t-info" x="${mid.x.toFixed(1)}" y="${(mid.y - 12).toFixed(1)}" text-anchor="middle">${esc(T('候选：路线 B · 待验证', 'Candidate: route B · unverified'))}</text>`;
        }
      }
      if (cond.code === 'drift') {
        const e = { x: m.x + 86, y: m.y - 84 };
        deco += `<path class="seg-warn" d="M${m.x},${m.y} C${m.x + 20},${m.y - 50} ${e.x - 30},${e.y + 10} ${e.x},${e.y}"/><circle cx="${e.x}" cy="${e.y}" r="6" class="dot-warn"/><text class="lbl t-warn" x="${e.x + 12}" y="${e.y + 4}">${esc(T('偏航', 'Drift'))}</text><text class="sub t-warn" x="${e.x + 12}" y="${e.y + 21}">${esc(T('2 个动作未关联 KR', '2 actions map to no KR'))}</text>`;
      }
      if (cond.code === 'loop') {
        deco += `<path class="seg-warn" d="M${m.x + 24},${m.y - 4} A 24 24 0 1 1 ${m.x + 17},${m.y - 18}"/><path class="dot-warn" d="M${m.x + 16},${m.y - 26} l9,6 -10,4 z"/><text class="lbl t-warn" x="${m.x}" y="${m.y - 36}" text-anchor="middle">${esc(T('疑似空转', 'Looping?'))}</text>`;
      }
      if (cond.code === 'waiting') {
        deco += `<g transform="translate(${m.x + 18},${m.y - 50})"><rect class="pill-wait" x="0" y="0" width="${U.prefs.locale === 'en' ? 150 : 128}" height="26" rx="13"/><text class="sub t-wait" x="12" y="17.5">⌛ ${esc(cond.reason === 'dependency' ? T('等待真机池', 'Device farm') : T('等待你验收', 'Your acceptance'))}</text></g>`;
      }
      const ang = tan(marker.c, marker.t);
      deco += `<g class="${stale ? '' : 'marker-g'}" transform="translate(${m.x.toFixed(1)},${m.y.toFixed(1)})">
        ${stale ? '' : '<circle class="ping marker-ring" r="12"/>'}
        <circle class="marker" r="12"/><path class="ico-w" d="M-4,-5 L5,0 L-4,5" transform="rotate(${ang.toFixed(1)})"/></g>`;
    }

    // Nodes and labels.
    let nodes = '';
    pts.forEach((pt, i) => {
      if (pt.kind === 'start') {
        nodes += `<circle cx="${pt.x}" cy="${pt.y}" r="7" class="n-start"/><text class="sub" x="${pt.x}" y="${pt.y + 30}" text-anchor="middle">${esc(T('起点', 'Start'))}</text>`;
        return;
      }
      const below = pt.y > 150;
      const ly = below ? pt.y + 36 : pt.y - 58;
      if (pt.kind === 'finish') {
        const crit = M.criteriaReview(okr);
        const passed = crit.filter(c => c.passed).length;
        nodes += `<g class="clickable" data-action="go" data-to="okrs/${esc(okr.id)}" role="button" tabindex="0" aria-label="${esc(T('OKR 验收标准', 'OKR acceptance criteria'))}">
          <rect x="${pt.x - 18}" y="${pt.y - 18}" width="36" height="36" rx="10" class="n-finish ${achieved ? 'done' : ''}"/>
          <path class="${achieved ? 'ico-w' : 'ico-m'}" d="M${pt.x - 5},${pt.y + 9} V${pt.y - 9} M${pt.x - 5},${pt.y - 8} H${pt.x + 7} L${pt.x + 4},${pt.y - 4} L${pt.x + 7},${pt.y} H${pt.x - 5}"/>
          <text class="lbl" x="${pt.x}" y="${ly}" text-anchor="middle">${esc(T('OKR 验收', 'OKR acceptance'))}</text>
          <text class="sub" x="${pt.x}" y="${ly + 17}" text-anchor="middle">${esc(T(`成功标准 ${passed}/${crit.length}`, `Criteria ${passed}/${crit.length}`))}</text></g>`;
        return;
      }
      const kr = pt.kr;
      const st = krState(okr, kr, cur);
      const lab = krLabel(okr, kr.id);
      const tone = { accepted: 't-ok', verified: 't-ok', verifying: 't-info', current: 't-info', progress: 't-info', pending: 't-muted' }[st];
      const state = {
        accepted: T('已验收', 'accepted'), verified: T('已验证 · 待验收', 'verified · awaiting you'), verifying: T('验证中', 'verifying'),
        current: T('当前 · 已测量', 'current · measured'), progress: T('已测量', 'measured'), pending: kr.deps && kr.deps.length && !M.depsMet(okr, kr) ? T('等待依赖', 'blocked by deps') : T('计划', 'planned'),
      }[st];
      let shape = '';
      if (st === 'accepted') shape = `<circle cx="${pt.x}" cy="${pt.y}" r="17" class="n-ok"/><path class="ico-w" d="M${pt.x - 7},${pt.y} l5,5 9,-10"/>`;
      else if (st === 'verified') shape = `<circle cx="${pt.x}" cy="${pt.y}" r="17" class="n-ok-soft"/><path class="ico-ok" d="M${pt.x - 7},${pt.y} l5,5 9,-10"/>`;
      else if (st === 'verifying') shape = `<circle cx="${pt.x}" cy="${pt.y}" r="17" class="n-info"/><text class="sub t-info" x="${pt.x}" y="${pt.y + 4}" text-anchor="middle">…</text>`;
      else if (st === 'current' || st === 'progress') shape = `<circle cx="${pt.x}" cy="${pt.y}" r="17" class="n-info"/><text class="tiny-t t-info" x="${pt.x}" y="${pt.y + 4}" text-anchor="middle">${esc(U.pct(M.krProgress(kr)))}</text>`;
      else shape = `<circle cx="${pt.x}" cy="${pt.y}" r="17" class="n-pend"/>`;
      nodes += `<g class="clickable" data-action="evidence" data-okr="${esc(okr.id)}" data-kr="${esc(kr.id)}" role="button" tabindex="0" aria-label="${esc(`${lab} ${L(kr.title)} · ${state}`)}">
        <circle cx="${pt.x}" cy="${pt.y}" r="24" class="n-hit"/>${shape}
        <text class="lbl" x="${pt.x}" y="${ly}" text-anchor="middle">${esc(lab)} <tspan class="sub">${esc(trunc(L(kr.title), U.prefs.locale === 'en' ? 22 : 11))}</tspan></text>
        <text class="sub" x="${pt.x}" y="${ly + 17}" text-anchor="middle">${esc(metricText(kr))}</text>
        <text class="sub ${tone}" x="${pt.x}" y="${ly + 33}" text-anchor="middle">${esc(state)}</text></g>`;
    });

    const view = opts && opts.locate && marker ? (() => { const m = bez(marker.c, marker.t); const x = Math.max(0, Math.min(1000 - 520, m.x - 260)); return `${x.toFixed(0)} 30 520 135`; })() : '0 0 1000 262';
    return `<svg class="map ${stale ? 'stale' : ''}" viewBox="${view}" role="img" aria-label="${esc(T('运行导航地图：KR 为检查点，OKR 验收为终点', 'Run navigation map: KRs are checkpoints, OKR acceptance is the destination'))}">
      <defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="8" class="hatch-line"/></pattern></defs>
      ${out}${deco}${nodes}</svg>`;
  }

  function barrier(p, label, tone) {
    return `<g transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})"><rect x="-22" y="-9" width="44" height="18" rx="4" class="barrier-${tone}"/><path d="M-14,-9 l-8,18 M-2,-9 l-8,18 M10,-9 l-8,18 M22,-9 l-8,18" class="barrier-stripe ${tone}"/><text class="sub t-${tone}" x="0" y="-18" text-anchor="middle">${esc(label)}</text></g>`;
  }

  /** Compact route strip for phones: position, road condition and checkpoints. */
  function routeStrip(okr, cond) {
    const n = okr.krs.length;
    const W = 340, x0 = 18, x1 = 322, y = 22;
    const cur = M.currentKr(okr);
    const xs = okr.krs.map((_, i) => x0 + (i + 1) * (x1 - x0) / (n + 1));
    let s = `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" class="strip-bg"/>`;
    let prev = x0;
    let mx = null;
    okr.krs.forEach((kr, i) => {
      const st = krState(okr, kr, cur);
      const x = xs[i];
      if (st === 'accepted' || st === 'verified') s += `<line x1="${prev}" y1="${y}" x2="${x}" y2="${y}" class="strip-ok"/>`;
      else if (st === 'current' || st === 'progress') {
        const p = M.krProgress(kr) || 0;
        const px = prev + (x - prev) * p;
        s += `<line x1="${prev}" y1="${y}" x2="${px}" y2="${y}" class="${st === 'current' ? 'strip-info' : 'strip-light'}"/>`;
        if (st === 'current') mx = prev + (x - prev) * Math.min(0.92, Math.max(0.08, p));
      }
      prev = x;
    });
    if (okr.lifecycle === 'ACHIEVED') s += `<line x1="${prev}" y1="${y}" x2="${x1}" y2="${y}" class="strip-ok"/>`;
    okr.krs.forEach((kr, i) => {
      const st = krState(okr, kr, cur);
      const cls = { accepted: 'n-ok', verified: 'n-ok-soft', verifying: 'n-info', current: 'n-info', progress: 'n-info', pending: 'n-pend' }[st];
      s += `<circle cx="${xs[i]}" cy="${y}" r="8" class="${cls}"/>`;
      if (st === 'accepted' || st === 'verified') s += `<path class="${st === 'accepted' ? 'ico-w' : 'ico-ok'}" d="M${xs[i] - 3.5},${y} l2.5,2.5 4.5,-5"/>`;
      s += `<text class="sub" x="${xs[i]}" y="${y + 27}" text-anchor="middle">${esc(krLabel(okr, kr.id))}</text><text class="sub ${st === 'pending' ? 't-muted' : 't-info'}" x="${xs[i]}" y="${y + 42}" text-anchor="middle">${esc(st === 'accepted' ? '✓' : st === 'verified' ? T('待验收', 'accept') : U.pct(M.krProgress(kr)))}</text>`;
    });
    s += `<rect x="${x1 - 8}" y="${y - 8}" width="16" height="16" rx="4" class="n-finish ${okr.lifecycle === 'ACHIEVED' ? 'done' : ''}"/><text class="sub" x="${x1}" y="${y + 27}" text-anchor="middle">${esc(T('验收', 'Done'))}</text>`;
    if (mx !== null && cond.code !== 'achieved') s += `<circle cx="${mx}" cy="${y}" r="7" class="marker"/>`;
    return `<svg class="strip map ${cond.code === 'unknown' ? 'stale' : ''}" viewBox="0 0 ${W} 72" role="img" aria-label="${esc(T('路线进度', 'Route progress'))}">${s}</svg>`;
  }

  /* -------------------------------------------------------- Stats cards */

  function distanceCard(okr) {
    const now = U.now();
    const a = M.achievement(okr, now);
    const done = okr.krs.filter(k => k.status === 'COMPLETE').length;
    const lv = M.lastVerifiedKr(okr);
    const unknown = a.unknown.length ? `<span class="chip warn" title="${T('缺失或过期的数据不按 0% 或完成展示', 'Missing or stale data is never shown as 0% or complete')}">${icon('help')}${T(`${a.unknown.length} 项未知/待更新`, `${a.unknown.length} unknown/stale`)}</span>` : '';
    return `<div>
      <h3>${icon('target', 'xs')}${T('距离结果', 'Distance to result')}</h3>
      <div class="row between top"><div class="kpi"><span class="kpi-v">${U.pct(a.value)}</span><span class="kpi-l">${T(`加权达成度 · ${done}/${okr.krs.length} KR 已完成`, `Weighted · ${done}/${okr.krs.length} KRs complete`)}</span></div>
        <button class="btn ghost icon sm" data-action="formula" aria-label="${T('计算口径', 'How this is calculated')}" title="${T('计算口径', 'How this is calculated')}">${icon('info')}</button></div>
      ${unknown ? `<div class="mt-8">${unknown}</div>` : ''}
      <div class="kr-mini"><div class="row tiny muted"><span style="width:30px"></span><span class="grow">${T('进度', 'Progress')}</span><span style="width:40px;text-align:right">${T('权重', 'Weight')}</span></div>${okr.krs.map(kr => {
        const p = M.krProgress(kr);
        const stale = M.krStale(kr, now);
        const cls = kr.status === 'COMPLETE' ? 'ok' : '';
        return `<div class="row"><span class="strong" style="width:30px">${esc(krLabel(okr, kr.id))}</span><div class="bar ${p === null || stale ? 'unknown' : cls}"><i style="width:${p === null ? 0 : Math.round(p * 100)}%"></i></div><span class="num muted" style="width:38px;text-align:right">${p === null ? '—' : U.pct(p)}</span><span class="tiny muted num" style="width:40px;text-align:right">${Math.round(a.parts.find(x => x.id === kr.id).share * 100)}%</span></div>`;
      }).join('')}</div>
      <div class="small muted mt-12">${T('最后已验证检查点', 'Last verified checkpoint')}：${lv ? `<strong>${esc(krLabel(okr, lv.id))}</strong> · ${U.agoTag(lv.verification.at)}` : T('尚无', 'none yet')}</div>
    </div>`;
  }

  function boundaryCard(okr, cond) {
    const b = okr.constraints.budget;
    const left = M.budgetLeft(b);
    const step = M.nextStep(okr);
    const gate = gateOf(M.currentKr(okr));
    const w = x => `${Math.max(0, Math.min(100, (x / b.limit) * 100)).toFixed(1)}%`;
    const need = cond.code === 'boundary' && cond.need ? cond.need - left : 0;
    const perm = cond.code === 'boundary' ? `<span class="st warn">${icon('alert')}${T('需要批准或调整', 'Needs approval or change')}</span>` : cond.code === 'unknown' ? `<span class="st muted">${icon('help')}${T('未知', 'Unknown')}</span>` : `<span class="st ok">${icon('shield')}${T('在授权范围内', 'Within authority')}</span>`;
    const dir = { drift: T('偏航（仍在授权内）', 'Drifting (still authorized)'), loop: T('原地打转', 'Circling'), blocked: T('当前路径不可行', 'Current path infeasible'), unknown: T('未知', 'Unknown') }[cond.code] || (M.currentKr(okr) ? T(`朝 ${krLabel(okr, M.currentKr(okr).id)}`, `Toward ${krLabel(okr, M.currentKr(okr).id)}`) : '—');
    return `<div>
      <h3>${icon('shield', 'xs')}${T('边界与余量', 'Boundary & reserve')}</h3>
      <div class="row between small"><span class="muted">${T('预算', 'Budget')}</span><span class="num">${U.money(b.spent)} ${T('已用', 'spent')} + ${U.money(b.reserved || 0)} ${T('预留', 'reserved')} / ${U.money(b.limit)}</span></div>
      <div class="meter mt-4" role="img" aria-label="${esc(T(`已用 ${U.money(b.spent)}，预留 ${U.money(b.reserved || 0)}，上限 ${U.money(b.limit)}`, `${U.money(b.spent)} spent, ${U.money(b.reserved || 0)} reserved, limit ${U.money(b.limit)}`))}"><span class="spent" style="width:${w(b.spent)}"></span><span class="reserved" style="width:${w(b.reserved || 0)}"></span>${need > 0 ? `<span class="need" style="width:${w(Math.min(need, b.limit))}"></span>` : ''}</div>
      <div class="small muted mt-4">${T('剩余', 'Left')} <strong class="num" style="color:var(--text)">${U.money(left)}</strong>${step ? ` · ${T('下一动作', 'next action')} ${U.money(step.cost)}` : ''}${gate ? ` · ${T('越界影响', 'out-of-bounds impact')} +${U.money(gate.budgetImpact || 0)}` : ''}</div>
      <div class="col gap-sm mt-12 small">
        <div class="row between"><span class="muted">${T('期限', 'Deadline')}</span><span>${U.date(okr.constraints.deadline)} · ${U.until(okr.constraints.deadline)}</span></div>
        <div class="row between"><span class="muted">${T('方向', 'Direction')}</span><span>${esc(dir)}</span></div>
        <div class="row between"><span class="muted">${T('权限', 'Authority')}</span>${perm}</div>
        <div class="row between"><span class="muted">${T('约定', 'Agreement')}</span><button class="link-btn" data-action="edit-agreement" data-id="${esc(okr.id)}">v${okr.constraints.version} ${icon('right', 'xs')}</button></div>
      </div>
    </div>`;
  }

  function observeCard(okr, cond) {
    const org = O();
    const h = U.host(okr.hostId);
    const i = U.inst(okr.instanceId);
    const kr = M.currentKr(okr) || M.lastVerifiedKr(okr);
    const run = M.currentRun(org, okr);
    const stale = kr ? M.krStale(kr, U.now()) : false;
    return `<div>
      <h3>${icon('pulse', 'xs')}${T('观测', 'Observation')}</h3>
      <div class="col gap-sm small">
        <div class="row between"><span class="muted">${T('执行', 'Runs on')}</span><a href="#/hosts/${esc(okr.hostId)}" class="ellipsis">${esc(h ? h.name : '—')} / ${esc(i ? i.name : '—')}</a></div>
        <div class="row between"><span class="muted">${T('心跳', 'Heartbeat')}</span><span>${h ? `${h.status === 'online' ? '' : `<span class="st muted">${icon('offline')}</span> `}${U.agoTag(h.lastHeartbeatAt)}` : '—'}</span></div>
        ${kr && kr.metric ? `<div class="row between"><span class="muted">${esc(krLabel(okr, kr.id))} ${T('测量', 'sample')}</span><span>${kr.metric.sampledAt ? U.agoTag(kr.metric.sampledAt) : T('未采样', 'not sampled')}${kr.metric.window ? ` · ${esc(L(kr.metric.window))}` : ''}</span></div>` : ''}
        <div class="row between"><span class="muted">${T('可信度', 'Trust')}</span>${kr ? U.trust(M.krTrust(kr), { stale }) : '—'}</div>
        <div class="row between"><span class="muted">${T('当前 Run', 'Current run')}</span><span>${run ? `<span class="mono tiny">${esc(run.id)}</span> ${U.runState(run)}` : T('无', 'none')}</span></div>
      </div>
      ${cond.code === 'unknown' ? `<div class="note warn mt-12">${icon('offline')}<div>${T('连接中断不等于失败：Run 保持最后确认的状态，重连后对账。', 'Disconnected is not failed: the run keeps its last confirmed state and is reconciled on reconnect.')}</div></div>` : ''}
    </div>`;
  }

  function nextMove(okr, cond) {
    const org = O();
    const kr = M.currentKr(okr);
    let text = '';
    let act = '';
    if (cond.code === 'boundary' && cond.reason === 'awaiting_approval') {
      const a = M.find(org.approvals, cond.approvalId);
      text = T(`等待批准：${L(a.action)}（预算影响 +${U.money(a.budgetImpact || 0)}）`, `Awaiting approval: ${L(a.action)} (budget impact +${U.money(a.budgetImpact || 0)})`);
    } else if (cond.code === 'on_track' && kr) {
      if (M.krProgress(kr) === 1 && (!kr.verification || kr.verification.state === 'none')) text = T(`提交 ${krLabel(okr, kr.id)} 验证（${U.agent(kr.verifier).name}，规则 ${kr.ruleVersion || 'v1'}）`, `Submit ${krLabel(okr, kr.id)} for verification (${U.agent(kr.verifier).name}, rule ${kr.ruleVersion || 'v1'})`);
      else if (kr.verification && kr.verification.state === 'pending') text = T(`${U.agent(kr.verifier).name} 按规则 ${kr.ruleVersion || 'v1'} 验证 ${krLabel(okr, kr.id)}`, `${U.agent(kr.verifier).name} verifies ${krLabel(okr, kr.id)} under rule ${kr.ruleVersion || 'v1'}`);
      else {
        const gate = gateOf(kr);
        const executed = org.approvals.some(a => a.okrId === okr.id && a.krId === kr.id && a.kind === 'boundary' && a.route === (kr.route || 'A') && a.state === 'approved');
        const step = M.nextStep(okr);
        if (gate && !executed) text = T(`下一步超出约定：${L(gate.action)}，将先请求批准`, `The next step is outside the agreement: ${L(gate.action)}; approval will be requested first`);
        else if (step) text = T(`继续 ${krLabel(okr, kr.id)}：推进到 ${U.num(step.value, kr.metric.unit)}（预计 ${U.money(step.cost)}，约定内）`, `Continue ${krLabel(okr, kr.id)}: move to ${U.num(step.value, kr.metric.unit)} (est. ${U.money(step.cost)}, within the agreement)`);
      }
    } else if (cond.code === 'blocked') {
      text = T('只判定当前路径不可行；可在约定内切换替代路线（待验证）', 'Only the current path is infeasible; an alternative inside the agreement can be tried (unverified)');
    } else if (cond.code === 'paused') {
      text = T('已暂停：检查点和已完成结果保留，继续前会重新核对状态', 'Paused: checkpoints and results are kept; state is re-checked before continuing');
    } else if (cond.code === 'unknown') {
      text = T('暂停状态推断；恢复连接后先对账，不自动重试', 'Status inference paused; reconcile on reconnect without automatic retries');
    } else if (cond.code === 'achieved') {
      text = T('目标已达成：成果与经验已写入组织记忆', 'Goal achieved: results and lessons are in organization memory');
      act = `<a class="btn sm" href="#/memory">${icon('book', 'sm')}<span>${T('查看记忆', 'View memory')}</span></a>`;
    } else {
      text = reasonText(cond.reason) || U.condName(cond.code);
    }
    return `<div class="next"><span class="lbl">${T('下一步', 'Next')}</span><span class="grow">${esc(text)}</span>${act}</div>`;
  }

  /* -------------------------------------------------------- Decisions */

  const REASON_CHIP = {
    third_party_upload: ['上传到第三方', 'Third-party upload'],
    paid_service: ['付费服务', 'Paid service'],
    budget: ['超出预算', 'Over budget'],
    public_release: ['公开发布', 'Public release'],
    destructive: ['删除操作', 'Destructive'],
    deployment: ['部署', 'Deployment'],
  };

  function decisionCard(d) {
    const org = O();
    const t = U.now();
    if (d.kind === 'confirmation') {
      const r = d.item;
      const okr = M.find(org.okrs, r.okrId);
      return `<article class="decision k-confirmation">
        <div class="d-top"><span class="chip danger">${icon('help')}${T('需要确认', 'Needs confirmation')}</span><span>${esc(r.id)} · ${esc(krLabel(okr, r.krId))}</span></div>
        <div class="d-title">${esc(L(r.title))}</div>
        <div class="d-body"><div>${esc(L(r.note))}</div>${(r.sideEffects || []).map(s => `<div class="row">${icon('alert', 'xs')}<span>${esc(L(s))}</span></div>`).join('')}</div>
        <div class="d-actions">${U.btn({ action: 'confirm-run', data: { id: r.id }, label: T('检查结果并确认', 'Check and confirm'), kind: 'primary', size: 'sm', perm: 'operate' })}</div>
      </article>`;
    }
    if (d.kind === 'pairing') {
      const x = d.item;
      return `<article class="decision k-pairing">
        <div class="d-top"><span class="chip info">${icon('phone')}${T('设备配对', 'Device pairing')}</span><span>${U.until(x.expiresAt)}</span></div>
        <div class="d-title">${esc(x.name)} · ${esc(U.PLATFORM[x.platform] || x.platform)}</div>
        <div class="d-body"><div>${T('核对码', 'Code')} <strong class="mono">${esc(x.code.slice(0, 3))} ${esc(x.code.slice(3))}</strong> · ${T('默认当前组织、7 天只读', 'Default: this org, read-only, 7 days')}</div></div>
        <div class="d-actions">${U.btn({ action: 'pair-review', data: { id: x.id }, label: T('核对并授权', 'Review and authorize'), kind: 'primary', size: 'sm', perm: 'manage_identity' })}${U.btn({ action: 'pair-reject', data: { id: x.id }, label: T('拒绝', 'Reject'), size: 'sm' })}</div>
      </article>`;
    }
    const a = d.item;
    const okr = M.find(org.okrs, a.okrId);
    const tx = pendingDecisionTx(a.id);
    const kr = okr && a.krId ? M.find(okr.krs, a.krId) : null;
    const where = `${okr ? `<span class="prio ${okr.priority}">${okr.priority}</span> ` : ''}${esc(krLabel(okr, a.krId))}`;
    const busy = !!tx;
    const actions = busy ? `<div class="d-tx">${U.txLine(tx)}</div>` : '';
    if (a.kind === 'standing') return FM.standingCard(a, tx);
    if (a.kind === 'boundary') {
      const left = okr ? M.budgetLeft(okr.constraints.budget) : 0;
      return `<article class="decision k-boundary">
        <div class="d-top"><span class="chip warn">${icon('alert')}${T('越界请求', 'Out-of-bounds request')}</span><span class="row gap-sm">${where}</span></div>
        <div class="d-title">${esc(L(a.action))}</div>
        <div class="d-body">
          <div class="row wrap">${(a.reasons || []).map(r => `<span class="chip outline">${esc(T(...(REASON_CHIP[r] || [r, r])))}</span>`).join('')}</div>
          <div>${T('预算影响', 'Budget impact')} <strong>+${U.money(a.budgetImpact || 0)}</strong> · ${T('剩余', 'left')} ${U.money(left)} · ${T('约定', 'agreement')} v${a.boundVersion}</div>
          ${a.alternative ? `<div>${T('替代方案', 'Alternative')}：${esc(L(a.alternative))}</div>` : ''}
          <div class="muted">${T('有效期', 'Valid')} ${U.until(a.expiresAt)} · ${T('仅授权这一次操作', 'authorizes this one action only')}</div>
        </div>
        ${actions || `<div class="d-actions">${U.btn({ action: 'decide', data: { id: a.id, d: 'approve' }, label: T('同意本次', 'Approve once'), kind: 'primary', size: 'sm', perm: 'approve' })}${U.btn({ action: 'decide', data: { id: a.id, d: 'reject' }, label: T('拒绝', 'Reject'), size: 'sm', perm: 'approve' })}${U.btn({ action: 'approval-detail', data: { id: a.id }, label: T('详情', 'Details'), kind: 'ghost', size: 'sm' })}</div>`}
      </article>`;
    }
    if (a.kind === 'acceptance') {
      const ev = org.evidence.filter(e => e.okrId === a.okrId && e.krId === a.krId);
      const verified = ev.filter(e => e.trust === 'verified' || e.trust === 'accepted').length;
      return `<article class="decision k-acceptance">
        <div class="d-top"><span class="chip ok">${icon('seal')}${T('待你验收', 'Awaiting your acceptance')}</span><span class="row gap-sm">${where}</span></div>
        <div class="d-title">${esc(kr ? L(kr.title) : '')}</div>
        <div class="d-body">
          <div class="row">${U.trust('verified')}<span>${esc(U.agent(kr && kr.verification ? kr.verification.by : '').name)} · ${T('规则', 'rule')} ${esc(kr && kr.verification ? kr.verification.ruleVersion : '')}</span></div>
          <div>${kr ? esc(metricText(kr)) : ''} · ${T(`${verified} 份已验证证据`, `${verified} verified evidence items`)}</div>
          <div class="muted">${T('指标达标不等于完成：你检查证据后才构成验收。', 'Reaching the metric is not completion: acceptance needs your review of the evidence.')}</div>
        </div>
        ${actions || `<div class="d-actions">${U.btn({ action: 'decide', data: { id: a.id, d: 'approve' }, label: T('验收', 'Accept'), kind: 'primary', size: 'sm', perm: 'approve' })}${U.btn({ action: 'decide', data: { id: a.id, d: 'reject' }, label: T('退回', 'Return'), size: 'sm', perm: 'approve' })}${U.btn({ action: 'evidence', data: { okr: a.okrId, kr: a.krId }, label: T('检查证据', 'Check evidence'), kind: 'ghost', size: 'sm' })}</div>`}
      </article>`;
    }
    // okr_acceptance
    const crit = okr ? M.criteriaReview(okr) : [];
    return `<article class="decision k-okr_acceptance">
      <div class="d-top"><span class="chip brand">${icon('flag')}${T('最终验收', 'Final acceptance')}</span><span class="row gap-sm">${okr ? `<span class="prio ${okr.priority}">${okr.priority}</span>` : ''}</span></div>
      <div class="d-title">${esc(okr ? L(okr.title) : '')}</div>
      <div class="d-body"><div>${T(`全部 KR 已完成 · 成功标准复核 ${crit.filter(c => c.passed).length}/${crit.length} 通过`, `All KRs complete · criteria re-check ${crit.filter(c => c.passed).length}/${crit.length} passed`)}</div>
        <div class="muted">${T('确认后记为 ACHIEVED，成果与经验写入组织记忆。', 'Confirming records ACHIEVED and writes results and lessons to memory.')}</div></div>
      ${actions || `<div class="d-actions">${U.btn({ action: 'decide', data: { id: a.id, d: 'approve' }, label: T('确认达成', 'Confirm achieved'), kind: 'primary', size: 'sm', perm: 'approve' })}${U.btn({ action: 'decide', data: { id: a.id, d: 'reject' }, label: T('退回', 'Return'), size: 'sm', perm: 'approve' })}${U.btn({ action: 'go', data: { to: `okrs/${a.okrId}` }, label: T('查看证据', 'View evidence'), kind: 'ghost', size: 'sm' })}</div>`}
    </article>`;
  }

  FM.decisionCard = decisionCard;

  function decisionsSection(org) {
    const list = U.decisions(org);
    const head = `<div class="sec-h" id="decisions"><h2>${T('需要你决定', 'Needs your decision')}${list.length ? `<span class="count">${list.length}</span>` : ''}</h2><a class="small" href="#/governance">${T('全部审批', 'All approvals')} →</a></div>`;
    if (!list.length) return `<section class="sec">${head}<div class="calm">${icon('check')}<span>${T('没有需要你决定的事项。Agent 在授权范围内继续推进。', 'Nothing needs you right now. Agents keep working within their authority.')}</span></div></section>`;
    return `<section class="sec">${head}<div class="decisions">${list.slice(0, U.isMobile() ? 4 : 6).map(decisionCard).join('')}</div></section>`;
  }

  /* ------------------------------------------------------- Run + feed */

  function runCard(okr) {
    const org = O();
    const runs = org.runs.filter(r => r.okrId === okr.id).slice(0, 5);
    const cur = M.currentRun(org, okr);
    const stopTx = cur && cur.stopping;
    const head = cur ? `<div class="col gap-sm">
        <div class="row between"><span class="row"><span class="run-id">${esc(cur.id)}</span>${U.runState(cur)}</span>${cur.state === 'running' || cur.state === 'awaiting_approval' ? U.btn({ action: 'stop-run', data: { id: cur.id }, label: stopTx ? T('正在停止…', 'Stopping…') : T('取消', 'Cancel'), size: 'sm', kind: 'danger', perm: 'operate', disabled: stopTx }) : ''}</div>
        <div class="strong">${esc(L(cur.title))}</div>
        <div class="small muted">${esc(krLabel(okr, cur.krId))} · ${esc((U.host(cur.hostId) || {}).name || '')} / ${esc((U.inst(cur.instanceId) || {}).name || '')} · ${T('开始于', 'started')} ${U.agoTag(cur.startedAt)} · ${T('第', 'attempt ')}${cur.attempt}${T(' 次尝试', '')}</div>
        ${(cur.sideEffects || []).length ? `<div class="tiny muted">${T('已发生的副作用（取消不会回滚）', 'Side effects so far (cancel does not roll back)')}：${cur.sideEffects.map(s => esc(L(s))).join('；')}</div>` : ''}
      </div>` : `<div class="muted small">${T('当前没有进行中的 Run', 'No run in progress')}</div>`;
    return `<section class="card"><div class="card-h"><h2>${icon('play', 'sm')}${T('当前执行', 'Current run')}</h2><a class="small" href="#/okrs/${esc(okr.id)}?tab=runs">${T('全部', 'All')} →</a></div>${head}
      <div class="divider"></div>
      <div class="col" style="gap:0">${runs.filter(r => r !== cur).slice(0, 4).map(r => `<div class="run-row"><span class="run-id">${esc(r.id)}</span><span class="grow ellipsis">${esc(L(r.title))}</span>${r.parentRunId ? `<span class="tiny muted">${T('重试自', 'retry of')} ${esc(r.parentRunId)}</span>` : ''}${U.runState(r)}</div>`).join('') || `<div class="muted small">${T('暂无历史 Run', 'No earlier runs')}</div>`}</div>
    </section>`;
  }

  function feedCard(okr) {
    const org = O();
    const items = org.activity.filter(a => a.okrId === okr.id).slice(0, 7);
    return `<section class="card"><div class="card-h"><h2>${icon('pulse', 'sm')}${T('执行足迹', 'Footprints')}</h2><span class="tiny muted">${T('只记录进展、阻塞与决定', 'Progress, blockers and decisions only')}</span></div>
      <div class="feed">${items.map(a => {
        const x = FM.activityText(a);
        return `<div class="ev"><span class="e-ico">${icon(x.icon)}</span><div class="grow"><div class="e-t">${x.html}</div><div class="e-s">${U.agoTag(a.at)}${a.runId ? `<span class="mono">${esc(a.runId)}</span>` : ''}${x.trust ? U.trust(x.trust) : ''}</div></div></div>`;
      }).join('') || `<div class="muted small">${T('暂无记录', 'Nothing yet')}</div>`}</div>
    </section>`;
  }

  /* ---------------------------------------------------------- Focus */

  function focusCard(okr) {
    const org = O();
    const cond = M.condition(org, okr, U.now());
    const mobile = U.isMobile();
    const locate = ui.mapView[okr.id] === 'locate';
    const paused = cond.code === 'paused';
    const canPause = okr.lifecycle === 'ACTIVE' && !paused && cond.code !== 'unknown';
    const kr = M.currentKr(okr);
    const hasB = kr && kr.plan && kr.plan.B && (kr.route || 'A') !== 'B';
    const h = U.host(okr.hostId);
    const stale = cond.code === 'unknown';
    return `<section class="card focus" aria-label="${esc(L(okr.title))}">
      <div class="focus-h">
        ${banner(okr, cond)}
        <div class="row wrap">
          ${bannerActions(okr, cond)}
          ${U.btn({ action: 'talk', data: { id: okr.id }, label: T('与 Agent 沟通', 'Talk to agent'), icon: 'message', size: 'sm' })}
          ${canPause ? U.btn({ action: 'talk', data: { id: okr.id, purpose: 'pause' }, label: T('暂停', 'Pause'), icon: 'pause', size: 'sm', kind: 'ghost', perm: 'operate' }) : ''}
          <button class="btn ghost sm icon" data-action="focus-menu" data-pop-anchor="focus" data-id="${esc(okr.id)}" aria-label="${T('更多操作', 'More actions')}">${icon('more', 'fill')}</button>
        </div>
      </div>
      ${basisBlock(okr, cond)}
      ${mobile ? `<div class="map-wrap" style="padding:10px 12px 2px">${routeStrip(okr, cond)}</div>` : `<div class="map-wrap">
        ${stale ? `<span class="chip map-stale-label">${icon('clock')}${T('历史快照', 'Last snapshot')} · ${U.agoTag(cond.since || (h ? h.lastHeartbeatAt : null))}</span>` : ''}
        <div class="map-tools"><div class="seg"><button data-action="map-view" data-id="${esc(okr.id)}" data-v="full" aria-pressed="${!locate}">${T('全图', 'Full')}</button><button data-action="map-view" data-id="${esc(okr.id)}" data-v="locate" aria-pressed="${locate}">${T('定位', 'Locate')}</button></div></div>
        ${renderMap(okr, cond, { locate })}
      </div>
      <div class="map-foot"><div class="legend">
        <span><i class="sw" style="background:var(--ok)"></i>${T('已验证结果', 'Verified')}</span>
        <span><i class="sw" style="background:var(--info)"></i>${T('当前进度（已测量）', 'Progress (measured)')}</span>
        <span><i class="sw" style="background:repeating-linear-gradient(90deg,var(--text-4) 0 3px,transparent 3px 7px)"></i>${T('计划路线', 'Planned')}</span>
        <span><i class="sw" style="background:repeating-linear-gradient(90deg,var(--warn) 0 5px,transparent 5px 9px)"></i>${T('偏航/空转', 'Drift/loop')}</span>
        <span><i class="sw" style="background:repeating-linear-gradient(45deg,var(--danger) 0 2px,transparent 2px 5px)"></i>${T('未授权区域', 'Unauthorized')}</span>
      </div><span class="tiny muted">${T('结果空间示意，不代表剩余时间或成功概率', 'A schematic of results, not time remaining or odds of success')}</span></div>`}
      <div class="focus-grid">${distanceCard(okr)}${boundaryCard(okr, cond)}${observeCard(okr, cond)}</div>
      ${nextMove(okr, cond)}
    </section>`;
  }

  FM.pops.focus = pop => {
    const okr = U.okrById(pop.id);
    if (!okr) return '';
    const kr = M.currentKr(okr);
    const hasB = kr && kr.plan && kr.plan.B && (kr.route || 'A') !== 'B';
    const item = (action, ic, zh, en, data, perm) => {
      const chk = perm ? can(perm) : { ok: true };
      return `<button class="menu-i" data-action="${action}" ${U.attrs(data)}${chk.ok ? '' : ` aria-disabled="true" data-why="${esc(U.permText(chk.code))}"`}>${icon(ic, 'sm')}<span class="grow">${esc(T(zh, en))}</span>${chk.ok ? '' : icon('lock', 'xs')}</button>`;
    };
    return `<div class="pop" role="menu">
      ${item('go', 'target', '查看 OKR 详情', 'View OKR details', { to: `okrs/${okr.id}` })}
      ${item('edit-agreement', 'file', '调整执行约定', 'Adjust agreement', { id: okr.id }, 'approve')}
      ${item('reassign', 'server', '改派执行主机', 'Reassign host', { id: okr.id }, 'operate')}
      ${hasB ? item('switch-route', 'route', '切换到路线 B', 'Switch to route B', { id: okr.id, route: 'B' }, 'operate') : ''}
    </div>`;
  };

  /* --------------------------------------------------------- Onboarding */

  function onboarding(p, org) {
    const ob = p.onboarding || {};
    const step = (done, n, zh, en, dzh, den, action, label) => `<div class="item top">
      <span class="avatar sm round" style="background:${done ? 'var(--ok)' : 'var(--surface-3)'};color:${done ? '#fff' : 'var(--text-2)'}">${done ? icon('check', 'xs') : n}</span>
      <div class="grow"><div class="strong">${esc(T(zh, en))}</div><div class="small muted">${esc(T(dzh, den))}</div></div>
      ${done ? `<span class="st ok">${icon('check')}${T('完成', 'Done')}</span>` : action}</div>`;
    const agent = org.agents.find(a => a.origin === 'app');
    return `<section class="card accent">
      <div class="card-h"><h2>${icon('sparkle', 'sm')}${T('开始你的第一个成果', 'Get to your first result')}</h2><span class="chip">${T('空组织 · 不继承任何示例数据', 'Empty organization · nothing inherited')}</span></div>
      <div class="list">
        ${step(ob.host, 1, '把这台电脑设为执行主机', 'Use this computer as an execution host', '后台服务同时承担 Host 与 Coordinator 角色，一次确认完成准入。', 'A background service runs the Host and Coordinator roles; one confirmation completes admission.', U.btn({ action: 'open', data: { dialog: 'bootstrap' }, label: T('设为执行主机', 'Set up'), size: 'sm', kind: 'primary', perm: 'manage_hosts' }))}
        ${step(ob.agent, 2, '创建默认 Agent', 'Create your default Agent', agent ? `${agent.name} · ${L(agent.model)}` : '名称、工作区文件夹与模型；由 App 创建，重启后身份不变。', agent ? `${agent.name} · ${L(agent.model)}` : 'Name, workspace folder and model; created by the App, its identity survives restarts.', U.btn({ action: 'open', data: { dialog: 'agent-create', setup: '1' }, label: T('创建 Agent', 'Create Agent'), size: 'sm', kind: ob.host ? 'primary' : '', disabled: !ob.host, why: T('先准备执行主机', 'Prepare a host first'), perm: 'manage_hosts' }))}
        ${step(ob.okr, 3, '创建第一个 OKR', 'Create your first OKR', 'Agent 协助拟定量化成功标准与结果型 KR，你确认边界后激活。', 'The Agent drafts quantified criteria and result KRs; you confirm limits, then activate.', U.btn({ action: 'go', data: { to: 'okrs/new' }, label: T('新建 OKR', 'New OKR'), size: 'sm', kind: ob.agent ? 'primary' : '', disabled: !ob.agent, why: T('先创建默认 Agent', 'Create the default Agent first') }))}
      </div>
      <div class="note mt-12">${icon('info')}<div>${T('Agent 的工作区可以是已有项目目录，也可以是新建文件夹。模型鉴权失败或中途退出时，已完成的步骤会保留。', 'An Agent’s workspace can be an existing project folder or a new one. Completed steps are kept if model auth fails or you stop midway.')}</div></div>
    </section>`;
  }

  /* --------------------------------------------------------------- View */

  FM.views.workbench = () => {
    const p = P();
    const org = O();
    const active = org.okrs.filter(o => o.lifecycle === 'ACTIVE' || o.lifecycle === 'ACTIVATING');
    const focus = U.focusOkr();
    const d = new Date();
    const dateLine = new Intl.DateTimeFormat(U.prefs.locale === 'en' ? 'en' : 'zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }).format(d);
    const running = active.filter(o => M.condition(org, o, U.now()).code === 'on_track').length;
    const summary = T(`${active.length} 个进行中的目标 · ${running} 个自主推进中`, `${active.length} active goals · ${running} progressing autonomously`);

    const tabs = active.length ? `<section class="sec"><div class="sec-h"><h2>${T('进行中的目标', 'Active goals')}</h2><span class="small muted">${active.length}/${M.MAX_ACTIVE} ACTIVE</span></div>
      <div class="okr-tabs" role="tablist">${active.map(o => {
        const c = M.condition(org, o, U.now());
        const a = M.achievement(o, U.now());
        const sel = focus && focus.id === o.id;
        return `<button class="okr-tab" role="tab" aria-selected="${sel}" data-action="focus" data-id="${esc(o.id)}">
          <span class="row between"><span class="row gap-sm"><span class="prio ${o.priority}">${o.priority}</span>${U.condBadge(c.code)}</span><span class="pct">${U.pct(a.value)}</span></span>
          <span class="t">${esc(L(o.title))}</span></button>`;
      }).join('')}${active.length < M.MAX_ACTIVE ? `<button class="okr-tab add" data-action="go" data-to="okrs/new">${icon('plus')}<span>${T('新建 OKR', 'New OKR')}</span></button>` : ''}</div></section>` : '';

    const body = focus ? `${focusCard(focus)}<div class="grid-2 mt-16">${runCard(focus)}${feedCard(focus)}</div>` : '';
    const empty = !active.length ? (p.onboarding ? onboarding(p, org) : `<section class="card"><div class="empty"><div class="ico">${icon('target', 'lg')}</div><h3>${T('没有进行中的目标', 'No active goals')}</h3><p class="small">${T('创建 OKR 并确认执行边界后，Agent 会在授权范围内自主推进。', 'Create an OKR and confirm its limits; Agents then work autonomously within them.')}</p><div class="row center mt-8"><a class="btn primary" href="#/okrs/new">${icon('plus', 'sm')}<span>${T('新建 OKR', 'New OKR')}</span></a><a class="btn" href="#/okrs">${T('查看候选', 'View candidates')}</a></div></div></section>`) : '';

    return `<div class="page-h"><div><h1>${T('工作台', 'Workbench')}</h1><p class="muted">${esc(dateLine)} · ${esc(summary)}</p></div>
      <div class="row">${U.btn({ action: 'go', data: { to: 'okrs/new' }, label: T('新建 OKR', 'New OKR'), icon: 'plus', kind: 'primary' })}</div></div>
      ${decisionsSection(org)}
      ${empty ? `<section class="sec">${empty}</section>` : ''}
      ${tabs}
      ${body ? `<section class="sec" style="margin-top:14px">${body}</section>` : ''}`;
  };

  /* ------------------------------------------------------------ Actions */

  function ctxOk(perm) {
    const c = can(perm);
    if (!c.ok) toast(U.permText(c.code), 'warn');
    return c.ok ? c : null;
  }

  Object.assign(FM.actions, {
    focus: el => { O().focusOkrId = el.dataset.id; U.save(); render(); },
    'map-view': el => { ui.mapView[el.dataset.id] = el.dataset.v; render(); },
    'focus-menu': el => U.togglePop('focus', el.getAttribute('data-pop-anchor'), { id: el.dataset.id }),
    'scroll-decisions': () => { const s = document.getElementById('decisions'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    formula: () => U.openDialog('formula'),
    decide: el => {
      const org = O();
      const a = M.find(org.approvals, el.dataset.id);
      const ctx = ctxOk('approve');
      if (!ctx) return;
      const chk = M.checkDecision(org, a, ctx, U.now());
      if (!chk.ok) {
        if (chk.code === 'expired' || chk.code === 'invalidated') { a.state = chk.code; U.save(); }
        toast(U.txErr(chk.code), 'warn');
        render();
        return;
      }
      const approve = el.dataset.d === 'approve';
      const boundary = a.kind === 'boundary';
      if (a.kind === 'standing') {
        U.submitTx({ kind: 'approval.decide', payload: { approvalId: a.id, decision: approve ? 'approve' : 'reject', deviceId: ctx.deviceId } }, {
          ok: approve ? T('已同意本次：Agent 已执行这一次，常驻权限不变。', 'Approved once: the Agent ran it this one time; the standing permission is unchanged.') : T('已拒绝：该操作不会执行。', 'Rejected: the action will not run.'),
          onConfirmed: (res, p) => {
            if (approve) M.executeStandingApproval(p, p.data[res.tx.orgId], a.id, U.now());
            if (FM.review) FM.review.mark(`approval.standing.${approve ? 'approve' : 'reject'}`);
          },
        });
        return;
      }
      U.submitTx({ kind: 'approval.decide', payload: { approvalId: a.id, decision: approve ? 'approve' : 'reject', deviceId: ctx.deviceId } }, {
        ok: boundary
          ? (approve ? T('已同意：操作获准，尚未执行；执行结果会关联到这条审批。', 'Approved: the action is authorized but not yet executed; its result will link to this approval.') : T('已拒绝：该操作不会执行。可在约定内换路。', 'Rejected: the action will not run. You can reroute within the agreement.'))
          : (approve ? T('已验收并记录验收者。', 'Accepted and recorded with you as the acceptor.') : T('已退回：保留提交记录，Agent 将补充证据后重新提交。', 'Returned: the submission is kept; the Agent will add evidence and resubmit.')),
        onConfirmed: () => { if (FM.review) FM.review.mark(`approval.${a.kind}.${approve ? 'approve' : 'reject'}`); },
      });
    },
    'approval-detail': el => U.openDialog('approval', { id: el.dataset.id }),
    evidence: el => U.openDrawer('evidence', { okrId: el.dataset.okr, krId: el.dataset.kr }),
    talk: el => {
      U.openDrawer('talk', { okrId: el.dataset.id });
      if (el.dataset.purpose) U.setF(`talk-${el.dataset.id}.purpose`, el.dataset.purpose);
    },
    resolve: el => {
      if (!ctxOk('operate')) return;
      const org = O();
      const okr = U.okrById(el.dataset.id);
      const res = M.resolveScenario(P(), org, okr, el.dataset.how, U.now());
      U.save();
      const msg = {
        correct: T('已纠偏：停止无关动作，在同一约定内继续。', 'Corrected: unrelated actions stopped; continuing under the same agreement.'),
        replan: T('已重新规划：停止同策重试，按约定内的新路线继续（待验证）。', 'Replanned: identical retries stopped; continuing on a new route within the agreement (unverified).'),
        reroute: T('已切换到路线 B；原外部请求标为已替代，不视为已批准。', 'Switched to route B; the external request is superseded, not approved.'),
        cheaper: T('已选择低成本路线，预算上限不变。', 'Chose a cheaper route; the budget limit is unchanged.'),
        reconnect: T('观测已恢复并对账，自主循环保持暂停，等待你明确继续。', 'Observation restored and reconciled; the loop stays paused until you continue.'),
        dependency_returned: T('依赖已返回，约束检查通过后继续。', 'The dependency returned; continuing after constraint checks.'),
      }[el.dataset.how];
      toast(res.ok ? msg : U.txErr(res.code), res.ok ? 'ok' : 'warn');
      if (FM.review && res.ok) FM.review.mark(`nav.resolve.${el.dataset.how}`);
      render();
    },
    'switch-route': el => {
      if (!ctxOk('operate')) return;
      const okr = U.okrById(el.dataset.id);
      const res = M.switchRoute(P(), O(), okr, el.dataset.route || 'B', U.now());
      U.save();
      toast(res.ok ? T('已切换到路线 B；原外部请求标为已替代，不视为已批准。', 'Switched to route B; the external request is superseded, not approved.') : U.txErr(res.code), res.ok ? 'ok' : 'warn');
      if (FM.review && res.ok) FM.review.mark('nav.reroute');
      ui.pop = null;
      render();
    },
    resume: el => {
      if (!ctxOk('operate')) return;
      const okr = U.okrById(el.dataset.id);
      const res = M.resumeOkr(P(), O(), okr, U.now());
      U.save();
      const why = { host_offline: T('执行主机不可达', 'The host is unreachable'), agent_stopped: T('负责实例已停止，请先在主机控制台重启', 'The instance is stopped; restart it from the host console first'), revoked: T('主机资格已撤销', 'Host membership revoked') }[res.code];
      toast(res.ok ? T('已继续：先核对状态，再在约定内推进。', 'Continuing: state is re-checked, then work resumes within the agreement.') : why || res.code, res.ok ? 'ok' : 'warn');
      if (res.ok && FM.review) FM.review.mark('nav.resumed');
      render();
    },
    'stop-run': el => {
      if (!ctxOk('operate')) return;
      const org = O();
      const run = M.find(org.runs, el.dataset.id);
      const res = M.requestStop(run);
      if (!res.ok) return;
      U.save();
      toast(T('正在停止：等待执行设备确认后才显示“已取消”。', 'Stopping: it shows “cancelled” only after the execution device confirms.'), 'info');
      render();
      const token = M.contextToken(P());
      U.later(1600, () => {
        const p = U.root.profiles[token.profileId];
        if (!p) return;
        M.confirmStop(p.data[token.orgId], run, U.now());
        U.save();
        if (M.sameContext(p, token)) toast(T('执行设备已确认取消。已发生的修改保留记录，不宣称回滚。', 'The execution device confirmed cancellation. Changes already made stay on record; nothing is claimed as rolled back.'), 'ok');
        if (FM.review) FM.review.mark('run.cancelled');
        render();
      });
    },
    'confirm-run': el => U.openDialog('confirm-run', { id: el.dataset.id }),
    reassign: el => { ui.pop = null; U.openDialog('reassign', { id: el.dataset.id }); },
    'edit-agreement': el => { ui.pop = null; U.openDialog('agreement', { id: el.dataset.id }); },
    open: el => U.openDialog(el.dataset.dialog, Object.assign({}, el.dataset)),
  });

  /* ---------------------------------------------------------- Dialogs */

  FM.dialogs.formula = () => ({
    title: T('计算口径', 'How progress is calculated'),
    body: `<div class="code-box" style="font-size:13px">clamp((current − baseline) / (target − baseline), 0, 1)</div>
      <ul class="small" style="margin:0;padding-left:18px;line-height:1.8">
        <li>${T('同一公式适用于提升型和降低型指标；基线等于目标的输入需要修正。', 'One formula covers increasing and decreasing metrics; a baseline equal to its target must be corrected.')}</li>
        <li>${T('总体为按正权重归一化的 KR 进度加权平均；超额完成显示原始值，图形封顶 100%。', 'Overall is the weighted mean of KR progress with normalized positive weights; overshoot shows raw values, capped at 100% in charts.')}</li>
        <li>${T('缺失或过期的数据标记为未知/待更新，不当作 0% 或完成。', 'Missing or stale data is marked unknown/stale, never 0% or complete.')}</li>
        <li>${T('完成状态独立于进度：100% 还需验证方式、有效证据、依赖完成，并再次复核成功标准。', 'Completion is separate from progress: 100% still needs verification, valid evidence, finished dependencies and a criteria re-check.')}</li>
        <li>${T('任务数量不影响达成度；Agent 不能通过降低目标或删除失败样本提高达成度。', 'Task counts do not affect progress; Agents cannot raise it by lowering targets or dropping failed samples.')}</li>
      </ul>`,
  });

  FM.dialogs.approval = ({ id }) => {
    const org = O();
    const a = M.find(org.approvals, id);
    if (!a) return null;
    const okr = M.find(org.okrs, a.okrId);
    const tx = pendingDecisionTx(a.id);
    const st = M.approvalStatus(a, U.now());
    if (a.kind === 'standing') {
      const ag = U.agent(a.agentId);
      return {
        title: T('超出常驻权限的请求', 'Beyond standing permission'),
        sub: `${esc(ag.name)} · ${esc((U.inst(a.instanceId) || {}).name || '')} · ${T('来自直接对话', 'From a direct chat')}`,
        body: `<div class="strong" style="font-size:15px">${esc(FM.directActionLabel(a.action))}</div>
          <dl class="kv">
            <dt>${T('状态', 'State')}</dt><dd>${U.apvState(a)}</dd>
            <dt>${T('范围', 'Scope')}</dt><dd>${T('仅此一次；绑定常驻权限', 'This one action; bound to standing permission')} v${a.boundVersion}</dd>
            <dt>${T('预计花费', 'Est. cost')}</dt><dd>${U.money(a.budgetImpact || 0)} · ${T('计入常驻预算，不占用 OKR 预算', 'counts against the standing budget, never an OKR')}</dd>
            ${a.execution ? `<dt>${T('执行结果', 'Execution')}</dt><dd>${T('已执行', 'Executed')} · ${U.dateTime(a.execution.at)} · <span class="mono">${esc(a.execution.runId)}</span></dd>` : ''}
          </dl>
          <div class="note">${icon('info')}<div>${T('同意只授权这一次，不会扩大常驻权限；要长期允许，请调整常驻权限。聊天中的“同意”不构成审批。', 'Approving authorizes this once and does not widen the standing permission; change the standing permission to allow it long-term. “OK” in a chat is not an approval.')}</div></div>
          ${tx ? U.txLine(tx) : ''}`,
        foot: st === 'pending' && !tx ? `${U.btn({ action: 'decide-close', data: { id: a.id, d: 'reject' }, label: T('拒绝', 'Reject'), perm: 'approve' })}${U.btn({ action: 'decide-close', data: { id: a.id, d: 'approve' }, label: T('同意本次', 'Approve once'), kind: 'primary', perm: 'approve' })}` : `<button class="btn" data-action="close-dialog">${T('关闭', 'Close')}</button>`,
      };
    }
    return {
      title: a.kind === 'boundary' ? T('越界请求', 'Out-of-bounds request') : T('验收请求', 'Acceptance request'),
      sub: `${esc(okr ? L(okr.title) : '')} · ${esc(krLabel(okr, a.krId))}`,
      body: `<div class="strong" style="font-size:15px">${esc(L(a.action || (okr && a.krId ? M.find(okr.krs, a.krId).title : '')))}</div>
        <dl class="kv">
          <dt>${T('状态', 'State')}</dt><dd>${U.apvState(a)}</dd>
          <dt>${T('原因', 'Why')}</dt><dd>${(a.reasons || []).map(r => esc(T(...(REASON_CHIP[r] || [r, r])))).join('、') || '—'}</dd>
          <dt>${T('范围', 'Scope')}</dt><dd>${T('仅此一次操作；绑定执行约定', 'This one action; bound to agreement')} v${a.boundVersion}</dd>
          <dt>${T('预算影响', 'Budget impact')}</dt><dd>+${U.money(a.budgetImpact || 0)} · ${T('剩余', 'left')} ${okr ? U.money(M.budgetLeft(okr.constraints.budget)) : '—'}</dd>
          <dt>${T('有效期', 'Valid until')}</dt><dd>${U.dateTime(a.expiresAt)} · ${U.until(a.expiresAt)}</dd>
          ${a.alternative ? `<dt>${T('替代方案', 'Alternative')}</dt><dd>${esc(L(a.alternative))}</dd>` : ''}
          ${a.runId ? `<dt>Run</dt><dd class="mono">${esc(a.runId)}</dd>` : ''}
          ${a.execution ? `<dt>${T('执行结果', 'Execution')}</dt><dd>${T('已执行', 'Executed')} · ${U.dateTime(a.execution.at)} · <span class="mono">${esc(a.execution.runId)}</span></dd>` : ''}
        </dl>
        <div class="note">${icon('info')}<div>${T('同意表示操作获准，不代表已执行；推送或聊天中的“同意”文本不构成审批。约定变化后未处理的审批自动失效。', 'Approval authorizes the action; it does not mean it ran. “OK” in a chat or push is not an approval. Pending approvals expire when the agreement changes.')}</div></div>
        ${tx ? U.txLine(tx) : ''}`,
      foot: st === 'pending' && !tx ? `${U.btn({ action: 'decide-close', data: { id: a.id, d: 'reject' }, label: a.kind === 'boundary' ? T('拒绝', 'Reject') : T('退回', 'Return'), perm: 'approve' })}${U.btn({ action: 'decide-close', data: { id: a.id, d: 'approve' }, label: a.kind === 'boundary' ? T('同意本次', 'Approve once') : T('验收', 'Accept'), kind: 'primary', perm: 'approve' })}` : `<button class="btn" data-action="close-dialog">${T('关闭', 'Close')}</button>`,
    };
  };
  FM.actions['decide-close'] = el => { FM.actions.decide(el); };

  FM.dialogs['confirm-run'] = ({ id, checked }) => {
    const org = O();
    const r = M.find(org.runs, id);
    if (!r) return null;
    const done = r.state !== 'needs_confirmation';
    return {
      title: T('确认未知的副作用', 'Confirm unknown side effects'),
      sub: `${esc(r.id)} · ${esc(L(r.title))}`,
      body: `<div class="note warn">${icon('alert')}<div>${esc(L(r.note))}</div></div>
        <div class="col gap-sm"><span class="label">${T('可能的副作用', 'Possible side effects')}</span>${(r.sideEffects || []).map(s => `<div class="small">• ${esc(L(s))}</div>`).join('')}</div>
        ${checked ? `<div class="note info">${icon('eye')}<div><strong>${T('检查结果', 'Check result')}：</strong>${esc(L(r.check))}</div></div>` : U.btn({ action: 'run-check', data: { id }, label: T('检查结果（演示）', 'Check the result (demo)'), icon: 'search' })}
        <div class="small muted">${T('App 不会自动重复已完成的外部操作。确认未执行时会创建新的 Run，并保留这次记录。', 'The app never repeats a completed external action automatically. If it did not run, a new Run is created and this record is kept.')}</div>
        ${done ? `<div class="note ok">${icon('check')}<div>${T('已确认：', 'Confirmed: ')}${U.runState(r)}${r.resolution === 'confirmed_not_executed' ? T('，已创建重试 Run', '; a retry run was created') : ''}</div></div>` : ''}`,
      foot: done ? `<button class="btn" data-action="close-dialog">${T('完成', 'Done')}</button>` : `${U.btn({ action: 'run-resolve', data: { id, how: 'not_executed' }, label: T('确认未执行，重试', 'Not executed — retry'), perm: 'operate', disabled: !checked, why: T('请先检查结果', 'Check the result first') })}${U.btn({ action: 'run-resolve', data: { id, how: 'executed' }, label: T('确认已执行', 'Confirm executed'), kind: 'primary', perm: 'operate', disabled: !checked, why: T('请先检查结果', 'Check the result first') })}`,
    };
  };
  FM.actions['run-check'] = () => { ui.dialog.checked = true; render(); };
  FM.actions['run-resolve'] = el => {
    const org = O();
    const r = M.find(org.runs, el.dataset.id);
    const res = M.resolveConfirmation(P(), org, r, el.dataset.how, U.now());
    U.save();
    if (res.ok) toast(el.dataset.how === 'executed' ? T('已确认执行；不会重复该操作。', 'Confirmed as executed; it will not be repeated.') : T(`已创建新的 Run ${res.retryId}；上次记录保留。`, `Created a new run ${res.retryId}; the earlier record is kept.`), 'ok');
    if (FM.review) FM.review.mark('run.confirmed');
    render();
  };

  FM.dialogs.agreement = ({ id }) => {
    const okr = U.okrById(id);
    if (!okr) return null;
    const c = okr.constraints;
    const key = `agr-${id}`;
    const limit = Number(U.f(`${key}.limit`, c.budget.limit / 100));
    const days = Number(U.f(`${key}.days`, Math.max(1, Math.round((c.deadline - U.now()) / U.DAY))));
    const tx = U.latestTx(t => t.kind === 'okr.update' && t.payload.okrId === id && t.state !== 'confirmed');
    const pend = O().approvals.filter(a => a.okrId === id && a.kind === 'boundary' && M.approvalStatus(a, U.now()) === 'pending').length;
    return {
      title: T('执行约定', 'Execution agreement'),
      sub: `${esc(L(okr.title))} · v${c.version} · ${T('确认于', 'confirmed')} ${U.date(c.confirmedAt)}`,
      size: 'lg',
      body: `<div class="grid-2">
          <div class="col"><span class="label">${T('可自主执行', 'Autonomous actions')}</span>${c.autonomous.map(x => `<div class="row small">${icon('check', 'sm')}${esc(L(x))}</div>`).join('')}</div>
          <div class="col"><span class="label">${T('升级条件（需要你批准）', 'Escalate (needs your approval)')}</span>${c.escalation.map(x => `<div class="row small">${icon('alert', 'sm')}${esc(L(x))}</div>`).join('')}</div>
        </div>
        <div class="kv"><dt>${T('工作区', 'Workspace')}</dt><dd class="mono small">${esc((M.find(O().workspaces, c.workspaceId) || {}).path || '')}</dd><dt>${T('验证授权', 'Verification')}</dt><dd>${esc(L(c.verification))}</dd><dt>${T('预算', 'Budget')}</dt><dd>${U.money(c.budget.spent)} ${T('已用', 'spent')} + ${U.money(c.budget.reserved || 0)} ${T('在途预留', 'reserved')}</dd></div>
        <div class="form-grid">
          <div class="field"><label for="agr-limit">${T('预算上限（USD）', 'Budget limit (USD)')}</label><input id="agr-limit" class="input num" type="number" min="1" step="1" data-f="${key}.limit" value="${esc(limit)}"></div>
          <div class="field"><label for="agr-days">${T('截止（从今天起的天数）', 'Deadline (days from today)')}</label><input id="agr-days" class="input num" type="number" min="1" step="1" data-f="${key}.days" value="${esc(days)}"></div>
        </div>
        <div class="note">${icon('info')}<div>${T('确认后生成 v', 'Confirming creates v')}${c.version + 1}${T('。', '. ')}${pend ? T(`绑定旧版本的 ${pend} 项待处理审批会失效，Agent 需按新约定重新请求。`, `${pend} pending approval(s) bound to the old version become invalid; the Agent must ask again.`) : T('旧批准不授权新范围。', 'Old approvals do not authorize a new scope.')}${T('聊天不能直接修改预算、权限或成功标准。', ' Chat cannot change budgets, authority or success criteria.')}</div></div>
        ${tx ? U.txLine(tx) : ''}`,
      foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'agreement-save', data: { id }, label: T('签名确认新约定', 'Sign the new agreement'), kind: 'primary', perm: 'approve', disabled: !!(tx && tx.state === 'pending') })}`,
    };
  };
  FM.actions['agreement-save'] = el => {
    const okr = U.okrById(el.dataset.id);
    const key = `agr-${okr.id}`;
    const limit = Math.round(Number(U.f(`${key}.limit`, okr.constraints.budget.limit / 100)) * 100);
    const days = Number(U.f(`${key}.days`, Math.round((okr.constraints.deadline - U.now()) / U.DAY)));
    if (!(limit > 0) || !(days > 0)) { toast(T('请输入有效的预算与天数', 'Enter a valid budget and number of days'), 'warn'); return; }
    U.submitTx({ kind: 'okr.update', payload: { okrId: okr.id, fromVersion: okr.constraints.version, patch: { budgetLimit: limit, deadline: U.now() + days * U.DAY } } }, {
      ok: T('新约定已确认；绑定旧版本的待处理审批已失效。', 'New agreement confirmed; pending approvals bound to the old version are invalid.'),
      onConfirmed: () => { U.clearForm(key); ui.dialog = null; if (FM.review) FM.review.mark('agreement.updated'); },
    });
  };

  FM.dialogs.reassign = ({ id }) => {
    const org = O();
    const okr = U.okrById(id);
    if (!okr) return null;
    const options = org.instances.filter(i => i.id !== okr.instanceId).map(i => {
      const issues = M.assignIssues(org, okr, i.hostId, i.id);
      return { i, issues };
    });
    const ISSUE = {
      source_unreachable: ['源主机不可达，无法确认旧循环已停止', "The source host is unreachable; the old loop can't be confirmed stopped"],
      target_offline: ['目标离线', 'Target offline'], target_not_accepting: ['目标暂停接单', 'Target not accepting work'], target_not_member: ['目标无主机资格', 'Target has no membership'],
      agent_mismatch: ['Agent 角色不匹配', 'Agent role mismatch'], agent_stopped: ['实例已停止', 'Instance stopped'], observe_only: ['仅观察适配器', 'Observe-only adapter'],
      workspace_unavailable: ['工作区不在该主机', 'Workspace not on that host'], instance_missing: ['实例不存在', 'Instance missing'],
    };
    const sel = U.f(`reassign-${id}.target`, '');
    return {
      title: T('改派执行主机', 'Reassign execution'),
      sub: esc(L(okr.title)),
      body: `<div class="note">${icon('info')}<div>${T('改派会暂停旧循环并保留检查点、指标与证据；目标端接收后等待你明确继续。未确认源端停止前，不会产生并行的重复执行。', 'Reassignment pauses the old loop and keeps checkpoints, metrics and evidence; the target waits for your explicit continue. No parallel duplicate runs before the source confirms it stopped.')}</div></div>
        <div class="col">${options.map(({ i, issues }) => {
          const h = U.host(i.hostId);
          const ok = !issues.length;
          return `<button class="opt" data-action="set-f" data-key="reassign-${esc(id)}.target" data-value="${esc(i.id)}" aria-pressed="${sel === i.id}"${ok ? '' : ` aria-disabled="true" data-why="${esc(issues.map(x => T(...(ISSUE[x] || [x, x]))).join('；'))}"`}>
            <span class="ico">${icon(h && h.kind === 'cloud' ? 'cloud' : 'server')}</span>
            <span class="grow"><span class="strong">${esc(h ? h.name : '')} / ${esc(i.name)}</span><span class="small muted" style="display:block">${esc(U.agent(i.agentId).name)} · ${esc(i.runtime)}</span>
            ${ok ? `<span class="st ok small">${icon('check')}${T('可接收', 'Can take over')}</span>` : `<span class="small" style="color:var(--danger)">${esc(issues.map(x => T(...(ISSUE[x] || [x, x]))).join('；'))}</span>`}</span></button>`;
        }).join('')}</div>`,
      foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'reassign-do', data: { id }, label: T('暂停旧循环并改派', 'Pause and reassign'), kind: 'primary', perm: 'operate', disabled: !sel, why: T('选择一个可接收的实例', 'Choose an instance that can take over') })}`,
    };
  };
  FM.actions['reassign-do'] = el => {
    const org = O();
    const okr = U.okrById(el.dataset.id);
    const target = U.inst(U.f(`reassign-${okr.id}.target`, ''));
    const res = M.reassign(P(), org, okr, target.hostId, target.id, U.now());
    U.save();
    if (res.ok) { ui.dialog = null; toast(T('已改派：旧循环已暂停，检查点保留。确认后点击“继续”。', 'Reassigned: the old loop is paused and checkpoints kept. Press “Continue” when ready.'), 'ok'); if (FM.review) FM.review.mark('host.reassigned'); }
    else toast(res.code, 'warn');
    render();
  };

  /* ---------------------------------------------------- Evidence drawer */

  const EV_KIND = { measurement: ['采样', 'Sample'], verification: ['验证记录', 'Verification'], report: ['报告', 'Report'], artifact: ['产物', 'Artifact'], log: ['日志', 'Log'], diff: ['代码变更', 'Diff'] };

  FM.evidenceRow = (e, okr) => {
    const kind = EV_KIND[e.kind] || [e.kind, e.kind];
    const kr = okr ? M.find(okr.krs, e.krId) : null;
    const title = e.title ? L(e.title) : e.kind === 'measurement' ? `${T('测量值', 'Value')} ${U.num(e.value, e.unit)}` : e.kind === 'verification' ? T(`${U.agent(e.verifier).name} 按规则 ${e.ruleVersion} 验证：${e.result === 'pass' ? '通过' : '未通过'}`, `${U.agent(e.verifier).name} verified under rule ${e.ruleVersion}: ${e.result === 'pass' ? 'pass' : 'fail'}`) : '';
    return `<div class="ev-row">${icon('file', 'sm')}<div class="grow"><div class="ellipsis">${esc(title)}</div><div class="tiny muted">${esc(T(kind[0], kind[1]))}${kr ? ` · ${esc(FM.krLabel(okr, kr.id))}` : ''}${e.runId ? ` · <span class="mono">${esc(e.runId)}</span>` : ''} · ${U.agoTag(e.at)}${e.demo ? ` · <span class="demo-tag">${T('演示', 'Demo')}</span>` : ''}</div></div>${U.trust(e.trust)}</div>`;
  };

  FM.drawers.evidence = ({ okrId, krId }) => {
    const org = O();
    const okr = M.find(org.okrs, okrId);
    if (!okr) return null;
    const kr = M.find(okr.krs, krId);
    const ev = org.evidence.filter(e => e.okrId === okrId && (!krId || e.krId === krId));
    const blockers = kr ? M.krBlockers(okr, kr, org.evidence, U.now()) : [];
    const BL = {
      below_target: ['指标未达目标', 'Metric below target'], stale: ['数据过期', 'Stale data'], no_verified_evidence: ['缺少已验证证据', 'No verified evidence'],
      not_verified: ['尚未验证', 'Not verified'], not_accepted: ['等待验收', 'Awaiting acceptance'], deps_incomplete: ['依赖未完成', 'Dependencies incomplete'],
    };
    const tasks = org.tasks.filter(t => t.okrId === okrId && (!krId || t.krId === krId));
    return {
      label: T('证据', 'Evidence'),
      html: `<div class="drawer-h"><div class="row between"><span class="small muted">${esc(FM.krLabel(okr, krId))} · ${T('证据与完成条件', 'Evidence & completion')}</span><button class="btn ghost icon sm" data-action="close-drawer" aria-label="${T('关闭', 'Close')}">${icon('x')}</button></div>
        <h2>${esc(kr ? L(kr.title) : L(okr.title))}</h2>
        ${kr ? `<div class="row wrap">${U.trust(M.krTrust(kr), { stale: M.krStale(kr, U.now()) })}<span class="chip">${esc(U.krStatusText(kr.status))}</span><span class="small muted">${esc(metricText(kr))}</span></div>` : ''}</div>
        <div class="drawer-b">
          ${kr ? `<div class="card soft tight"><div class="label">${T('完成条件', 'Completion')}</div>${blockers.length ? blockers.map(b => `<div class="row small mt-4">${icon('x', 'sm')}${esc(T(...(BL[b] || [b, b])))}</div>`).join('') : `<div class="row small mt-4" style="color:var(--ok)">${icon('check', 'sm')}${T('全部满足', 'All met')}</div>`}
            <div class="tiny muted mt-8">${T('验证方式', 'Verification')}：${esc(L(kr.method || ''))}</div></div>` : ''}
          <div><div class="label">${T('证据', 'Evidence')} · ${ev.length}</div><div class="col" style="gap:0">${ev.map(e => FM.evidenceRow(e, okr)).join('') || `<div class="muted small mt-8">${T('暂无证据', 'No evidence yet')}</div>`}</div></div>
          <div><div class="label">${T('任务', 'Tasks')}</div>${tasks.map(t => FM.taskRow(t)).join('') || `<div class="muted small">—</div>`}</div>
          <div class="note">${icon('info')}<div>${T('Agent 声明与验证结果分开记录；对话中的承诺不能作为 KR 达成证据。敏感证据加密上链（演示）。', 'Agent claims and verification results are recorded separately; promises in chat are not evidence. Sensitive evidence is encrypted on chain (demo).')}</div></div>
        </div>`,
    };
  };

  const FLOW = ['Created', 'Assigned', 'Submitted', 'Verified', 'Completed'];
  const FLOW_T = { Created: ['已创建', 'Created'], Assigned: ['已分配', 'Assigned'], Submitted: ['已提交', 'Submitted'], Verified: ['已验证', 'Verified'], Completed: ['已完成', 'Completed'] };
  FM.taskRow = t => {
    const n = FLOW.indexOf(t.state);
    return `<div class="task"><span class="flow" aria-hidden="true">${FLOW.map((s, i) => `<i class="${i < n ? 'on' : i === n ? (n === 4 ? 'on' : 'cur') : ''}"></i>`).join('')}</span><span class="grow ellipsis">${esc(L(t.title))}</span><span class="small muted">${esc(T(...FLOW_T[t.state]))}</span></div>`;
  };

  /* ------------------------------------------------ Conversation drawer */

  const PURPOSE = {
    ask: ['询问原因', 'Ask why', '保持当前执行状态', 'Execution continues unchanged'],
    inform: ['补充信息', 'Add context', '保存方向与线索，执行状态不变', 'Saved as direction; execution unchanged'],
    plan: ['请求新方案', 'Request a plan', '暂停当前尝试，保留检查点', 'Pauses the current attempt; checkpoints kept'],
    pause: ['暂停等待', 'Pause', '暂停此 OKR 的自主循环', "Pauses this OKR's autonomous loop"],
  };
  const PROMPTS = {
    ask: [['为什么判断为当前路况？', 'Why this road condition?'], ['下一步是什么？', "What's next?"]],
    inform: [['优先保证 Windows 的安装成功率', 'Prioritize the Windows install success rate'], ['不要修改签名配置', "Don't touch the signing configuration"]],
    plan: [['有不需要外部服务的方案吗？', 'Is there a plan without external services?']],
    pause: [['先暂停，等我确认预算', 'Pause until I confirm the budget']],
  };

  function replyText(msg, okr) {
    const s = msg.snapshot;
    const kr = FM.krLabel(okr, s.krId);
    if (msg.purpose === 'inform') return T('已记录你的补充信息，并关联到当前 Run。执行状态保持不变；需要调整路径时可以请求新方案。', 'Noted and linked to the current run. Execution is unchanged; request a plan if the route should change.');
    if (msg.purpose === 'pause') return T('已暂停此 OKR 的自主循环，检查点与已完成结果保留。补充信息后可以继续规划。', "Paused this OKR's loop; checkpoints and results are kept. Add context, then continue.");
    if (msg.purpose === 'plan') return msg.proposalAvailable === false ? T('当前 KR 没有约定内的替代路线。建议补充信息，或调整执行约定。', 'This KR has no alternative inside the agreement. Add context or adjust the agreement.') : T('已暂停当前尝试并保留检查点。下面是约定内的替代方案，采用前会重新核对状态：', 'Paused the current attempt and kept checkpoints. Here is an alternative inside the agreement; state is re-checked before adopting:');
    const map = {
      on_track: T(`${kr} 最近的采样持续改善，当前路线有效。下一步在约定内继续，并按规则提交验证。`, `${kr} keeps improving across recent samples; the route holds. Next: continue within the agreement and submit for verification.`),
      boundary: T('下一动作超出执行约定，我已暂停该动作并等待你的决定；约定内的替代方案可在审批卡片中查看。', "The next action is outside the agreement, so I paused it and am waiting for your decision; the in-agreement alternative is on the approval card."),
      drift: T('最近 2 个动作（重构日志格式、升级 lint 规则）无法关联任何 KR。我会停止无关动作，回到当前 KR。', "The last 2 actions (log format, lint rules) map to no KR. I'll stop them and return to the current KR."),
      loop: T('同一签名错误已重试 3 次，指标没有改善。我建议停止同策重试，改用约定内的新路线。', 'The same signing error was retried 3 times with no improvement. I suggest stopping identical retries and taking a new route within the agreement.'),
      blocked: T('当前路线的必要动作无法执行（被约定排除或已被拒绝）。约定内的本地替代路线可行，但需要验证。', "The current route's required step can't run (excluded or rejected). A local alternative inside the agreement is feasible but unverified."),
      waiting: T('正在等待依赖返回，仍在预期窗口内。这是正常等待，不判为空转。', 'Waiting for a dependency, still inside its expected window. This is normal waiting, not looping.'),
      paused: T('当前处于暂停状态。收到继续指令后，我会先核对状态再推进。', "I'm paused. When you continue, I'll re-check state before moving on."),
      unknown: T('观测中断期间我不推断状态；恢复后先对账，再决定是否重试。', "While observation is interrupted I don't infer state; I'll reconcile before any retry."),
    };
    return map[s.condition] || map.on_track;
  }

  FM.drawers.talk = ({ okrId }) => {
    const org = O();
    const okr = M.find(org.okrs, okrId);
    if (!okr) return null;
    const conv = org.conversations[okrId] || { messages: [], draft: '' };
    const key = `talk-${okrId}`;
    const purpose = U.f(`${key}.purpose`, 'ask');
    const draft = U.f(`${key}.text`, conv.draft || '');
    const ag = U.agent(okr.ownerAgentId);
    const snap = M.snapshot(org, okr, U.now());
    const chk = M.canMessage(org, okr, can('operate'));
    const h = U.host(okr.hostId);
    const i = U.inst(okr.instanceId);
    const snapChip = s => `${esc(FM.krLabel(okr, s.krId) || '—')} · ${esc(s.runId || '—')} · ${esc((U.host(s.hostId) || {}).name || '')}/${esc((U.inst(s.instanceId) || {}).name || '')} · ${esc(U.condName(s.condition))} · ${T('约定', 'agreement')} v${s.constraintsVersion}`;
    const msgs = conv.messages.map(m => {
      const mine = m.from === 'user';
      const p = m.proposal;
      let prop = '';
      if (p) {
        const kr = M.find(okr.krs, p.krId);
        const alt = kr && kr.plan && kr.plan.B;
        const stState = { pending: ['info', '待确认', 'Awaiting you'], adopted: ['ok', '已采用', 'Adopted'], stale: ['muted', '已过期（状态已变化）', 'Stale (state changed)'], superseded: ['muted', '已被新指示替代', 'Superseded'], unavailable: ['muted', '无可用方案', 'Unavailable'] }[p.state];
        prop = alt ? `<div class="proposal"><div class="row between"><strong>${T('方案', 'Plan')}：${esc(FM.krLabel(okr, p.krId))} · ${T('路线 B', 'Route B')} · ${esc(L(alt.label))}</strong><span class="chip ${stState[0]}">${esc(T(stState[1], stState[2]))}</span></div>
          <ol class="small">${alt.steps.map(s => `<li>${T('推进到', 'Move to')} ${esc(U.num(s.value, kr.metric.unit))}（${T('预计', 'est.')} ${U.money(s.cost)}）</li>`).join('')}<li>${T('提交验证', 'Submit for verification')}：${esc(L(kr.method || ''))}</li></ol>
          <div class="tiny muted">${T('约束影响：不扩大权限、不改变成功标准；预计花费', 'Constraints: no new authority, same success criteria; est. cost')} ${U.money(p.cost)} · ${T('剩余', 'left')} ${U.money(M.budgetLeft(okr.constraints.budget))} · ${T('基于状态版本', 'based on state')} #${p.basedOnVersion}</div>
          ${p.state === 'pending' ? `<div class="row">${U.btn({ action: 'adopt', data: { okr: okrId, id: p.id }, label: T('采用方案并继续', 'Adopt and continue'), kind: 'primary', size: 'sm', perm: 'operate' })}</div>` : ''}</div>` : '';
      }
      const delivery = mine ? (m.delivery === 'replied' ? T('已回应', 'Answered') : T('已送达（演示）', 'Delivered (demo)')) : T('演示回复，不是真实 Agent', 'Demo reply, not a live Agent');
      const text = mine ? m.text : replyText(Object.assign({}, m, { proposalAvailable: !(m.proposal && m.proposal.state === 'unavailable') }), okr);
      return `<div class="msg ${mine ? 'me' : 'agent'}">
        ${mine ? `<span class="chip outline">${esc(T(PURPOSE[m.purpose][0], PURPOSE[m.purpose][1]))}</span>` : ''}
        <div class="bubble">${esc(text)}</div>${prop}
        <div class="meta">${esc(mine ? T('你', 'You') : ag.name)} · ${U.agoTag(m.at)} · ${esc(delivery)}</div>
        <details class="snap"><summary>${icon('link', 'xs')}${T('关联快照', 'Linked snapshot')}</summary><div class="mt-4">${snapChip(m.snapshot)}</div></details>
      </div>`;
    }).join('');
    return {
      label: T('与 Agent 沟通', 'Talk to agent'),
      html: `<div class="drawer-h">
          <div class="row between"><span class="row"><span class="avatar sm round">${esc(ag.name.slice(0, 1))}</span><strong>${T(`与 ${ag.name} 沟通`, `Talk to ${ag.name}`)}</strong></span><button class="btn ghost icon sm" data-action="close-drawer" aria-label="${T('关闭', 'Close')}">${icon('x')}</button></div>
          <div class="row between gap-sm"><span class="small muted ellipsis">${esc(L(okr.title))}</span><button class="link-btn tiny" style="flex:none" data-action="open-direct" data-agent="${esc(okr.ownerAgentId)}">${T('聊与本目标无关的事 →', 'Something unrelated to this goal →')}</button></div>
          <div class="snap">${icon('link', 'xs')} ${T('当前快照', 'Current snapshot')}：${snapChip(snap)}</div>
        </div>
        <div class="drawer-b" id="talk-body">${msgs || `<div class="empty"><div class="ico">${icon('message', 'lg')}</div><p class="small">${T('会话按 OKR 保存。每条消息都会绑定发送时的 KR、Run、主机与约定快照。', "Conversations are saved per OKR. Each message binds the KR, run, host and agreement at send time.")}</p></div>`}</div>
        <div class="drawer-f">
          <div class="purpose" role="radiogroup" aria-label="${T('沟通目的', 'Purpose')}">${Object.keys(PURPOSE).map(k => `<button class="chip lg ${purpose === k ? 'brand' : 'outline'}" style="border:0;cursor:pointer" data-action="set-f" data-key="${key}.purpose" data-value="${k}" role="radio" aria-checked="${purpose === k}">${esc(T(PURPOSE[k][0], PURPOSE[k][1]))}</button>`).join('')}</div>
          <div class="tiny muted">${esc(T(PURPOSE[purpose][2], PURPOSE[purpose][3]))}</div>
          <div class="row wrap gap-sm">${(PROMPTS[purpose] || []).map(q => `<button class="link-btn small" data-action="set-f" data-key="${key}.text" data-value="${esc(T(q[0], q[1]))}">${esc(T(q[0], q[1]))}</button>`).join('')}</div>
          <textarea class="textarea" id="${key}-text" data-f="${key}.text" rows="2" placeholder="${T('输入消息…', 'Write a message…')}" aria-label="${T('消息', 'Message')}">${esc(draft)}</textarea>
          ${chk.ok ? '' : `<div class="note warn">${icon('lock')}<div>${esc(U.permText(chk.code))}${T('。草稿已保存在本机，恢复后不会自动重发。', '. The draft is saved locally and will not be resent automatically.')}</div></div>`}
          <div class="row between"><span class="tiny muted">${T('聊天不能提高预算、扩大权限或改写成功标准。', 'Chat cannot raise budgets, widen authority or rewrite criteria.')}</span>${U.btn({ action: 'send', data: { okr: okrId }, label: T('发送', 'Send'), icon: 'send', kind: 'primary', size: 'sm', disabled: !chk.ok, why: U.permText(chk.code) })}</div>
        </div>`,
    };
  };

  FM.actions.send = el => {
    const org = O();
    const okr = U.okrById(el.dataset.okr);
    const key = `talk-${okr.id}`;
    const purpose = U.f(`${key}.purpose`, 'ask');
    const text = String(U.f(`${key}.text`, '')).trim() || T(PURPOSE[purpose][0], PURPOSE[purpose][1]);
    const res = M.sendMessage(P(), org, okr, purpose, text, can('operate'), U.now());
    if (!res.ok) { U.save(); toast(U.permText(res.code), 'warn'); render(); return; }
    U.setF(`${key}.text`, '');
    U.save();
    render();
    const token = M.contextToken(P());
    U.later(900, () => {
      const p = U.root.profiles[token.profileId];
      if (!p) return;
      const o = p.data[token.orgId];
      const k = M.find(o.okrs, okr.id);
      M.agentReply(p, o, k, res.msg.id, U.now());
      U.save();
      render();
      const body = document.getElementById('talk-body');
      if (body) body.scrollTop = body.scrollHeight;
      if (FM.review) FM.review.mark(`talk.${purpose}`);
    });
  };

  FM.actions.adopt = el => {
    const org = O();
    const okr = U.okrById(el.dataset.okr);
    const res = M.adoptProposal(P(), org, okr, el.dataset.id, can('operate'), U.now());
    U.save();
    const why = { stale: T('方案已过期：状态已变化，请基于最新状态重新请求。', 'The plan is stale: state changed; request a new one.'), budget: T('剩余预算不足以执行该方案。', 'Not enough budget left for this plan.'), superseded: T('方案已被新的指示替代。', 'The plan was superseded by newer direction.') }[res.code];
    toast(res.ok ? T('已采用方案：地图切换到路线 B，原外部请求标为已替代。', 'Plan adopted: the map switches to route B; the external request is superseded.') : why || U.permText(res.code), res.ok ? 'ok' : 'warn');
    if (res.ok && FM.review) FM.review.mark('talk.adopted');
    render();
  };
})();
