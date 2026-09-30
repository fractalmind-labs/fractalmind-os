/* FractalMind App prototype v2 — OKR list, detail, creation wizard and export.
 * The list shows goals only; details hold criteria, KRs, trend, plan and evidence
 * (PRD §5, §8.1). The workbench and details share the same records. */
(function () {
  'use strict';
  const FM = window.FM;
  const U = FM.ui;
  const { M, T, L, esc, icon, P, O, can, ui, render, toast, DAY } = U;

  const krLabel = (okr, id) => FM.krLabel(okr, id);
  const isActive = o => o.lifecycle === 'ACTIVE' || o.lifecycle === 'ACTIVATING';

  const CAND = {
    active_limit: ['已有 3 个 ACTIVE 目标，保存在候选池', 'Three goals are already active; kept as a candidate'],
    workspace_missing: ['缺少工作区', 'No workspace'],
    agent_not_deployed: ['负责 Agent 尚未部署到主机', 'The responsible Agent is not deployed on a host'],
    agent_stopped: ['负责实例已停止', 'The responsible instance is stopped'],
    host_missing: ['未指定执行主机', 'No execution host'],
    host_offline: ['执行主机离线', 'The execution host is offline'],
    host_not_accepting: ['执行主机暂停接单', 'The host is not accepting work'],
    host_not_member: ['主机没有组织资格', 'The host has no membership'],
    grant_expired: ['主机执行授权已到期', "The host's execution grant expired"],
    activation_failed: ['激活交易失败，可重试', 'The activation transaction failed; retry'],
  };
  const candText = c => { const x = CAND[c]; return x ? T(x[0], x[1]) : c || ''; };
  FM.candText = candText;

  /* ---------------------------------------------------------------- List */

  const FILTERS = [
    ['all', '全部', 'All'], ['ACTIVE', '进行中', 'Active'], ['CANDIDATE', '候选', 'Candidates'],
    ['DRAFT', '草稿', 'Drafts'], ['ACHIEVED', '已达成', 'Achieved'], ['ARCHIVED', '已归档', 'Archived'],
  ];
  const match = (o, k) => k === 'all' || (k === 'ACTIVE' ? isActive(o) : o.lifecycle === k);

  function card(o) {
    const org = O();
    const now = U.now();
    const a = M.achievement(o, now);
    const cond = M.condition(org, o, now);
    const done = o.krs.filter(k => k.status === 'COMPLETE').length;
    const pend = U.decisions(org).filter(d => d.item.okrId === o.id).length;
    const width = a.value === null ? 0 : Math.round(a.value * 100);
    return `<article class="card okr-card" data-action="go" data-to="okrs/${esc(o.id)}" role="link" tabindex="0" aria-label="${esc(L(o.title))}">
      <div class="row between"><span class="row gap-sm"><span class="prio ${o.priority}">${o.priority}</span>${U.lifeChip(o.lifecycle)}</span>${o.lifecycle === 'ACTIVE' ? U.condBadge(cond.code) : ''}</div>
      <div class="t">${esc(L(o.title))}</div>
      <div class="row between small muted"><span>${T('负责人', 'Owner')} ${esc(U.agent(o.ownerAgentId).name)}</span><span>${o.lifecycle === 'ACHIEVED' ? `${T('达成于', 'Achieved')} ${U.date(o.achievedAt)}` : `${T('截止', 'Due')} ${U.date(o.constraints.deadline)}`}</span></div>
      <div><div class="row between small"><span class="muted">${T('结果达成度', 'Result progress')}</span><strong class="num">${U.pct(a.value)}</strong></div><div class="bar thick ${o.lifecycle === 'ACHIEVED' ? 'brand' : ''} mt-4"><i style="width:${width}%"></i></div></div>
      <div class="row wrap small muted"><span>${T(`${done}/${o.krs.length} 个 KR 已完成`, `${done}/${o.krs.length} KRs complete`)}</span>${a.unknown.length ? `<span class="chip warn">${T(`${a.unknown.length} 项未知`, `${a.unknown.length} unknown`)}</span>` : ''}${pend ? `<span class="chip danger">${T(`${pend} 项待决定`, `${pend} to decide`)}</span>` : ''}</div>
      ${o.lifecycle === 'CANDIDATE' ? `<div class="row between"><span class="small" style="color:var(--wait)">${esc(candText(o.candidateReason))}</span>${U.btn({ action: 'activate', data: { id: o.id }, label: T('激活', 'Activate'), size: 'sm', perm: 'approve' })}</div>` : ''}
    </article>`;
  }

  function list() {
    const org = O();
    const filter = ui.tab.okrs || 'all';
    const order = { ACTIVE: 0, ACTIVATING: 0, CANDIDATE: 1, DRAFT: 2, ACHIEVED: 3, ARCHIVED: 4 };
    const shown = org.okrs.filter(o => match(o, filter)).sort((a, b) => order[a.lifecycle] - order[b.lifecycle] || a.priority.localeCompare(b.priority));
    const full = M.activeCount(org) >= M.MAX_ACTIVE;
    return `<div class="page-h"><div><h1>OKR</h1><p class="muted">${T(`每个组织最多 ${M.MAX_ACTIVE} 个 ACTIVE；更多目标保存在候选池。点击目标查看成功标准、KR、趋势与证据。`, `At most ${M.MAX_ACTIVE} ACTIVE per organization; more goals wait as candidates. Open a goal for criteria, KRs, trend and evidence.`)}</p></div>
      <div class="row">${U.btn({ action: 'export-okr-md', label: T('导出 OKR.md', 'Export OKR.md'), icon: 'download' })}${U.btn({ action: 'go', data: { to: 'okrs/new' }, label: T('新建 OKR', 'New OKR'), icon: 'plus', kind: 'primary' })}</div></div>
      <div class="tabs" role="tablist">${FILTERS.map(([k, zh, en]) => {
        const n = org.okrs.filter(o => match(o, k)).length;
        const label = k === 'ACTIVE' ? `${n}/${M.MAX_ACTIVE}` : n;
        return `<button class="tab" role="tab" aria-selected="${filter === k}" data-action="set-tab" data-scope="okrs" data-tab="${k}">${esc(T(zh, en))} <span class="muted num">${label}</span></button>`;
      }).join('')}</div>
      ${full && (filter === 'all' || filter === 'ACTIVE' || filter === 'CANDIDATE') ? `<div class="note info" style="margin-bottom:14px">${icon('info')}<div>${T('ACTIVE 已满。新建或激活的目标会进入候选池；完成或归档一个进行中的目标后再激活。', 'ACTIVE is full. New or activated goals go to candidates; finish or archive an active goal first.')}</div></div>` : ''}
      ${shown.length ? `<div class="okr-grid">${shown.map(card).join('')}</div>` : `<div class="card"><div class="empty"><div class="ico">${icon('target', 'lg')}</div><h3>${T('这里还没有目标', 'No goals here yet')}</h3><a class="btn primary mt-8" href="#/okrs/new">${icon('plus', 'sm')}<span>${T('新建 OKR', 'New OKR')}</span></a></div></div>`}`;
  }

  /* -------------------------------------------------------------- Detail */

  function ring(v, tone) {
    const r = 46, c = 2 * Math.PI * r;
    const p = v === null || v === undefined ? 0 : Math.max(0, Math.min(1, v));
    return `<div class="ring"><svg viewBox="0 0 108 108" aria-hidden="true"><circle cx="54" cy="54" r="${r}" fill="none" style="stroke:var(--surface-3)" stroke-width="10"/><circle cx="54" cy="54" r="${r}" fill="none" style="stroke:var(--${tone || 'info'})" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}"/></svg><span class="v">${U.pct(v)}</span></div>`;
  }

  function trendChart(okr) {
    // One point per day (the day's last sample) keeps rapid demo heartbeats readable.
    const byDay = new Map();
    (okr.trend || []).filter(x => x.value !== null && x.value !== undefined).forEach(x => byDay.set(new Date(x.at).toDateString(), x));
    const pts = [...byDay.values()];
    if (pts.length < 2) return `<div class="muted small">${T('数据不足：至少需要两次采样。', 'Not enough data: at least two samples are needed.')}</div>`;
    const W = 620, H = 150, px = 40, top = 12, bottom = 26;
    const t0 = pts[0].at, t1 = pts[pts.length - 1].at;
    const X = t => px + (W - px - 12) * ((t - t0) / ((t1 - t0) || 1));
    const Y = v => top + (H - top - bottom) * (1 - v);
    const grid = [0, 0.5, 1].map(v => `<line x1="${px}" x2="${W - 8}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:var(--border)" stroke-dasharray="${v === 1 ? '5 4' : '0'}"/><text x="${px - 8}" y="${Y(v) + 4}" text-anchor="end" style="fill:var(--text-3);font-size:11px">${Math.round(v * 100)}%</text>`).join('');
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.at).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
    const dots = pts.map(p => `<circle cx="${X(p.at).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="3" style="fill:var(--surface);stroke:var(--info)" stroke-width="2"><title>${U.dateTime(p.at)} · ${U.pct(p.value)}</title></circle>`).join('');
    return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T(`实测达成度从 ${U.pct(pts[0].value)} 到 ${U.pct(pts[pts.length - 1].value)}`, `Measured progress from ${U.pct(pts[0].value)} to ${U.pct(pts[pts.length - 1].value)}`))}">
      ${grid}<text x="${W - 10}" y="${Y(1) - 4}" text-anchor="end" style="fill:var(--text-3);font-size:11px">${esc(T('目标', 'Target'))}</text>
      <path d="${line}" fill="none" style="stroke:var(--info)" stroke-width="2.5" stroke-linejoin="round"/>${dots}
      <text x="${px}" y="${H - 6}" style="fill:var(--text-3);font-size:11px">${esc(U.date(t0))}</text><text x="${W - 12}" y="${H - 6}" text-anchor="end" style="fill:var(--text-3);font-size:11px">${esc(U.date(t1))}</text></svg>
      <div class="tiny muted">${T('只展示实测值；预测线与目标线分开标注，首版不预测。', 'Measured values only; forecasts would be labeled separately and are not shown in this release.')}</div>`;
  }

  function krRow(okr, kr) {
    const org = O();
    const now = U.now();
    const p = M.krProgress(kr);
    const stale = M.krStale(kr, now);
    const a = M.achievement(okr, now);
    const share = (a.parts.find(x => x.id === kr.id) || {}).share || 0;
    const key = `kr-${okr.id}-${kr.id}`;
    const open = ui.expanded[key];
    const ev = org.evidence.filter(e => e.okrId === okr.id && e.krId === kr.id);
    const tasks = org.tasks.filter(t => t.okrId === okr.id && t.krId === kr.id);
    const runs = org.runs.filter(r => r.okrId === okr.id && r.krId === kr.id);
    const blockers = M.krBlockers(okr, kr, org.evidence, now);
    let status = U.krStatusText(kr.status);
    if (kr.status !== 'COMPLETE' && kr.acceptance && kr.acceptance.state === 'pending') status = T('待验收', 'Awaiting acceptance');
    else if (kr.status !== 'COMPLETE' && kr.verification && kr.verification.state === 'pending') status = T('验证中', 'Verifying');
    const m = kr.metric;
    const metric = kr.binary
      ? `<div class="kr-metric"><div><div class="m-l">${T('二元结果', 'Binary result')}</div><div class="m-v">${kr.binary.verified ? T('已验证 = 1', 'Verified = 1') : T('未验证 = 0', 'Unverified = 0')}</div></div><div></div><div></div><div class="bar-cell"><div class="bar thick ${kr.status === 'COMPLETE' ? 'ok' : ''}"><i style="width:${p ? 100 : 0}%"></i></div></div><div class="pct-cell nowrap"><strong>${U.pct(p)}</strong> <span class="muted small">· ${T('权重', 'weight')} ${Math.round(share * 100)}%</span></div></div>`
      : `<div class="kr-metric">
        <div><div class="m-l">${T('基线', 'Baseline')}</div><div class="m-v">${esc(U.num(m.baseline, m.unit))}</div></div>
        <div><div class="m-l">${T('当前', 'Current')}</div><div class="m-v" style="${stale ? 'color:var(--warn)' : ''}">${m.current === null ? T('未采样', 'Not sampled') : esc(U.num(m.current, m.unit))}</div></div>
        <div><div class="m-l">${T('目标', 'Target')} ${m.direction === 'down' ? '↓' : '↑'}</div><div class="m-v">${esc(U.num(m.target, m.unit))}</div></div>
        <div class="bar-cell"><div class="bar thick ${p === null || stale ? 'unknown' : kr.status === 'COMPLETE' ? 'ok' : ''}"><i style="width:${p === null ? 0 : Math.round(p * 100)}%"></i></div></div>
        <div class="pct-cell nowrap"><strong>${p === null ? T('未知', 'Unknown') : U.pct(p)}</strong> <span class="muted small">· ${T('权重', 'weight')} ${Math.round(share * 100)}%</span></div></div>`;
    const deps = (kr.deps || []).map(d => krLabel(okr, d)).join('、') || '—';
    return `<div class="kr" id="${esc(key)}">
      <div class="kr-h"><span class="kr-id">${esc(krLabel(okr, kr.id))}</span><div class="grow"><div class="kr-t">${esc(L(kr.title))}</div></div>${U.trust(M.krTrust(kr), { stale })}</div>
      ${metric}
      <div class="kr-meta"><span>${T('状态', 'Status')} <strong style="color:var(--text)">${esc(status)}</strong></span><span>${T('依赖', 'Depends on')} ${esc(deps)}</span>${m ? `<span>${T('采样', 'Sampled')} ${m.sampledAt ? U.agoTag(m.sampledAt) : '—'}${m.window ? ` · ${esc(L(m.window))}` : ''}</span>` : ''}<span>${T('验证', 'Verification')} ${esc(L(kr.method || ''))}</span></div>
      <div class="kr-meta"><button class="link-btn" data-action="evidence" data-okr="${esc(okr.id)}" data-kr="${esc(kr.id)}">${icon('file', 'xs')}${T(`证据 ${ev.length}`, `Evidence ${ev.length}`)}</button><button class="link-btn" data-action="expand" data-key="${esc(key)}">${icon(open ? 'up' : 'down', 'xs')}${T(`任务与 Run ${tasks.length + runs.length}`, `Tasks & runs ${tasks.length + runs.length}`)}</button></div>
      ${open ? `<div class="kr-more col">
        ${kr.deliverable ? `<div class="small"><span class="muted">${T('产出', 'Deliverable')}：</span>${esc(L(kr.deliverable))}</div>` : ''}
        ${blockers.length && kr.status !== 'COMPLETE' ? `<div class="small"><span class="muted">${T('尚未完成的原因', 'Not complete because')}：</span>${blockers.map(b => esc(T(...({ below_target: ['指标未达目标', 'below target'], stale: ['数据过期', 'stale data'], no_verified_evidence: ['缺少已验证证据', 'no verified evidence'], not_verified: ['尚未验证', 'not verified'], not_accepted: ['等待验收', 'awaiting acceptance'], deps_incomplete: ['依赖未完成', 'dependencies incomplete'] }[b] || [b, b])))).join('、')}</div>` : ''}
        <div>${tasks.map(t => FM.taskRow(t)).join('') || `<span class="small muted">${T('Agent 尚未拆解任务', 'The Agent has not planned tasks yet')}</span>`}</div>
        ${runs.length ? `<div>${runs.map(r => `<div class="run-row"><span class="run-id">${esc(r.id)}</span><span class="grow ellipsis">${esc(L(r.title))}</span>${U.runState(r)}</div>`).join('')}</div>` : ''}
      </div>` : ''}
    </div>`;
  }

  function sideCards(okr) {
    const org = O();
    const now = U.now();
    const a = M.achievement(okr, now);
    const done = okr.krs.filter(k => k.status === 'COMPLETE').length;
    const c = okr.constraints;
    const b = c.budget;
    const w = x => `${Math.max(0, Math.min(100, (x / b.limit) * 100)).toFixed(1)}%`;
    const h = U.host(okr.hostId);
    const i = U.inst(okr.instanceId);
    const ag = U.agent(okr.ownerAgentId);
    const ready = !isActive(okr) && okr.lifecycle !== 'ACHIEVED' && okr.lifecycle !== 'ARCHIVED' ? M.readiness(org, okr, now) : null;
    const completion = okr.lifecycle === 'ACHIEVED' ? T('已达成（ACHIEVED）', 'Achieved') : T(`进行中 · ${done}/${okr.krs.length} 个 KR 已完成`, `In progress · ${done}/${okr.krs.length} KRs complete`);
    return `<aside class="detail-side">
      <section class="card"><div class="row gap-lg">${ring(a.value, okr.lifecycle === 'ACHIEVED' ? 'brand' : 'info')}<div class="col gap-sm"><span class="label">${T('加权达成度', 'Weighted progress')}</span><span class="small">${esc(completion)}</span>
        ${a.unknown.length ? `<span class="chip warn">${icon('help')}${T(`${a.unknown.length} 项未知/待更新`, `${a.unknown.length} unknown/stale`)}</span>` : ''}
        <button class="link-btn small" data-action="formula">${icon('info', 'xs')}${T('计算口径', 'How it is calculated')}</button></div></div>
        <div class="tiny muted mt-12">${T('完成状态独立于进度：100% 还需要验证、有效证据与验收。', 'Completion is separate from progress: 100% still needs verification, evidence and acceptance.')}</div></section>
      <section class="card"><div class="card-h"><h3>${icon('file', 'sm')}${T('执行约定', 'Agreement')} v${c.version}</h3>${isActive(okr) ? U.btn({ action: 'edit-agreement', data: { id: okr.id }, label: T('调整', 'Adjust'), size: 'sm', perm: 'approve' }) : ''}</div>
        <div class="row between small"><span class="muted">${T('预算', 'Budget')}</span><span class="num">${U.money(b.spent)} + ${U.money(b.reserved || 0)} / ${U.money(b.limit)}</span></div>
        <div class="meter mt-4"><span class="spent" style="width:${w(b.spent)}"></span><span class="reserved" style="width:${w(b.reserved || 0)}"></span></div>
        <dl class="kv mt-12"><dt>${T('截止', 'Deadline')}</dt><dd>${U.date(c.deadline)} · ${U.until(c.deadline)}</dd><dt>${T('可自主', 'Autonomous')}</dt><dd>${c.autonomous.map(x => esc(L(x))).join('；')}</dd><dt>${T('需升级', 'Escalate')}</dt><dd>${c.escalation.map(x => esc(L(x))).join('；')}</dd><dt>${T('验证授权', 'Verification')}</dt><dd>${esc(L(c.verification))}</dd></dl></section>
      <section class="card"><div class="card-h"><h3>${icon('server', 'sm')}${T('执行位置', 'Where it runs')}</h3>${isActive(okr) ? U.btn({ action: 'reassign', data: { id: okr.id }, label: T('改派', 'Reassign'), size: 'sm', perm: 'operate' }) : ''}</div>
        <dl class="kv"><dt>${T('负责人', 'Owner')}</dt><dd>${esc(ag.name)} · ${esc(L(ag.role || ''))}</dd><dt>${T('主机', 'Host')}</dt><dd>${h ? `<a href="#/hosts/${esc(h.id)}">${esc(h.name)}</a> · ${U.hostState(h)}` : '—'}</dd><dt>${T('实例', 'Instance')}</dt><dd>${esc(i ? `${i.name} · ${i.runtime}` : '—')}</dd><dt>${T('模型', 'Model')}</dt><dd>${esc(L(ag.model || '—'))}</dd><dt>${T('工作区', 'Workspace')}</dt><dd class="mono small">${esc((M.find(org.workspaces, okr.workspaceId) || {}).path || '—')}</dd></dl>
        ${ready ? `<div class="divider"></div><div class="label">${T('运行准备检查', 'Readiness check')}</div>${ready.length ? ready.map(x => `<div class="row small mt-4" style="color:var(--danger)">${icon('x', 'sm')}${esc(candText(x))}</div>`).join('') : `<div class="row small mt-4" style="color:var(--ok)">${icon('check', 'sm')}${T('工作区、Agent、主机与授权均就绪', 'Workspace, Agent, host and authority are ready')}</div>`}` : ''}</section>
    </aside>`;
  }

  function overview(okr) {
    const org = O();
    const crit = M.criteriaReview(okr);
    const tasks = org.tasks.filter(t => t.okrId === okr.id);
    return `<div class="col gap-lg">
      <section class="card"><div class="card-h"><h2>${T('成功标准', 'Success criteria')}</h2><span class="small muted">${T('全部 KR 完成后再次复核', 'Re-checked after all KRs complete')}</span></div>
        ${okr.criteria.map((c, i) => {
          const passed = crit[i] && crit[i].passed;
          return `<div class="crit"><span class="st ${passed ? 'ok' : 'muted'}">${icon(passed ? 'check' : 'clock')}</span><div class="grow"><div>${esc(L(c.text))}</div><div class="row wrap gap-sm mt-4">${c.krIds.map(id => `<span class="chip outline">${esc(krLabel(okr, id))}</span>`).join('')}<span class="tiny muted">${passed ? T('已通过', 'Passed') : T('待验证', 'Pending')}</span></div></div></div>`;
        }).join('')}</section>
      <section class="card"><div class="card-h"><h2>${T('关键结果', 'Key results')}</h2><span class="small muted">${T('Agent 声明 → 已测量 → 已验证 → 已验收', 'Claimed → measured → verified → accepted')}</span></div>
        ${okr.krs.map(kr => krRow(okr, kr)).join('')}</section>
      <section class="card"><div class="card-h"><h2>${T('达成趋势', 'Progress trend')}</h2></div>${trendChart(okr)}</section>
      <section class="card"><div class="card-h"><h2>${T('Agent 的计划', "The Agent's plan")}</h2><span class="small muted">${T('任务由 Agent 自主拆解，数量不影响达成度', 'Agents plan tasks; their count does not affect progress')}</span></div>
        ${tasks.map(t => `<div class="row">${FM.taskRow(t)}<span class="chip outline">${esc(krLabel(okr, t.krId))}</span></div>`).join('') || `<div class="muted small">${T('激活后由 Agent 按依赖拆解任务。', 'After activation the Agent plans tasks by dependency.')}</div>`}</section>
    </div>`;
  }

  function runsTab(okr) {
    const org = O();
    const runs = org.runs.filter(r => r.okrId === okr.id);
    const apv = org.approvals.filter(a => a.okrId === okr.id);
    return `<div class="col gap-lg">
      <section class="card flush"><table class="table"><thead><tr><th>Run</th><th>KR</th><th>${T('内容', 'What')}</th><th>${T('状态', 'State')}</th><th>${T('尝试', 'Attempt')}</th><th>${T('开始', 'Started')}</th></tr></thead>
        <tbody>${runs.map(r => `<tr><td class="mono small">${esc(r.id)}</td><td>${esc(krLabel(okr, r.krId))}</td><td><div>${esc(L(r.title))}</div>${r.error ? `<div class="tiny" style="color:var(--danger)">${esc(L(r.error))}</div>` : ''}${r.parentRunId ? `<div class="tiny muted">${T('重试自', 'Retry of')} ${esc(r.parentRunId)}</div>` : ''}</td><td>${U.runState(r)}</td><td class="num">${r.attempt}</td><td class="small muted">${U.agoTag(r.startedAt)}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">${T('暂无', 'None')}</td></tr>`}</tbody></table></section>
      <section class="card"><div class="card-h"><h2>${T('审批与验收记录', 'Approvals and acceptance')}</h2></div>
        ${apv.map(a => `<div class="item"><div class="grow"><div>${esc(L(a.action || (a.kind === 'okr_acceptance' ? T('最终验收', 'Final acceptance') : `${T('验收', 'Accept')} ${krLabel(okr, a.krId)}`)))}</div><div class="tiny muted">${esc(krLabel(okr, a.krId))} · ${U.dateTime(a.decidedAt || a.createdAt)}${a.execution ? ` · ${T('已执行', 'executed')} ${esc(a.execution.runId)}` : a.state === 'approved' && a.kind === 'boundary' ? ` · ${T('尚未执行', 'not executed yet')}` : ''}</div></div>${U.apvState(a)}</div>`).join('') || `<div class="muted small">${T('暂无', 'None')}</div>`}</section>
    </div>`;
  }

  function evidenceTab(okr) {
    const org = O();
    return `<section class="card">${okr.krs.map(kr => {
      const ev = org.evidence.filter(e => e.okrId === okr.id && e.krId === kr.id);
      return `<div class="mt-12"><div class="row between"><strong>${esc(krLabel(okr, kr.id))} · ${esc(L(kr.title))}</strong>${U.trust(M.krTrust(kr))}</div>${ev.map(e => FM.evidenceRow(e, okr)).join('') || `<div class="small muted mt-4">${T('暂无证据', 'No evidence yet')}</div>`}</div>`;
    }).join('')}</section>`;
  }

  function detail(id, r) {
    const org = O();
    const okr = M.find(org.okrs, id);
    if (!okr) return `<a class="back" href="#/okrs">${icon('left', 'sm')}${T('OKR 列表', 'OKRs')}</a><div class="card"><div class="empty"><h3>${T('该目标不在当前组织', 'This goal is not in the current organization')}</h3></div></div>`;
    const now = U.now();
    const cond = M.condition(org, okr, now);
    const scope = `okr-${id}`;
    const tab = ui.tab[scope] || r.query.get('tab') || 'overview';
    const ag = U.agent(okr.ownerAgentId);
    const h = U.host(okr.hostId);
    const actions = [];
    if (isActive(okr)) actions.push(U.btn({ action: 'view-run', data: { id }, label: T('在工作台查看运行', 'View run on workbench'), icon: 'home', kind: 'primary' }));
    if (okr.lifecycle === 'CANDIDATE' || okr.lifecycle === 'DRAFT') actions.push(U.btn({ action: 'activate', data: { id }, label: T('确认并激活', 'Confirm and activate'), icon: 'play', kind: 'primary', perm: 'approve' }));
    if (okr.lifecycle === 'ACHIEVED') actions.push(`<a class="btn" href="#/memory">${icon('book', 'sm')}<span>${T('成果与记忆', 'Results & memory')}</span></a>`);
    actions.push(`<button class="btn icon" data-action="okr-menu" data-pop-anchor="okr-more" data-id="${esc(id)}" aria-label="${T('更多操作', 'More actions')}">${icon('more', 'fill')}</button>`);
    const tabs = [['overview', '概览', 'Overview'], ['runs', '执行记录', 'Runs'], ['evidence', '证据', 'Evidence']];
    const body = tab === 'runs' ? runsTab(okr) : tab === 'evidence' ? evidenceTab(okr) : overview(okr);
    return `<a class="back" href="#/okrs">${icon('left', 'sm')}${T('OKR 列表', 'OKRs')}</a>
      <div class="page-h"><div class="grow" style="min-width:280px">
        <div class="row wrap gap-sm"><span class="prio ${okr.priority}">${okr.priority}</span>${U.lifeChip(okr.lifecycle)}${isActive(okr) || okr.lifecycle === 'ACHIEVED' ? U.condBadge(cond.code) : ''}</div>
        <h1 class="mt-8">${esc(L(okr.title))}</h1>
        <p class="small muted">${T('负责人', 'Owner')} ${esc(ag.name)} · ${T('截止', 'Due')} ${U.date(okr.constraints.deadline)} · ${T('执行', 'Runs on')} ${esc(h ? h.name : '—')}${okr.lifecycle === 'CANDIDATE' ? ` · <span style="color:var(--wait)">${esc(candText(okr.candidateReason))}</span>` : ''}</p>
      </div><div class="row wrap">${actions.join('')}</div></div>
      <div class="tabs" role="tablist">${tabs.map(([k, zh, en]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-action="set-tab" data-scope="${scope}" data-tab="${k}">${esc(T(zh, en))}</button>`).join('')}</div>
      <div class="detail">${body}${sideCards(okr)}</div>`;
  }

  FM.views.okrs = r => {
    if (r.parts[1] === 'new') return wizard();
    if (r.parts[1]) return detail(r.parts[1], r);
    return list();
  };

  FM.pops['okr-more'] = pop => {
    const okr = U.okrById(pop.id);
    if (!okr) return '';
    const archivable = !['ACHIEVED', 'ARCHIVED'].includes(okr.lifecycle);
    const chk = can('approve');
    return `<div class="pop" role="menu">
      <button class="menu-i" data-action="export-okr-md" data-id="${esc(okr.id)}">${icon('download', 'sm')}${T('导出此目标为 OKR.md', 'Export this goal as OKR.md')}</button>
      ${archivable ? `<button class="menu-i" data-action="archive-ask" data-id="${esc(okr.id)}"${chk.ok ? '' : ` aria-disabled="true" data-why="${esc(U.permText(chk.code))}"`}>${icon('archive', 'sm')}${T('归档…', 'Archive…')}</button>` : ''}
    </div>`;
  };

  /* -------------------------------------------------------------- Wizard */

  const AUTONOMOUS = [
    { zh: '读写工作区文件', en: 'Read and write workspace files' },
    { zh: '运行构建与测试', en: 'Run builds and tests' },
    { zh: '在工作区内创建分支与提交', en: 'Create branches and commits in the workspace' },
    { zh: '使用本组织的真机池', en: "Use this organization's device farm" },
  ];
  const ESCALATION = [
    { zh: '调用付费外部服务或上传代码到第三方', en: 'Paid external services or uploading code to third parties' },
    { zh: '修改签名证书、发布渠道或凭据', en: 'Changing signing certificates, release channels or credentials' },
    { zh: '预算预留超过剩余额度', en: 'Reservations beyond the remaining budget' },
    { zh: '删除或改写已上链的记录', en: 'Deleting or rewriting on-chain records' },
  ];
  const STEPS = [['目标', 'Objective'], ['成功标准', 'Criteria'], ['关键结果', 'Key results'], ['执行约定', 'Agreement'], ['确认', 'Confirm']];
  const W = 'okrnew';
  const w = (k, d) => U.f(`${W}.${k}`, d);

  function defaults() {
    const org = O();
    const owner = w('owner', (org.agents[0] || {}).id || '');
    const ws = w('ws', (org.workspaces[0] || {}).id || '');
    const insts = org.instances.filter(i => i.agentId === owner);
    return { owner, ws, inst: w('inst', (insts[0] || {}).id || '') };
  }

  function draftFrom() {
    const d = defaults();
    const cc = Number(w('ccount', 1));
    const kc = Number(w('kcount', 1));
    const raw = [...Array(cc)].map((_, i) => String(w(`c${i}`, '')).trim());
    const map = {};
    const criteria = [];
    raw.forEach((c, i) => { if (c) { map[i] = criteria.length; criteria.push(c); } });
    const krs = [...Array(kc)].map((_, i) => ({
      id: `kr${i + 1}`, title: w(`k${i}t`, ''), baseline: w(`k${i}b`, ''), target: w(`k${i}g`, ''), unit: w(`k${i}u`, ''),
      weight: w(`k${i}w`, 1), verify: w(`k${i}v`, 'user'), criterion: map[Number(w(`k${i}c`, 0))],
      deps: [...Array(kc)].map((_, j) => (j !== i && w(`k${i}d${j}`, false) ? `kr${j + 1}` : null)).filter(Boolean),
    }));
    return {
      title: w('title', ''), priority: w('priority', 'P1'), ownerAgentId: d.owner, criteria, krs,
      constraints: { workspaceId: d.ws, budget: Number(w('budget', 20)), deadline: new Date(U.now() + Number(w('days', 30)) * DAY).toISOString(), verification: w('verification', T('Reviewer 复核证据，由你验收', 'Reviewer re-checks evidence; you accept')) },
    };
  }

  const ERR = {
    required: ['必填', 'Required'], count: ['需要 1–3 项', 'Needs 1–3 items'], quantified: ['至少一条包含可量化指标（数字）', 'At least one needs a measurable number'],
    numbers: ['基线与目标需为数字', 'Baseline and target must be numbers'], baseline_equals_target: ['基线不能等于目标', 'Baseline cannot equal the target'],
    positive: ['需大于 0', 'Must be greater than 0'], cycle: ['依赖存在循环', 'Dependencies form a cycle'], future: ['截止时间需在未来', 'The deadline must be in the future'],
    unmapped: ['成功标准需映射到至少一个 KR', 'Each criterion must map to at least one KR'], looks_like_task: ['看起来像任务而非结果：执行步骤请交给 Agent 的计划', 'Looks like a task, not a result: leave execution steps to the Agent’s plan'],
  };
  const errText = code => T(...(ERR[code] || [code, code]));
  const STEP_FIELDS = { 1: ['title', 'priority', 'owner'], 2: ['criteria'], 3: ['kr', 'krs'], 4: ['constraints'] };

  function stepErrors(step, res) {
    const pre = STEP_FIELDS[step] || [];
    return res.errors.filter(e => pre.some(p => e.field === p || e.field.startsWith(p)));
  }

  function fieldErr(res, field) {
    if (!w('tried', false)) return '';
    const e = res.errors.find(x => x.field === field) || res.warnings.find(x => x.field === field);
    return e ? `<div class="err-t" style="${res.warnings.includes(e) ? 'color:var(--warn)' : ''}">${icon(res.warnings.includes(e) ? 'alert' : 'x', 'xs')}${esc(errText(e.code))}</div>` : '';
  }

  function wizard() {
    const org = O();
    const step = Number(w('step', 1));
    const d = defaults();
    const draft = draftFrom();
    const res = M.validateDraft(draft, U.now());
    const input = (k, label, extra) => `<div class="field ${extra && extra.full ? 'full' : ''}"><label for="w-${k}">${esc(label)}</label><input id="w-${k}" class="input ${extra && extra.cls ? extra.cls : ''}" data-f="${W}.${k}" value="${esc(w(k, extra && extra.def !== undefined ? extra.def : ''))}" ${extra && extra.type ? `type="${extra.type}"` : ''} ${extra && extra.ph ? `placeholder="${esc(extra.ph)}"` : ''}>${extra && extra.err ? extra.err : ''}</div>`;
    let body = '';
    if (step === 1) {
      const insts = org.instances.filter(i => i.agentId === d.owner);
      body = `<div class="form-grid">
        <div class="field full"><label for="w-title">${T('Objective（一句话结果目标：动词 + 结果）', 'Objective (one sentence: verb + outcome)')}</label><textarea id="w-title" class="textarea" data-f="${W}.title" rows="2" placeholder="${esc(T('例如：让团队周报可以一键生成并附来源', 'e.g. Make weekly reports one-click with cited sources'))}">${esc(w('title', ''))}</textarea>${fieldErr(res, 'title')}</div>
        <div class="field"><span class="label">${T('优先级', 'Priority')}</span><div class="seg">${['P0', 'P1', 'P2'].map(pr => `<button data-action="set-f" data-key="${W}.priority" data-value="${pr}" aria-pressed="${w('priority', 'P1') === pr}">${pr}</button>`).join('')}</div></div>
        <div class="field"><label for="w-days">${T('期限（天）', 'Timeframe (days)')}</label><input id="w-days" class="input num" type="number" min="1" data-f="${W}.days" value="${esc(w('days', 30))}"></div>
        <div class="field"><label for="w-owner">${T('负责人', 'Owner')}</label><select id="w-owner" class="select" data-f="${W}.owner">${org.agents.map(a => `<option value="${esc(a.id)}" ${a.id === d.owner ? 'selected' : ''}>${esc(a.name)} · ${esc(L(a.role))}</option>`).join('')}</select></div>
        <div class="field"><label for="w-inst">${T('执行实例', 'Instance')}</label><select id="w-inst" class="select" data-f="${W}.inst">${insts.map(i => `<option value="${esc(i.id)}" ${i.id === d.inst ? 'selected' : ''}>${esc(i.name)} · ${esc((U.host(i.hostId) || {}).name || '')}</option>`).join('') || `<option value="">${T('该 Agent 尚未部署', 'This Agent is not deployed')}</option>`}</select></div>
        <div class="field full"><label for="w-ws">${T('工作区', 'Workspace')}</label><select id="w-ws" class="select" data-f="${W}.ws">${org.workspaces.map(x => `<option value="${esc(x.id)}" ${x.id === d.ws ? 'selected' : ''}>${esc(x.name)} · ${esc(x.path)}</option>`).join('') || `<option value="">${T('请先导入项目目录', 'Import a project folder first')}</option>`}</select></div>
      </div>`;
    } else if (step === 2) {
      const cc = Number(w('ccount', 1));
      body = `<div class="note">${icon('info')}<div>${T('1–3 条可二元验证的成功标准，至少一条包含可量化指标。自由文本不能直接推断验收通过。', '1–3 binary-verifiable criteria, at least one measurable. Free text alone never implies acceptance.')}</div></div>
        ${[...Array(cc)].map((_, i) => `<div class="field"><label for="w-c${i}">${T('成功标准', 'Criterion')} ${i + 1}</label><div class="row"><input id="w-c${i}" class="input" data-f="${W}.c${i}" value="${esc(w(`c${i}`, ''))}" placeholder="${esc(T('例如：核心流程成功率 ≥ 95%', 'e.g. Core flow success rate ≥ 95%'))}">${cc > 1 ? `<button class="btn ghost icon" data-action="w-crit" data-d="-1" data-i="${i}" aria-label="${T('删除', 'Remove')}">${icon('x')}</button>` : ''}</div>${fieldErr(res, `criteria${i}`)}</div>`).join('')}
        ${fieldErr(res, 'criteria')}
        ${cc < 3 ? `<button class="btn sm" data-action="w-crit" data-d="1">${icon('plus', 'sm')}${T('添加成功标准', 'Add criterion')}</button>` : ''}`;
    } else if (step === 3) {
      const kc = Number(w('kcount', 1));
      const crit = draft.criteria;
      body = `<div class="note">${icon('info')}<div>${T('KR 描述可观察的结果；“安装工具”“实现模块”等执行步骤由 Agent 放进计划。', 'KRs describe observable results; steps like “install a tool” go into the Agent’s plan.')}</div></div>
        ${[...Array(kc)].map((_, i) => `<div class="card soft tight"><div class="row between"><strong>KR${i + 1}</strong>${kc > 1 ? `<button class="btn ghost icon sm" data-action="w-kr" data-d="-1" aria-label="${T('删除', 'Remove')}">${icon('x', 'sm')}</button>` : ''}</div>
          <div class="form-grid mt-8">
            <div class="field full"><label for="w-k${i}t">${T('可观察的结果', 'Observable result')}</label><input id="w-k${i}t" class="input" data-f="${W}.k${i}t" value="${esc(w(`k${i}t`, ''))}" placeholder="${esc(T('例如：核心流程成功率', 'e.g. Core flow success rate'))}">${fieldErr(res, `kr${i}.title`)}</div>
            ${input(`k${i}b`, T('基线', 'Baseline'), { type: 'number', cls: 'num' })}${input(`k${i}g`, T('目标', 'Target'), { type: 'number', cls: 'num', err: fieldErr(res, `kr${i}.metric`) })}
            ${input(`k${i}u`, T('单位', 'Unit'), { ph: '% / ms / 个' })}${input(`k${i}w`, T('权重', 'Weight'), { type: 'number', cls: 'num', def: 1, err: fieldErr(res, `kr${i}.weight`) })}
            <div class="field"><label for="w-k${i}c">${T('对应成功标准', 'Maps to criterion')}</label><select id="w-k${i}c" class="select" data-f="${W}.k${i}c">${crit.map((c, j) => `<option value="${j}" ${Number(w(`k${i}c`, 0)) === j ? 'selected' : ''}>${j + 1}. ${esc(c.slice(0, 28))}</option>`).join('') || `<option>—</option>`}</select></div>
            <div class="field"><label for="w-k${i}v">${T('验证方式', 'Verification')}</label><select id="w-k${i}v" class="select" data-f="${W}.k${i}v"><option value="user" ${w(`k${i}v`, 'user') === 'user' ? 'selected' : ''}>${T('Reviewer 复核，由你验收', 'Reviewer re-checks; you accept')}</option><option value="preauthorized" ${w(`k${i}v`, 'user') === 'preauthorized' ? 'selected' : ''}>${T('预授权验证者直接验收', 'Pre-authorized verifier accepts')}</option></select></div>
            ${kc > 1 ? `<div class="field full"><span class="label">${T('依赖', 'Depends on')}</span><div class="row wrap">${[...Array(kc)].map((__, j) => (j === i ? '' : `<label class="check"><input type="checkbox" data-f="${W}.k${i}d${j}" ${w(`k${i}d${j}`, false) ? 'checked' : ''}>KR${j + 1}</label>`)).join('')}</div></div>` : ''}
          </div></div>`).join('')}
        ${fieldErr(res, 'krs')}
        ${kc < 3 ? `<button class="btn sm" data-action="w-kr" data-d="1">${icon('plus', 'sm')}${T('添加 KR', 'Add KR')}</button>` : ''}`;
    } else if (step === 4) {
      body = `<div class="form-grid">
          ${input('budget', T('预算上限（USD，含在途预留）', 'Budget limit (USD, including reservations)'), { type: 'number', cls: 'num', def: 20, err: fieldErr(res, 'constraints.budget') })}
          <div class="field"><span class="label">${T('工作区与设备', 'Workspace & device')}</span><div class="small">${esc((M.find(org.workspaces, d.ws) || {}).path || '—')} · ${esc((U.host((U.inst(d.inst) || {}).hostId) || {}).name || '—')}</div></div>
          <div class="field"><span class="label">${T('可自主执行', 'Autonomous actions')}</span>${AUTONOMOUS.map((x, i) => `<label class="check"><input type="checkbox" data-f="${W}.a${i}" ${w(`a${i}`, i < 2) ? 'checked' : ''}>${esc(L(x))}</label>`).join('')}</div>
          <div class="field"><span class="label">${T('升级条件（需要你批准）', 'Escalate (needs your approval)')}</span>${ESCALATION.map((x, i) => `<label class="check"><input type="checkbox" data-f="${W}.e${i}" ${w(`e${i}`, true) ? 'checked' : ''}>${esc(L(x))}</label>`).join('')}</div>
          <div class="field full"><label for="w-verification">${T('验证授权', 'Verification authority')}</label><input id="w-verification" class="input" data-f="${W}.verification" value="${esc(w('verification', T('Reviewer 复核证据，由你验收', 'Reviewer re-checks evidence; you accept')))}">${fieldErr(res, 'constraints.verification')}</div>
        </div>
        <div class="note">${icon('shield')}<div>${T('约定内自主执行仍经过执行端权限检查；权限、预算、时间任一不满足即停止发起新动作。', 'Autonomous work still passes execution-side checks; if authority, budget or time runs out, no new actions start.')}</div></div>`;
    } else {
      const full = M.activeCount(org) >= M.MAX_ACTIVE;
      const tmp = { workspaceId: d.ws, instanceId: d.inst, hostId: (U.inst(d.inst) || {}).hostId };
      const ready = M.readiness(org, tmp, U.now());
      const q = [
        [!res.errors.some(e => e.field === 'title'), T('Objective 以结果为导向', 'Objective is outcome-oriented')],
        [!res.errors.some(e => e.field.startsWith('criteria')), T('成功标准可量化、可二元验证并映射到 KR', 'Criteria are measurable, binary and mapped to KRs')],
        [!res.errors.some(e => e.field.startsWith('kr')), T('每个 KR 有基线、目标、权重、依赖与验证方式', 'Each KR has baseline, target, weight, dependencies and verification')],
        [!res.warnings.length, T('KR 是结果而不是任务', 'KRs are results, not tasks')],
        [!res.errors.some(e => e.field.startsWith('constraints')), T('执行约定完整（预算、期限、验证授权）', 'Agreement complete (budget, deadline, verification)')],
      ];
      body = `<div class="card soft tight"><div class="row gap-sm"><span class="prio ${draft.priority}">${draft.priority}</span><strong>${esc(draft.title || T('（未填写目标）', '(no objective)'))}</strong></div>
          <div class="small muted mt-4">${esc(U.agent(d.owner).name)} · ${T(`${w('days', 30)} 天`, `${w('days', 30)} days`)} · $${esc(w('budget', 20))}</div>
          <ul class="small mt-8" style="margin:8px 0 0;padding-left:18px">${draft.criteria.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
          <div class="col gap-sm mt-8">${draft.krs.map((k, i) => `<div class="small"><strong>KR${i + 1}</strong> ${esc(k.title)} · ${esc(k.baseline)} → ${esc(k.target)} ${esc(k.unit)} · ${T('权重', 'weight')} ${esc(k.weight)}${k.deps.length ? ` · ${T('依赖', 'after')} ${k.deps.map(x => x.toUpperCase()).join('、')}` : ''}</div>`).join('')}</div></div>
        <div><div class="label">${T('质量校验（okr-manager）', 'Quality gate (okr-manager)')}</div>${q.map(([ok, t]) => `<div class="row small mt-4" style="color:${ok ? 'var(--ok)' : 'var(--danger)'}">${icon(ok ? 'check' : 'x', 'sm')}${esc(t)}</div>`).join('')}</div>
        <div><div class="label">${T('运行准备（FR-40）', 'Readiness (FR-40)')}</div>${ready.length ? ready.map(x => `<div class="row small mt-4" style="color:var(--danger)">${icon('x', 'sm')}${esc(candText(x))}</div>`).join('') : `<div class="row small mt-4" style="color:var(--ok)">${icon('check', 'sm')}${T('工作区、Agent、主机与授权均就绪', 'Workspace, Agent, host and authority are ready')}</div>`}</div>
        ${full ? `<div class="note info">${icon('info')}<div>${T('已有 3 个 ACTIVE 目标。确认后此目标进入候选池，可随时查看和编辑。', 'Three goals are already active. After confirming, this goal waits as a candidate.')}</div></div>` : ''}
        <div class="small muted">${T('链上写入：预计', 'Chain write: est.')} ${U.sui(M.feeFor('okr.activate'))} · ${T('支付来源', 'paid by')} ${P().wallet.source === 'sponsor' ? T('赞助方', 'sponsor') : T('你的运行费账户', 'your run-fee account')}</div>`;
    }
    const nav = STEPS.map(([zh, en], i) => `<span class="${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}"><b>${i + 1 < step ? '✓' : i + 1}</b>${esc(T(zh, en))}</span>`).join('');
    const back = step > 1 ? `<button class="btn" data-action="w-step" data-d="-1">${icon('left', 'sm')}${T('上一步', 'Back')}</button>` : `<a class="btn" href="#/okrs">${T('取消', 'Cancel')}</a>`;
    const full = M.activeCount(org) >= M.MAX_ACTIVE;
    const next = step < 5
      ? `<button class="btn primary" data-action="w-step" data-d="1">${T('下一步', 'Next')}${icon('right', 'sm')}</button>`
      : `${U.btn({ action: 'w-save', data: { mode: 'draft' }, label: T('保存为草稿', 'Save as draft') })}${U.btn({ action: 'w-save', data: { mode: 'activate' }, label: full ? T('保存到候选池', 'Save as candidate') : T('确认并激活', 'Confirm and activate'), kind: 'primary', perm: 'approve', disabled: !res.ok, why: T('请先修正质量校验中的问题', 'Fix the quality-gate issues first') })}`;
    const assist = step <= 3 ? U.btn({ action: 'w-assist', label: T('让 Agent 协助拟定', 'Let the Agent draft'), icon: 'sparkle', size: 'sm', kind: 'ghost' }) : '';
    return `<a class="back" href="#/okrs">${icon('left', 'sm')}${T('OKR 列表', 'OKRs')}</a>
      <div class="page-h"><div><h1>${T('新建 OKR', 'New OKR')}</h1><p class="muted">${T('你确认结果与边界；Agent 自主拆解任务、执行和验证。', 'You confirm results and limits; the Agent plans, executes and verifies.')}</p></div>${assist}</div>
      <div class="steps-nav">${nav}</div>
      <div class="card" style="max-width:820px"><div class="col gap-lg">${body}</div><div class="card-f" style="justify-content:space-between">${back}<div class="row">${next}</div></div></div>`;
  }

  function defaultPlan(b, g, budget) {
    const cost = Math.max(20, Math.round(budget * 0.04));
    const at = x => Math.round((b + (g - b) * x) * 10) / 10;
    return { A: { steps: [{ value: at(0.4), cost }, { value: at(0.75), cost }, { value: g, cost }] } };
  }

  function createOkr() {
    const p = P();
    const org = O();
    const now = U.now();
    const d = defaults();
    const draft = draftFrom();
    const inst = U.inst(d.inst);
    const budget = Math.round(Number(w('budget', 20)) * 100);
    const days = Number(w('days', 30));
    const reviewer = (org.agents.find(a => a.verifier) || {}).id || d.owner;
    const okr = {
      id: M.nextId(p, 'okr'), priority: draft.priority, ownerAgentId: d.owner, lifecycle: 'DRAFT', title: draft.title.trim(), createdAt: now,
      window: { start: now, end: now + days * DAY }, workspaceId: d.ws, hostId: inst ? inst.hostId : null, instanceId: inst ? inst.id : null, version: 1,
      criteria: draft.criteria.map((text, i) => ({ id: `sc${i + 1}`, text, krIds: draft.krs.filter(k => k.criterion === i).map(k => k.id) })),
      krs: draft.krs.map(k => {
        const b = Number(k.baseline), g = Number(k.target);
        return {
          id: k.id, weight: Number(k.weight), status: 'PENDING', deps: k.deps, verifyBy: k.verify, verifier: reviewer, ruleVersion: 'v1',
          title: String(k.title).trim(), metric: { baseline: b, current: b, target: g, unit: k.unit, direction: g > b ? 'up' : 'down', sampledAt: now },
          method: draft.constraints.verification, verification: { state: 'none' }, acceptance: { state: 'none' }, route: 'A', stepIndex: 0, plan: defaultPlan(b, g, budget),
        };
      }),
      constraints: {
        workspaceId: d.ws, hostId: inst ? inst.hostId : null, version: 1, confirmedAt: now, deadline: now + days * DAY,
        budget: { limit: budget, spent: 0, reserved: 0, currency: 'USD' },
        autonomous: AUTONOMOUS.filter((_, i) => w(`a${i}`, i < 2)), escalation: ESCALATION.filter((_, i) => w(`e${i}`, true)),
        verification: draft.constraints.verification,
      },
      nav: { scenario: null, waiting: null, observation: 'ok', paused: false, pausedReason: null, blocked: null }, trend: [],
    };
    org.okrs.push(okr);
    if (p.onboarding) p.onboarding.okr = true;
    return okr;
  }

  function activate(okr) {
    const org = O();
    const res = M.requestActivation(org, okr, U.now());
    U.save();
    if (!res.ok) {
      const msg = res.code === 'active_limit' ? T('已有 3 个 ACTIVE 目标：已保存到候选池。完成或归档一个后再激活。', 'Three goals are active: saved as a candidate. Finish or archive one first.')
        : res.code === 'not_ready' ? T(`运行准备未通过：${res.issues.map(candText).join('；')}。已保存到候选池。`, `Readiness failed: ${res.issues.map(candText).join('; ')}. Saved as a candidate.`)
          : res.code === 'already_active' ? T('该目标已激活或正在激活，不会重复创建。', 'Already active or activating; nothing is duplicated.') : res.code;
      toast(msg, 'warn', 5600);
      U.go(`okrs/${okr.id}`);
      return;
    }
    const orgId = P().currentOrgId;
    U.submitTx({ kind: 'okr.activate', payload: { okrId: okr.id } }, {
      ok: T('已激活：Agent 将按依赖自主拆解任务并推进。', 'Activated: the Agent will plan by dependency and work autonomously.'),
      onConfirmed: (r, p) => {
        p.data[orgId].focusOkrId = okr.id;
        if (FM.review) FM.review.mark('okr.activated');
        if (U.P() === p && p.currentOrgId === orgId) U.go('workbench');
      },
      onFailed: (r, p) => {
        const o = M.find(p.data[orgId].okrs, okr.id);
        if (o && o.lifecycle === 'ACTIVATING') { o.lifecycle = 'CANDIDATE'; o.candidateReason = 'activation_failed'; }
      },
    });
  }

  Object.assign(FM.actions, {
    'view-run': el => { O().focusOkrId = el.dataset.id; U.save(); U.go('workbench'); },
    'okr-menu': el => U.togglePop('okr-more', el.getAttribute('data-pop-anchor'), { id: el.dataset.id }),
    activate: el => {
      const c = can('approve');
      if (!c.ok) { toast(U.permText(c.code), 'warn'); return; }
      activate(U.okrById(el.dataset.id));
    },
    'archive-ask': el => { ui.pop = null; U.openDialog('archive', { id: el.dataset.id }); },
    'archive-do': el => {
      const okr = U.okrById(el.dataset.id);
      U.submitTx({ kind: 'okr.archive', payload: { okrId: okr.id } }, {
        ok: T('已归档：链上历史保留，可在“已归档”中查看。', 'Archived: chain history is kept under Archived.'),
        onConfirmed: () => { ui.dialog = null; },
      });
    },
    'w-step': el => {
      const step = Number(w('step', 1));
      const dir = Number(el.dataset.d);
      if (dir > 0) {
        const errs = stepErrors(step, M.validateDraft(draftFrom(), U.now()));
        if (errs.length) { U.setF(`${W}.tried`, true); render(); toast(T('请先完成本步必填项', 'Complete this step first'), 'warn'); return; }
      }
      U.setF(`${W}.tried`, false);
      U.setF(`${W}.step`, Math.max(1, Math.min(5, step + dir)));
      render();
      const sc = document.scrollingElement;
      if (sc) sc.scrollTop = 0;
    },
    'w-crit': el => {
      const cc = Number(w('ccount', 1));
      if (Number(el.dataset.d) > 0) U.setF(`${W}.ccount`, Math.min(3, cc + 1));
      else {
        const i = Number(el.dataset.i);
        for (let j = i; j < cc - 1; j++) U.setF(`${W}.c${j}`, w(`c${j + 1}`, ''));
        U.setF(`${W}.c${cc - 1}`, '');
        U.setF(`${W}.ccount`, Math.max(1, cc - 1));
      }
      render();
    },
    'w-kr': el => {
      const kc = Number(w('kcount', 1));
      U.setF(`${W}.kcount`, Math.max(1, Math.min(3, kc + Number(el.dataset.d))));
      render();
    },
    'w-assist': () => {
      const set = (k, v) => { if (!w(k, '')) U.setF(`${W}.${k}`, v); };
      if (!w('title', '')) U.setF(`${W}.title`, T('让发布流程可重复并附带可验证的证据', 'Make releases repeatable with verifiable evidence'));
      set('c0', T('核心流程成功率 ≥ 95%，并附 3 份已验证证据', 'Core flow success rate ≥ 95% with 3 verified evidence items'));
      U.setF(`${W}.ccount`, Math.max(1, Number(w('ccount', 1))));
      set('k0t', T('核心流程成功率', 'Core flow success rate'));
      set('k0b', '60'); set('k0g', '95'); set('k0u', '%'); set('k0w', '60');
      if (Number(w('kcount', 1)) < 2) U.setF(`${W}.kcount`, 2);
      set('k1t', T('关键操作 p95 延迟', 'Key action p95 latency'));
      set('k1b', '800'); set('k1g', '300'); set('k1u', 'ms'); set('k1w', '40');
      U.setF(`${W}.k1v`, 'preauthorized');
      toast(T('已填入演示建议：请逐项核对，Agent 不会替你确认。', 'Filled in demo suggestions: review each one; the Agent does not confirm for you.'), 'info', 4600);
      render();
    },
    'w-save': el => {
      const res = M.validateDraft(draftFrom(), U.now());
      if (el.dataset.mode === 'activate' && !res.ok) { U.setF(`${W}.tried`, true); render(); return; }
      if (!String(w('title', '')).trim()) { toast(T('请至少填写目标', 'Enter an objective first'), 'warn'); return; }
      const okr = createOkr();
      U.clearForm(W);
      U.save();
      if (el.dataset.mode === 'draft') { toast(T('已保存为草稿（仅本机工作副本，确认后才写入链上）。', 'Saved as a draft (local working copy until confirmed on chain).'), 'ok'); U.go(`okrs/${okr.id}`); return; }
      if (FM.review) FM.review.mark('okr.created');
      activate(okr);
    },
    'export-okr-md': el => {
      const org = O();
      const list = el.dataset.id ? [U.okrById(el.dataset.id)] : org.okrs.filter(o => o.lifecycle === 'ACTIVE');
      ui.pop = null;
      U.download('OKR.md', okrMarkdown(list), 'text/markdown');
      toast(T(`已导出 ${list.length} 个目标。链上记录为准，文件是投影。`, `Exported ${list.length} goal(s). Chain records are authoritative; the file is a projection.`), 'ok');
    },
  });

  FM.dialogs.archive = ({ id }) => {
    const okr = U.okrById(id);
    if (!okr) return null;
    const org = O();
    const executing = org.runs.some(r => r.okrId === id && ['queued', 'running', 'recovering'].includes(r.state));
    const tx = U.latestTx(t => t.kind === 'okr.archive' && t.payload.okrId === id);
    return {
      title: T('归档目标', 'Archive goal'), sub: esc(L(okr.title)), size: 'sm',
      body: `<div class="small">${T('归档后目标不再占用 ACTIVE 名额。链上历史、证据与成果保留，界面移除不代表擦除。', 'Archiving frees an ACTIVE slot. Chain history, evidence and results remain; hiding is not erasing.')}</div>
        ${executing ? `<div class="note warn">${icon('alert')}<div>${T('有正在执行的 Run：请先取消并等待执行设备确认。', 'A run is executing: cancel it and wait for the execution device to confirm first.')}</div></div>` : `<div class="note">${icon('info')}<div>${T('只在等待审批的请求会失效，不会被执行。', 'Requests only waiting for approval become invalid and never run.')}</div></div>`}
        ${tx ? U.txLine(tx) : ''}`,
      foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'archive-do', data: { id }, label: T('签名归档', 'Sign and archive'), kind: 'danger', perm: 'approve', disabled: executing || !!(tx && tx.state === 'pending'), why: T('先停止正在执行的 Run', 'Stop the running work first') })}`,
    };
  };

  function iso(ts) { return ts ? new Date(ts).toISOString().slice(0, 10) : '—'; }
  function okrMarkdown(list) {
    const emoji = { P0: '🔴', P1: '🟡', P2: '🟢' };
    const org = O();
    const status = k => (k.status === 'COMPLETE' ? '✅ COMPLETE' : k.status === 'IN_PROGRESS' ? 'IN PROGRESS' : 'PENDING');
    const body = list.map(o => {
      const krs = o.krs.map((k, i) => {
        const m = k.metric;
        const outcome = m ? `${U.num(m.baseline, m.unit)} → ${U.num(m.target, m.unit)} (current ${m.current === null ? 'unknown' : U.num(m.current, m.unit)})` : (k.binary && k.binary.verified ? 'verified' : 'unverified');
        return `**KR${i + 1}: ${L(k.title)}** — ${status(k)}\n- Deliverable: ${L(k.deliverable) || '—'}\n${(k.deps || []).length ? `- Depends on: ${k.deps.map(d => krLabel(o, d)).join(', ')}\n` : ''}- Outcome: ${outcome}\n- Verification: ${L(k.method) || '—'}\n`;
      }).join('\n');
      const order = o.krs.map(k => ((k.deps || []).length ? `${k.deps.map(d => krLabel(o, d)).join(' + ')} → ${krLabel(o, k.id)}` : krLabel(o, k.id))).join('; ');
      const tasks = org.tasks.filter(t => t.okrId === o.id).map(t => `- [${t.state === 'Completed' ? 'x' : ' '}] ${L(t.title)} (${krLabel(o, t.krId)} · ${t.state})`).join('\n') || '- [ ] —';
      return `### OKR ${L(o.title)} (${iso(o.activatedAt || o.createdAt)}) — ${o.lifecycle} ${emoji[o.priority] || ''} ${o.priority}\n\n**Owner**: ${U.agent(o.ownerAgentId).name}\n**Deadline**: ${iso(o.constraints.deadline)}\n\n#### Objective\n${L(o.title)}\n\n#### Success Criteria\n${o.criteria.map(c => `- **${L(c.text)}**`).join('\n')}\n\n#### Key Results\n\n> **Dependency order**: ${order}\n\n${krs}\n#### Tasks / Milestones\n\n${tasks}\n`;
    }).join('\n---\n\n');
    return `<!-- Exported from the FractalMind App prototype v2 (demo data). Chain records are authoritative; this file is a projection. -->\n\n${body}`;
  }
})();
