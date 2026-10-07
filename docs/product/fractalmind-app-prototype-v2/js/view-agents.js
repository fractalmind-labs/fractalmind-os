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

  function romChip(rom) {
    if (!rom) return `<span class="chip wait">${T('未记录 ROM', 'No ROM recorded')}</span>`;
    return `<span class="chip outline mono">${esc(rom.id)}@${esc(rom.version)}</span>`;
  }
  const HB_BY = { crontab: ['系统 crontab', 'system crontab'], 'project-script': ['项目脚本', 'project script'], 'codex-app': ['Codex App 定时任务', 'Codex App schedule'], 'agent-manager': ['agent-manager', 'agent-manager'] };
  function heartbeatText(hb) {
    if (!hb) return '—';
    const by = T(...(HB_BY[hb.by] || [hb.by, hb.by]));
    return hb.schedules ? T(`${hb.schedules} 个定时任务 · ${by}`, `${hb.schedules} schedules · ${by}`) : `<span class="mono">${esc(hb.cron)}</span> · ${by}`;
  }

  FM.views.agents = () => {
    const org = O();
    const roles = org.agents.map(a => {
      const insts = org.instances.filter(i => i.agentId === a.id);
      const okrs = org.okrs.filter(o => o.ownerAgentId === a.id && o.lifecycle === 'ACTIVE');
      return `<article class="card"><div class="row between top"><div class="row"><span class="avatar round">${esc(a.name.slice(0, 1))}</span><div><div class="strong">${esc(a.name)}${a.verifier ? ` <span class="chip ok">${T('验证者', 'Verifier')}</span>` : ''}${a.unconstrained ? ` <span class="chip wait">${T('不受约束', 'Unconstrained')}</span>` : ''}</div><div class="small muted">${esc(L(a.role))}</div></div></div><span class="chip outline">${T(`${insts.length} 个实例`, `${insts.length} instances`)}</span></div>
        <dl class="kv mt-12">${a.home ? `<dt>Home</dt><dd class="mono small">${esc(a.home)}</dd>` : ''}${a.home ? `<dt>ROM</dt><dd>${romChip(a.rom)}</dd>` : ''}<dt>${T('运行时', 'Runtime')}</dt><dd>${esc(L(a.runtime))}${a.profileId ? ` <span class="tiny muted mono">${esc(a.launcher === 'codex' && a.profileId !== 'default' ? `--profile ${a.profileId}` : a.profileId)}</span>` : ''}${a.origin === 'app' ? ` <span class="chip outline">${T('App 创建', 'Created by the app')}</span>` : a.origin === 'imported' ? ` <span class="chip outline">${T('从主机导入', 'Imported')}</span>` : ''}</dd><dt>${T('模型', 'Model')}</dt><dd>${esc(L(a.model))}</dd>${a.subAgents ? `<dt>${T('员工 Agent', 'Employees')}</dt><dd>${T(`${a.subAgents} 个（agents/EMP_*），留在主机上由它调度`, `${a.subAgents} (agents/EMP_*), dispatched by it on the host`)}</dd>` : ''}<dt>${T('能力', 'Capabilities')}</dt><dd><div class="row wrap gap-sm">${(a.capabilities || []).map(c => `<span class="chip">${esc(L(c))}</span>`).join('')}</div></dd><dt>${T('负责', 'Owns')}</dt><dd>${okrs.map(o => `<a href="#/okrs/${esc(o.id)}">${o.priority} ${esc(L(o.title))}</a>`).join('<br>') || '—'}</dd></dl>
        <div class="snap mt-12 small">${a.unconstrained ? T('只能对话：执行不受 FractalMind 约束，不能承接 OKR；仅管理设备可发送。', 'Chat only: execution is not constrained by FractalMind and it cannot own OKRs; only management devices can message it.') : FM.standingLine(a)}</div>
        <div class="row wrap mt-12">${U.btn({ action: 'open-direct', data: { agent: a.id }, label: T('对话', 'Chat'), icon: 'message', kind: 'primary', size: 'sm' })}${a.unconstrained ? '' : U.btn({ action: 'open', data: { dialog: 'standing', agent: a.id }, label: T('常驻权限', 'Standing permission'), icon: 'shield', size: 'sm' })}${(org.direct[a.id] || { messages: [] }).messages.length ? `<span class="tiny muted">${T(`${org.direct[a.id].messages.length} 条对话`, `${org.direct[a.id].messages.length} messages`)}</span>` : ''}</div></article>`;
    }).join('');
    const rows = org.instances.map(i => {
      const h = U.host(i.hostId);
      const okrs = org.okrs.filter(o => o.instanceId === i.id && o.lifecycle === 'ACTIVE');
      const canInclude = i.imported === 'observe' && M.constrainable(i) && i.status !== 'importing';
      return `<tr><td><div class="strong">${esc(i.name)}</div><div class="tiny muted mono">${esc(i.sessionKey || '')}</div></td><td>${esc(U.agent(i.agentId).name || T('未分配', 'Unassigned'))}</td>
        <td><a href="#/hosts/${esc(i.hostId)}">${esc(h ? h.name : '—')}</a></td><td class="small">${esc(i.runtime)}</td>
        <td><span class="chip ${M.constrainable(i) ? 'outline' : 'wait'}">${i.adapter === 'tmux-observe' ? T('仅观察', 'Observe only') : i.adapter === 'unconstrained' ? T('不受约束', 'Unconstrained') : T('可控', 'Controllable')}</span></td>
        <td>${instState(i)}</td><td class="small">${okrs.map(o => `${o.priority} ${esc(L(o.title).slice(0, 12))}…`).join('<br>') || '—'}</td>
        <td class="small">${i.imported === 'observe' ? T('导入 · 仅观察', 'Imported · observe') : i.imported === 'managed' ? T('导入 · 已纳入', 'Imported · managed') : i.origin === 'app' ? T('App 创建', 'Created by the app') : T('App 部署', 'Deployed by app')}${i.status === 'creating' ? (tx => (tx ? `<div class="mt-4">${U.txLine(tx)}</div>` : ''))(U.latestTx(t => t.kind === 'agent.create' && t.payload.instanceId === i.id)) : ''}${canInclude ? `<div class="mt-4">${U.btn({ action: 'open', data: { dialog: 'include', id: i.id }, label: T('纳入 OKR', 'Add to OKR'), size: 'sm', perm: 'manage_hosts' })}</div>` : ''}</td></tr>`;
    }).join('');
    return `<div class="page-h"><div><h1>${T('团队与 Agents', 'Team & Agents')}</h1><p class="muted">${T('Agent 角色、运行实例与所在主机。同一角色可以部署在多台主机；命令与授权绑定具体实例。', 'Agent roles, running instances and their hosts. One role can run on several hosts; commands and grants bind a specific instance.')} ${T('可以直接和任一 Agent 对话；没有 OKR 时它按常驻权限行事。', 'You can chat with any Agent directly; without an OKR it acts within its standing permission.')}</p></div>
        <div class="row">${U.btn({ action: 'open', data: { dialog: 'discover' }, label: T('从主机导入 Agent', 'Import from a host'), icon: 'scan' })}${U.btn({ action: 'open', data: { dialog: 'agent-create' }, label: T('新建 Agent', 'New Agent'), icon: 'plus', kind: 'primary', perm: 'manage_hosts' })}</div></div>
      <div class="grid-2">${roles}</div>
      <section class="sec"><div class="sec-h"><h2>${T('运行实例', 'Instances')}</h2><span class="small muted">${org.instances.length}</span></div>
        <div class="card flush" style="overflow-x:auto"><table class="table"><thead><tr><th>${T('实例', 'Instance')}</th><th>${T('角色', 'Role')}</th><th>${T('主机', 'Host')}</th><th>${T('运行时', 'Runtime')}</th><th>${T('适配器', 'Adapter')}</th><th>${T('状态', 'Status')}</th><th>OKR</th><th>${T('来源', 'Source')}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <section class="sec"><div class="card soft"><div class="row top gap-lg"><span class="avatar" style="background:var(--surface-3);color:var(--text-3)">${icon('users')}</span><div class="grow"><div class="row wrap"><strong>${T('团队协作', 'Team delivery')}</strong><span class="chip wait">P3</span></div>
        <p class="small muted mt-4">${T('由 Lead 拆分任务、成员提交子成果、验收者逐项验证后汇总；失败的子任务不会被隐藏为总体成功。该阶段开放前不显示可用操作。', 'A Lead splits work, members submit, verifiers check each piece before it rolls up; failed subtasks are never hidden as overall success. No actions until this stage ships.')}</p></div></div></div></section>`;
  };

  /* ------------------------------------------------ Discovery (J11) */

  FM.dialogs.discover = st => {
    const org = O();
    // Opened for a specific host (setup, New Agent): start there.
    if (st.host && !st.hostApplied) { st.hostApplied = true; U.setF('discover.host', st.host); }
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
          <div class="tiny muted mt-4">${esc(s.runtime)} · <span class="mono">${esc(s.workspace)}</span> · ${T('启动于', 'started')} ${U.agoTag(s.startedAt)}</div><div class="small mt-4">${esc(L(s.task))}</div>
          ${s.agentFile ? `<dl class="kv mt-8 small"><dt>${T('定义', 'Definition')}</dt><dd><span class="mono">${esc(s.workspace)}/AGENTS.md</span> · ${T('名称', 'name')} <strong>${esc(s.agentFile.namespace || s.agentFile.name)}</strong></dd>
            <dt>${T('启动', 'Launch')}</dt><dd class="mono">${esc(s.agentFile.launcher)}${s.agentFile.profile && s.agentFile.profile !== 'default' ? ` --profile ${esc(s.agentFile.profile)}` : ''}</dd><dt>${T('模型', 'Model')}</dt><dd>${esc(L(s.agentFile.model))} <span class="tiny muted">${T('由启动配置决定', 'from the launch profile')}</span></dd>
            <dt>${T('心跳', 'Heartbeat')}</dt><dd>${heartbeatText(s.agentFile.heartbeat)}</dd><dt>ROM</dt><dd>${romChip(s.agentFile.rom)}</dd>
            <dt>${T('技能', 'Skills')}</dt><dd>${s.agentFile.skills}${s.agentFile.subAgents ? ` · ${T(`${s.agentFile.subAgents} 个员工 Agent（不随之导入）`, `${s.agentFile.subAgents} employee Agents (not imported with it)`)}` : ''}</dd></dl>` : ''}</div><div class="col" style="align-items:flex-end">${action}</div></div></div>`;
      }).join('')}` : `<div class="note">${icon('info')}<div>${T('这台主机上没有发现会话。', 'No sessions found on this host.')}</div></div>`;
    }
    return {
      title: T('导入主机上已运行的 Agent', 'Import Agents running on a host'), size: 'lg',
      sub: T('按 tmux 会话发现，读取各自 Home 里的 AGENTS.md：名称、启动方式、心跳与 ROM。发现快照是观测；导入关系、OKR 绑定与授权是链上状态。', 'Found by tmux session, read from each Home’s AGENTS.md: name, launch, heartbeat and ROM. Snapshots are observations; imports, OKR bindings and grants are chain state.'),
      body: `<div class="col">${hosts}</div>${U.btn({ action: 'scan-host', label: T('扫描', 'Scan'), icon: 'scan', disabled: !hostId, why: T('选择一台主机', 'Choose a host') })}${result}
        <div class="note">${icon('info')}<div>${T('默认“导入为仅观察”：保留原进程、Home、定时任务与员工 Agent，不重新启动、不改写文件。同名不同主机不合并，同一实例不能重复导入。可以直接对话；纳入 OKR 需要能接受约束的适配器。', 'Default is “observe only”: the process, Home, schedules and employee Agents stay as they are; nothing is restarted or rewritten. Same names on different hosts are not merged; one instance imports once. You can chat with it; joining an OKR needs an adapter that accepts constraints.')}</div></div>`,
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

  /* ---------------------------------------------- New Agent (#67) */

  const CREATE_ISSUES = {
    name: ['名称用小写字母、数字和连字符，2–31 位，字母开头', 'Use 2–31 lowercase letters, digits or hyphens, starting with a letter'],
    name_taken: ['已有同名 Agent', 'An Agent already has this name'],
    home: ['选择 Home 目录', 'Choose a Home directory'],
    home_is_agent: ['这是已有 Agent 的 Home：请用“从主机导入”', 'This is an existing Agent’s Home: import it instead'],
    home_not_empty: ['目录不为空：请选择空目录或新建目录', 'The folder is not empty: choose an empty or new folder'],
    home_taken: ['这个 Home 已被另一个 Agent 使用', 'Another Agent already uses this Home'],
    rom: ['选择一个 ROM', 'Choose a ROM'],
    skills: ['可选技能不属于这个 ROM', 'The optional skills are not part of this ROM'],
    host_not_local: ['只能在本 App 管理的主机上创建；远程主机需在该主机上运行 FractalMind App', 'Only on a host this App manages; for a remote host, run the FractalMind App on it'],
    service_stopped: ['本机服务已停止，先启动服务', 'This computer’s service is stopped; start it first'],
    launcher: ['选择启动方式', 'Choose how to launch it'],
  };
  const HOME_STATE = {
    new: ['ok', '将新建目录', 'Will be created'], empty: ['ok', '空目录', 'Empty folder'],
    not_empty: ['danger', '不为空', 'Not empty'], agent_home: ['wait', '已有 Agent 的 Home', 'An Agent’s Home'], invalid: ['danger', '路径无效', 'Invalid path'],
  };
  const COMPAT = { 'fully-compatible': ['ok', '完全兼容', 'Fully compatible'], 'draft-compatible': ['wait', '草案兼容', 'Draft compatible'] };

  function createInput(st) {
    const p = P();
    const svc = M.localServiceFor(p);
    const host = U.host(svc.hostId) || {};
    const launcher = U.f('agentnew.launcher', ((host.launchers || [])[0] || {}).id || '');
    const l = (host.launchers || []).find(x => x.id === launcher) || { profiles: [] };
    const name = String(U.f('agentnew.name', '')).trim();
    return {
      name, hostId: svc.hostId,
      home: String(U.f('agentnew.home', name ? `~/agents/${name}` : '')).trim(),
      romId: U.f('agentnew.rom', ''),
      optionalSkills: M.ROMS.find(r => r.id === U.f('agentnew.rom', '')) ? M.ROMS.find(r => r.id === U.f('agentnew.rom', '')).optional.filter(k => U.f(`agentnew.skill_${k}`, false)) : [],
      launcher, profileId: U.f('agentnew.profile', (l.profiles[0] || {}).id || ''),
    };
  }

  FM.dialogs['agent-create'] = st => {
    const p = P();
    const org = O();
    const svc = M.localServiceFor(p);
    const host = U.host(svc.hostId);
    const created = st.createdId && U.inst(st.createdId);
    if (created) {
      const a = U.agent(created.agentId);
      const confirmed = created.status !== 'creating';
      const tx = U.latestTx(t => t.kind === 'agent.create' && t.payload.instanceId === created.id);
      const rom = M.ROMS.find(r => r.id === a.rom.id);
      const steps = [
        ['写入 ROM 文件', 'Write the ROM files', `${rom.files.length}`],
        ['安装技能到 .agents/skills', 'Install skills into .agents/skills', `${a.skills.length}`],
        ['写入 AGENTS.md（名称、启动方式、心跳、ROM）', 'Write AGENTS.md (name, launch, heartbeat, ROM)', ''],
        ['链上登记 Agent（本设备签名）', 'Register the Agent on chain (signed by this device)', ''],
        ['启动 tmux 会话并安装心跳', 'Start the tmux session and the heartbeat', `${a.namespace}--main`],
      ];
      return {
        title: T('新建 Agent', 'New Agent'), size: 'sm', sticky: !confirmed,
        body: `<div class="col">${steps.map(([zh, en, x], i) => `<div class="row"><span class="st ${confirmed || i < 3 ? 'ok' : 'info'}">${icon(confirmed || i < 3 ? 'check' : 'refresh', confirmed || i < 3 ? '' : 'spin')}</span><span>${esc(T(zh, en))}${x ? ` <span class="tiny muted mono">${esc(x)}</span>` : ''}</span></div>`).join('')}</div>
          ${confirmed ? `<div class="calm">${icon('check')}<span>${T(`${a.name} 已在这台电脑上运行，Home ${a.home}。`, `${a.name} is running on this computer, Home ${a.home}.`)}</span></div>` : tx ? U.txLine(tx) : ''}`,
        foot: confirmed ? `<button class="btn" data-action="close-dialog">${T('完成', 'Done')}</button>${U.btn({ action: 'go', data: { to: 'okrs/new' }, label: T('创建第一个 OKR', 'Create the first OKR'), kind: 'primary', icon: 'plus' })}` : '',
      };
    }
    const input = createInput(st);
    const issues = M.createAgentIssues(p, org, input);
    const shown = issues.filter(x => !((x === 'name' && !input.name) || (x === 'home' && !input.home) || (x === 'rom' && !input.romId)));
    const rom = M.ROMS.find(r => r.id === input.romId);
    const hs = host ? M.homeState(host, input.home) : 'invalid';
    const hsChip = input.home ? (x => `<span class="chip ${x[0]}">${esc(T(x[1], x[2]))}</span>`)(HOME_STATE[hs] || HOME_STATE.invalid) : '';
    const launchers = (host && host.launchers) || [];
    const l = launchers.find(x => x.id === input.launcher) || { profiles: [] };
    const prof = l.profiles.find(x => x.id === input.profileId);
    const pending = U.latestTx(t => t.kind === 'agent.create' && t.state === 'pending');
    return {
      title: st.setup === '1' ? T('新建你的第一个 Agent', 'Create your first Agent') : T('新建 Agent', 'New Agent'), size: 'lg',
      sub: T('Agent 就是一个 Home 目录：ROM 写入 Agent OS 文件与技能，AGENTS.md 记录名称与启动方式，agent-manager 在 tmux 中运行它。', 'An Agent is a Home directory: the ROM writes the Agent OS files and skills, AGENTS.md records its name and launch, and agent-manager runs it in tmux.'),
      body: `${!host ? `<div class="note warn">${icon('alert')}<div>${T('先把这台电脑设为执行主机。', 'Set up this computer as an execution host first.')}</div></div>` : ''}
        <div class="field"><label for="an-name">${T('名称', 'Name')} <span class="tiny muted">${T('必填', 'required')}</span></label><input id="an-name" class="input mono" maxlength="31" data-f="agentnew.name" value="${esc(input.name)}" placeholder="writer">
          <div class="tiny muted">${input.name ? T(`tmux 会话 ${input.name}--main · AGENTS.md 中 namespace: ${input.name}`, `tmux session ${input.name}--main · namespace: ${input.name} in AGENTS.md`) : T('小写字母、数字和连字符；用作 namespace 与 tmux 会话名', 'Lowercase letters, digits and hyphens; used as the namespace and tmux session name')}</div></div>
        <div class="field"><label for="an-home">Home ${T('目录', 'directory')} <span class="tiny muted">${T('必填', 'required')}</span></label><div class="row"><input id="an-home" class="input mono grow" data-f="agentnew.home" value="${esc(input.home)}" placeholder="~/agents/writer">${hsChip}</div>
          <div class="tiny muted">${T('空目录或新目录。已有 Agent 的 Home 请用“从主机导入”。原型只模拟目录检查，不读取真实文件系统。', 'An empty or new folder. For an existing Agent’s Home, import it instead. The prototype simulates the check and never reads your file system.')}</div></div>
        <div class="field"><label>ROM <span class="tiny muted">${T('必填 · 来自 roms/agent-os-roms', 'required · from roms/agent-os-roms')}</span></label><div class="col">${M.ROMS.map(r => `<button class="opt" data-action="set-f" data-key="agentnew.rom" data-value="${esc(r.id)}" aria-pressed="${input.romId === r.id}"><span class="ico">${icon('layers')}</span><span class="grow"><span class="row wrap gap-sm"><span class="strong mono">${esc(r.id)}</span><span class="tiny muted">${esc(r.family)} · v${esc(r.version)}</span><span class="chip ${COMPAT[r.compat][0]}">${esc(T(COMPAT[r.compat][1], COMPAT[r.compat][2]))}</span></span><span class="small muted" style="display:block">${esc(L(r.desc))}</span></span></button>`).join('')}</div></div>
        ${rom ? `<div class="card soft tight"><div class="label">${T('将写入 Home', 'Will write to Home')}</div><div class="row wrap gap-sm mt-4">${rom.files.map(f => `<code class="chip outline">${esc(f)}</code>`).join('')}</div>
          <div class="label mt-8">${T('必装技能', 'Required skills')}</div><div class="small">${rom.included.length ? rom.included.map(k => `<code>${esc(k)}</code>`).join(' ') : T('无', 'None')}</div>
          ${rom.optional.length ? `<div class="label mt-8">${T('可选技能', 'Optional skills')}</div><div class="row wrap">${rom.optional.map(k => `<label class="check"><input type="checkbox" data-f="agentnew.skill_${esc(k)}" ${U.f(`agentnew.skill_${k}`, false) ? 'checked' : ''}><code>${esc(k)}</code></label>`).join('')}</div>` : ''}
          ${rom.compat === 'draft-compatible' ? `<div class="note warn mt-8">${icon('alert')}<div>${T('草案兼容：部分文件或技能可能需要你手动补齐。', 'Draft compatible: some files or skills may need manual completion.')}</div></div>` : ''}</div>` : ''}
        <div class="field"><label>${T('启动方式', 'Launch')} <span class="tiny muted">${T('决定模型', 'decides the model')}</span></label><div class="row wrap">
          <select class="select" data-f="agentnew.launcher" aria-label="${esc(T('启动器', 'Launcher'))}">${launchers.map(x => `<option value="${esc(x.id)}" ${x.id === input.launcher ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          <select class="select" data-f="agentnew.profile" aria-label="Profile">${l.profiles.map(x => `<option value="${esc(x.id)}" ${x.id === input.profileId ? 'selected' : ''}>${esc(x.id)} · ${esc(L(x.model))}</option>`).join('')}</select></div>
          <div class="tiny muted">${T('这台电脑上已安装的启动器与配置；模型、账号与密钥由启动器自己的配置管理，App 不读取。', 'Launchers and profiles installed on this computer; models, accounts and keys stay in each launcher’s own configuration and the App does not read them.')}${prof ? ` ${T('模型', 'Model')}：${esc(L(prof.model))}` : ''}</div></div>
        ${rom && input.name && input.home ? `<details><summary class="small">${T('预览 AGENTS.md 头部', 'Preview the AGENTS.md header')}</summary><pre class="mono small">${esc(M.agentFrontmatter(input))}</pre></details>` : ''}
        <dl class="kv"><dt>${T('主机', 'Host')}</dt><dd>${esc(host ? host.name : '—')} <span class="chip brand">${T('这台电脑', 'This computer')}</span></dd><dt>${T('常驻权限', 'Standing permission')}</dt><dd>${T('默认无：没有 OKR 时只对话；之后可调整', 'None by default: it only chats without an OKR; adjust later')}</dd><dt>${T('费用', 'Fee')}</dt><dd>${T('本设备签一笔交易，预计', 'This device signs one transaction, est.')} <strong>${U.sui(M.FEES['agent.create'])}</strong></dd></dl>
        ${shown.map(x => `<div class="row small" style="color:var(--danger)">${icon('x', 'sm')}${esc(T(...(CREATE_ISSUES[x] || [x, x])))}</div>`).join('')}
        <div class="small">${T('已有正在运行的 Agent？', 'Already running an Agent?')} <a href="#" data-action="open" data-dialog="discover" data-host="${esc(svc.hostId || '')}">${T('改为从这台电脑导入', 'Import it from this computer instead')}</a></div>
        ${pending ? U.txLine(pending) : ''}`,
      foot: `<button class="btn" data-action="close-dialog">${st.setup === '1' ? T('稍后', 'Later') : T('取消', 'Cancel')}</button>${U.btn({ action: 'agent-create-do', label: T('确认并创建', 'Confirm and create'), kind: 'primary', perm: 'manage_hosts', disabled: issues.length > 0 || !!pending, why: T('填写名称、Home 目录并选择 ROM', 'Enter a name and Home, and choose a ROM') })}`,
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
        onConfirmed: (r, pp) => { if (pp.onboarding) pp.onboarding.agent = true; if (FM.review) FM.review.mark('agent.imported'); },
        onFailed: (r, pp) => {
          const o = pp.data[r.tx.orgId];
          o.instances = o.instances.filter(i => i.id !== res.instance.id);
          if (s.agentFile && !s.agentId) o.agents = o.agents.filter(a => a.id !== res.instance.agentId);
        },
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
    'agent-create-do': () => {
      const p = P();
      const org = O();
      const input = createInput(ui.dialog);
      const res = M.createAgent(p, org, input, U.now());
      if (!res.ok) { toast(T(...(CREATE_ISSUES[res.code] || [res.code, res.code])), 'warn'); return; }
      ui.dialog.createdId = res.instance.id;
      U.save();
      const tx = U.submitTx({ kind: 'agent.create', payload: { instanceId: res.instance.id } }, {
        onConfirmed: (r, pp) => {
          if (pp.onboarding) pp.onboarding.agent = true;
          U.clearForm('agentnew');
          if (FM.review) FM.review.mark('agent.created');
        },
        onFailed: (r, pp) => { M.dropCreatedAgent(pp.data[r.tx.orgId], res.instance.id); if (ui.dialog) ui.dialog.createdId = null; },
      });
      if (!tx) { M.dropCreatedAgent(org, res.instance.id); ui.dialog.createdId = null; U.save(); render(); }
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
