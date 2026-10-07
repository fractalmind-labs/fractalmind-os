/* FractalMind App prototype v2 — governance & approvals, settings, my
 * organizations (fractal growth path) and the open network directory. */
(function () {
  'use strict';
  const FM = window.FM;
  const U = FM.ui;
  const { M, T, L, esc, icon, P, O, can, ui, render, toast, DAY, HOUR, MIN } = U;

  /* ---------------------------------------------------------- Governance */

  const KIND_T = { boundary: ['越界请求', 'Out-of-bounds'], acceptance: ['KR 验收', 'KR acceptance'], okr_acceptance: ['最终验收', 'Final acceptance'], standing: ['超出常驻权限', 'Beyond standing'] };

  function permissions() {
    const p = P();
    const cols = ['read', 'operate', 'approve', 'manage_hosts'];
    const head = [T('组织 / 角色', 'Organization / role'), T('读取', 'Read'), T('执行', 'Operate'), T('审批', 'Approve'), T('管理主机', 'Manage hosts')];
    const rows = p.orgs.map(o => `<div><span class="avatar sm ${o.kind === 'team' ? 'team' : ''}">${U.orgInitial(o)}</span><span class="grow"><span class="strong">${esc(L(o.name))}</span><span class="tiny muted" style="display:block">${o.role === 'admin' ? T('管理员', 'Admin') : T('成员', 'Member')}</span></span></div>${cols.map(a => {
      const r = M.can(p, p.currentDeviceId, o.id, a, U.now());
      return `<div title="${esc(r.ok ? '' : U.permText(r.code))}" style="color:${r.ok ? 'var(--ok)' : 'var(--text-4)'}">${icon(r.ok ? 'check' : 'x', 'sm')}<span class="tiny">${r.ok ? '' : esc(U.permText(r.code).slice(0, 14))}</span></div>`;
    }).join('')}`).join('');
    const mi = M.can(p, p.currentDeviceId, p.currentOrgId, 'manage_identity', U.now());
    return `<section class="card"><div class="card-h"><h2>${T('本设备的权限', "This device's permissions")}</h2><span class="small muted">${esc(U.me().name)}</span></div>
      <div class="perm-grid">${head.map(h => `<div class="h">${esc(h)}</div>`).join('')}${rows}</div>
      <div class="row small mt-12">${icon(mi.ok ? 'check' : 'x', 'sm')}<span>${T('身份管理（添加/撤销设备、恢复）', 'Identity management (add/revoke devices, recovery)')}：${mi.ok ? T('允许', 'Allowed') : esc(U.permText(mi.code))}</span></div>
      <div class="note mt-12">${icon('info')}<div>${T('可用操作 = 组织角色 × 设备授权 × 数据访问。切换组织不授予或撤销权限；聊天中的“同意”不构成审批。', 'Available actions = organization role × device grant × data access. Switching organizations grants nothing; “OK” in chat is not an approval.')}</div></div></section>`;
  }

  const DEC_T = {
    agreement: d => T(`确认执行约定 v${d.version}`, `Confirmed agreement v${d.version}`),
    invite_consumed: d => T(`主机邀请已兑换：${(U.host(d.hostId) || {}).name || ''}`, `Host invitation redeemed: ${(U.host(d.hostId) || {}).name || ''}`),
    device_revoked: d => T(`撤销设备：${d.device}`, `Revoked device: ${d.device}`),
    approval: d => { const a = M.find(O().approvals, d.approvalId); return T(`审批：${a ? L(a.action) : ''}`, `Approval: ${a ? L(a.action) : ''}`); },
    org_created: () => T('创建个人组织', 'Created the personal organization'),
    joined: () => T('加入组织（成员资格对象确认）', 'Joined (membership object confirmed)'),
  };

  FM.views.governance = () => {
    const org = O();
    const p = P();
    const tab = ui.tab.gov || 'pending';
    const pending = U.decisions(org);
    const history = org.approvals.filter(a => M.approvalStatus(a, U.now()) !== 'pending');
    const tabs = [['pending', '待处理', 'Pending', pending.length], ['history', '审批历史', 'History', history.length], ['perm', '权限', 'Permissions', null], ['records', '决策记录', 'Records', null]];
    let body = '';
    if (tab === 'pending') body = pending.length ? `<div class="decisions">${pending.map(FM.decisionCard).join('')}</div>` : `<div class="calm">${icon('check')}<span>${T('没有待处理的审批。', 'No pending approvals.')}</span></div>`;
    if (tab === 'history') {
      body = `<div class="card flush" style="overflow-x:auto"><table class="table"><thead><tr><th>${T('类型', 'Type')}</th><th>${T('内容', 'What')}</th><th>OKR</th><th>${T('结果', 'Outcome')}</th><th>${T('执行', 'Execution')}</th><th>${T('时间', 'When')}</th></tr></thead><tbody>
        ${history.map(a => {
          const okr = M.find(org.okrs, a.okrId);
          const exec = a.kind !== 'boundary' && a.kind !== 'standing' ? '—' : a.execution ? `<span class="st ok">${icon('play')}${T('已执行', 'Executed')}</span>` : a.state === 'approved' ? `<span class="st warn">${icon('clock')}${T('获准，未执行', 'Approved, not run')}</span>` : a.superseded ? T('已替代', 'Superseded') : T('未执行', 'Not run');
          return `<tr><td class="small">${esc(T(...(KIND_T[a.kind] || [a.kind, a.kind])))}</td><td>${esc(a.kind === 'standing' ? `${U.agent(a.agentId).name} · ${FM.directActionLabel(a.action)}` : L(a.action || (okr && a.krId ? M.find(okr.krs, a.krId).title : okr ? okr.title : '')))}</td><td class="small">${okr ? `${okr.priority} · ${esc(FM.krLabel(okr, a.krId) || '')}` : '—'}</td><td>${U.apvState(a)}</td><td class="small">${exec}</td><td class="small muted">${U.dateTime(a.decidedAt || a.invalidatedAt || a.expiresAt)}</td></tr>`;
        }).join('')}</tbody></table></div>`;
    }
    if (tab === 'perm') body = permissions();
    if (tab === 'records') {
      const recs = org.decisions.map(d => ({ at: d.at, text: (DEC_T[d.kind] || (() => d.kind))(d), tx: null }))
        .concat(p.txs.filter(t => t.orgId === p.currentOrgId && t.state === 'confirmed').map(t => ({ at: t.settledAt, text: U.txLabel(t.kind), tx: t.id })))
        .sort((a, b) => b.at - a.at);
      body = `<section class="card"><div class="feed">${recs.map(r => `<div class="ev"><span class="e-ico">${icon('file')}</span><div class="grow"><div class="e-t">${esc(r.text)}</div><div class="e-s">${U.dateTime(r.at)}${r.tx ? `<span class="mono">${esc(U.shortId(r.tx, 4))}</span>` : ''}<span class="demo-tag">${T('演示链记录', 'Demo chain record')}</span></div></div></div>`).join('')}</div></section>`;
    }
    return `<div class="page-h"><div><h1>${T('治理与审批', 'Governance & approvals')}</h1><p class="muted">${T('当前权限、授权设备与可核查的决策记录。', 'Current authority, authorized devices and verifiable decision records.')}</p></div></div>
      <div class="tabs" role="tablist">${tabs.map(([k, zh, en, n]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-action="set-tab" data-scope="gov" data-tab="${k}">${esc(T(zh, en))}${n ? ` <span class="count ${k === 'pending' ? '' : 'soft'}">${n}</span>` : ''}</button>`).join('')}</div>
      ${body}
      <section class="sec"><div class="card soft"><div class="row top gap-lg"><span class="avatar" style="background:var(--surface-3);color:var(--text-3)">${icon('users')}</span><div><div class="row wrap"><strong>${T('组织提案与角色委派', 'Proposals and role delegation')}</strong><span class="chip wait">P3</span></div><p class="small muted mt-4">${T('人员加入、角色委派与提案流程在 P3 交付；在此之前不显示可用操作，Agent 自助注册也不等于管理员批准的成员关系。', 'People, delegation and proposals ship in P3; until then no actions are shown, and Agent self-registration is never admin-approved membership.')}</p></div></div></div></section>`;
  };

  /* ------------------------------------------------------------ Settings */

  const SECTIONS = [
    ['general', 'sliders', '语言与外观', 'Language & appearance'], ['workspaces', 'folder', '工作区', 'Workspaces'],
    ['runtime', 'cpu', '模型与运行时', 'Models & runtime'], ['connections', 'link', '连接', 'Connections'],
    ['fees', 'wallet', '运行费', 'Run fees'], ['data', 'box', '导出与数据', 'Export & data'],
    ['diagnostics', 'pulse', '诊断', 'Diagnostics'], ['about', 'info', '关于与更新', 'About & updates'],
  ];

  function general() {
    const pr = U.prefs;
    const notif = k => U.f(`notify.${k}`, true);
    return `<section class="card"><div class="card-h"><h2>${T('语言与外观', 'Language & appearance')}</h2></div>
      <div class="form-grid"><div class="field"><span class="label">${T('界面语言', 'Language')}</span><div class="seg"><button data-action="set-locale" data-v="zh-CN" aria-pressed="${pr.locale !== 'en'}">简体中文</button><button data-action="set-locale" data-v="en" aria-pressed="${pr.locale === 'en'}">English</button></div>
        <span class="hint">${T('你编写的目标、约定与命令输出保留原文；导出保留源记录。', 'Your goals, agreements and command output keep their original language; exports keep source records.')}</span></div>
      <div class="field"><span class="label">${T('外观', 'Appearance')}</span><div class="seg"><button data-action="set-theme" data-v="light" aria-pressed="${pr.theme === 'light'}">${icon('sun', 'sm')}${T('浅色', 'Light')}</button><button data-action="set-theme" data-v="dark" aria-pressed="${pr.theme === 'dark'}">${icon('moon', 'sm')}${T('深色', 'Dark')}</button><button data-action="set-theme" data-v="system" aria-pressed="${pr.theme === 'system'}">${icon('monitor', 'sm')}${T('跟随系统', 'System')}</button></div>
        <span class="hint">${T('默认跟随系统并即时更新；遵守“减少动态效果”。切换不会影响页面、草稿或执行记录。', 'Follows the system by default and updates live; honors reduced motion. Switching keeps pages, drafts and records.')}</span></div></div></section>
      <section class="card mt-16"><div class="card-h"><h2>${T('通知', 'Notifications')}</h2></div>
        ${[['progress', '进展与完成', 'Progress and completion'], ['blocked', '阻塞与失联', 'Blockers and disconnects'], ['boundary', '越界请求', 'Out-of-bounds requests'], ['verify', '需要验证或验收的决定', 'Verification and acceptance decisions']].map(([k, zh, en]) => `<label class="row between item" style="cursor:pointer"><span>${esc(T(zh, en))}</span><span class="switch"><input type="checkbox" data-f="notify.${k}" ${notif(k) ? 'checked' : ''} aria-label="${esc(T(zh, en))}"><i></i></span></label>`).join('')}
        <div class="tiny muted mt-8">${T('heartbeat 只在进展、阻塞或需要你决定时通知；重复或迟到的通知不会重复操作。关闭通知后，工作台待办仍可见。', 'Heartbeats notify only on progress, blockers or decisions; duplicate or late pushes never repeat actions. With notifications off, workbench to-dos remain.')}</div></section>`;
  }

  function workspaces() {
    const org = O();
    return `<section class="card"><div class="card-h"><h2>${T('工作区', 'Workspaces')}</h2>${U.btn({ action: 'open', data: { dialog: 'workspace' }, label: T('导入项目目录', 'Import a project'), icon: 'plus', size: 'sm', perm: 'operate' })}</div>
      ${org.workspaces.map(w => `<div class="item top"><span class="host-ico">${icon('folder')}</span><div class="grow"><div class="strong">${esc(w.name)}</div><div class="mono small muted">${esc(w.path)}</div><div class="tiny muted mt-4">${T('主机', 'Hosts')}：${w.hostIds.map(id => esc((U.host(id) || {}).name || id)).join('、')} · ${T('读写', 'read/write')} · ${(w.files || []).map(f => `<code>${esc(f)}</code>`).join(' ')}</div></div></div>`).join('') || `<div class="muted small">${T('还没有工作区', 'No workspaces yet')}</div>`}
      <div class="note mt-12">${icon('info')}<div>${T('Workspace 指向实际项目目录，不是另一种组织。现有 Agent OS 文件（OKR.md、memory/ 等）是链上记录的投影，编辑需版本校验。', 'A workspace points to a real project folder; it is not another kind of organization. Agent OS files (OKR.md, memory/…) project chain records and are version-checked on edit.')}</div></div></section>`;
  }

  /** Launchers installed on this computer (#67). A launcher's own profile
   * decides the model; the App never reads its accounts or keys. */
  function runtime() {
    const svc = M.localServiceFor(P());
    const host = U.host(svc.hostId);
    const launchers = (host && host.launchers) || [];
    return `<section class="card"><div class="card-h"><h2>${T('Agent 启动器', 'Agent launchers')}</h2><span class="chip ${launchers.length ? 'ok' : 'warn'}">${launchers.length ? T('这台电脑', 'This computer') : T('还不是执行主机', 'Not a host yet')}</span></div>
      ${launchers.length ? `<dl class="kv">${launchers.map(l => `<dt>${esc(l.name)}</dt><dd>${l.profiles.map(pr => `<span class="mono">${esc(pr.id)}</span> · ${esc(L(pr.model))}`).join('<br>')}</dd>`).join('')}</dl>` : `<div class="small muted">${T('把这台电脑设为执行主机后，这里列出已安装的启动器（Codex CLI、Claude Code 等）及其配置。', 'After this computer becomes an execution host, its launchers (Codex CLI, Claude Code…) and profiles appear here.')}</div>`}
      <div class="tiny muted mt-8">${T('Agent 的 AGENTS.md 选择启动器与配置；模型、账号与密钥由启动器自己管理，模型费用由服务商计费，与链上运行费分开。', 'Each Agent’s AGENTS.md picks a launcher and profile; models, accounts and keys stay with the launcher, and model usage is billed by the provider, separately from chain fees.')}</div></section>`;
  }

  function connections() {
    return `${FM.dialogs.bindings().body.replace(/class="list"/, 'class="list card"')}<div class="row mt-12">${U.btn({ action: 'invite-stage', data: { stage: 'binding', dialog: 'invite' }, label: T('新增连接入口', 'Add endpoint'), icon: 'plus', perm: 'manage_hosts' })}</div>${FM.channelsCard()}`;
  }

  function fees() {
    const p = P();
    const w = p.wallet;
    const rows = Object.keys(M.FEES).filter(k => U.txLabel(k) !== k).map(k => `<div class="run-row"><span class="grow">${esc(U.txLabel(k))}</span><span class="num muted">${U.sui(M.feeFor(k))}</span></div>`).join('');
    return `<div class="grid-2"><section class="card"><div class="card-h"><h2>${T('运行费账户', 'Run-fee account')}</h2><span class="demo-tag">${T('测试网 · 演示', 'Testnet · demo')}</span></div>
        <div class="kpi"><span class="kpi-v">${U.sui(w.balance)}</span><span class="kpi-l">${T('余额', 'Balance')}</span></div>
        <div class="field mt-12"><span class="label">${T('支付来源', 'Paid by')}</span><div class="seg"><button data-action="fee-source" data-v="self" aria-pressed="${w.source === 'self'}">${T('自付', 'Myself')}</button><button data-action="fee-source" data-v="sponsor" aria-pressed="${w.source === 'sponsor'}">${T('已有赞助方', 'Existing sponsor')}</button></div></div>
        ${w.source === 'sponsor' ? `<div class="note ${w.sponsor && w.sponsor.online ? 'info' : 'warn'} mt-8">${icon('wallet')}<div>${w.sponsor ? `${esc(L(w.sponsor.name))} · ${w.sponsor.online ? T('在线', 'online') : T('离线', 'offline')} · ${T('剩余额度', 'quota left')} ${U.sui(w.sponsor.quota)}` : ''}</div></div>` : ''}
        <dl class="kv mt-12"><dt>${T('收款地址', 'Address')}</dt><dd class="mono small">${esc(U.shortId(w.address, 8))} <span class="chip warn">${T('演示地址，请勿转账', 'Demo address — do not send funds')}</span></dd></dl>
        <div class="row wrap mt-12">${U.btn({ action: 'fee-topup', label: T('模拟到账 0.02 SUI', 'Simulate a 0.02 SUI deposit'), icon: 'download', size: 'sm' })}</div>
        <div class="tiny muted mt-8">${T('到账只更新余额，不会自动签名或提交任何交易。没有官方 Gas 后台；有效代付可以免去先充值。', 'Deposits only change the balance; nothing is signed or submitted automatically. There is no official gas backend; a working sponsor can pay instead.')}</div></section>
      <section class="card"><div class="card-h"><h2>${T('费用估算', 'Fee estimates')}</h2><span class="small muted">${T('示例值，非实时估价', 'Examples, not live quotes')}</span></div>${rows}</section></div>
      <section class="card mt-16"><div class="card-h"><h2>${T('费用记录', 'Fee records')}</h2></div>
        ${w.records.map(r => `<div class="run-row"><span class="st ${r.state === 'confirmed' ? 'ok' : 'danger'}">${icon(r.state === 'confirmed' ? 'check' : 'x')}</span><span class="grow">${esc(U.txLabel(r.kind))}${r.state === 'failed' ? ` · <span class="small" style="color:var(--danger)">${T('失败仍按链上结果扣费', 'failed; charged per chain result')}</span>` : ''}</span><span class="mono tiny muted">${esc(U.shortId(r.txId, 4))}</span><span class="num">${U.sui(r.amount)}</span><span class="small muted">${U.date(r.at)}</span></div>`).join('') || `<div class="muted small">${T('暂无', 'None')}</div>`}
        <div class="tiny muted mt-8">${T('链上运行费与模型、工具服务、云主机账单分开显示。', 'Chain run fees are shown separately from model, tool and cloud bills.')}</div></section>`;
  }

  function data() {
    const opts = { okrs: U.f('export.okrs', true), records: U.f('export.records', true), memories: U.f('export.memories', true), artifacts: U.f('export.artifacts', true) };
    const out = M.buildExport(P(), P().currentOrgId, opts, U.now());
    const m = out.manifest;
    const miss = m.missing.map(x => { const e = M.find(O().evidence, x.id); const h = U.host(x.hostId); const label = e && e.title ? L(e.title) : e && e.kind === 'measurement' ? `${T('测量值', 'Measurement')} ${U.num(e.value, e.unit)}` : x.id; return `<li>${esc(label)} · ${T('位于', 'on')} ${esc(h ? h.name : x.hostId)}（${T('主机不可达', 'host unreachable')}）</li>`; }).join('');
    return `<section class="card"><div class="card-h"><h2>${T('导出', 'Export')}</h2><span class="small muted">${T('仅当前组织', 'Current organization only')}</span></div>
        <div class="row wrap gap-lg">${[['okrs', 'OKR 与执行约定', 'OKRs & agreements'], ['records', '任务、Run 与验收记录', 'Tasks, runs & acceptance'], ['memories', '记忆', 'Memories'], ['artifacts', '产物索引', 'Artifact index']].map(([k, zh, en]) => `<label class="check"><input type="checkbox" data-f="export.${k}" ${opts[k] ? 'checked' : ''}>${esc(T(zh, en))}</label>`).join('')}</div>
        <div class="card soft tight mt-12"><div class="label">${T('清单预览', 'Manifest preview')}</div>
          <dl class="kv mt-8"><dt>${T('格式', 'Format')}</dt><dd class="mono small">${esc(m.format)}/v${m.version}</dd><dt>${T('来源组织', 'Organization')}</dt><dd>${esc(L(U.orgMeta().name))} · <span class="mono small">${esc(U.shortId(m.organization.chainId, 6))}</span></dd><dt>${T('包含', 'Includes')}</dt><dd>${m.included.join(', ') || '—'}</dd><dt>${T('凭据', 'Credentials')}</dt><dd>${T('不包含（邀请码、恢复码、密钥单独处理）', 'Excluded (invitation codes, recovery codes and keys are handled separately)')}</dd><dt>${T('完整性', 'Complete')}</dt><dd>${m.complete ? `<span class="st ok">${icon('check')}${T('完整', 'Complete')}</span>` : `<span class="st warn">${icon('alert')}${T('不完整：缺失项已列出', 'Incomplete: gaps listed')}</span>`}</dd></dl>
          ${miss ? `<ul class="small" style="margin:8px 0 0;padding-left:18px">${miss}</ul>` : ''}</div>
        <div class="card-f">${U.btn({ action: 'export-do', label: T('导出 JSON', 'Export JSON'), icon: 'download', kind: 'primary', perm: 'read' })}</div></section>
      <section class="card mt-16"><div class="card-h"><h2>${T('数据控制', 'Data control')}</h2></div>
        ${[['清除本机缓存', 'Clear local caches', '只删除可重建的索引；链上确认状态重建，在线状态重新观测。', 'Removes rebuildable indexes only; confirmed chain state is rebuilt and liveness re-observed.', 'cache-clear'],
          ['删除本机工作副本', 'Delete local working copies', '删除执行目录中的临时文件；需要保留的内容应先显式提交上链。', 'Deletes temporary files in execution folders; commit anything worth keeping first.', null],
          ['撤销授权', 'Revoke access', '在“我的身份”中撤销设备，或在主机详情中撤销主机资格。', 'Revoke devices under My identity, or host membership under host details.', null],
          ['归档链上记录', 'Archive chain records', '归档不承诺擦除不可变的链上历史；公开字段上链后不能承诺保密。', 'Archiving cannot erase immutable chain history; public fields on chain cannot be made private.', null]].map(([zh, en, dzh, den, act]) => `<div class="item top"><div class="grow"><div class="strong">${esc(T(zh, en))}</div><div class="small muted">${esc(T(dzh, den))}</div></div>${act ? `<button class="btn sm" data-action="${act}">${T('执行', 'Run')}</button>` : ''}</div>`).join('')}</section>`;
  }

  function diagnostics() {
    const org = O();
    const f = U.root.faults;
    const comp = [
      ['FractalMind App', '0.4.1', true, ''], ['Core / envd', '0.9.3', true, ''],
      ...org.bindings.map(b => [`Coordinator · ${b.endpoint}`, '0.9.3', b.online && !f.coordinatorDown, b.online && !f.coordinatorDown ? '' : T('不可达：主机状态显示为未知', 'Unreachable: host status shows unknown')]),
      ['Sui RPC · testnet', 'gRPC', !f.rpcDown, f.rpcDown ? T('不可用：交易结果未知时先查询原交易', 'Unavailable: query unknown transactions before anything else') : ''],
      [T('推送（APNs / FCM）', 'Push (APNs / FCM)'), '—', true, T('只携带最小唤醒信息', 'Carries minimal wake-up data only')],
    ];
    return `<section class="card"><div class="card-h"><h2>${T('组件健康', 'Component health')}</h2>${U.btn({ action: 'open', data: { dialog: 'diag' }, label: T('导出诊断', 'Export diagnostics'), icon: 'download', size: 'sm' })}</div>
      ${comp.map(([n, v, ok, note]) => `<div class="item"><span class="st ${ok ? 'ok' : 'danger'}">${icon(ok ? 'check' : 'x')}</span><div class="grow"><div class="strong">${esc(n)}</div>${note ? `<div class="tiny muted">${esc(note)}</div>` : ''}</div><span class="mono small muted">${esc(v)}</span></div>`).join('')}
      <div class="tiny muted mt-8">${T('诊断默认只在本机记录；上传需要你选择并预览，关键路径不记录明文凭据和私有文件正文。', 'Diagnostics stay local by default; uploading requires your choice and preview. Credentials and private file bodies are never logged.')}</div></section>`;
  }

  function about() {
    const st = U.f('update.state', 'idle');
    const active = O().runs.filter(r => r.state === 'running').length;
    const upd = {
      idle: `${U.btn({ action: 'set-f', data: { key: 'update.state', value: 'available' }, label: T('检查更新', 'Check for updates'), size: 'sm' })}`,
      available: `<div class="note info">${icon('download')}<div>${T('新版本 0.4.2 可用：修复远程桌面重连与中文输入。', 'Version 0.4.2 is available: fixes desktop reconnects and CJK input.')}</div></div><div class="row mt-8">${U.btn({ action: 'set-f', data: { key: 'update.state', value: 'downloaded' }, label: T('下载', 'Download'), kind: 'primary', size: 'sm' })}</div>`,
      downloaded: `<div class="note ${active ? 'warn' : 'ok'}">${icon(active ? 'clock' : 'check')}<div>${active ? T(`已下载。${active} 个 Run 正在执行：将在安全检查点应用，不会在未确认停止前替换执行组件。`, `Downloaded. ${active} run(s) executing: it applies at a safe checkpoint; execution components are never replaced before a confirmed stop.`) : T('已下载，可以应用。', 'Downloaded and ready to apply.')}</div></div><div class="row mt-8">${U.btn({ action: 'set-f', data: { key: 'update.state', value: 'scheduled' }, label: T('在安全检查点应用', 'Apply at a safe checkpoint'), kind: 'primary', size: 'sm' })}</div>`,
      scheduled: `<div class="calm">${icon('check')}<span>${T('已安排：在下一个安全检查点应用。组织、权限与任务会保留。', 'Scheduled for the next safe checkpoint. Organizations, permissions and tasks are kept.')}</span></div>`,
    }[st];
    return `<section class="card"><div class="card-h"><h2>FractalMind App</h2><span class="chip">0.4.1 · ${T('测试网', 'Testnet')}</span></div>
      <dl class="kv"><dt>${T('原型', 'Prototype')}</dt><dd>v2 · ${T('交互评审用，全部数据为演示', 'for review; all data is demo data')}</dd><dt>${T('平台', 'Platform')}</dt><dd>macOS · Windows · Ubuntu · iOS · Android</dd></dl>
      <div class="divider"></div><div class="label">${T('更新', 'Updates')}</div><div class="mt-8">${upd}</div>
      <div class="divider"></div><div class="small muted">${T('退出窗口可以保留后台执行；“停止任务并退出”需要得到明确的执行结果。卸载会停止后台组件，并允许选择保留项目数据。', 'Closing the window can keep background work; “Stop tasks and quit” waits for a definite result. Uninstalling stops background components and lets you keep project data.')}</div></section>`;
  }

  FM.views.settings = r => {
    const sec = r.parts[1] || 'general';
    const body = { general, workspaces, runtime, connections, fees, data, diagnostics, about }[sec] || general;
    const nav = SECTIONS.map(([k, ic, zh, en]) => `<a class="sb-link" href="#/settings/${k}"${k === sec ? ' aria-current="page"' : ''}>${icon(ic)}<span>${esc(T(zh, en))}</span></a>`).join('');
    return `<div class="page-h"><div><h1>${T('组织设置', 'Settings')}</h1><p class="muted">${esc(L(U.orgMeta().name))} · ${T('工作区、工具、连接、运行费、存储与通知。身份与设备在“我的身份”。', 'Workspaces, tools, connections, fees, storage and notifications. Identity and devices live under My identity.')}</p></div></div>
      <div class="settings-grid"><nav class="col hide-m" style="gap:2px;position:sticky;top:76px">${nav}</nav>
        <div class="show-m"><select class="select" data-action-nav="settings" aria-label="${T('设置分区', 'Section')}" onchange="location.hash='#/settings/'+this.value">${SECTIONS.map(([k, , zh, en]) => `<option value="${k}" ${k === sec ? 'selected' : ''}>${esc(T(zh, en))}</option>`).join('')}</select></div>
        <div>${body()}</div></div>`;
  };

  Object.assign(FM.actions, {
    'fee-source': el => {
      const w = P().wallet;
      w.source = el.dataset.v;
      if (w.source === 'sponsor' && !w.sponsor) w.sponsor = { id: 'sponsor-demo', name: { zh: '测试网赞助方（演示）', en: 'Testnet sponsor (demo)' }, quota: 20000000, online: true };
      U.save();
      render();
    },
    'fee-topup': () => {
      P().wallet.balance += 20000000;
      U.save();
      toast(T('演示到账 0.02 SUI：只更新余额，不会自动提交任何交易。', 'Demo deposit of 0.02 SUI: balance only; nothing is submitted.'), 'ok');
      if (FM.review) FM.review.mark('fees.topup');
      render();
    },
    'export-do': () => {
      const opts = { okrs: U.f('export.okrs', true), records: U.f('export.records', true), memories: U.f('export.memories', true), artifacts: U.f('export.artifacts', true) };
      const out = M.buildExport(P(), P().currentOrgId, opts, U.now());
      U.download(`fractalmind-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 2));
      toast(out.manifest.complete ? T('已导出完整包。', 'Exported a complete package.') : T('已导出：清单标明了缺失内容，不会显示为完整备份。', 'Exported: the manifest lists missing items; it is not shown as a complete backup.'), 'ok', 4800);
      if (FM.review) FM.review.mark('export.done');
    },
    'cache-clear': () => toast(T('已清除可重建缓存（演示）：链上确认状态会重建，在线状态重新观测。', 'Cleared rebuildable caches (demo): confirmed chain state is rebuilt; liveness is re-observed.'), 'ok'),
  });

  FM.dialogs.diag = () => ({
    title: T('导出诊断', 'Export diagnostics'), size: 'sm',
    body: `<div class="small">${T('将包含：组件版本、健康状态、错误原因与跨组件请求标识。', 'Includes: component versions, health, error causes and cross-component request IDs.')}</div>
      <div class="note ok">${icon('shield')}<div>${T('已脱敏：不含凭据、邀请码、恢复码、私有文件正文与对话内容。', 'Redacted: no credentials, invitation or recovery codes, private file bodies or conversations.')}</div></div>
      <pre class="console" style="min-height:0">{ "app": "0.4.1", "core": "0.9.3", "rpc": "${U.root.faults.rpcDown ? 'unavailable' : 'ok'}", "requestId": "req_7f3a…", "secrets": "[redacted]" }</pre>`,
    foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button><button class="btn primary" data-action="diag-do">${T('保存到本机', 'Save locally')}</button>`,
  });
  FM.actions['diag-do'] = () => { U.download('fractalmind-diagnostics-redacted.json', JSON.stringify({ app: '0.4.1', core: '0.9.3', demo: true, secrets: '[redacted]' }, null, 2)); U.closeDialog(); };

  /* ------------------------------------------------ Workspace and model */

  const FOLDERS = [
    { name: 'fractalmind-app', path: '~/code/fractalmind-app', files: ['AGENTS.md', 'OKR.md', 'HEARTBEAT.md'] },
    { name: 'personal-site', path: '~/code/personal-site', files: ['package.json', 'README.md'] },
    { name: 'sample-workspace', path: '~/FractalMind/sample-workspace', files: ['AGENTS.md', 'README.md'], sample: true },
  ];

  FM.dialogs.workspace = () => {
    const sel = U.f('ws.pick', '');
    const f = FOLDERS.find(x => x.path === sel);
    return {
      title: T('导入项目目录', 'Import a project folder'), size: 'lg',
      body: `<div class="col">${FOLDERS.map(x => `<button class="opt" data-action="set-f" data-key="ws.pick" data-value="${esc(x.path)}" aria-pressed="${sel === x.path}"><span class="ico">${icon('folder')}</span><span class="grow"><span class="strong">${esc(x.name)}</span>${x.sample ? ` <span class="chip warn">${T('示例工作区', 'Sample workspace')}</span>` : ''}<span class="mono small muted" style="display:block">${esc(x.path)}</span></span></button>`).join('')}</div>
        ${f ? `<div class="card soft tight"><div class="label">${T('现有配置预览', 'Existing configuration')}</div><div class="row wrap mt-8">${f.files.map(x => `<code class="chip outline">${esc(x)}</code>`).join('')}</div>
          <div class="small mt-8">${T('请求权限：读写此目录；执行位置为本组织已授权的主机。', 'Requested access: read and write this folder; execution happens on authorized hosts in this organization.')}</div></div>` : ''}
        <div class="note">${icon('info')}<div>${T('取消导入不会修改原文件。原型只模拟目录选择，不读取你的真实文件系统。', 'Cancelling changes no files. The prototype simulates the picker and never reads your real file system.')}</div></div>`,
      foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'ws-import', label: T('授权并导入', 'Authorize and import'), kind: 'primary', disabled: !f, why: T('选择一个目录', 'Choose a folder') })}`,
    };
  };

  Object.assign(FM.actions, {
    'ws-import': () => {
      const p = P();
      const org = O();
      const f = FOLDERS.find(x => x.path === U.f('ws.pick', ''));
      if (!org.workspaces.some(w => w.path === f.path)) {
        org.workspaces.push({ id: M.nextId(p, 'ws'), name: f.name, path: f.path, hostIds: org.hosts.map(h => h.id), access: 'read_write', importedAt: U.now(), files: f.files });
      }
      if (p.onboarding) p.onboarding.workspace = true;
      U.save();
      U.clearForm('ws');
      ui.dialog = null;
      toast(T('已导入并授权读写。原文件未被修改。', 'Imported with read/write access. No files were changed.'), 'ok');
      if (FM.review) FM.review.mark('onboard.workspace');
      render();
    },
  });

  /* This computer as the organization's first host (J1, issue #64): envd runs
   * as a background service with the Host and Coordinator roles. One
   * confirmation: a device-signed PTB (binding + invite), then the host's own
   * redemption with gas sponsored by this device. */
  const BOOT_STEPS = [
    ['service', '安装后台服务（登录后自动运行）', 'Install the background service (runs at login)'],
    ['keys', '在系统钥匙串初始化主机与 Coordinator 密钥', 'Create host and coordinator keys in the system keychain'],
    ['prepare', '创建连接入口与一次性邀请（本设备签名）', 'Create the endpoint and a one-time invitation (signed by this device)'],
    ['redeem', '本机兑换邀请并入组（本设备代付 gas）', 'Redeem on this computer and join (gas paid by this device)'],
    ['online', '连接 Coordinator 并上线', 'Connect to the coordinator and go online'],
  ];
  const LOCAL_ENDPOINT = 'http://127.0.0.1:7443';

  FM.dialogs.bootstrap = st => {
    const p = P();
    const dev = U.me() || { name: 'This computer', platform: 'macos' };
    const started = st.done !== undefined;
    const done = st.done || 0;
    const service = { macos: 'launchd LaunchAgent', windows: T('Windows 计划任务', 'Windows scheduled task'), ubuntu: 'systemd user service' }[dev.platform] || 'launchd LaunchAgent';
    const svcNow = M.localServiceFor(p);
    const existing = M.find(O().bindings, svcNow.bindingId);
    const reuse = existing && existing.state === 'confirmed';
    const endpoint = reuse ? existing.endpoint : LOCAL_ENDPOINT;
    const scopeText = !reuse || (existing.scope || 'loopback') === 'loopback'
      ? T('仅本机可访问', 'This computer only')
      : existing.scope === 'lan' ? T('局域网可访问', 'Reachable on your network') : T('公网可访问', 'Reachable from the internet');
    const fee = (reuse ? M.FEES['invite.create'] : M.FEES['host.prepare']) + M.FEES['invite.redeem'];
    if (!started) {
      return {
        title: T('把这台电脑设为执行主机', 'Use this computer as an execution host'), size: 'lg',
        sub: T('推荐：Agent 在本机执行你的 OKR。之后可以在“主机与算力”里调整。', 'Recommended: Agents run your OKRs on this computer. Adjust it later under Hosts & compute.'),
        body: `<div class="field"><label for="boot-name">${T('主机名称（公开上链）', 'Host name (public on chain)')}</label><input id="boot-name" class="input" maxlength="128" data-f="boot.name" value="${esc(U.f('boot.name', dev.name))}"></div>
          <dl class="kv">
            <dt>${T('角色', 'Roles')}</dt><dd><span class="chip brand">Host</span> <span class="chip brand">Coordinator</span> <span class="tiny muted">${T('同一个后台服务承担两个角色', 'One background service runs both')}</span></dd>
            <dt>${T('后台服务', 'Background service')}</dt><dd>${esc(service)} · ${T('登录后自动运行，关掉 App 后 Agent 继续执行；不需要管理员权限', 'Starts at login; Agents keep running after the App closes; no admin rights needed')}</dd>
            <dt>${T('Coordinator 入口', 'Coordinator endpoint')}</dt><dd><span class="mono">${esc(endpoint)}</span> · ${scopeText}${reuse ? ` · ${T('沿用已有入口', 'existing endpoint')}` : ''}</dd>
            <dt>${T('授权期限', 'Validity')}</dt><dd>${T('邀请 15 分钟内在本机兑换；主机执行授权 7 天，可续期', 'The invitation is redeemed here within 15 minutes; the host execution grant lasts 7 days and can be renewed')}</dd>
            <dt>${T('费用', 'Fees')}</dt><dd>${T('两笔交易，合计预计', 'Two transactions, est. total')} <strong>${U.sui(fee)}</strong> · ${T('全部由本设备支付，不需要给主机地址充值', 'all paid by this device; no need to fund the host address')}</dd>
          </dl>
          <div class="note">${icon('info')}<div>${T('本机同样经过一次性邀请的链上准入，不会因为是“自己的电脑”而跳过。手机等其他设备暂时连不上仅本机的入口；需要时在“主机与算力”里开放到局域网或公网（需 HTTPS）。', 'This computer still joins through a one-time on-chain invitation; being yours never skips admission. Phones and other devices cannot reach a this-computer-only endpoint; open it to your LAN or the internet (HTTPS) under Hosts & compute when needed.')}</div></div>`,
        foot: `<button class="btn" data-action="close-dialog">${T('稍后', 'Later')}</button>${U.btn({ action: 'bootstrap-start', label: T('确认并设置', 'Confirm and set up'), kind: 'primary', perm: 'manage_hosts' })}`,
      };
    }
    return {
      title: T('正在把这台电脑设为执行主机', 'Setting up this computer as an execution host'), size: 'lg', sticky: done < BOOT_STEPS.length,
      body: `<div class="col">${BOOT_STEPS.map(([k, zh, en], i) => `<div class="row"><span class="st ${i < done ? 'ok' : i === done && st.busy ? 'info' : 'muted'}">${icon(i < done ? 'check' : i === done && st.busy ? 'refresh' : 'clock', i === done && st.busy ? 'spin' : '')}</span><span class="${i === done ? 'strong' : ''}">${esc(T(zh, en))}</span></div>`).join('')}</div>
        ${st.err ? `<div class="note danger">${icon('x')}<div>${esc(st.err)} ${T('已完成的步骤会保留；继续时先查询原交易，不会重复提交。', 'Completed steps are kept; continuing queries the original transaction and never resubmits.')}</div></div>` : ''}
        ${done >= BOOT_STEPS.length ? `<div class="calm">${icon('check')}<span>${T(`这台电脑已是执行主机，Coordinator 入口 ${endpoint}（${scopeText}）。`, `This computer is an execution host; coordinator endpoint ${endpoint} (${scopeText}).`)}</span></div>` : ''}`,
      foot: done >= BOOT_STEPS.length
        ? (O().agents.some(a => a.hostId === svcNow.hostId)
          ? `<button class="btn primary" data-action="close-dialog">${T('完成', 'Done')}</button>`
          : `<button class="btn" data-action="close-dialog">${T('稍后', 'Later')}</button>${U.btn({ action: 'open', data: { dialog: 'discover', host: svcNow.hostId }, label: T('导入已运行的 Agent', 'Import a running Agent') })}${U.btn({ action: 'open', data: { dialog: 'agent-create', setup: '1' }, label: T('下一步：新建 Agent', 'Next: create an Agent'), kind: 'primary', perm: 'manage_hosts' })}`)
        : `${st.err ? `<button class="btn" data-action="close-dialog">${T('稍后继续', 'Continue later')}</button>${U.btn({ action: 'bootstrap-next', label: T('继续', 'Continue'), kind: 'primary', disabled: !!st.busy })}` : ''}`,
    };
  };

  FM.actions['bootstrap-start'] = () => {
    const st = ui.dialog;
    const name = String(U.f('boot.name', (U.me() || {}).name || '')).trim();
    if (!name) { toast(T('请填写主机名称', 'Enter a host name'), 'warn'); return; }
    st.name = name;
    st.done = 0;
    FM.actions['bootstrap-next']();
  };

  FM.actions['bootstrap-next'] = () => {
    const st = ui.dialog;
    const p = P();
    const org = O();
    const svc = M.localServiceFor(p);
    st.err = null;
    st.busy = true;
    render();
    const step = st.done || 0;
    const advance = () => { st.busy = false; st.done = step + 1; render(); if (st.done < BOOT_STEPS.length) FM.actions['bootstrap-next'](); };
    const fail = r => { st.busy = false; st.err = U.txErr(r.code); render(); };
    if (step === 0) { U.later(600, () => { svc.state = 'running'; svc.startAtLogin = true; U.save(); advance(); }); return; }
    if (step === 1) { U.later(500, () => { svc.keys = true; U.save(); advance(); }); return; }
    if (step === 2) {
      let b = M.find(org.bindings, svc.bindingId);
      if (!b) {
        b = { id: M.nextId(p, 'bind'), endpoint: LOCAL_ENDPOINT, scope: 'loopback', version: 1, label: { zh: '本机 Coordinator', en: 'This computer' }, state: 'pending', online: false, local: true };
        org.bindings.push(b);
        svc.bindingId = b.id;
      }
      const code = FM.makeInviteCode ? FM.makeInviteCode() : `FMI1-${Date.now()}`;
      const dg = M.digest(`fm-invite:1:${code.toUpperCase().replace(/[\s-]/g, '')}`);
      const res = M.createInvite(p, org, { ttl: '15m', desktop: true, workspaceIds: org.workspaces.map(w => w.id), bindingId: b.id }, dg, U.now());
      if (!res.ok) { fail(res); return; }
      st.inviteId = res.invite.id;
      U.save();
      // A binding confirmed earlier (e.g. setting up again after a revoke) only
      // needs a new invite; a new binding and its invite share one PTB.
      const spec = b.state === 'confirmed'
        ? { kind: 'invite.create', payload: { inviteId: res.invite.id } }
        : { kind: 'host.prepare', payload: { bindingId: b.id, inviteId: res.invite.id } };
      const tx = U.submitTx(spec, {
        onConfirmed: (r, pp) => { const x = M.find(pp.data[r.tx.orgId].bindings, b.id); if (x) x.online = true; advance(); },
        onFailed: fail, onRejected: fail,
      });
      if (!tx) st.busy = false;
      return;
    }
    if (step === 3) {
      const inv = M.find(org.invites, st.inviteId);
      const dev = U.me();
      const deviceKey = `ed25519:${Array.from(U.randomBytes(8), b => b.toString(16).padStart(2, '0')).join('')}`;
      const device = { name: st.name, kind: 'local', os: { macos: 'macOS 15.6', windows: 'Windows 11', ubuntu: 'Ubuntu 24.04' }[dev.platform] || 'macOS 15.6', arch: 'arm64', desktop: true, location: { zh: '本机', en: 'This computer' }, deviceKey, proof: M.redeemProof(inv.id, inv.codeDigest, deviceKey) };
      U.submitTx({ kind: 'invite.redeem', payload: { inviteId: inv.id, device, sponsoredBy: dev.id } }, {
        onConfirmed: (r, pp) => {
          const o = pp.data[r.tx.orgId];
          r.host.isThisDevice = true;
          r.host.roles = ['host', 'coordinator'];
          M.localServiceFor(pp).hostId = r.host.id;
          // The host reports its launchers and folder states; Agents are added
          // explicitly afterwards (create from a ROM, or import a running one).
          r.host.launchers = U.F.localLaunchers();
          r.host.folders = U.F.localFolders();
          o.workspaces.forEach(w => { if (!w.hostIds.includes(r.host.id)) w.hostIds.push(r.host.id); });
          if (pp.onboarding) pp.onboarding.host = true;
          if (FM.review) FM.review.mark('onboard.host');
          advance();
        },
        onFailed: fail, onRejected: fail,
      });
      return;
    }
    if (step === 4) {
      U.later(500, () => {
        const res = M.connectHost(org, svc.hostId, true, U.now());
        U.save();
        if (!res.ok) { fail(res); return; }
        advance();
      });
    }
  };

  /* ------------------------------------------------------ Organizations */

  function glyph(level) {
    let s = '<rect x="2" y="2" width="44" height="44" rx="11" fill="none" stroke="currentColor" stroke-width="2"/>';
    const sq = [[9, 9, 14], [25, 25, 8], [34, 34, 4.5], [39.5, 39.5, 2.5]];
    sq.forEach(([x, y, w], i) => { s += `<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${w / 4}" fill="currentColor" opacity="${i < level ? 1 : 0.22}"/>`; });
    return `<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true">${s}</svg>`;
  }

  FM.views.orgs = () => {
    const p = P();
    const meta = U.orgMeta();
    const stages = [
      [1, '个人组织', 'Personal organization', '你与 Agent 用 OKR、约束与证据完成目标。', 'You and your Agents deliver goals with OKRs, limits and evidence.', 'P2', true],
      [2, '人与 Agent 的团队', 'Teams of people and Agents', 'Lead 拆分任务，成员提交，验收者逐项验证后汇总。', 'A Lead splits work; members submit; verifiers check each piece before it rolls up.', 'P3', false],
      [3, '子组织与组织协作', 'Sub-organizations', '子组织复用同一模型，权限继承需要显式定义。', 'Sub-organizations reuse the same model; inherited authority is explicit.', 'P3', false],
      [4, '组织联邦', 'Federations', '独立组织按授权委托、提交与验收；私有数据不自动共享。', 'Independent organizations delegate, deliver and accept under explicit grants; private data is never shared automatically.', 'P4', false],
    ];
    return `<div class="page-h"><div><h1>${T('我的组织', 'My organizations')}</h1><p class="muted">${T('可验证的组织关系。切换后，工作台、OKR、主机与权限按该组织重新确定。', 'Verifiable organization relationships. Switching re-establishes the workbench, OKRs, hosts and permissions.')}</p></div></div>
      <div class="grid-2">${p.orgs.map(o => {
        const cur = o.id === p.currentOrgId;
        const d = p.data[o.id];
        return `<article class="card ${cur ? 'accent' : ''}"><div class="row between top"><div class="row"><span class="avatar ${o.kind === 'team' ? 'team' : ''}">${U.orgInitial(o)}</span><div><div class="strong">${esc(L(o.name))}</div><div class="small muted">${o.kind === 'personal' ? T('个人组织', 'Personal') : T('团队组织', 'Team')} · ${o.role === 'admin' ? T('管理员', 'Admin') : T('成员', 'Member')}</div></div></div>${cur ? `<span class="chip brand">${T('当前', 'Current')}</span>` : `<button class="btn sm" data-action="switch-org" data-id="${esc(o.id)}">${T('切换', 'Switch')}</button>`}</div>
          <dl class="kv mt-12"><dt>${T('链上身份', 'Chain ID')}</dt><dd class="mono small">${esc(U.shortId(o.chainId, 8))} <button class="btn ghost icon sm" data-action="copy" data-copy="${esc(o.chainId)}" aria-label="${T('复制', 'Copy')}">${icon('copy', 'sm')}</button></dd><dt>${T('网络', 'Network')}</dt><dd>Sui ${T('测试网', 'testnet')} · ${o.status === 'confirmed' ? T('已确认', 'confirmed') : o.status}</dd><dt>${T('关系来源', 'Relationship')}</dt><dd>${o.role === 'admin' ? 'OrgAdminCap' : T('成员资格对象', 'Membership object')}</dd><dt>${T('内容', 'Contents')}</dt><dd>${T(`${d.okrs.filter(x => x.lifecycle === 'ACTIVE').length} 个进行中目标 · ${d.hosts.length} 台主机`, `${d.okrs.filter(x => x.lifecycle === 'ACTIVE').length} active goals · ${d.hosts.length} hosts`)}</dd></dl></article>`;
      }).join('')}</div>
      <section class="sec"><div class="sec-h"><h2>${T('成长路径', 'Growth path')}</h2><span class="small muted">${T('每一级复用 OKR、约束、任务、身份、权限与成果证据', 'Every level reuses OKRs, limits, tasks, identity, authority and evidence')}</span></div>
        <div class="fractal">${stages.map(([lv, zh, en, dzh, den, phase, on]) => `<div class="stage-card ${on ? 'on' : 'future'}">${glyph(lv)}<div class="row between"><strong>${esc(T(zh, en))}</strong><span class="chip ${on ? 'ok' : 'wait'}">${phase}</span></div><div class="small muted">${esc(T(dzh, den))}</div>${on ? `<span class="small" style="color:var(--brand-ink)">${T('你在这里', 'You are here')}</span>` : `<span class="small muted">${T('后续开放，暂无可用操作', 'Coming later; no actions yet')}</span>`}</div>`).join('')}</div>
        <div class="note mt-12">${icon('info')}<div>${T('FractalMind 的使命是通过分形、自相似的 Agent 组织向 ASI 发展。组织规模与能力的关系需要持续验证，不用安装量或 Agent 数量代替能力证据。', 'FractalMind aims at ASI through fractal, self-similar agent organizations. The link between scale and capability must be shown with evidence, never with install or Agent counts.')}</div></div></section>`;
  };

  /* ---------------------------------------------------------- Network */

  function netOrg(n) {
    const rel = n.relation === 'member' ? `<span class="chip ok">${T('已加入', 'Member')}</span>` : `<span class="chip outline">${T('未加入', 'Not a member')}</span>`;
    return `<article class="card net-card click" data-action="go" data-to="network/${esc(n.id)}" role="link" tabindex="0"><div class="row between"><strong>${esc(L(n.name))}</strong>${rel}</div>
      <div class="small">${esc(L(n.mission))}</div>
      <div class="row wrap small muted"><span>${T(`${n.members} 位成员`, `${n.members} members`)}</span><span>${T(`${n.agents} 个 Agent`, `${n.agents} Agents`)}</span><span>${T(`${n.hosts} 台主机`, `${n.hosts} hosts`)}</span></div>
      <div class="tiny muted">${T('来源', 'Source')}：Sui ${T('测试网', 'testnet')} · <span class="demo-tag">${T('演示目录', 'Demo directory')}</span> · ${T('更新于', 'updated')} ${U.agoTag(n.updatedAt)}</div></article>`;
  }

  FM.views.network = r => {
    const dir = U.root.network || [];
    const fail = U.root.faults.networkFail;
    if (r.parts[1]) {
      const n = dir.find(x => x.id === r.parts[1]);
      if (!n) return `<a class="back" href="#/network">${icon('left', 'sm')}${T('开放网络', 'Open network')}</a><div class="card"><div class="empty"><h3>${T('没有找到该组织', 'Organization not found')}</h3></div></div>`;
      const member = n.relation === 'member';
      return `<a class="back" href="#/network">${icon('left', 'sm')}${T('开放网络', 'Open network')}</a>
        <div class="page-h"><div><div class="row wrap"><h1>${esc(L(n.name))}</h1>${member ? `<span class="chip ok">${T('已加入', 'Member')}</span>` : `<span class="chip outline">${T('未加入', 'Not a member')}</span>`}</div><p class="muted">${esc(L(n.mission))}</p></div>
          ${member ? `<button class="btn primary" data-action="switch-org" data-id="${esc(n.orgId)}">${T('切换到此组织', 'Switch to it')}</button>` : ''}</div>
        <div class="grid-2"><section class="card"><div class="card-h"><h2>${T('参与规则', 'How to take part')}</h2></div><p class="small">${esc(L(n.rules))}</p>
          <div class="card-f" style="justify-content:flex-start">${U.btn({ action: 'noop', label: T('申请加入（人员 · P3 开放）', 'Apply to join (people · P3)'), disabled: true, why: T('人员加入与角色委派在 P3 交付', 'People and roles ship in P3') })}</div>
          <div class="tiny muted mt-8">${T('贡献主机需使用该组织签发的一次性主机邀请码；Host 邀请不能用于 Human 登录或人员入组。', 'Contributing a host needs a one-time host invitation from the organization; host invitations never sign in a Human or admit people.')}</div></section>
        <section class="card"><div class="card-h"><h2>${T('公开信息', 'Public information')}</h2></div>
          <dl class="kv"><dt>${T('链上身份', 'Chain ID')}</dt><dd class="mono small">${esc(U.shortId(n.chainId, 8))}</dd><dt>${T('网络', 'Network')}</dt><dd>Sui ${T('测试网', 'testnet')}</dd><dt>${T('规模', 'Size')}</dt><dd>${T(`${n.members} 位成员 · ${n.agents} 个 Agent · ${n.hosts} 台主机`, `${n.members} members · ${n.agents} Agents · ${n.hosts} hosts`)}</dd><dt>${T('更新', 'Updated')}</dt><dd>${U.agoTag(n.updatedAt)} · <span class="demo-tag">${T('演示目录', 'Demo directory')}</span></dd></dl>
          <div class="note mt-12">${icon('info')}<div>${T('公开字段一旦上链不能承诺保密或物理删除；浏览公开信息不等于获得受保护内容的解密权。', 'Public fields on chain cannot be made private or deleted; browsing them never grants access to protected content.')}</div></div></section></div>`;
    }
    const q = String(U.f('net.q', '')).trim().toLowerCase();
    const shown = dir.filter(n => !q || `${L(n.name)} ${n.name.zh || ''} ${n.name.en || n.name} ${L(n.mission)}`.toLowerCase().includes(q));
    const body = fail
      ? `<div class="card"><div class="empty"><div class="ico">${icon('offline', 'lg')}</div><h3>${T('查询失败', 'Query failed')}</h3><p class="small">${T('无法读取公开组织目录（Sui RPC 或索引不可用）。这不代表没有组织，也不会显示缓存为实时数据。', 'Could not read the public directory (Sui RPC or index unavailable). This does not mean there are no organizations; cached data is never shown as live.')}</p>${U.btn({ action: 'net-retry', label: T('重试', 'Retry'), icon: 'refresh' })}</div></div>`
      : shown.length ? `<div class="okr-grid">${shown.map(netOrg).join('')}</div>` : `<div class="card"><div class="empty"><div class="ico">${icon('search', 'lg')}</div><h3>${T('没有结果', 'No results')}</h3><p class="small">${T('换个名称试试。', 'Try another name.')}</p></div></div>`;
    return `<div class="page-h"><div><h1>${T('开放网络', 'Open network')}</h1><p class="muted">${T('浏览组织公开的使命、规则、网络与更新时间，按其规则参与。', 'Browse the public missions, rules, networks and freshness of organizations, and take part by their rules.')}</p></div></div>
      <div class="filters"><div class="search">${icon('search')}<input class="input" id="net-q" data-f="net.q" data-live value="${esc(U.f('net.q', ''))}" placeholder="${T('按名称查找组织', 'Find by name')}" aria-label="${T('搜索组织', 'Search organizations')}"></div><span class="small muted">${T('未加入、未授权、查询失败、无结果与离线分别显示', 'Not joined, unauthorized, failed, empty and offline are shown distinctly')}</span></div>
      ${body}`;
  };

  Object.assign(FM.actions, {
    noop: () => {},
    'net-retry': () => { toast(T('仍然无法查询（评审工具中关闭“开放网络查询失败”后重试）。', 'Still failing (turn off “Network query fails” in the review tools, then retry).'), 'warn'); },
  });
})();
