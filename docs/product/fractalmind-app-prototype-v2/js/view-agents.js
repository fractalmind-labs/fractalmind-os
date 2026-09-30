/* FractalMind App prototype v2 — Team & Agents (roles, instances, discovery and
 * import of existing Agents, J11) and Memory & results (FR-08). */
(function () {
  'use strict';
  const FM = window.FM;
  const U = FM.ui;
  const { M, F, T, L, esc, icon, P, O, can, ui, render, toast } = U;

  const ST = { running: ['ok', '运行', 'Running'], idle: ['muted', '空闲', 'Idle'], stopped: ['danger', '已停止', 'Stopped'], importing: ['info', '导入中', 'Importing'] };
  const instState = i => {
    const h = U.host(i.hostId);
    if (!h || h.status !== 'online') return `<span class="st muted">${icon('help')}${T('未知', 'Unknown')}</span>`;
    const x = ST[i.status] || ['muted', i.status, i.status];
    return `<span class="st ${x[0]}">${esc(T(x[1], x[2]))}</span>`;
  };

  FM.views.agents = () => {
    const org = O();
    const roles = org.agents.map(a => {
      const insts = org.instances.filter(i => i.agentId === a.id);
      const okrs = org.okrs.filter(o => o.ownerAgentId === a.id && o.lifecycle === 'ACTIVE');
      return `<article class="card"><div class="row between top"><div class="row"><span class="avatar round">${esc(a.name.slice(0, 1))}</span><div><div class="strong">${esc(a.name)}${a.verifier ? ` <span class="chip ok">${T('验证者', 'Verifier')}</span>` : ''}</div><div class="small muted">${esc(L(a.role))}</div></div></div><span class="chip outline">${T(`${insts.length} 个实例`, `${insts.length} instances`)}</span></div>
        <dl class="kv mt-12"><dt>${T('运行时', 'Runtime')}</dt><dd>${esc(a.runtime)}</dd><dt>${T('模型', 'Model')}</dt><dd>${esc(L(a.model))}</dd><dt>${T('能力', 'Capabilities')}</dt><dd><div class="row wrap gap-sm">${(a.capabilities || []).map(c => `<span class="chip">${esc(L(c))}</span>`).join('')}</div></dd><dt>${T('负责', 'Owns')}</dt><dd>${okrs.map(o => `<a href="#/okrs/${esc(o.id)}">${o.priority} ${esc(L(o.title))}</a>`).join('<br>') || '—'}</dd></dl></article>`;
    }).join('');
    const rows = org.instances.map(i => {
      const h = U.host(i.hostId);
      const okrs = org.okrs.filter(o => o.instanceId === i.id && o.lifecycle === 'ACTIVE');
      const canInclude = i.imported === 'observe' && i.adapter !== 'tmux-observe' && i.status !== 'importing';
      return `<tr><td><div class="strong">${esc(i.name)}</div><div class="tiny muted mono">${esc(i.sessionKey || '')}</div></td><td>${esc(U.agent(i.agentId).name || T('未分配', 'Unassigned'))}</td>
        <td><a href="#/hosts/${esc(i.hostId)}">${esc(h ? h.name : '—')}</a></td><td class="small">${esc(i.runtime)}</td>
        <td><span class="chip ${i.adapter === 'tmux-observe' ? 'wait' : 'outline'}">${i.adapter === 'tmux-observe' ? T('仅观察', 'Observe only') : T('可控', 'Controllable')}</span></td>
        <td>${instState(i)}</td><td class="small">${okrs.map(o => `${o.priority} ${esc(L(o.title).slice(0, 12))}…`).join('<br>') || '—'}</td>
        <td class="small">${i.imported === 'observe' ? T('导入 · 仅观察', 'Imported · observe') : i.imported === 'managed' ? T('导入 · 已纳入', 'Imported · managed') : T('App 部署', 'Deployed by app')}${canInclude ? `<div class="mt-4">${U.btn({ action: 'open', data: { dialog: 'include', id: i.id }, label: T('纳入 OKR', 'Add to OKR'), size: 'sm', perm: 'manage_hosts' })}</div>` : ''}</td></tr>`;
    }).join('');
    return `<div class="page-h"><div><h1>${T('团队与 Agents', 'Team & Agents')}</h1><p class="muted">${T('Agent 角色、运行实例与所在主机。同一角色可以部署在多台主机；命令与授权绑定具体实例。', 'Agent roles, running instances and their hosts. One role can run on several hosts; commands and grants bind a specific instance.')}</p></div>
        <div class="row">${U.btn({ action: 'open', data: { dialog: 'discover' }, label: T('从 Host 发现 Agent', 'Discover on a host'), icon: 'scan', kind: 'primary' })}</div></div>
      <div class="grid-2">${roles}</div>
      <section class="sec"><div class="sec-h"><h2>${T('运行实例', 'Instances')}</h2><span class="small muted">${org.instances.length}</span></div>
        <div class="card flush" style="overflow-x:auto"><table class="table"><thead><tr><th>${T('实例', 'Instance')}</th><th>${T('角色', 'Role')}</th><th>${T('主机', 'Host')}</th><th>${T('运行时', 'Runtime')}</th><th>${T('适配器', 'Adapter')}</th><th>${T('状态', 'Status')}</th><th>OKR</th><th>${T('来源', 'Source')}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <section class="sec"><div class="card soft"><div class="row top gap-lg"><span class="avatar" style="background:var(--surface-3);color:var(--text-3)">${icon('users')}</span><div class="grow"><div class="row wrap"><strong>${T('团队协作', 'Team delivery')}</strong><span class="chip wait">P3</span></div>
        <p class="small muted mt-4">${T('由 Lead 拆分任务、成员提交子成果、验收者逐项验证后汇总；失败的子任务不会被隐藏为总体成功。该阶段开放前不显示可用操作。', 'A Lead splits work, members submit, verifiers check each piece before it rolls up; failed subtasks are never hidden as overall success. No actions until this stage ships.')}</p></div></div></div></section>`;
  };

  /* ------------------------------------------------ Discovery (J11) */

  FM.dialogs.discover = st => {
    const org = O();
    const hostId = U.f('discover.host', st.host || '');
    const scan = st.scan && st.scan.hostId === hostId ? st.scan : null;
    const hosts = org.hosts.map(h => `<button class="opt" data-action="set-f" data-key="discover.host" data-value="${esc(h.id)}" aria-pressed="${h.id === hostId}"><span class="ico">${icon(h.kind === 'cloud' ? 'cloud' : 'server')}</span><span class="grow"><span class="strong">${esc(h.name)}</span><span class="small muted" style="display:block">${esc(h.os)}</span></span>${U.hostState(h)}</button>`).join('');
    let result = '';
    if (st.err && st.errHost === hostId) result = `<div class="note warn">${icon('alert')}<div>${esc(st.err)}</div></div>`;
    if (scan) {
      result = scan.sessions.length ? `<div class="label">${T('发现的会话', 'Sessions found')} · ${T('观测于', 'observed')} ${U.agoTag(scan.at)}</div>${scan.sessions.map(s => {
        const imported = s.importedAs || (org.instances.find(i => i.hostId === s.hostId && i.sessionKey === s.key) || {}).id;
        const inst = imported ? U.inst(imported) : null;
        const tx = inst && U.latestTx(t => t.kind === 'agent.import' && t.payload.instanceId === inst.id);
        const action = inst
          ? (inst.status === 'importing' ? U.txLine(tx) : `<span class="st ok">${icon('check')}${T('已导入', 'Imported')}</span>${inst.imported === 'observe' && inst.adapter !== 'tmux-observe' ? U.btn({ action: 'open', data: { dialog: 'include', id: inst.id }, label: T('纳入 OKR', 'Add to OKR'), size: 'sm', perm: 'manage_hosts' }) : ''}`)
          : U.btn({ action: 'import-session', data: { key: s.key }, label: T('导入为仅观察', 'Import as observe-only'), size: 'sm', kind: 'primary', perm: 'manage_hosts', disabled: s.identity !== 'verified', why: T('身份未核实，不能导入', 'Identity not verified; cannot import') });
        return `<div class="card soft tight"><div class="row between top"><div><div class="row wrap gap-sm"><strong>${esc(s.name)}</strong><span class="chip ${s.adapter === 'tmux-observe' ? 'wait' : 'outline'}">${s.adapter === 'tmux-observe' ? T('tmux · 仅观察', 'tmux · observe only') : T('可接受约束', 'Accepts constraints')}</span><span class="chip ${s.identity === 'verified' ? 'ok' : 'danger'}">${s.identity === 'verified' ? T('身份已核实', 'Identity verified') : T('身份未核实', 'Identity unverified')}</span></div>
          <div class="tiny muted mt-4">${esc(s.runtime)} · <span class="mono">${esc(s.workspace)}</span> · ${T('启动于', 'started')} ${U.agoTag(s.startedAt)}</div><div class="small mt-4">${esc(L(s.task))}</div></div><div class="col" style="align-items:flex-end">${action}</div></div></div>`;
      }).join('')}` : `<div class="note">${icon('info')}<div>${T('这台主机上没有发现会话。', 'No sessions found on this host.')}</div></div>`;
    }
    return {
      title: T('从 Host 发现已有 Agent', 'Discover existing Agents on a host'), size: 'lg',
      sub: T('发现快照是观测；导入关系、OKR 绑定与授权是链上状态。', 'Discovery snapshots are observations; imports, OKR bindings and grants are chain state.'),
      body: `<div class="col">${hosts}</div>${U.btn({ action: 'scan-host', label: T('扫描', 'Scan'), icon: 'scan', disabled: !hostId, why: T('选择一台主机', 'Choose a host') })}${result}
        <div class="note">${icon('info')}<div>${T('默认“导入为仅观察”：保留原进程与任务，不重新启动或复制 Agent。同名不同主机不合并，同一实例不能重复导入。', 'Default is “observe only”: the original process and task continue; nothing is restarted or copied. Same names on different hosts are not merged; one instance imports once.')}</div></div>`,
      foot: `<button class="btn primary" data-action="close-dialog">${T('完成', 'Done')}</button>`,
    };
  };

  FM.dialogs.include = ({ id }) => {
    const org = O();
    const inst = U.inst(id);
    if (!inst) return null;
    const okrs = org.okrs.filter(o => o.lifecycle === 'ACTIVE');
    const okrId = U.f(`include-${id}.okr`, (okrs.find(o => (M.find(org.workspaces, o.workspaceId) || {}).path === inst.workspace) || okrs[0] || {}).id);
    ui.dialog.okrId = okrId;
    const okr = U.okrById(okrId);
    const CHECKS = [['budget', '预算上限与在途预留', 'Budget limit and reservations'], ['deadline', '期限', 'Deadline'], ['tools', '允许的工具与工作区', 'Allowed tools and workspace'], ['escalation', '升级条件', 'Escalation conditions'], ['checkpoint', '原任务已到安全检查点', 'The original task reached a safe checkpoint'], ['stopped', '已证实旧执行停止', 'The old execution is confirmed stopped']];
    const checks = Object.fromEntries(CHECKS.map(([k]) => [k, U.f(`include-${id}.${k}`, false)]));
    const issues = M.includeIssues(org, inst, okr, checks, U.now());
    const ISS = { observe_only: ['仅观察适配器不能接受约束', 'Observe-only adapters cannot take constraints'], observation_stale: ['观测已超过 5 分钟，请重新扫描', 'The observation is older than 5 minutes; scan again'], okr_not_active: ['目标未激活', 'The goal is not active'], workspace_mismatch: ['实例工作区与目标不匹配', 'Instance workspace does not match the goal'], checks_incomplete: ['请逐项确认交接检查', 'Confirm each handoff check'] };
    const tx = U.latestTx(t => t.kind === 'agent.include' && t.payload.instanceId === id);
    return {
      title: T('授权纳入 OKR', 'Authorize for an OKR'), sub: `${esc(inst.name)} · ${esc((U.host(inst.hostId) || {}).name || '')} · <span class="mono">${esc(inst.workspace)}</span>`, size: 'lg',
      body: `<div class="field"><label for="inc-okr">${T('目标（仅 ACTIVE，工作区需匹配）', 'Goal (ACTIVE only; workspace must match)')}</label><select id="inc-okr" class="select" data-f="include-${esc(id)}.okr">${okrs.map(o => `<option value="${esc(o.id)}" ${o.id === okrId ? 'selected' : ''}>${o.priority} · ${esc(L(o.title))} · ${esc((M.find(org.workspaces, o.workspaceId) || {}).path || '')}</option>`).join('')}</select></div>
        ${okr ? `<div class="small muted">${T('约定', 'Agreement')} v${okr.constraints.version} · ${T('预算剩余', 'budget left')} ${U.money(M.budgetLeft(okr.constraints.budget))} · ${T('截止', 'due')} ${U.date(okr.constraints.deadline)}</div>` : ''}
        <div class="col">${CHECKS.map(([k, zh, en]) => `<label class="check"><input type="checkbox" data-f="include-${esc(id)}.${k}" ${checks[k] ? 'checked' : ''}>${esc(T(zh, en))}</label>`).join('')}</div>
        ${issues.length ? issues.map(x => `<div class="row small" style="color:var(--danger)">${icon('x', 'sm')}${esc(T(...(ISS[x] || [x, x])))}</div>`).join('') : `<div class="row small" style="color:var(--ok)">${icon('check', 'sm')}${T('可以提交授权', 'Ready to authorize')}</div>`}
        ${issues.includes('observation_stale') ? U.btn({ action: 'rescan', data: { id }, label: T('重新扫描', 'Scan again'), size: 'sm', icon: 'refresh' }) : ''}
        <div class="note">${icon('info')}<div>${T('确认后切换责任实例、保留已有成果，并暂停自主循环，等待你明确继续。边界或目标变化后需要重新授权。', 'After confirming, the responsible instance switches, results are kept and the loop pauses until you continue. Changes to limits or goals need a new authorization.')}</div></div>
        ${tx ? U.txLine(tx) : ''}`,
      foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'include-do', data: { id }, label: T('签名授权', 'Sign authorization'), kind: 'primary', perm: 'manage_hosts', disabled: issues.length > 0 || !!(tx && tx.state === 'pending'), why: T('请先解决上面的问题', 'Resolve the issues above first') })}`,
    };
  };

  Object.assign(FM.actions, {
    'scan-host': () => {
      const org = O();
      const hostId = U.f('discover.host', ui.dialog.host || '');
      const res = M.scanHost(org, hostId, F.observedSessions(U.root.seededAt), U.now());
      ui.dialog.err = null;
      ui.dialog.scan = null;
      if (!res.ok) {
        ui.dialog.errHost = hostId;
        ui.dialog.err = { offline: T('主机离线：无法扫描，显示未知。恢复连接后重新发现。', 'Host offline: cannot scan; status unknown. Rediscover after it reconnects.'), not_authorized: T('主机没有有效资格，不能扫描。', 'The host has no valid membership; cannot scan.') }[res.code] || res.code;
      } else ui.dialog.scan = { hostId, at: U.now(), sessions: res.sessions };
      if (FM.review && res.ok) FM.review.mark('agent.scanned');
      render();
    },
    'import-session': el => {
      const p = P();
      const org = O();
      const s = ui.dialog.scan.sessions.find(x => x.key === el.dataset.key);
      const res = M.importObserve(p, org, s, U.now());
      if (!res.ok) { toast({ duplicate: T('该实例已导入，不会重复创建。', 'Already imported; nothing is duplicated.'), identity_unverified: T('身份未核实，不能导入。', 'Identity not verified; cannot import.') }[res.code] || res.code, 'warn'); return; }
      U.submitTx({ kind: 'agent.import', payload: { instanceId: res.instance.id } }, {
        ok: T('已导入为仅观察：原进程与任务保持不变。', 'Imported as observe-only: the original process and task are unchanged.'),
        onConfirmed: () => { if (FM.review) FM.review.mark('agent.imported'); },
        onFailed: (r, pp) => { const o = pp.data[r.tx.orgId]; o.instances = o.instances.filter(i => i.id !== res.instance.id); },
      });
    },
    rescan: el => {
      const org = O();
      const inst = U.inst(el.dataset.id);
      const res = M.scanHost(org, inst.hostId, F.observedSessions(U.root.seededAt), U.now());
      if (res.ok && res.sessions.some(s => s.key === inst.sessionKey)) { inst.observedAt = U.now(); U.save(); toast(T('已重新观测到该实例。', 'The instance was observed again.'), 'ok'); }
      else toast(T('再次扫描未发现该实例：状态未知，请重新发现。', 'The instance was not found again: status unknown; rediscover it.'), 'warn');
      render();
    },
    'include-do': el => {
      const id = el.dataset.id;
      const okrId = U.f(`include-${id}.okr`, ui.dialog.okrId || '');
      const checks = Object.fromEntries(['budget', 'deadline', 'tools', 'escalation', 'checkpoint', 'stopped'].map(k => [k, !!U.f(`include-${id}.${k}`, false)]));
      U.submitTx({ kind: 'agent.include', payload: { instanceId: id, okrId, checks } }, {
        ok: T('已纳入 OKR：责任实例已切换，自主循环暂停，等待你明确继续。', 'Added to the OKR: the responsible instance switched and the loop is paused until you continue.'),
        onConfirmed: () => { ui.dialog = null; if (FM.review) FM.review.mark('agent.included'); },
      });
    },
  });

  /* ------------------------------------------------------------ Memory */

  const KIND = { experience: ['经验', 'Lesson', 'info'], decision: ['决策', 'Decision', 'wait'], result: ['成果', 'Result', 'brand'] };

  function sourceLinks(m) {
    const org = O();
    const s = m.source || {};
    const okr = s.okrId ? M.find(org.okrs, s.okrId) : null;
    const parts = [];
    if (okr) parts.push(`<a href="#/okrs/${esc(okr.id)}">${esc(L(okr.title).slice(0, 18))}…</a>`);
    if (okr && s.krId) parts.push(esc(FM.krLabel(okr, s.krId)));
    if (s.runId) parts.push(`<span class="mono">${esc(s.runId)}</span>`);
    if (s.approvalId) parts.push(`<span class="mono">${esc(s.approvalId)}</span>`);
    return parts.join(' · ') || '—';
  }

  function memoryItem(m) {
    const key = `mem-${m.id}`;
    const editing = U.f(`${key}.edit`, false);
    const tx = U.latestTx(t => (t.kind === 'memory.write' || t.kind === 'memory.archive') && t.payload.memoryId === m.id && t.state !== 'confirmed');
    const k = KIND[m.kind] || KIND.experience;
    if (editing) {
      return `<div class="card"><div class="col">
        <div class="field"><label for="${key}-t">${T('标题', 'Title')}</label><input id="${key}-t" class="input" data-f="${key}.title" value="${esc(U.f(`${key}.title`, L(m.title)))}"></div>
        <div class="field"><label for="${key}-b">${T('内容', 'Content')}</label><textarea id="${key}-b" class="textarea" data-f="${key}.body">${esc(U.f(`${key}.body`, L(m.body)))}</textarea></div>
        <div class="tiny muted">${T('保存会写入新版本（加密上链，演示）。你编辑的文字保留原文，不随界面语言变化。', 'Saving writes a new version (encrypted on chain, demo). Your text keeps its original language.')}</div>
        ${tx ? U.txLine(tx) : ''}
        <div class="row end"><button class="btn" data-action="toggle-f" data-key="${key}.edit">${T('取消', 'Cancel')}</button>${U.btn({ action: 'mem-save', data: { id: m.id }, label: T('保存新版本', 'Save new version'), kind: 'primary', perm: 'operate' })}</div></div></div>`;
    }
    return `<div class="card"><div class="row between top"><div class="grow"><div class="row wrap gap-sm"><span class="chip ${k[2]}">${esc(T(k[0], k[1]))}</span><strong>${esc(L(m.title))}</strong></div>
        ${m.body ? `<p class="small mt-8">${esc(L(m.body))}</p>` : ''}
        <div class="tiny muted mt-8">${T('来源', 'Source')}：${sourceLinks(m)} · v${m.version} · ${T('更新于', 'updated')} ${U.agoTag(m.updatedAt)} · ${m.encrypted ? `${icon('lock', 'xs')} ${T('加密上链（演示）', 'Encrypted on chain (demo)')}` : ''}</div>
        ${tx ? `<div class="mt-8">${U.txLine(tx)}</div>` : ''}</div>
      ${m.state === 'active' ? `<div class="row">${U.btn({ action: 'toggle-f', data: { key: `${key}.edit` }, label: T('编辑', 'Edit'), size: 'sm', icon: 'edit', perm: 'operate' })}${U.btn({ action: 'mem-archive', data: { id: m.id }, label: T('归档', 'Archive'), size: 'sm', icon: 'archive', perm: 'operate' })}</div>` : `<span class="chip">${T('已归档', 'Archived')}</span>`}</div></div>`;
  }

  FM.views.memory = () => {
    const org = O();
    const tab = ui.tab.memory || 'memories';
    const active = org.memories.filter(m => m.state === 'active');
    const archived = org.memories.filter(m => m.state === 'archived');
    const results = org.results.map(r => {
      const okr = M.find(org.okrs, r.okrId);
      const ev = r.evidenceIds.map(id => M.find(org.evidence, id)).filter(Boolean);
      return `<div class="card"><div class="row between"><div class="row gap-sm"><span class="chip brand">${icon('flag')}${T('已达成', 'Achieved')}</span><strong>${esc(okr ? L(okr.title) : r.okrId)}</strong></div><span class="small muted">${U.date(r.at)}</span></div>
        <div class="mt-8">${ev.map(e => FM.evidenceRow(e, okr)).join('') || `<span class="small muted">${T('无证据引用', 'No evidence linked')}</span>`}</div>
        <div class="row mt-8"><a class="btn sm" href="#/okrs/${esc(r.okrId)}">${T('查看目标与验收记录', 'View goal and acceptance')}</a></div></div>`;
    }).join('');
    const tabs = [['results', '已验收成果', 'Accepted results', org.results.length], ['memories', '记忆', 'Memories', active.length], ['archived', '已归档', 'Archived', archived.length]];
    const body = tab === 'results' ? (results || `<div class="card"><div class="empty"><h3>${T('还没有已验收的成果', 'No accepted results yet')}</h3></div></div>`)
      : tab === 'archived' ? archived.map(memoryItem).join('') || `<div class="card"><div class="empty"><h3>${T('没有归档的记忆', 'No archived memories')}</h3></div></div>`
        : active.map(memoryItem).join('') || `<div class="card"><div class="empty"><h3>${T('还没有记忆', 'No memories yet')}</h3><p class="small">${T('已验收的成果会生成带来源的记忆。', 'Accepted results create memories with sources.')}</p></div></div>`;
    return `<div class="page-h"><div><h1>${T('记忆与成果', 'Memory & results')}</h1><p class="muted">${T('已验收的成果、决策与经验，均可追溯来源。后续工作可以引用它们。', 'Accepted results, decisions and lessons, each traceable to its source for later work to reuse.')}</p></div>
        <div class="row">${U.btn({ action: 'mem-export', label: T('导出记忆', 'Export memories'), icon: 'download' })}</div></div>
      <div class="tabs" role="tablist">${tabs.map(([k, zh, en, n]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-action="set-tab" data-scope="memory" data-tab="${k}">${esc(T(zh, en))} <span class="muted num">${n}</span></button>`).join('')}</div>
      <div class="col gap-lg">${body}</div>
      <div class="note mt-16">${icon('info')}<div>${T('记忆正文按策略加密后上链；归档或界面移除不承诺擦除不可变的链上历史。', 'Memory content is encrypted on chain by policy; archiving or hiding does not erase immutable chain history.')}</div></div>`;
  };

  Object.assign(FM.actions, {
    'mem-save': el => {
      const key = `mem-${el.dataset.id}`;
      const m = M.find(O().memories, el.dataset.id);
      const title = String(U.f(`${key}.title`, L(m.title))).trim();
      const body = String(U.f(`${key}.body`, L(m.body))).trim();
      if (!title) { toast(T('标题不能为空', 'Title cannot be empty'), 'warn'); return; }
      U.submitTx({ kind: 'memory.write', payload: { memoryId: m.id, patch: { title, body } } }, {
        ok: T('已写入新版本。', 'Saved a new version.'),
        onConfirmed: () => { U.clearForm(key); if (FM.review) FM.review.mark('memory.edited'); },
      });
    },
    'mem-archive': el => {
      U.submitTx({ kind: 'memory.archive', payload: { memoryId: el.dataset.id } }, { ok: T('已归档；链上历史保留。', 'Archived; chain history is kept.') });
    },
    'mem-export': () => {
      const out = M.buildExport(P(), P().currentOrgId, { memories: true }, U.now());
      U.download('fractalmind-memories.json', JSON.stringify(out, null, 2));
      toast(T('已导出记忆（仅当前组织，不含凭据）。', 'Exported memories (this organization only, no credentials).'), 'ok');
    },
  });
})();
