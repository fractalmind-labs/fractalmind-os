/* FractalMind App prototype v2 — hosts & compute: fleet, host detail, console,
 * remote desktop, membership, one-time invitations (J7) and connection bindings. */
(function () {
  'use strict';
  const FM = window.FM;
  const U = FM.ui;
  const { M, T, L, esc, icon, P, O, can, ui, render, toast, DAY } = U;

  ui.console = ui.console || {};
  ui.desktop = ui.desktop || {};

  const bindingOf = h => M.find(O().bindings, h.bindingId);
  const attention = h => h.status !== 'online' || !h.accepting || (h.membership && h.membership.state !== 'active') || (h.grant && h.grant.expiresAt - U.now() < 2.5 * DAY);
  const okrsOn = h => O().okrs.filter(o => o.hostId === h.id && (o.lifecycle === 'ACTIVE' || o.lifecycle === 'ACTIVATING'));

  function res(label, v, sampled, online) {
    if (!online) return `<div class="res"><span class="muted" style="width:34px">${label}</span><span class="muted">—</span></div>`;
    return `<div class="res"><span class="muted" style="width:34px">${label}</span><div class="bar ${v > 85 ? 'warn' : ''}"><i style="width:${v}%"></i></div><span class="num">${v}%</span></div>`;
  }

  function hostRow(h) {
    const insts = O().instances.filter(i => i.hostId === h.id);
    const okrs = okrsOn(h);
    const online = h.status === 'online';
    return `<tr class="click" data-action="go" data-to="hosts/${esc(h.id)}">
      <td><div class="host-name"><span class="host-ico">${icon(h.kind === 'cloud' ? 'cloud' : 'server')}</span><div><div class="strong">${esc(h.name)}${h.isThisDevice ? ` <span class="chip outline">${T('本机', 'This computer')}</span>` : ''}${(h.roles || []).includes('coordinator') ? ` <span class="chip brand">Coordinator</span>` : ''}</div><div class="tiny muted">${esc(L(h.location) || '—')} · ${h.kind === 'cloud' ? T('云端', 'Cloud') : T('本地', 'Local')}</div></div></div></td>
      <td class="small">${esc(h.os)}<div class="tiny muted">${esc(h.arch)}</div></td>
      <td>${U.hostState(h)}${!h.accepting && h.membership.state === 'active' ? `<div class="tiny" style="color:var(--warn)">${T('暂停接单', 'Not accepting')}</div>` : ''}</td>
      <td class="small">${U.agoTag(h.lastHeartbeatAt)}${online ? '' : `<div class="tiny muted">${T('显示最后观测', 'last observation')}</div>`}</td>
      <td>${res('CPU', h.cpu, h.sampledAt, online)}${res(T('内存', 'MEM'), h.mem, h.sampledAt, online)}</td>
      <td class="small">${insts.length}<div class="tiny muted ellipsis" style="max-width:140px">${insts.map(i => esc(i.name)).join(', ')}</div></td>
      <td>${okrs.map(o => `<span class="chip outline" title="${esc(L(o.title))}">${o.priority} · ${esc(L(o.title).slice(0, 10))}…</span>`).join(' ') || '<span class="muted small">—</span>'}</td>
    </tr>`;
  }

  function hostCard(h) {
    const insts = O().instances.filter(i => i.hostId === h.id);
    return `<article class="card tight click" data-action="go" data-to="hosts/${esc(h.id)}" role="link" tabindex="0">
      <div class="row between"><div class="host-name"><span class="host-ico">${icon(h.kind === 'cloud' ? 'cloud' : 'server')}</span><div><div class="strong">${esc(h.name)}</div><div class="tiny muted">${esc(h.os)} · ${esc(L(h.location) || '')}</div></div></div>${U.hostState(h)}</div>
      <div class="row between small mt-8"><span class="muted">${T('心跳', 'Heartbeat')} ${U.agoTag(h.lastHeartbeatAt)}</span><span>${T(`${insts.length} 个实例`, `${insts.length} instances`)} · ${T(`${okrsOn(h).length} 个 OKR`, `${okrsOn(h).length} OKRs`)}</span></div>
    </article>`;
  }

  function list() {
    const org = O();
    const filter = ui.tab.hosts || 'all';
    const q = String(U.f('hosts.q', '')).trim().toLowerCase();
    const shown = org.hosts.filter(h => (filter === 'all' || (filter === 'attention' ? attention(h) : h.kind === filter)) &&
      (!q || `${h.name} ${L(h.location)} ${h.os} ${h.kind === 'cloud' ? 'cloud 云端' : 'local 本地'}`.toLowerCase().includes(q)));
    const online = org.hosts.filter(h => h.status === 'online').length;
    const att = org.hosts.filter(attention).length;
    const seg = (k, zh, en) => `<button data-action="set-tab" data-scope="hosts" data-tab="${k}" aria-pressed="${filter === k}">${esc(T(zh, en))}</button>`;
    return `<div class="page-h"><div><h1>${T('主机与算力', 'Hosts & compute')}</h1><p class="muted">${T('本地与云端执行主机、Agent 实例和正在执行的 OKR。每台主机的心跳与连接相互独立。', 'Local and cloud hosts, Agent instances and the OKRs they run. Heartbeats and connections are independent per host.')}</p></div>
      <div class="row wrap">${U.btn({ action: 'open', data: { dialog: 'bindings' }, label: T('管理连接', 'Connections'), icon: 'link' })}${U.btn({ action: 'open', data: { dialog: 'discover' }, label: T('发现已有 Agent', 'Discover Agents'), icon: 'scan' })}${U.btn({ action: 'open', data: { dialog: 'invite' }, label: T('接入主机', 'Add a host'), icon: 'plus', kind: 'primary', perm: 'manage_hosts' })}</div></div>
      ${localCallout()}
      <div class="stats">
        <div class="stat kpi"><span class="kpi-v">${org.hosts.length}</span><span class="kpi-l">${T('台主机', 'hosts')} · ${org.hosts.filter(h => h.kind === 'local').length} ${T('本地', 'local')} / ${org.hosts.filter(h => h.kind === 'cloud').length} ${T('云端', 'cloud')}</span></div>
        <div class="stat kpi"><span class="kpi-v" style="color:var(--ok)">${online}</span><span class="kpi-l">${T('在线', 'online')}</span></div>
        <div class="stat kpi"><span class="kpi-v">${org.instances.length}</span><span class="kpi-l">${T('个 Agent 实例', 'Agent instances')}</span></div>
        <div class="stat kpi"><span class="kpi-v" style="color:${att ? 'var(--warn)' : 'inherit'}">${att}</span><span class="kpi-l">${T('需要关注', 'need attention')}</span></div>
      </div>
      <div class="filters mt-16"><div class="seg">${seg('all', '全部', 'All')}${seg('local', '本地', 'Local')}${seg('cloud', '云端', 'Cloud')}${seg('attention', '需要关注', 'Attention')}</div>
        <div class="search">${icon('search')}<input class="input" data-f="hosts.q" data-live id="hosts-q" value="${esc(U.f('hosts.q', ''))}" placeholder="${T('名称、位置或系统', 'Name, location or OS')}" aria-label="${T('搜索主机', 'Search hosts')}"></div></div>
      <div class="card flush host-table"><table class="table"><thead><tr><th>${T('主机', 'Host')}</th><th>${T('系统', 'OS')}</th><th>${T('状态', 'Status')}</th><th>${T('心跳', 'Heartbeat')}</th><th>${T('资源（采样）', 'Resources (sampled)')}</th><th>${T('实例', 'Instances')}</th><th>${T('执行中的 OKR', 'Running OKRs')}</th></tr></thead>
        <tbody>${shown.map(hostRow).join('') || `<tr><td colspan="7"><div class="empty"><h3>${q ? T('没有匹配的主机', 'No matching hosts') : T('还没有主机', 'No hosts yet')}</h3></div></td></tr>`}</tbody></table></div>
      <div class="host-cards">${shown.map(hostCard).join('') || `<div class="card"><div class="empty"><h3>${T('没有匹配的主机', 'No matching hosts')}</h3></div></div>`}</div>
      <div class="note mt-16">${icon('info')}<div>${T('资源指标带采样时间；断线后显示历史快照并标记未知。主机名称与上报的 host_id 不能充当身份凭证。', 'Resource metrics carry sample times; after a disconnect they are shown as history and marked unknown. Host names and reported host_ids are not credentials.')}</div></div>`;
  }

  /* -------------------------------------------------------------- Detail */

  const SCOPE = {
    loopback: ['仅本机', 'This computer only', 'outline'],
    lan: ['局域网', 'Local network', 'info'],
    public: ['公网', 'Internet', 'warn'],
  };
  const isDesktop = () => { const d = U.me(); return !!d && ['macos', 'windows', 'ubuntu'].includes(d.platform); };
  const localService = () => M.localServiceFor(P());

  function localCallout() {
    const svc = localService();
    if (svc.state !== 'not_installed' || !isDesktop()) return '';
    return `<section class="card accent" style="margin-bottom:16px"><div class="row between wrap gap-lg">
      <div class="row top"><span class="host-ico">${icon('server')}</span><div><div class="strong">${T('这台电脑还不是执行主机', 'This computer is not an execution host yet')}</div>
      <div class="small muted">${T('一次确认：安装后台服务（Host + 仅本机 Coordinator），完成链上准入。', 'One confirmation installs the background service (Host + this-computer-only coordinator) and completes on-chain admission.')}</div></div></div>
      ${U.btn({ action: 'open', data: { dialog: 'bootstrap' }, label: T('设为执行主机', 'Set up'), kind: 'primary', perm: 'manage_hosts' })}</div></section>`;
  }

  /** This computer's background service (envd as Host + Coordinator). */
  function localServiceCard(h) {
    const svc = localService();
    if (!h.isThisDevice || svc.hostId !== h.id) return '';
    const b = M.find(O().bindings, svc.bindingId) || bindingOf(h);
    const scope = SCOPE[(b && b.scope) || 'loopback'];
    const running = svc.state === 'running';
    const dev = U.me() || {};
    const service = { macos: 'launchd LaunchAgent', windows: T('Windows 计划任务', 'Windows scheduled task'), ubuntu: 'systemd user service' }[dev.platform] || 'launchd LaunchAgent';
    return `<section class="card" style="margin-bottom:16px"><div class="card-h"><h2>${icon('server', 'sm')}${T('本机服务', 'This computer’s service')}</h2>
        <span class="row gap-sm"><span class="chip brand">Host</span><span class="chip brand">Coordinator</span><span class="st ${running ? 'ok' : 'muted'}">${icon(running ? 'check' : 'pause')}${running ? T('运行中', 'Running') : T('已停止', 'Stopped')}</span></span></div>
      <dl class="kv">
        <dt>${T('后台服务', 'Background service')}</dt><dd>${esc(service)} · ${svc.startAtLogin ? T('登录后自动运行', 'Starts at login') : T('手动启动', 'Starts manually')}</dd>
        <dt>${T('Coordinator 入口', 'Coordinator endpoint')}</dt><dd><span class="mono">${esc(b ? b.endpoint : '')}</span> <span class="chip ${scope[2]}">${esc(T(scope[0], scope[1]))}</span> <span class="tiny muted">v${(b && b.version) || 1}</span></dd>
        <dt>${T('密钥', 'Keys')}</dt><dd>${svc.keys ? T('主机与 Coordinator 密钥在系统钥匙串', 'Host and coordinator keys in the system keychain') : '—'}</dd>
        <dt>${T('模型', 'Model')}</dt><dd>${esc(L(M.modelLabel(svc.model)))}${svc.model && svc.model.keyInKeychain ? ` · <span class="tiny muted">${T('API 密钥在系统钥匙串', 'API key in the system keychain')}</span>` : ''}</dd>
        <dt>${T('Agent', 'Agents')}</dt><dd>${O().agents.filter(a => a.origin === 'app' && a.hostId === svc.hostId).map(a => esc(a.name)).join('、') || `<span class="muted">${T('还没有由 App 创建的 Agent', 'No Agents created by the app yet')}</span>`}</dd>
      </dl>
      ${(b && (b.scope || 'loopback') === 'loopback') ? `<div class="note mt-12">${icon('info')}<div>${T('入口仅本机可访问：手机等其他设备暂时连不上。需要时开放到局域网或公网（需 HTTPS）。', 'The endpoint is reachable from this computer only: phones and other devices cannot connect yet. Open it to your network or the internet (HTTPS) when needed.')}</div></div>` : ''}
      <div class="card-f">${U.btn({ action: 'local-service-toggle', label: running ? T('停止服务', 'Stop service') : T('启动服务', 'Start service'), icon: running ? 'pause' : 'play', perm: 'manage_hosts' })}${running ? U.btn({ action: 'local-service-restart', label: T('重启服务', 'Restart service'), icon: 'refresh', perm: 'manage_hosts' }) : ''}${U.btn({ action: 'open', data: { dialog: 'model' }, label: svc.model ? T('更改模型', 'Change model') : T('连接模型', 'Connect a model'), icon: 'sparkle', perm: 'manage_hosts' })}${U.btn({ action: 'open', data: { dialog: 'local-endpoint' }, label: T('修改入口', 'Change endpoint'), icon: 'link', perm: 'manage_hosts' })}</div></section>`;
  }

  function overview(h) {
    const org = O();
    const online = h.status === 'online';
    const receipts = org.receipts.filter(r => r.hostId === h.id).slice(0, 5);
    return `${localServiceCard(h)}<div class="grid-2">
      <section class="card"><div class="card-h"><h2>${T('资源', 'Resources')}</h2><span class="small muted">${T('采样', 'Sampled')} ${U.agoTag(h.sampledAt)}</span></div>
        ${online ? `${res('CPU', h.cpu, h.sampledAt, true)}<div class="mt-8">${res(T('内存', 'MEM'), h.mem, h.sampledAt, true)}</div>` : `<div class="note warn">${icon('offline')}<div>${T(`失去心跳：最后观测 CPU ${h.cpu}% · 内存 ${h.mem}%（历史快照，当前未知）`, `No heartbeat: last seen CPU ${h.cpu}% · MEM ${h.mem}% (history; current unknown)`)}</div></div>`}
        <dl class="kv mt-12"><dt>${T('系统', 'OS')}</dt><dd>${esc(h.os)} · ${esc(h.arch)}</dd><dt>${T('远程桌面', 'Desktop')}</dt><dd>${h.desktop === 'supported' ? T('支持（需授权）', 'Supported (needs grant)') : T('无图形会话', 'Headless')}</dd><dt>${T('接单', 'Accepting')}</dt><dd>${h.accepting ? T('接收新分配', 'Taking new work') : T('暂停接单：只影响新分配，现有运行继续', 'Paused: only new assignments stop; current work continues')}</dd></dl></section>
      <section class="card"><div class="card-h"><h2>${T('执行中的 OKR', 'Running OKRs')}</h2></div>
        ${okrsOn(h).map(o => { const c = M.condition(org, o, U.now()); return `<div class="item click" data-action="view-run" data-id="${esc(o.id)}"><span class="prio ${o.priority}">${o.priority}</span><span class="grow ellipsis">${esc(L(o.title))}</span>${U.condBadge(c.code)}</div>`; }).join('') || `<div class="muted small">${T('当前没有分配到此主机的 OKR', 'No OKRs assigned to this host')}</div>`}
        <div class="divider"></div><div class="label">${T('最近命令回执', 'Recent command receipts')}</div>
        ${receipts.map(r => `<div class="run-row"><span class="run-id">${esc(r.id)}</span><span class="grow">${esc(CMD[r.cmd] ? T(...CMD[r.cmd]) : r.cmd)} · ${esc((U.inst(r.instanceId) || {}).name || T('主机', 'host'))}</span><span class="st ${r.state === 'acked' ? 'ok' : 'warn'}">${icon(r.state === 'acked' ? 'check' : 'clock')}${r.state === 'acked' ? T('已回执', 'Acknowledged') : T('等待回执', 'Awaiting receipt')}</span></div>`).join('') || `<div class="muted small mt-4">${T('暂无', 'None')}</div>`}</section>
    </div>`;
  }

  const CMD = { status: ['状态', 'Status'], logs: ['日志', 'Logs'], restart: ['重启', 'Restart'], stop: ['停止', 'Stop'], shell: ['Shell', 'Shell'] };

  function instancesTab(h) {
    const org = O();
    const insts = org.instances.filter(i => i.hostId === h.id);
    return `<section class="card"><div class="card-h"><h2>${T('Agent 实例', 'Agent instances')}</h2>${U.btn({ action: 'open', data: { dialog: 'discover', host: h.id }, label: T('发现已有 Agent', 'Discover Agents'), icon: 'scan', size: 'sm' })}</div>
      ${insts.map(i => {
        const okrs = org.okrs.filter(o => o.instanceId === i.id && o.lifecycle === 'ACTIVE');
        const st = { running: ['ok', '运行', 'Running'], idle: ['muted', '空闲', 'Idle'], stopped: ['danger', '已停止', 'Stopped'], importing: ['info', '导入中', 'Importing'] }[i.status] || ['muted', i.status, i.status];
        return `<div class="item top"><span class="host-ico">${icon('users')}</span><div class="grow"><div class="row wrap gap-sm"><strong>${esc(i.name)}</strong><span class="small muted">${esc(U.agent(i.agentId).name || T('未分配角色', 'No role'))}</span><span class="chip ${i.adapter === 'tmux-observe' ? 'wait' : 'outline'}">${i.adapter === 'tmux-observe' ? T('仅观察', 'Observe only') : T('可控适配器', 'Controllable')}</span>${i.imported ? `<span class="chip outline">${i.imported === 'observe' ? T('导入 · 仅观察', 'Imported · observe') : T('导入 · 已纳入 OKR', 'Imported · in OKR')}</span>` : ''}</div>
          <div class="tiny muted mt-4">${esc(i.runtime)} · <span class="mono">${esc(i.workspace || '')}</span>${okrs.length ? ` · ${okrs.map(o => `${o.priority} ${esc(L(o.title).slice(0, 14))}…`).join('、')}` : ''}</div></div>
          <div class="col" style="align-items:flex-end"><span class="st ${h.status === 'online' ? st[0] : 'muted'}">${h.status === 'online' ? esc(T(st[1], st[2])) : T('未知', 'Unknown')}</span>
          <div class="row">${U.btn({ action: 'cmd-ask', data: { host: h.id, inst: i.id, cmd: 'logs' }, label: T('日志', 'Logs'), size: 'sm', perm: 'operate' })}${i.adapter === 'tmux-observe' ? '' : `${U.btn({ action: 'cmd-ask', data: { host: h.id, inst: i.id, cmd: 'restart' }, label: T('重启', 'Restart'), size: 'sm', perm: 'operate' })}${U.btn({ action: 'cmd-ask', data: { host: h.id, inst: i.id, cmd: 'stop' }, label: T('停止', 'Stop'), size: 'sm', kind: 'danger', perm: 'operate', disabled: i.status === 'stopped', why: T('已停止', 'Already stopped') })}`}</div></div></div>`;
      }).join('') || `<div class="empty"><div class="ico">${icon('users', 'lg')}</div><p class="small">${T('此主机上还没有 Agent 实例', 'No Agent instances on this host')}</p></div>`}
      <div class="note mt-12">${icon('info')}<div>${T('命令绑定具体实例，不会因名称相同发到其他主机。停止实例会暂停它负责的 OKR，其他主机上的运行不受影响。', 'Commands target a specific instance, never another host with the same name. Stopping an instance pauses its OKRs only.')}</div></div></section>`;
  }

  function consoleTab(h) {
    const org = O();
    const insts = org.instances.filter(i => i.hostId === h.id);
    const target = U.f(`con-${h.id}.target`, insts[0] ? insts[0].id : '');
    const lines = ui.console[h.id] || [];
    const pendingRcpt = org.receipts.find(r => r.hostId === h.id && r.state === 'sent');
    return `<section class="card"><div class="card-h"><h2>${icon('terminal', 'sm')}${T('远程控制台', 'Remote console')}</h2><span class="small muted">${T('写操作需确认目标；超时先查询，不盲目重发', 'Writes confirm their target; on timeout, query before resending')}</span></div>
      <div class="row wrap">
        <select class="select" style="width:auto" data-f="con-${esc(h.id)}.target" aria-label="${T('目标实例', 'Target instance')}">${insts.map(i => `<option value="${esc(i.id)}" ${i.id === target ? 'selected' : ''}>${esc(i.name)} · ${esc(U.agent(i.agentId).name || '')}</option>`).join('')}<option value="" ${!target ? 'selected' : ''}>${T('主机本身', 'The host itself')}</option></select>
        ${['status', 'logs', 'restart', 'stop'].map(c => U.btn({ action: 'cmd-ask', data: { host: h.id, inst: target, cmd: c }, label: T(...CMD[c]), size: 'sm', kind: c === 'stop' ? 'danger' : '', perm: 'operate', disabled: (c === 'restart' || c === 'stop') && !target, why: T('选择一个实例', 'Choose an instance') })).join('')}
      </div>
      <div class="console mt-12" id="console-${esc(h.id)}" role="log" aria-live="polite">${lines.map(l => `<div class="${l.c || ''}">${esc(l.t)}</div>`).join('') || `<span class="c-dim">${T('# 输出会显示在这里（演示数据，不连接真实主机）', '# Output appears here (demo data; no real host is connected)')}</span>`}</div>
      ${pendingRcpt && U.root.faults.coordinatorDown ? `<div class="note warn mt-8">${icon('clock')}<div>${T(`命令 ${pendingRcpt.id} 未收到回执：Coordinator 不可达。先查询结果，不要重复发送。`, `No receipt for ${pendingRcpt.id}: the coordinator is unreachable. Query first; don't resend.`)} ${U.btn({ action: 'cmd-query', data: { id: pendingRcpt.id, host: h.id }, label: T('查询回执', 'Query receipt'), size: 'sm' })}</div></div>` : ''}
      <div class="row mt-12"><input class="input mono" id="shell-${esc(h.id)}" data-f="con-${esc(h.id)}.shell" value="${esc(U.f(`con-${h.id}.shell`, ''))}" placeholder="uptime · df -h · git status · whoami" aria-label="Shell"><span class="grow"></span>${U.btn({ action: 'cmd-ask', data: { host: h.id, inst: '', cmd: 'shell' }, label: T('执行', 'Run'), icon: 'terminal', perm: 'operate' })}</div>
      <div class="tiny muted mt-8">${T('Shell 只接受演示命令；真实实现中，执行端校验命令身份、目标、链上授权、撤销、重放与预算后才执行。', 'The shell accepts demo commands only. In production the host checks identity, target, chain authority, revocation, replay and budget before running anything.')}</div>
    </section>`;
  }

  function desktopTab(h) {
    if (h.desktop !== 'supported') {
      return `<section class="card"><div class="empty"><div class="ico">${icon('monitor', 'lg')}</div><h3>${T('无图形会话', 'No graphical session')}</h3><p class="small">${T('这台主机是无桌面服务器，不提供远程桌面。可以使用远程控制台。', 'This host is a headless server with no remote desktop. Use the remote console instead.')}</p></div></section>`;
    }
    const s = ui.desktop[h.id] || (ui.desktop[h.id] = { connected: false, mode: 'view', quality: 'auto', zoom: 'fit', stats: false, input: 'trackpad' });
    const grantDesk = h.grant && h.grant.desktop;
    const op = can('operate');
    const canControl = grantDesk && op.ok && h.status === 'online';
    const why = !grantDesk ? T('执行授权不含桌面控制', 'The execution grant excludes desktop control') : !op.ok ? U.permText(op.code) : T('主机离线', 'Host offline');
    const segB = (key, v, zh, en) => `<button data-action="desk" data-host="${esc(h.id)}" data-k="${key}" data-v="${v}" aria-pressed="${s[key] === v}">${esc(T(zh, en))}</button>`;
    return `<section class="card"><div class="card-h"><h2>${icon('monitor', 'sm')}${T('远程桌面', 'Remote desktop')}</h2><span class="demo-tag">${T('示意画面', 'Illustration')}</span></div>
      <div class="desktop ${s.connected && s.mode === 'control' ? 'ctl' : ''}" style="${s.zoom === '100' ? 'transform:scale(1.02)' : ''}">
        <div class="win"><div class="bar-t"><i></i><i></i><i></i></div><div class="lines"><span style="width:62%"></span><span style="width:84%"></span><span style="width:48%"></span><span style="width:71%"></span></div></div>
        <div class="dock"><i></i><i></i><i></i><i></i><i></i></div>${s.connected ? '<div class="cursor"></div>' : ''}
        ${!s.connected ? `<div class="overlay"><div class="col" style="align-items:center"><strong>${T('未连接', 'Not connected')}</strong>${U.btn({ action: 'desk', data: { host: h.id, k: 'connected', v: '1' }, label: T('连接（查看）', 'Connect (view)'), kind: 'primary', size: 'sm', disabled: h.status !== 'online', why: T('主机离线', 'Host offline') })}</div></div>` : ''}
        ${s.connected && s.stats ? `<div class="chip" style="position:absolute;top:10px;left:10px;background:rgba(0,0,0,.55);color:#fff">30 fps · 42 ms · ${s.quality === 'high' ? '1080p' : s.quality === 'low' ? '540p' : T('自动', 'auto')}</div>` : ''}
      </div>
      <div class="row wrap mt-12">
        <div class="seg"><button data-action="desk" data-host="${esc(h.id)}" data-k="mode" data-v="view" aria-pressed="${s.mode === 'view'}">${T('查看', 'View')}</button><button data-action="desk" data-host="${esc(h.id)}" data-k="mode" data-v="control" aria-pressed="${s.mode === 'control'}"${canControl && s.connected ? '' : ` aria-disabled="true" data-why="${esc(s.connected ? why : T('先连接', 'Connect first'))}"`}>${T('控制', 'Control')}${canControl ? '' : icon('lock', 'xs')}</button></div>
        <div class="seg">${segB('quality', 'auto', '自动', 'Auto')}${segB('quality', 'high', '高', 'High')}${segB('quality', 'low', '低', 'Low')}</div>
        <div class="seg">${segB('zoom', 'fit', '适应', 'Fit')}${segB('zoom', '100', '100%', '100%')}</div>
        <label class="check"><input type="checkbox" data-action="desk-stats" data-host="${esc(h.id)}" ${s.stats ? 'checked' : ''}>${T('统计', 'Stats')}</label>
        <span class="grow"></span>
        ${s.connected ? `${U.btn({ action: 'desk', data: { host: h.id, k: 'reconnect', v: '1' }, label: T('重新连接', 'Reconnect'), size: 'sm', icon: 'refresh' })}${U.btn({ action: 'desk', data: { host: h.id, k: 'connected', v: '' }, label: T('断开', 'Disconnect'), size: 'sm' })}` : ''}
      </div>
      ${U.isMobile() && s.connected ? `<div class="row wrap mt-12"><div class="seg">${segB('input', 'trackpad', '触控板', 'Trackpad')}${segB('input', 'direct', '直接触控', 'Direct touch')}</div><input class="input" style="flex:1;min-width:140px" data-f="desk-${esc(h.id)}.text" placeholder="${T('发送文本到主机', 'Send text to the host')}">${U.btn({ action: 'desk-text', data: { host: h.id }, label: T('发送', 'Send'), size: 'sm', disabled: s.mode !== 'control', why: T('需要控制模式', 'Needs control mode') })}</div>` : ''}
      <div class="note mt-12">${icon('info')}<div>${T('断线会释放输入；重新连接不会自动取得控制。手机只读授权不允许桌面输入。', 'Disconnecting releases input; reconnecting never takes control automatically. Read-only phones cannot send input.')}</div></div></section>`;
  }

  function accessTab(h) {
    const b = bindingOf(h);
    const inv = h.membership && h.membership.inviteId ? M.find(O().invites, h.membership.inviteId) : null;
    const via = { invite: T('一次性邀请码', 'One-time invitation'), review: T('设备申请与人工审核', 'Device request and review'), bootstrap: T('首台主机引导', 'First-host bootstrap') }[h.membership.via] || h.membership.via;
    const tx = U.latestTx(t => t.kind === 'host.revoke' && t.payload.hostId === h.id);
    const revoked = h.membership.state !== 'active';
    return `<div class="grid-2">
      <section class="card"><div class="card-h"><h2>${T('主机资格', 'Host membership')}</h2>${revoked ? `<span class="chip danger">${T('已撤销', 'Revoked')}</span>` : `<span class="chip ok">${T('有效', 'Active')}</span>`}</div>
        <dl class="kv"><dt>${T('来源', 'Via')}</dt><dd>${esc(via)}${inv ? ` · <span class="mono small">${esc(inv.id)}</span>` : ''}</dd><dt>${T('生效于', 'Since')}</dt><dd>${U.date(h.membership.since)}</dd><dt>${T('设备身份', 'Device identity')}</dt><dd class="mono small">${esc(M.digest(`${h.id}:key`).slice(0, 8))}…${T('（设备密钥指纹，演示）', ' (key fingerprint, demo)')}</dd>${revoked ? `<dt>${T('撤销于', 'Revoked')}</dt><dd>${U.dateTime(h.membership.revokedAt)}</dd>` : ''}</dl>
        <div class="tiny muted mt-12">${T('资格、执行授权与连接是三件不同的事：链上入组成功不证明在线，在线也不代表仍有授权。', 'Membership, execution grant and connection are separate facts: joining on chain proves no liveness, and being online proves no authority.')}</div></section>
      <section class="card"><div class="card-h"><h2>${T('执行授权', 'Execution grant')}</h2></div>
        <dl class="kv"><dt>${T('动作', 'Actions')}</dt><dd>${T('在授权工作区内执行 OKR 任务', 'Run OKR tasks inside authorized workspaces')}</dd><dt>${T('桌面控制', 'Desktop control')}</dt><dd>${h.grant.desktop ? T('已包含', 'Included') : T('不包含', 'Not included')}</dd><dt>${T('有效期', 'Valid')}</dt><dd>${U.date(h.grant.expiresAt)} · ${U.until(h.grant.expiresAt)}</dd><dt>${T('组织管理', 'Org admin')}</dt><dd>${T('从不授予主机', 'Never granted to hosts')}</dd></dl></section>
      <section class="card"><div class="card-h"><h2>${T('连接入口', 'Connection')}</h2></div>
        <dl class="kv"><dt>${T('端点', 'Endpoint')}</dt><dd class="mono small">${esc(b ? b.endpoint : '—')}</dd><dt>${T('链上绑定', 'Chain binding')}</dt><dd>${b ? (b.state === 'confirmed' ? T('已确认', 'Confirmed') : b.state) : '—'}</dd><dt>${T('当前连接', 'Now')}</dt><dd>${U.hostState(h)}</dd></dl></section>
      <section class="card"><div class="card-h"><h2 style="color:var(--danger)">${T('撤销', 'Revoke')}</h2></div>
        <p class="small">${T('撤销资格和执行授权后，即使连接仍在，新的受保护操作也会被拒绝；已开始的操作另行确认停止。此主机上的 OKR 会暂停。', 'After revoking membership and grant, new protected operations are refused even if the connection stays up; running work is stopped separately. OKRs here pause.')}</p>
        ${tx ? `<div class="mt-8">${U.txLine(tx)}</div>` : ''}
        <div class="card-f">${U.btn({ action: 'host-revoke', data: { id: h.id }, label: T('撤销主机资格', 'Revoke membership'), kind: 'danger', perm: 'manage_hosts', disabled: revoked || !!(tx && tx.state === 'pending'), why: T('已撤销', 'Already revoked') })}</div></section>
    </div>`;
  }

  function detail(id) {
    const org = O();
    const h = M.find(org.hosts, id);
    if (!h) return `<a class="back" href="#/hosts">${icon('left', 'sm')}${T('主机与算力', 'Hosts')}</a><div class="card"><div class="empty"><h3>${T('该主机不在当前组织', 'This host is not in the current organization')}</h3></div></div>`;
    const scope = `host-${id}`;
    const tab = ui.tab[scope] || 'overview';
    const tabs = [['overview', '概览', 'Overview'], ['instances', 'Agent 实例', 'Instances'], ['console', '远程控制台', 'Console'], ['desktop', '远程桌面', 'Desktop'], ['access', '资格与授权', 'Access']];
    const body = { overview, instances: instancesTab, console: consoleTab, desktop: desktopTab, access: accessTab }[tab](h);
    const b = bindingOf(h);
    const accept = h.membership.state === 'active'
      ? `<label class="row small" style="cursor:pointer"><span class="switch"><input type="checkbox" data-action="host-accept" data-id="${esc(h.id)}" ${h.accepting ? 'checked' : ''} ${can('manage_hosts').ok ? '' : 'disabled'} aria-label="${T('接收新任务', 'Accept new work')}"><i></i></span>${T('接收新任务', 'Accept new work')}</label>` : '';
    return `<a class="back" href="#/hosts">${icon('left', 'sm')}${T('主机与算力', 'Hosts & compute')}</a>
      <div class="page-h"><div class="row gap-lg top"><span class="host-ico" style="width:46px;height:46px;border-radius:13px">${icon(h.kind === 'cloud' ? 'cloud' : 'server', 'lg')}</span><div>
        <div class="row wrap"><h1>${esc(h.name)}</h1>${U.hostState(h)}</div>
        <p class="small muted">${h.kind === 'cloud' ? T('云端', 'Cloud') : T('本地', 'Local')} · ${esc(h.os)} · ${esc(h.arch)} · ${esc(L(h.location) || '')} · ${T('心跳', 'heartbeat')} ${U.agoTag(h.lastHeartbeatAt)} · <span class="mono">${esc(b ? b.endpoint : '')}</span></p></div></div>
        <div class="row wrap">${accept}</div></div>
      ${h.status === 'waiting_connection' ? `<div class="note warn" style="margin-bottom:14px">${icon('offline')}<div>${T('已加入组织，等待连接。资格已保留并自动重连，不会重复兑换或重新授权。', 'Joined; waiting to connect. Membership is kept and reconnects automatically without redeeming again.')} ${U.btn({ action: 'host-connect', data: { id: h.id }, label: T('重试连接', 'Retry connection'), size: 'sm' })}</div></div>` : ''}
      <div class="tabs" role="tablist">${tabs.map(([k, zh, en]) => `<button class="tab" role="tab" aria-selected="${tab === k}" data-action="set-tab" data-scope="${scope}" data-tab="${k}">${esc(T(zh, en))}</button>`).join('')}</div>
      ${body}`;
  }

  FM.views.hosts = r => (r.parts[1] ? detail(r.parts[1]) : list());

  /* ---------------------------------------------------- Console actions */

  const SHELL = {
    uptime: () => ['14:02  up 12 days,  3:41,  load averages: 1.42 1.51 1.38'],
    whoami: () => ['fm-envd'],
    'df -h': () => ['Filesystem   Size  Used Avail Use%', '/dev/disk3   460G  211G  249G  46%'],
    'git status': () => ['On branch alpha/installers', 'nothing to commit, working tree clean'],
    ls: () => ['AGENTS.md  HEARTBEAT.md  OKR.md  memory/  src/'],
  };

  function out(hostId, lines) {
    ui.console[hostId] = (ui.console[hostId] || []).concat(lines).slice(-80);
  }

  function sendCmd(hostId, instId, cmd, text) {
    const org = O();
    const ctx = can('operate');
    const r = M.hostCommand(P(), org, hostId, instId || null, cmd, ctx, U.now());
    if (!r.ok) { toast(U.permText(r.code) || r.code, 'warn'); return; }
    U.save();
    const i = U.inst(instId);
    const target = `${(U.host(hostId) || {}).name}${i ? ` / ${i.name}` : ''}`;
    out(hostId, [{ t: `$ ${cmd === 'shell' ? text : `${cmd} ${i ? i.name : ''}`}   # ${r.receipt.id} → ${target}`, c: 'c-dim' }]);
    render();
    if (U.root.faults.coordinatorDown) { out(hostId, [{ t: T('… 未收到回执（Coordinator 不可达）', '… no receipt (coordinator unreachable)'), c: 'c-warn' }]); render(); return; }
    U.later(700, () => ack(hostId, r.receipt.id, cmd, instId, text));
  }

  function ack(hostId, rid, cmd, instId, text) {
    const org = O();
    M.ackCommand(P(), org, rid, U.now());
    U.save();
    const i = U.inst(instId);
    const lines = {
      status: [{ t: `${i ? i.name : 'host'}: ${i ? i.status : 'online'} · ${i ? i.runtime : ''}`, c: 'c-ok' }],
      logs: [{ t: '[14:01:52] smoke: windows-11 run 24/30 … ok', c: '' }, { t: '[14:02:10] measure: install_success=82% (window=30)', c: '' }, { t: T('[14:02:11] heartbeat 已上报', '[14:02:11] heartbeat reported'), c: 'c-dim' }],
      restart: [{ t: T(`${i ? i.name : ''} 已重启；相关 OKR 保留结果并等待明确继续`, `${i ? i.name : ''} restarted; its OKRs keep results and wait for an explicit continue`), c: 'c-warn' }],
      stop: [{ t: T(`${i ? i.name : ''} 已停止；只暂停它负责的 OKR`, `${i ? i.name : ''} stopped; only its OKRs are paused`), c: 'c-warn' }],
      shell: (SHELL[String(text).trim()] ? SHELL[String(text).trim()]().map(t => ({ t })) : [{ t: T('演示 Shell 不支持该命令', 'The demo shell does not support that command'), c: 'c-err' }]),
    }[cmd] || [];
    out(hostId, lines.concat([{ t: `✓ ${rid} ${T('已回执', 'acknowledged')}`, c: 'c-dim' }]));
    if (FM.review) FM.review.mark(`host.cmd.${cmd}`);
    render();
    const el = document.getElementById(`console-${hostId}`);
    if (el) el.scrollTop = el.scrollHeight;
  }

  Object.assign(FM.actions, {
    'cmd-ask': el => {
      const { host, inst, cmd } = el.dataset;
      if (cmd === 'restart' || cmd === 'stop') { U.openDialog('cmd-confirm', { host, inst, cmd }); return; }
      const text = cmd === 'shell' ? String(U.f(`con-${host}.shell`, '')).trim() : '';
      if (cmd === 'shell' && !text) { toast(T('输入一条命令', 'Enter a command'), 'warn'); return; }
      if (ui.tab[`host-${host}`] !== 'console') ui.tab[`host-${host}`] = 'console';
      sendCmd(host, inst, cmd, text);
      if (cmd === 'shell') U.setF(`con-${host}.shell`, '');
    },
    'cmd-go': el => { const { host, inst, cmd } = el.dataset; ui.dialog = null; ui.tab[`host-${host}`] = 'console'; sendCmd(host, inst, cmd); },
    'cmd-query': el => { ack(el.dataset.host, el.dataset.id, 'status', null); toast(T('已查询到回执，没有重复发送命令。', 'Receipt found; the command was not resent.'), 'ok'); },
    'host-accept': el => {
      const h = U.host(el.dataset.id);
      h.accepting = el.checked;
      U.save();
      toast(h.accepting ? T('已恢复接单。', 'Accepting new work again.') : T('已暂停接单：只影响新分配，现有运行继续。', 'Paused intake: only new assignments stop; current work continues.'), 'ok');
      render();
    },
    'host-connect': el => {
      const res = M.connectHost(O(), el.dataset.id, !U.root.faults.coordinatorDown, U.now());
      U.save();
      toast(res.ok ? T('已连接并上报心跳。无需再次兑换邀请码。', 'Connected and reporting. No need to redeem again.') : T('Coordinator 仍不可达，资格保留，稍后自动重试。', 'The coordinator is still unreachable; membership is kept and retried.'), res.ok ? 'ok' : 'warn');
      render();
    },
    'host-revoke': el => U.openDialog('host-revoke', { id: el.dataset.id }),
    'host-revoke-do': el => {
      const local = localService().hostId === el.dataset.id;
      U.submitTx({ kind: 'host.revoke', payload: { hostId: el.dataset.id } }, {
        ok: local
          ? T('本机主机资格已撤销；后台服务已停止并卸载，主机与 Coordinator 密钥已从钥匙串清理。', 'This computer’s membership is revoked; the background service was stopped and removed, and host and coordinator keys were cleared from the keychain.')
          : T('主机资格与执行授权已撤销；新的受保护操作将被拒绝。', 'Membership and grant revoked; new protected operations will be refused.'),
        onConfirmed: (r, pp) => {
          if (local) M.removeLocalService(pp);
          ui.dialog = null;
          if (FM.review) FM.review.mark('host.revoked');
        },
      });
    },
    'local-service-restart': () => {
      const res = M.restartLocalService(P(), O());
      if (!res.ok) { toast(res.code, 'warn'); return; }
      U.save();
      toast(res.stale.length
        ? T(`服务已重启。App 创建的 Agent 身份不变；${res.stale.length} 个手动导入的实例 ID 随进程变化，需要重新关联。`, `Service restarted. App-created Agents keep their identity; ${res.stale.length} imported instance(s) changed ID with the process and need relinking.`)
        : T('服务已重启，Agent 身份不变。', 'Service restarted; Agent identities are unchanged.'), res.stale.length ? 'warn' : 'ok', 5200);
      if (FM.review) FM.review.mark('host.restarted');
      render();
    },
    'local-service-toggle': () => {
      const p = P();
      const svc = localService();
      const res = M.setLocalServiceRunning(p, O(), svc.state !== 'running', U.now());
      U.save();
      toast(svc.state === 'running'
        ? T('本机服务已启动，主机重新上线。', 'The service started; this host is back online.')
        : T('本机服务已停止：主机离线，链上资格保留；它负责的 OKR 会显示状态未知。', 'The service stopped: this host is offline and keeps its chain membership; its OKRs show an unknown state.'), res.ok || svc.state === 'stopped' ? 'info' : 'warn');
      render();
    },
    'local-endpoint-save': () => {
      const svc = localService();
      const scope = U.f('ep.scope', 'loopback');
      const endpoint = String(U.f('ep.url', '')).trim();
      if (!M.validEndpoint(scope, endpoint)) {
        toast(scope === 'loopback'
          ? T('仅本机入口应为 http://127.0.0.1:<端口>', 'A this-computer-only endpoint is http://127.0.0.1:<port>')
          : T('局域网与公网入口必须使用 HTTPS，且不能是本机回环地址。', 'Network and internet endpoints must use HTTPS and cannot be a loopback address.'), 'warn');
        return;
      }
      U.submitTx({ kind: 'binding.update', payload: { bindingId: svc.bindingId, scope, endpoint } }, {
        ok: T('入口已更新为新版本；旧版本的邀请已失效，本机主机正在重新连接。', 'The endpoint has a new version; old invitations are void and this host is reconnecting.'),
        onConfirmed: (r, pp) => {
          ui.dialog = null;
          U.clearForm('ep');
          U.later(800, () => { const o = pp.data[r.tx.orgId]; if (M.localServiceFor(pp).state === 'running') M.connectHost(o, M.localServiceFor(pp).hostId, true, U.now()); U.save(); render(); });
        },
      });
    },
    desk: el => {
      const { host, k, v } = el.dataset;
      const s = ui.desktop[host];
      if (k === 'connected') { s.connected = !!v; s.mode = 'view'; }
      else if (k === 'reconnect') { s.connected = true; s.mode = 'view'; toast(T('已重新连接：输入已释放，需要时再次取得控制。', 'Reconnected: input was released; take control again if needed.'), 'info'); }
      else s[k] = v;
      if (k === 'mode' && v === 'control' && FM.review) FM.review.mark('host.desktop.control');
      render();
    },
    'desk-stats': el => { ui.desktop[el.dataset.host].stats = el.checked; render(); },
    'desk-text': el => { toast(T('已发送演示文本输入。', 'Sent demo text input.'), 'ok'); U.setF(`desk-${el.dataset.host}.text`, ''); render(); },
  });

  FM.dialogs['cmd-confirm'] = ({ host, inst, cmd }) => {
    const h = U.host(host);
    const i = U.inst(inst);
    const okrs = O().okrs.filter(o => o.instanceId === inst && o.lifecycle === 'ACTIVE');
    return {
      title: cmd === 'stop' ? T('停止实例', 'Stop instance') : T('重启实例', 'Restart instance'), size: 'sm',
      body: `<dl class="kv"><dt>${T('主机', 'Host')}</dt><dd>${esc(h.name)}</dd><dt>${T('实例', 'Instance')}</dt><dd>${esc(i ? i.name : '—')} · ${esc(i ? i.runtime : '')}</dd><dt>${T('范围', 'Scope')}</dt><dd class="mono small">${esc(i ? i.workspace : '')}</dd><dt>${T('影响', 'Impact')}</dt><dd>${okrs.length ? okrs.map(o => esc(L(o.title))).join('；') + T(' 将暂停', ' will pause') : T('无 OKR 受影响', 'No OKRs affected')}</dd></dl>
        <div class="note">${icon('info')}<div>${cmd === 'stop' ? T('停止只影响这个实例负责的 OKR；恢复后需要你明确继续。', 'Stopping affects only this instance’s OKRs; you continue explicitly afterwards.') : T('重启后保留结果与检查点，等待你明确继续。', 'After restart, results and checkpoints are kept until you continue.')}</div></div>`,
      foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'cmd-go', data: { host, inst, cmd }, label: T('确认发送', 'Send'), kind: cmd === 'stop' ? 'danger' : 'primary', perm: 'operate' })}`,
    };
  };

  FM.dialogs['host-revoke'] = ({ id }) => {
    const h = U.host(id);
    const local = localService().hostId === id;
    const tx = U.latestTx(t => t.kind === 'host.revoke' && t.payload.hostId === id);
    return {
      title: T('撤销主机资格', 'Revoke host membership'), sub: esc(h.name), size: 'sm',
      body: `<p class="small">${T('撤销 HostMembership 与执行授权。连接仍在时也会拒绝新的受保护操作；该主机上的 OKR 暂停。', 'Revokes HostMembership and the execution grant. New protected operations are refused even while connected; OKRs on this host pause.')}</p>${local ? `<div class="note warn">${icon('alert')}<div>${T('这是本机：确认后同时停止并卸载后台服务，并从钥匙串清理主机与 Coordinator 密钥。', 'This is this computer: confirming also stops and removes the background service and clears the host and coordinator keys from the keychain.')}</div></div>` : ''}${tx ? U.txLine(tx) : ''}`,
      foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'host-revoke-do', data: { id }, label: T('签名撤销', 'Sign and revoke'), kind: 'danger solid', perm: 'manage_hosts', disabled: !!(tx && tx.state === 'pending') })}`,
    };
  };

  FM.dialogs['local-endpoint'] = () => {
    const svc = localService();
    const b = M.find(O().bindings, svc.bindingId);
    if (!b) return null;
    const scope = U.f('ep.scope', b.scope || 'loopback');
    const defaults = { loopback: 'http://127.0.0.1:7443', lan: 'https://fm-host.local:7443', public: 'https://' };
    const url = U.f('ep.url', scope === (b.scope || 'loopback') ? b.endpoint : defaults[scope]);
    const tx = U.latestTx(t => t.kind === 'binding.update' && t.payload.bindingId === b.id && t.state !== 'confirmed');
    return {
      title: T('修改 Coordinator 入口', 'Change the coordinator endpoint'), size: 'lg', sub: `${T('当前', 'Current')} <span class="mono">${esc(b.endpoint)}</span> · v${b.version || 1}`,
      body: `<div class="col">${['loopback', 'lan', 'public'].map(k => `<button class="opt" data-action="ep-scope" data-scope="${k}" aria-pressed="${scope === k}"><span class="ico">${icon(k === 'loopback' ? 'laptop' : k === 'lan' ? 'link' : 'globe')}</span><span class="grow"><span class="strong">${esc(T(SCOPE[k][0], SCOPE[k][1]))}</span><span class="small muted" style="display:block">${esc({
          loopback: T('只有这台电脑能访问；可以用 HTTP。', 'Only this computer can connect; HTTP is allowed.'),
          lan: T('同一局域网的手机和电脑可以访问；需要 HTTPS 证书。', 'Phones and computers on the same network can connect; needs an HTTPS certificate.'),
          public: T('任何网络都能访问，适合在外面用手机管理；需要 HTTPS 证书和可达的域名。', 'Reachable from anywhere, e.g. managing from your phone outside; needs HTTPS and a reachable domain.'),
        }[k])}</span></span></button>`).join('')}</div>
        <div class="field"><label for="ep-url">${T('入口地址', 'Endpoint')}</label><input id="ep-url" class="input mono" data-f="ep.url" value="${esc(url)}"></div>
        <div class="note">${icon('info')}<div>${T('确认后绑定版本加一：用旧版本签发、尚未兑换的邀请会失效；这个入口下的主机重新连接到新地址，链上资格不变。', 'Confirming bumps the binding version: unredeemed invitations for the old version become void; hosts on this endpoint reconnect to the new address and keep their membership.')}</div></div>
        ${tx ? U.txLine(tx) : ''}`,
      foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'local-endpoint-save', label: T('签名更新入口', 'Sign and update'), kind: 'primary', perm: 'manage_hosts', disabled: !!(tx && tx.state === 'pending') || (scope === (b.scope || 'loopback') && url === b.endpoint), why: T('入口没有变化', 'The endpoint is unchanged') })}`,
    };
  };
  FM.actions['ep-scope'] = el => {
    U.setF('ep.scope', el.dataset.scope);
    U.setF('ep.url', { loopback: 'http://127.0.0.1:7443', lan: 'https://fm-host.local:7443', public: 'https://' }[el.dataset.scope]);
    render();
  };

  /* ------------------------------------------------------- Invitations */

  const B32 = M.B32;
  function makeCode() {
    const b = U.randomBytes(24);
    let s = '';
    for (let i = 0; i < 24; i++) s += B32[b[i] & 31];
    return `FMI1-${s.match(/.{4}/g).join('-')}`;
  }
  FM.makeInviteCode = makeCode;
  const normCode = c => String(c || '').toUpperCase().replace(/[\s-]/g, '');
  const codeDigest = c => M.digest(`fm-invite:1:${normCode(c)}`);

  function qr(seed) {
    let h = parseInt(M.digest(seed).slice(0, 8), 16);
    const n = 21;
    let cells = '';
    const finder = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" rx="1.5" style="fill:none;stroke:var(--text)" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" style="fill:var(--text)"/>`;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if ((x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)) continue;
        h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
        if (h & 1) cells += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
      }
    }
    return `<div class="qr" title="${T('示意二维码，不能扫描', 'Illustrative QR; not scannable')}"><svg viewBox="-0.5 -0.5 22 22" aria-hidden="true"><g style="fill:var(--text)">${cells}</g>${finder(0, 0)}${finder(14, 0)}${finder(0, 14)}</svg></div>`;
  }
  FM.qr = qr;

  FM.dialogs.invite = st => {
    const org = O();
    const binding = org.bindings.find(b => b.state === 'confirmed');
    let stage = st.stage || (binding ? 'create' : 'binding');
    const title = T('接入主机', 'Add a host');
    const steps = [['binding', '连接入口', 'Endpoint'], ['create', '创建邀请码', 'Create invitation'], ['share', '私下传递', 'Share privately'], ['host', '新主机确认', 'Host confirms'], ['done', '上线', 'Online']];
    const idx = steps.findIndex(s => s[0] === stage);
    const nav = `<div class="steps-nav" style="margin:0">${steps.filter(s => s[0] !== 'binding' || !binding || stage === 'binding').map(([k, zh, en], i) => `<span class="${k === stage ? 'on' : steps.findIndex(s => s[0] === k) < idx ? 'done' : ''}"><b>${steps.findIndex(s => s[0] === k) < idx ? '✓' : i + 1}</b>${esc(T(zh, en))}</span>`).join('')}</div>`;
    let body = '', foot = '';

    if (stage === 'binding') {
      const pend = org.bindings.find(b => b.state === 'pending');
      const tx = pend && U.latestTx(t => t.kind === 'binding.create' && t.payload.bindingId === pend.id);
      body = `<p class="small">${T('这个组织还没有连接入口。先由有权设备提交 CoordinatorBinding，确认后才能签发邀请。', 'This organization has no connection endpoint yet. An authorized device submits a CoordinatorBinding first; invitations follow once it is confirmed.')}</p>
        <div class="field"><label for="bind-ep">${T('Coordinator 端点', 'Coordinator endpoint')}</label><input id="bind-ep" class="input mono" data-f="invite.endpoint" value="${esc(U.f('invite.endpoint', 'coordinator.home.arpa:7443'))}"></div>
        <div class="note">${icon('info')}<div>${T('填写端点不构成信任或授权；链上绑定成功也不证明端点在线。原型不会访问你输入的地址。', 'Entering an endpoint grants no trust; a confirmed binding proves no liveness. The prototype never contacts the address.')}</div></div>
        ${tx ? U.txLine(tx) : ''}`;
      foot = `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'bind-create', label: T('签名提交绑定', 'Sign binding'), kind: 'primary', perm: 'manage_hosts', disabled: !!(tx && tx.state === 'pending') })}`;
    }

    if (stage === 'create') {
      const ttl = U.f('invite.ttl', '1h');
      const desk = U.f('invite.desktop', false);
      const inv = st.inviteId ? M.find(org.invites, st.inviteId) : null;
      const tx = inv && U.latestTx(t => t.kind === 'invite.create' && t.payload.inviteId === inv.id);
      body = `<div class="field"><span class="label">${T('邀请有效期（最晚兑换时间）', 'Valid for (latest redemption)')}</span><div class="seg">${[['15m', '15 分钟', '15 min'], ['1h', '1 小时', '1 hour'], ['24h', '24 小时', '24 hours']].map(([v, zh, en]) => `<button data-action="set-f" data-key="invite.ttl" data-value="${v}" aria-pressed="${ttl === v}">${esc(T(zh, en))}</button>`).join('')}</div></div>
        <div class="field"><span class="label">${T('项目范围', 'Workspaces')}</span>${org.workspaces.map(ws => `<label class="check"><input type="checkbox" data-f="invite.ws-${esc(ws.id)}" ${U.f(`invite.ws-${ws.id}`, true) ? 'checked' : ''}><span>${esc(ws.name)} <span class="muted mono small">${esc(ws.path)}</span></span></label>`).join('') || `<span class="small muted">${T('尚无工作区', 'No workspaces yet')}</span>`}</div>
        <div class="card soft tight"><div class="row between"><div><div class="strong">${T('预授权执行权限 · 7 天', 'Pre-authorized execution · 7 days')}</div><div class="tiny muted">${T('执行授权有效期独立于邀请有效期；不授予组织管理权限；每个邀请只允许 1 台主机。', 'The execution grant runs separately from the invitation; no org admin rights; one host per invitation.')}</div></div></div>
          <label class="check mt-8"><input type="checkbox" data-f="invite.desktop" ${desk ? 'checked' : ''}>${T('同时授予远程桌面控制', 'Also grant remote desktop control')}</label></div>
        <div class="small muted">${T('连接入口', 'Endpoint')}：<span class="mono">${esc(binding.endpoint)}</span> · ${T('签名费用预计', 'est. fee')} ${U.sui(M.feeFor('invite.create'))}</div>
        ${tx ? U.txLine(tx) : ''}`;
      foot = `<button class="btn ghost left" data-action="open" data-dialog="invites">${T('管理已有邀请码', 'Manage invitations')}</button><button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'invite-create', label: T('签名创建邀请码', 'Sign and create'), kind: 'primary', perm: 'manage_hosts', disabled: !!(tx && tx.state === 'pending') })}`;
    }

    if (stage === 'share') {
      const inv = M.find(org.invites, st.inviteId);
      const code = U.secrets.get(inv.id);
      body = `<div class="note ok">${icon('check')}<div>${T('邀请已上链确认。邀请码只在本页内存中，可兑换一次。', 'The invitation is confirmed on chain. The code lives only in this page’s memory and redeems once.')}</div></div>
        ${code ? `<div class="row top gap-lg">${qr(inv.id)}<div class="col grow"><div class="code-box"><span class="grow">${esc(code)}</span><button class="btn ghost icon sm" data-action="copy" data-copy="${esc(code)}" data-done="${esc(T('已复制：请私下传递', 'Copied: share it privately'))}" aria-label="${T('复制', 'Copy')}">${icon('copy')}</button></div>
          <dl class="kv"><dt>${T('最晚兑换', 'Redeem by')}</dt><dd>${U.dateTime(inv.expiresAt)} · ${U.until(inv.expiresAt)}</dd><dt>${T('执行授权', 'Grant')}</dt><dd>${T('7 天', '7 days')}${inv.desktop ? T(' · 含远程桌面', ' · with desktop') : ''}</dd><dt>${T('公开信息', 'On chain')}</dt><dd class="mono small">${esc(inv.pubKey)}…</dd></dl></div></div>`
        : `<div class="note warn">${icon('alert')}<div>${T('页面刷新后无法再次显示邀请码（链上只存验证公钥）。如未保存，请撤销后重新生成。', 'After a reload the code cannot be shown again (only the public verification key is on chain). If you did not save it, revoke and create a new one.')}</div></div>`}
        <div class="small muted">${T('邀请码按凭据处理：不进入日志、普通导出、公开 URL 或分析事件。泄漏时可撤销未使用的邀请。', 'Treat the code as a credential: never in logs, ordinary exports, public URLs or analytics. Revoke unused invitations if leaked.')}</div>`;
      foot = `<button class="btn" data-action="close-dialog">${T('完成', 'Done')}</button>${code ? `<button class="btn primary" data-action="invite-stage" data-stage="host">${icon('server', 'sm')}${T('在新主机使用（演示）', 'Use on the new host (demo)')}</button>` : ''}`;
    }

    if (stage === 'host') {
      const inv = st.inviteId ? M.find(org.invites, st.inviteId) : null;
      const found = st.found ? M.find(org.invites, st.found) : null;
      const tx = found && U.latestTx(t => t.kind === 'invite.redeem' && t.payload.inviteId === found.id);
      const status = found ? M.inviteStatus(found, U.now()) : null;
      body = `<div class="note info">${icon('server')}<div>${T('演示：你现在代表新主机的拥有者。真实流程在新主机的 App 或 envd 中完成。', 'Demo: you are now the new host’s owner. In reality this happens in the host’s app or envd.')}</div></div>
        <div class="form-grid"><div class="field"><label for="h-name">${T('主机名称', 'Host name')}</label><input id="h-name" class="input" data-f="invite.hname" value="${esc(U.f('invite.hname', 'Studio PC'))}"></div>
          <div class="field"><label for="h-os">${T('系统', 'System')}</label><select id="h-os" class="select" data-f="invite.hos">${['Ubuntu 24.04', 'Windows 11', 'macOS 15.6'].map(o => `<option ${U.f('invite.hos', 'Ubuntu 24.04') === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
          <div class="field full"><span class="label">${T('类型', 'Kind')}</span><div class="seg"><button data-action="set-f" data-key="invite.hkind" data-value="local" aria-pressed="${U.f('invite.hkind', 'local') === 'local'}">${T('本地（有桌面）', 'Local (desktop)')}</button><button data-action="set-f" data-key="invite.hkind" data-value="cloud" aria-pressed="${U.f('invite.hkind', 'local') === 'cloud'}">${T('云端（无桌面，envd）', 'Cloud (headless, envd)')}</button></div></div>
          <div class="field full"><label for="h-code">${T('邀请码', 'Invitation code')}</label><div class="row"><input id="h-code" class="input mono" data-f="invite.code" value="${esc(U.f('invite.code', inv ? U.secrets.get(inv.id) || '' : ''))}" placeholder="FMI1-…"><button class="btn" data-action="invite-read">${T('读取邀请', 'Read invitation')}</button></div>${st.err ? `<div class="err-t">${icon('x', 'xs')}${esc(st.err)}</div>` : ''}</div></div>
        ${found ? `<div class="card soft tight"><div class="label">${T('链上邀请（由 App 读取）', 'On-chain invitation (read by the app)')}</div>
          <dl class="kv mt-8"><dt>${T('组织', 'Organization')}</dt><dd>${esc(L(U.orgMeta().name))}</dd><dt>${T('范围', 'Scope')}</dt><dd>${found.workspaceIds.map(id => esc((M.find(org.workspaces, id) || {}).name || id)).join('、') || '—'}</dd><dt>${T('执行授权', 'Grant')}</dt><dd>${T('7 天', '7 days')}${found.desktop ? T(' · 含远程桌面', ' · with desktop') : ''}</dd><dt>${T('最晚兑换', 'Redeem by')}</dt><dd>${U.until(found.expiresAt)}</dd><dt>${T('状态', 'State')}</dt><dd>${esc(INV_STATE[status] ? T(...INV_STATE[status]) : status)}</dd></dl>
          <label class="check mt-8"><input type="checkbox" data-f="invite.consent" ${U.f('invite.consent', false) ? 'checked' : ''}>${T('我同意本机加入该组织，并接受上述执行权限。设备密钥在本机生成。', 'I agree this machine joins the organization with the permissions above. The device key is generated locally.')}</label></div>` : ''}
        ${tx ? U.txLine(tx) : ''}`;
      foot = `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'invite-redeem', label: T('加入组织并连接', 'Join and connect'), kind: 'primary', disabled: !found || status !== 'active' || !U.f('invite.consent', false) || !!(tx && tx.state === 'pending'), why: !found ? T('先读取邀请', 'Read the invitation first') : status !== 'active' ? T('邀请不可用', 'Invitation unusable') : T('请先勾选同意', 'Give consent first') })}`;
    }

    if (stage === 'done') {
      const h = U.host(st.hostId);
      const waiting = h && h.status !== 'online';
      body = waiting
        ? `<div class="note warn">${icon('offline')}<div><strong>${T('已加入组织，等待连接', 'Joined; waiting to connect')}</strong><br>${T('链上入组已成功，但 Coordinator 不可达。资格已保留并自动重连，不会重复兑换或重新授权。', 'Membership succeeded on chain but the coordinator is unreachable. It retries automatically without redeeming again.')}</div></div>`
        : `<div class="calm">${icon('check')}<span>${T(`${h ? h.name : ''} 已加入并上线，首个心跳已上报。`, `${h ? h.name : ''} joined and is online; the first heartbeat arrived.`)}</span></div>
          <div class="small muted">${T('一笔交易内完成：校验邀请、标记已消费、创建主机资格与执行授权。之后重连不再需要邀请码。', 'One transaction validated the invitation, consumed it, and created membership plus the grant. Reconnecting never needs the code again.')}</div>`;
      foot = `${waiting ? U.btn({ action: 'host-connect', data: { id: st.hostId }, label: T('重试连接', 'Retry connection') }) : ''}<button class="btn primary" data-action="go-close" data-to="hosts/${esc(st.hostId)}">${T('查看主机', 'View host')}</button>`;
    }

    return {
      title, size: 'lg', sticky: stage === 'host',
      sub: T('管理员签名一次预授权；新主机输入一次即可入组、授权并上线。', 'The admin signs once; the new host enters the code once to join, get authority and come online.'),
      body: `${nav}${body}${stage !== 'done' ? `<details class="small"><summary class="muted" style="cursor:pointer">${T('高级：没有邀请码时改用设备申请与人工审核', 'Advanced: device request and manual review without a code')}</summary><div class="note mt-8">${icon('info')}<div>${T('envd 提交 HostJoinRequest，管理员核对设备指纹后批准资格并授予执行权限。普通 AgentCertificate 不能代替主机准入。原型 v2 只展示说明。', 'envd submits a HostJoinRequest; an admin checks the device fingerprint, then approves membership and grants execution. An AgentCertificate never substitutes for host admission. v2 shows this as a description only.')}</div></div></details>` : ''}`,
      foot,
    };
  };

  const INV_STATE = { signing: ['待确认', 'Pending'], active: ['有效', 'Active'], consumed: ['已使用', 'Used'], expired: ['已过期', 'Expired'], revoked: ['已撤销', 'Revoked'] };

  FM.dialogs.invites = () => {
    const org = O();
    return {
      title: T('邀请码', 'Invitations'), size: 'lg',
      body: `<div class="list">${org.invites.map(inv => {
        const st = M.inviteStatus(inv, U.now());
        const tone = { active: 'ok', consumed: 'info', expired: 'muted', revoked: 'danger', signing: 'warn' }[st];
        const host = inv.consumedBy ? U.host(inv.consumedBy) : null;
        return `<div class="item"><span class="mono small">${esc(inv.id)}</span><div class="grow small">${T('创建', 'Created')} ${U.dateTime(inv.createdAt)} · ${esc(inv.ttl)}${inv.desktop ? T(' · 含桌面', ' · desktop') : ''}${host ? ` · ${T('已被', 'used by')} <a href="#/hosts/${esc(host.id)}" data-action="go-close" data-to="hosts/${esc(host.id)}">${esc(host.name)}</a>${T(' 使用', '')}` : ''}</div><span class="chip ${tone}">${esc(T(...INV_STATE[st]))}</span>${st === 'active' || st === 'signing' ? U.btn({ action: 'invite-revoke', data: { id: inv.id }, label: T('撤销', 'Revoke'), size: 'sm', kind: 'danger', perm: 'manage_hosts' }) : ''}</div>`;
      }).join('') || `<div class="muted small">${T('暂无', 'None')}</div>`}</div>
      <div class="note">${icon('info')}<div>${T('未使用邀请的撤销不等于撤销已入组主机；邀请已消费时，请到对应主机撤销资格。', 'Revoking an unused invitation does not revoke enrolled hosts; for a used one, revoke the host itself.')}</div></div>`,
      foot: `<button class="btn" data-action="open" data-dialog="invite">${T('创建新邀请', 'New invitation')}</button><button class="btn primary" data-action="close-dialog">${T('完成', 'Done')}</button>`,
    };
  };

  FM.dialogs.bindings = () => {
    const org = O();
    return {
      title: T('连接入口', 'Connections'), size: 'lg',
      sub: T('组织认可的 Coordinator 端点。每个连接独立：一个断开不影响其他连接上的主机。', 'Coordinator endpoints the organization recognizes. Each is independent: one disconnecting leaves the others’ hosts alone.'),
      body: `<div class="list">${org.bindings.map(b => {
        const hosts = org.hosts.filter(h => h.bindingId === b.id);
        return `<div class="item"><span class="host-ico">${icon('link')}</span><div class="grow"><div class="mono small strong">${esc(b.endpoint)} ${b.scope ? `<span class="chip ${{ loopback: 'outline', lan: 'info', public: 'warn' }[b.scope]}" style="font-family:var(--font)">${esc({ loopback: T('仅本机', 'This computer only'), lan: T('局域网', 'Local network'), public: T('公网', 'Internet') }[b.scope])}</span>` : ''}</div><div class="tiny muted">${esc(L(b.label) || '')} · ${T(`${hosts.length} 台主机`, `${hosts.length} hosts`)} · ${b.state === 'confirmed' ? T('链上已确认', 'Confirmed on chain') : T('待确认', 'Pending')}</div></div>
          <span class="st ${b.online ? 'ok' : 'muted'}">${icon(b.online ? 'check' : 'offline')}${b.online ? T('已连接', 'Connected') : T('已断开', 'Disconnected')}</span>
          ${b.state === 'confirmed' ? U.btn({ action: 'bind-toggle', data: { id: b.id }, label: b.online ? T('断开', 'Disconnect') : T('重新连接', 'Reconnect'), size: 'sm', perm: 'manage_hosts' }) : ''}</div>`;
      }).join('') || `<div class="muted small">${T('还没有连接入口', 'No endpoints yet')}</div>`}</div>
      <div class="note">${icon('info')}<div>${T('生产客户端目前为单连接；此处展示链上组织绑定的多连接目录。任意 URL 不能授予主机资格。', 'Today’s production client holds one connection; this shows the multi-connection directory bound on chain. No URL can grant membership.')}</div></div>`,
      foot: `${U.btn({ action: 'invite-stage', data: { stage: 'binding', dialog: 'invite' }, label: T('新增连接入口', 'Add endpoint'), icon: 'plus', perm: 'manage_hosts' })}<button class="btn primary" data-action="close-dialog">${T('完成', 'Done')}</button>`,
    };
  };

  Object.assign(FM.actions, {
    'invite-stage': el => {
      if (el.dataset.dialog === 'invite') { U.openDialog('invite', { stage: el.dataset.stage }); return; }
      ui.dialog.stage = el.dataset.stage;
      render();
    },
    'bind-create': () => {
      const p = P();
      const org = O();
      const ep = String(U.f('invite.endpoint', 'coordinator.home.arpa:7443')).trim();
      if (!/^[\w.-]+(:\d+)?$/.test(ep)) { toast(T('请输入主机名与端口，例如 coordinator.home.arpa:7443', 'Enter a host and port, e.g. coordinator.home.arpa:7443'), 'warn'); return; }
      const b = { id: M.nextId(p, 'bind'), endpoint: ep, label: { zh: '新连接入口', en: 'New endpoint' }, state: 'pending', online: false };
      org.bindings.push(b);
      U.submitTx({ kind: 'binding.create', payload: { bindingId: b.id } }, {
        ok: T('连接入口已绑定到组织。', 'The endpoint is bound to the organization.'),
        onConfirmed: (r, pp) => { const x = M.find(pp.data[r.tx.orgId].bindings, b.id); if (x) x.online = true; if (ui.dialog && ui.dialog.type === 'invite') ui.dialog.stage = 'create'; },
        onFailed: (r, pp) => { const o = pp.data[r.tx.orgId]; o.bindings = o.bindings.filter(x => x.id !== b.id); },
      });
    },
    'bind-toggle': el => {
      const org = O();
      const b = M.find(org.bindings, el.dataset.id);
      b.online = !b.online;
      org.hosts.filter(h => h.bindingId === b.id).forEach(h => {
        if (!b.online) { h.prevStatus = h.status; if (h.status === 'online') h.status = 'offline'; }
        else if (h.prevStatus === 'online') { h.status = 'online'; h.lastHeartbeatAt = U.now(); }
      });
      U.save();
      toast(b.online ? T('已重新连接；主机在线状态重新观测。', 'Reconnected; host status is observed again.') : T('已断开：该连接上的主机显示为未知，其他连接不受影响。', 'Disconnected: hosts on it show unknown; other connections are unaffected.'), 'ok');
      render();
    },
    'invite-create': () => {
      const p = P();
      const org = O();
      const code = makeCode();
      const wsIds = org.workspaces.filter(ws => U.f(`invite.ws-${ws.id}`, true)).map(ws => ws.id);
      const res = M.createInvite(p, org, { ttl: U.f('invite.ttl', '1h'), desktop: U.f('invite.desktop', false), workspaceIds: wsIds }, codeDigest(code), U.now());
      if (!res.ok) { toast(res.code, 'warn'); return; }
      U.secrets.set(res.invite.id, code);
      ui.dialog.inviteId = res.invite.id;
      U.submitTx({ kind: 'invite.create', payload: { inviteId: res.invite.id } }, {
        onConfirmed: () => { if (ui.dialog && ui.dialog.inviteId === res.invite.id) ui.dialog.stage = 'share'; if (FM.review) FM.review.mark('invite.created'); },
        onFailed: () => { toast(T('交易失败：邀请未生效，可以重试（使用新交易）。', 'Transaction failed: the invitation is not active; retry with a new transaction.'), 'warn'); },
      });
    },
    'invite-read': () => {
      const org = O();
      const prefilled = ui.dialog.inviteId ? U.secrets.get(ui.dialog.inviteId) || '' : '';
      const dg = codeDigest(U.f('invite.code', prefilled));
      const inv = org.invites.find(i => i.codeDigest === dg);
      ui.dialog.err = null;
      ui.dialog.found = null;
      if (!inv) ui.dialog.err = T('邀请码无效或不属于任何可读取的邀请', 'The code is invalid or matches no readable invitation');
      else {
        const st = M.inviteStatus(inv, U.now());
        if (st !== 'active') ui.dialog.err = T(`邀请${T(...INV_STATE[st])}，不能兑换`, `The invitation is ${T(...INV_STATE[st]).toLowerCase()} and cannot be redeemed`);
        ui.dialog.found = inv.id;
      }
      render();
    },
    'invite-redeem': () => {
      const org = O();
      const inv = M.find(org.invites, ui.dialog.found);
      const deviceKey = `ed25519:${Array.from(U.randomBytes(8), b => b.toString(16).padStart(2, '0')).join('')}`;
      const kind = U.f('invite.hkind', 'local');
      const device = {
        name: String(U.f('invite.hname', 'Studio PC')).trim() || 'Host', kind, os: U.f('invite.hos', 'Ubuntu 24.04'),
        arch: 'x86_64', desktop: kind === 'local', location: kind === 'cloud' ? { zh: '云端', en: 'Cloud' } : { zh: '本地', en: 'Local' },
        deviceKey, proof: M.redeemProof(inv.id, inv.codeDigest, deviceKey),
      };
      U.submitTx({ kind: 'invite.redeem', payload: { inviteId: inv.id, device } }, {
        onConfirmed: (r, p) => {
          const o = p.data[r.tx.orgId];
          const c = M.connectHost(o, r.host.id, !U.root.faults.coordinatorDown, U.now());
          U.secrets.delete(inv.id);
          if (ui.dialog && ui.dialog.type === 'invite') { ui.dialog.stage = 'done'; ui.dialog.hostId = r.host.id; }
          if (FM.review) FM.review.mark(c.ok ? 'invite.redeemed' : 'invite.waiting');
          U.clearForm('invite');
        },
      });
    },
    'invite-revoke': el => {
      U.submitTx({ kind: 'invite.revoke', payload: { inviteId: el.dataset.id } }, { ok: T('邀请已撤销，不能再兑换。', 'Invitation revoked; it can no longer be redeemed.'), onConfirmed: () => U.secrets.delete(el.dataset.id) });
    },
  });
})();
