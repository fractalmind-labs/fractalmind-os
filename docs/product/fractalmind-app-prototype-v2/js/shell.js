/* FractalMind App prototype v2 — shell: navigation, context bar, org switcher,
 * command palette, notifications, lock screen and shared activity text. */
(function () {
  'use strict';
  const FM = window.FM;
  const U = FM.ui;
  const { M, T, L, esc, icon, P, O, orgMeta, me, can, ui, go, render, toast } = U;

  const NAV = [
    { id: 'workbench', icon: 'home', zh: '工作台', en: 'Workbench' },
    { id: 'okrs', icon: 'target', zh: 'OKR', en: 'OKRs' },
    { id: 'hosts', icon: 'server', zh: '主机与算力', en: 'Hosts & compute' },
    { id: 'agents', icon: 'users', zh: '团队与 Agents', en: 'Team & Agents' },
    { id: 'memory', icon: 'book', zh: '记忆与成果', en: 'Memory & results' },
    { id: 'governance', icon: 'shield', zh: '治理与审批', en: 'Governance' },
  ];
  const NAV_ME = [
    { id: 'identity', icon: 'user', zh: '我的身份', en: 'My identity' },
    { id: 'settings', icon: 'sliders', zh: '组织设置', en: 'Settings' },
  ];
  const NAV_GLOBAL = [
    { id: 'orgs', icon: 'layers', zh: '我的组织', en: 'My organizations' },
    { id: 'network', icon: 'globe', zh: '开放网络', en: 'Open network' },
  ];
  const ALL_NAV = NAV.concat(NAV_ME, NAV_GLOBAL);

  const PROTECTED = new Set(['workbench', 'okrs', 'agents', 'memory', 'governance']);

  FM.pageTitle = r => {
    const n = ALL_NAV.find(x => x.id === r.name);
    return n ? T(n.zh, n.en) : 'FractalMind';
  };

  const attentionHosts = org => org.hosts.filter(h => h.status !== 'online' || !h.accepting || (h.grant && h.grant.expiresAt - U.now() < 2.5 * U.DAY) || (h.membership && h.membership.state !== 'active')).length;
  const pendingApprovals = org => org.approvals.filter(a => M.approvalStatus(a, U.now()) === 'pending').length;

  function badge(id, org) {
    if (!org) return '';
    if (id === 'workbench') {
      const n = can('read').ok ? U.decisions(org).length : 0;
      return n ? `<span class="count">${n}</span>` : '';
    }
    if (id === 'governance') { const n = pendingApprovals(org); return n ? `<span class="count soft">${n}</span>` : ''; }
    if (id === 'hosts') { const n = attentionHosts(org); return n ? `<span class="count soft">${n}</span>` : ''; }
    return '';
  }

  function navLink(n, r, org) {
    const cur = r.name === n.id || (n.id === 'okrs' && r.name === 'okr');
    return `<a class="sb-link" href="#/${n.id}"${cur ? ' aria-current="page"' : ''}>${icon(n.icon)}<span>${esc(T(n.zh, n.en))}</span>${badge(n.id, org)}</a>`;
  }

  function orgSub(meta) {
    const kind = meta.kind === 'personal' ? T('个人组织', 'Personal') : T('团队组织', 'Team');
    const role = { admin: T('管理员', 'Admin'), member: T('成员', 'Member'), observer: T('观察者', 'Observer') }[meta.role];
    return `${kind} · ${role} · ${T('测试网', 'Testnet')}`;
  }

  function sidebar(r) {
    const p = P();
    const org = O();
    const meta = orgMeta();
    const dev = me();
    return `<aside class="sidebar" aria-label="${T('主导航', 'Main navigation')}">
      <div class="sb-brand">${U.LOGO}<span>FractalMind</span><span class="demo-tag" title="${T('全部数据为演示', 'All data is demo data')}">${T('演示', 'Demo')}</span></div>
      <button class="sb-org" data-action="org-menu" data-pop-anchor="org" aria-haspopup="menu" aria-label="${T('切换组织', 'Switch organization')}">
        <span class="avatar ${meta.kind === 'team' ? 'team' : ''}">${U.orgInitial(meta)}</span>
        <span class="grow"><span class="t ellipsis" style="display:block">${esc(L(meta.name))}</span><span class="s">${esc(orgSub(meta))}</span></span>
        ${icon('down', 'sm')}
      </button>
      <nav class="col gap-sm" style="gap:2px">${NAV.map(n => navLink(n, r, org)).join('')}</nav>
      <div class="sb-group">${T('个人', 'You')}</div>
      <nav class="col" style="gap:2px">${NAV_ME.map(n => navLink(n, r, org)).join('')}</nav>
      <div class="sb-group">${T('网络', 'Network')}</div>
      <nav class="col" style="gap:2px">${NAV_GLOBAL.map(n => navLink(n, r, org)).join('')}</nav>
      <div class="sb-foot">
        <a class="sb-me" href="#/identity">
          <span class="avatar round sm" style="background:#8a6a3a">${esc(p.human.name.slice(0, 1).toUpperCase())}</span>
          <span class="grow"><span class="t ellipsis" style="display:block">${esc(p.human.name)}</span><span class="s ellipsis" style="display:block">${esc(dev ? dev.name : '')} · ${dev && dev.role === 'manage' ? T('管理设备', 'Management device') : T('访问设备', 'Access device')}</span></span>
        </a>
        <button class="btn ghost sm" data-action="lock" style="justify-content:flex-start">${icon('lock', 'sm')}<span>${T('锁定此 App', 'Lock this app')}</span></button>
      </div>
    </aside>`;
  }

  /* ------------------------------------------------------ Context bar */

  function ctxOkr(r) {
    if ((r.name === 'okrs' || r.name === 'okr') && r.parts[1] && r.parts[1] !== 'new') return U.okrById(r.parts[1]);
    return U.focusOkr();
  }

  function permSummary() {
    const dev = me();
    const read = can('read');
    if (!read.ok) return { tone: 'warn', text: U.permText(read.code) };
    const parts = [];
    if (can('operate').ok) parts.push(T('可执行', 'Operate'));
    if (can('approve').ok) parts.push(T('可审批', 'Approve'));
    if (!parts.length) parts.push(T('只读', 'Read-only'));
    const exp = dev.grant.expiresAt ? ` · ${U.until(dev.grant.expiresAt)}` : '';
    return { tone: parts.length > 1 ? 'ok' : 'info', text: `${parts.join(' · ')}${exp}` };
  }

  function ctxParts(r) {
    const org = O();
    const okr = ctxOkr(r);
    const ws = okr ? M.find(org.workspaces, okr.workspaceId) : org.workspaces[0];
    const h = okr ? U.host(okr.hostId) : null;
    const a = okr ? U.agent(okr.ownerAgentId) : null;
    const i = okr ? U.inst(okr.instanceId) : null;
    return { okr, ws, h, a, i };
  }

  function contextBar(r) {
    const { ws, h, a, i } = ctxParts(r);
    const perm = permSummary();
    const dev = me();
    const hostDot = h ? `<span class="dot ${h.status === 'online' ? 'ok' : ''}"></span>` : '';
    return `<div class="ctx" role="group" aria-label="${T('当前上下文', 'Current context')}">
      <button class="ctx-item" data-action="ctx-menu" data-pop-anchor="ctx" title="${esc(T('工作区', 'Workspace'))}: ${esc(ws ? ws.path : '')}">${icon('folder', 'sm')}<span class="k">${T('工作区', 'Workspace')}</span><span class="v">${esc(ws ? ws.name : T('未选择', 'None'))}</span></button>
      <span class="ctx-sep">${icon('right', 'xs')}</span>
      <button class="ctx-item" data-action="ctx-menu" data-pop-anchor="ctx-h" title="${esc(T('执行主机', 'Execution host'))}">${hostDot}<span class="k">${T('执行', 'Runs on')}</span><span class="v">${esc(h ? h.name : T('未指定', 'Not set'))}</span></button>
      <span class="ctx-sep">${icon('right', 'xs')}</span>
      <button class="ctx-item" data-action="ctx-menu" data-pop-anchor="ctx-a" title="${esc(i ? `${i.name} · ${i.runtime}` : '')}">${icon('users', 'sm')}<span class="v">${esc(a ? `${a.name} · ${L(a.model)}` : '—')}</span></button>
      <span class="chip ${perm.tone} ctx-perm" title="${T('本设备在当前组织的权限', "This device's permission in this organization")}">${icon(dev && dev.role === 'manage' ? 'laptop' : 'phone')}${esc(perm.text)}</span>
    </div>`;
  }

  function txIndicator() {
    const p = P();
    const open = p.txs.filter(t => t.state === 'pending' || t.state === 'unknown');
    if (!open.length) return '';
    const unknown = open.some(t => t.state === 'unknown');
    return `<button class="tx-ind ${unknown ? 'warn' : ''}" data-action="tx-menu" data-pop-anchor="tx">${icon(unknown ? 'help' : 'refresh', unknown ? 'sm' : 'sm spin')}${unknown ? T('交易结果未知', 'Unknown outcome') : T(`${open.length} 笔交易待确认`, `${open.length} pending`)}</button>`;
  }

  function unreadCount() {
    const p = P();
    const org = O();
    if (!org || !can('read').ok) return 0;
    return org.activity.filter(a => NOTIFY.has(a.kind) && a.at > (p.notifSeenAt || 0)).length;
  }

  function topbar(r) {
    const n = unreadCount();
    const themeIcon = { light: 'sun', dark: 'moon', system: 'monitor' }[U.prefs.theme];
    return `<header class="topbar">
      ${contextBar(r)}
      <div class="tb-tools">
        ${txIndicator()}
        <button class="tb-search" data-action="palette">${icon('search', 'sm')}<span>${T('搜索或跳转', 'Search or jump')}</span><span class="kbd">⌘K</span></button>
        <button class="tb-btn" data-action="toggle-locale" title="${T('Switch to English', '切换到中文')}" aria-label="${T('切换语言', 'Switch language')}"><span style="font-weight:700;font-size:12px">${U.prefs.locale === 'en' ? '中' : 'EN'}</span></button>
        <button class="tb-btn" data-action="theme-menu" data-pop-anchor="theme" aria-label="${T('外观', 'Appearance')}">${icon(themeIcon)}</button>
        <button class="tb-btn" data-action="notif-menu" data-pop-anchor="notif" aria-label="${T('通知', 'Notifications')}">${icon('bell')}${n ? `<span class="count">${n}</span>` : ''}</button>
      </div>
    </header>`;
  }

  function mobileTop(r) {
    const meta = orgMeta();
    const n = unreadCount();
    return `<header class="m-top">
      <button class="org" data-action="org-menu" data-pop-anchor="org-m" aria-label="${T('切换组织', 'Switch organization')}">
        <span class="avatar sm ${meta.kind === 'team' ? 'team' : ''}">${U.orgInitial(meta)}</span><span class="t">${esc(L(meta.name))}</span>${icon('down', 'xs')}
      </button>
      <span class="grow"></span>
      ${txIndicator()}
      <button class="tb-btn" data-action="notif-menu" data-pop-anchor="notif-m" aria-label="${T('通知', 'Notifications')}">${icon('bell')}${n ? `<span class="count">${n}</span>` : ''}</button>
      <button class="tb-btn" data-action="all-features" aria-label="${T('全部功能', 'All features')}">${icon('grid')}</button>
    </header>`;
  }

  function ctxMini(r) {
    if (!['workbench', 'okrs', 'okr'].includes(r.name)) return '';
    const { h, a } = ctxParts(r);
    const perm = permSummary();
    return `<button class="ctx-mini" data-action="ctx-sheet">
      <span class="dot ${h && h.status === 'online' ? 'ok' : ''}"></span>
      <span class="grow ellipsis">${esc(h ? h.name : T('未指定主机', 'No host'))} · ${esc(a ? a.name : '—')}</span>
      <span class="chip ${perm.tone}">${esc(perm.text)}</span>${icon('right', 'xs')}
    </button>`;
  }

  function tabbar(r) {
    const org = O();
    const tabs = [
      ['workbench', 'home', '工作台', 'Workbench'],
      ['okrs', 'target', 'OKR', 'OKRs'],
      ['hosts', 'server', '主机', 'Hosts'],
      ['orgs', 'layers', '组织', 'Orgs'],
      ['settings', 'sliders', '设置', 'Settings'],
    ];
    return `<nav class="tabbar" aria-label="${T('主导航', 'Main navigation')}">${tabs.map(([id, ic, zh, en]) => {
      const cur = r.name === id || (id === 'orgs' && r.name === 'network');
      return `<a href="#/${id}"${cur ? ' aria-current="page"' : ''}>${icon(ic)}<span>${esc(T(zh, en))}</span>${id === 'workbench' ? badge('workbench', org) : ''}</a>`;
    }).join('')}</nav>`;
  }

  /** Protected organization content needs a valid grant and synced data on this device. */
  function gate(r) {
    const chk = can('read');
    if (chk.ok || !PROTECTED.has(r.name === 'okr' ? 'okrs' : r.name)) return null;
    const dev = me();
    let action = '';
    if (chk.code === 'data_not_synced' && dev.grant.state === 'active' && dev.dataSync === 'pending') {
      action = U.btn({ action: 'sync-data', data: { id: dev.id }, label: T('同步加密数据', 'Sync encrypted data'), kind: 'primary', icon: 'key' });
    } else if (chk.code === 'org_not_granted') {
      action = U.btn({ action: 'org-menu', data: { 'pop-anchor': 'gate' }, label: T('切换组织', 'Switch organization'), icon: 'layers' });
    }
    return `<div class="card" style="max-width:560px;margin:40px auto">
      <div class="empty"><div class="ico">${icon('lock', 'lg')}</div><h3>${esc(U.permText(chk.code))}</h3>
      <p class="small">${T('组织角色、设备授权和数据解密权共同决定可见内容。此设备仍可查看主机状态与自己的身份。', 'Organization role, device grant and data access together decide what is visible. This device can still view host status and its own identity.')}</p>
      <div class="row center mt-8">${action}<a class="btn" href="#/identity">${icon('user', 'sm')}<span>${T('我的身份', 'My identity')}</span></a></div></div></div>`;
  }

  FM.shell = function (r) {
    const name = r.name === 'okr' ? 'okrs' : r.name;
    const org = O();
    let view = FM.views[name];
    if (name === 'welcome') view = FM.views.workbench;
    if (!view) view = FM.views.workbench;
    const locked = gate(r);
    const pageCls = { hosts: 'wide', workbench: 'wide' }[name] || '';
    const content = locked || view(r);
    return `${sidebar(r)}<div class="main">${topbar(r)}${mobileTop(r)}<main class="page ${pageCls}" id="main">${locked ? '' : ctxMini(r)}${content}</main></div>${tabbar(r)}`;
  };

  /* ---------------------------------------------------------- Popovers */

  FM.pops.org = () => {
    const p = P();
    const items = p.orgs.map(o => {
      const cur = o.id === p.currentOrgId;
      return `<button class="menu-i ${cur ? 'on' : ''}" data-action="switch-org" data-id="${esc(o.id)}" role="menuitemradio" aria-checked="${cur}">
        <span class="avatar sm ${o.kind === 'team' ? 'team' : ''}">${U.orgInitial(o)}</span>
        <span class="grow"><span class="ellipsis" style="display:block;font-weight:600">${esc(L(o.name))}</span><span class="tiny muted">${esc(orgSub(o))}</span></span>
        ${cur ? icon('check', 'sm') : ''}</button>`;
    }).join('');
    return `<div class="pop" role="menu" style="width:300px">
      <div class="menu-h">${T('当前组织', 'Current organization')}</div>${items}
      <div class="menu-sep"></div>
      <button class="menu-i" data-action="go" data-to="orgs">${icon('layers', 'sm')}${T('我的组织', 'My organizations')}</button>
      <button class="menu-i" data-action="go" data-to="network">${icon('globe', 'sm')}${T('开放网络', 'Open network')}</button>
      <div class="menu-sep"></div>
      <div class="tiny muted" style="padding:4px 10px 6px">${T('切换只改变上下文，不授予或撤销权限。', 'Switching changes context only; it grants or revokes nothing.')}</div>
    </div>`;
  };

  FM.pops.ctx = pop => {
    const r = U.route();
    const { okr, ws, h, a, i } = ctxParts(r);
    const dev = me();
    const perm = permSummary();
    return `<div class="pop" style="width:340px;padding:12px">
      <div class="menu-h" style="padding:0 0 8px">${T('当前上下文', 'Current context')}</div>
      <dl class="kv">
        <dt>${T('组织', 'Organization')}</dt><dd>${esc(L(orgMeta().name))}</dd>
        <dt>${T('目标', 'Goal')}</dt><dd>${okr ? esc(L(okr.title)) : '—'}</dd>
        <dt>${T('工作区', 'Workspace')}</dt><dd class="mono small">${esc(ws ? ws.path : '—')}</dd>
        <dt>${T('执行主机', 'Host')}</dt><dd>${h ? `${esc(h.name)} · ${U.hostState(h)}` : '—'}</dd>
        <dt>Agent</dt><dd>${a ? `${esc(a.name)} · ${esc(i ? i.name : '')}` : '—'}</dd>
        <dt>${T('运行时/模型', 'Runtime/model')}</dt><dd>${i ? esc(i.runtime) : '—'} · ${a ? esc(L(a.model)) : '—'}</dd>
        <dt>${T('本设备', 'This device')}</dt><dd>${esc(dev.name)} · <span class="chip ${perm.tone}">${esc(perm.text)}</span></dd>
      </dl>
      <div class="row wrap mt-12">
        ${h ? `<button class="btn sm" data-action="go" data-to="hosts/${esc(h.id)}">${icon('server', 'sm')}${T('主机详情', 'Host details')}</button>` : ''}
        <button class="btn sm" data-action="go" data-to="identity">${icon('user', 'sm')}${T('设备与权限', 'Devices & access')}</button>
      </div>
    </div>`;
  };

  FM.pops.theme = () => {
    const opt = (v, ic, zh, en) => `<button class="menu-i ${U.prefs.theme === v ? 'on' : ''}" data-action="set-theme" data-v="${v}" role="menuitemradio" aria-checked="${U.prefs.theme === v}">${icon(ic, 'sm')}<span class="grow">${esc(T(zh, en))}</span>${U.prefs.theme === v ? icon('check', 'sm') : ''}</button>`;
    return `<div class="pop" role="menu" style="width:200px">${opt('light', 'sun', '浅色', 'Light')}${opt('dark', 'moon', '深色', 'Dark')}${opt('system', 'monitor', '跟随系统', 'System')}</div>`;
  };

  FM.pops.tx = () => {
    const p = P();
    const list = p.txs.slice(0, 6);
    return `<div class="pop" style="width:380px;padding:10px">
      <div class="menu-h" style="padding:0 0 8px">${T('链上交易（演示）', 'Chain transactions (demo)')}</div>
      <div class="col">${list.map(tx => U.txLine(tx)).join('') || `<div class="muted small">${T('暂无', 'None')}</div>`}</div>
      <div class="tiny muted mt-8">${T('结果未知时查询原交易，不会重新提交。', 'When the outcome is unknown, the original transaction is queried, never resubmitted.')}</div>
    </div>`;
  };

  const NOTIFY = new Set(['gate', 'verify_pass', 'complete', 'accepted', 'achieved', 'connection_lost', 'needs_confirmation', 'criteria_review', 'returned', 'approved_exec']);

  FM.pops.notif = () => {
    const org = O();
    const items = can('read').ok ? org.activity.filter(a => NOTIFY.has(a.kind)).slice(0, 8) : [];
    return `<div class="pop" style="width:380px;padding:8px">
      <div class="menu-h">${T('通知', 'Notifications')}</div>
      ${items.map(a => {
        const x = FM.activityText(a);
        return `<button class="menu-i" data-action="open-activity" data-okr="${esc(a.okrId || '')}">
          <span class="e-ico" style="width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:var(--surface-3);flex:none">${icon(x.icon, 'sm')}</span>
          <span class="grow"><span style="display:block;font-size:13px;line-height:1.4">${x.html}</span><span class="tiny muted">${U.agoTag(a.at)}</span></span></button>`;
      }).join('') || `<div class="muted small" style="padding:8px 10px">${T('暂无通知', 'No notifications')}</div>`}
      <div class="menu-sep"></div>
      <div class="tiny muted" style="padding:4px 10px 6px">${T('只在进展、阻塞或需要你决定时通知；关闭系统通知后，待办仍在工作台可见。', 'Notifies only on progress, blockers or decisions. With system notifications off, to-dos stay on the workbench.')}</div>
    </div>`;
  };

  Object.assign(FM.actions, {
    'org-menu': el => U.togglePop('org', el.getAttribute('data-pop-anchor')),
    'ctx-menu': el => U.togglePop('ctx', el.getAttribute('data-pop-anchor')),
    'ctx-sheet': () => U.openDialog('context'),
    'theme-menu': el => U.togglePop('theme', el.getAttribute('data-pop-anchor')),
    'tx-menu': el => U.togglePop('tx', el.getAttribute('data-pop-anchor')),
    'notif-menu': el => {
      U.togglePop('notif', el.getAttribute('data-pop-anchor'));
      const p = P();
      p.notifSeenAt = U.now();
      U.save();
    },
    'open-activity': el => {
      const org = O();
      if (el.dataset.okr && M.find(org.okrs, el.dataset.okr)) {
        const okr = M.find(org.okrs, el.dataset.okr);
        if (okr.lifecycle === 'ACTIVE') { org.focusOkrId = okr.id; U.save(); go('workbench'); } else go(`okrs/${okr.id}`);
      }
      ui.pop = null;
      render();
    },
    'switch-org': el => {
      const p = P();
      const res = M.switchOrg(p, el.dataset.id);
      ui.pop = null;
      if (res.same) { render(); return; }
      ui.autoplay = false;
      ui.drawer = null;
      U.save();
      toast(T(`已切换到 ${L(orgMeta().name)}：工作台、OKR、主机与权限已按该组织重新确定。`, `Switched to ${L(orgMeta().name)}: workbench, OKRs, hosts and permissions now follow this organization.`), 'ok', 4600);
      const r = U.route();
      if ((r.name === 'okrs' && r.parts[1]) || (r.name === 'hosts' && r.parts[1])) go(r.name); else render();
    },
    'toggle-locale': () => { U.prefs.locale = U.prefs.locale === 'en' ? 'zh-CN' : 'en'; U.savePrefs(); render(); },
    'set-theme': el => { U.prefs.theme = el.dataset.v; U.savePrefs(); ui.pop = null; U.applyTheme(); render(); },
    'set-locale': el => { U.prefs.locale = el.dataset.v; U.savePrefs(); render(); },
    lock: () => { P().locked = true; U.save(); render(); },
    unlock: () => { P().locked = false; U.save(); toast(T('已解锁。解锁只保护本机凭据，不改变链上授权。', 'Unlocked. Unlocking protects local credentials only; chain grants are unchanged.'), 'ok'); render(); },
    'all-features': () => U.openDialog('all-features'),
    palette: () => { ui.palette = { i: 0 }; U.setF('palette.q', ''); U.render(); },
    'sync-data': el => {
      const p = P();
      const res = M.syncData(p, el.dataset.id);
      U.save();
      toast(res.ok ? T('加密数据已同步（演示密钥交接）。', 'Encrypted data synced (demo key handoff).') : U.permText(res.code), res.ok ? 'ok' : 'warn');
      if (FM.review) FM.review.mark('data.synced');
      render();
    },
  });

  FM.dialogs.context = () => ({ title: T('当前上下文', 'Current context'), body: FM.pops.ctx().replace('class="pop"', 'class=""').replace('style="width:340px;padding:12px"', '') });

  FM.dialogs['all-features'] = () => {
    const org = O();
    const item = (to, ic, zh, en, extra) => `<button class="opt" data-action="go-close" data-to="${to}"><span class="ico">${icon(ic)}</span><span class="grow"><span class="strong">${esc(T(zh, en))}</span>${extra ? `<span class="small muted" style="display:block">${extra}</span>` : ''}</span>${icon('right', 'sm')}</button>`;
    const pend = pendingApprovals(org);
    return {
      title: T('全部功能', 'All features'),
      body: `<div class="col">
        ${item('agents', 'users', '团队与 Agents', 'Team & Agents')}
        ${item('memory', 'book', '记忆与成果', 'Memory & results')}
        ${item('governance', 'shield', '治理与审批', 'Governance & approvals', pend ? T(`${pend} 项待处理`, `${pend} pending`) : '')}
        ${item('identity', 'user', '我的身份', 'My identity')}
        ${item('settings/fees', 'wallet', '运行费', 'Run fees')}
        ${item('network', 'globe', '开放网络', 'Open network')}
      </div>
      <div class="row between"><span class="small muted">${T('语言与外观', 'Language & appearance')}</span>
        <div class="row"><div class="seg"><button data-action="set-locale" data-v="zh-CN" aria-pressed="${U.prefs.locale !== 'en'}">中文</button><button data-action="set-locale" data-v="en" aria-pressed="${U.prefs.locale === 'en'}">EN</button></div>
        <div class="seg"><button data-action="set-theme" data-v="light" aria-pressed="${U.prefs.theme === 'light'}" aria-label="${T('浅色', 'Light')}">${icon('sun', 'sm')}</button><button data-action="set-theme" data-v="dark" aria-pressed="${U.prefs.theme === 'dark'}" aria-label="${T('深色', 'Dark')}">${icon('moon', 'sm')}</button><button data-action="set-theme" data-v="system" aria-pressed="${U.prefs.theme === 'system'}" aria-label="${T('跟随系统', 'System')}">${icon('monitor', 'sm')}</button></div></div>
      </div>`,
    };
  };
  FM.actions['go-close'] = el => { ui.dialog = null; go(el.dataset.to); };

  FM.lockscreen = () => {
    const dev = me();
    const how = { touch_id: 'Touch ID', face_id: 'Face ID', fingerprint: T('指纹', 'fingerprint'), windows_hello: 'Windows Hello', password: T('本机密码', 'device password') }[dev && dev.unlock] || T('本机解锁', 'device unlock');
    return `<div class="lockscreen" role="dialog" aria-modal="true" aria-label="${T('已锁定', 'Locked')}">
      <div class="card" style="width:min(380px,calc(100% - 32px));text-align:center;padding:28px 24px">
        <div style="display:flex;justify-content:center">${U.LOGO.replace('class="logo"', 'class="logo" style="width:44px;height:44px"')}</div>
        <h2 class="mt-12">${T('FractalMind 已锁定', 'FractalMind is locked')}</h2>
        <p class="small muted mt-8">${esc(dev ? dev.name : '')} · ${T('组织内容已隐藏', 'Organization content hidden')}</p>
        <button class="btn primary lg block mt-16" data-action="unlock">${icon('fingerprint')}<span>${T(`使用 ${how} 解锁（演示）`, `Unlock with ${how} (demo)`)}</span></button>
        <p class="tiny muted mt-12">${T('解锁只保护本机凭据，不能代替或恢复链上授权；已撤销或到期的设备解锁后仍无权限。', 'Unlocking protects local credentials only. It cannot replace or restore chain grants; revoked or expired devices stay without access.')}</p>
      </div></div>`;
  };

  /* ------------------------------------------------------ Palette */

  function paletteItems() {
    const org = O();
    const items = ALL_NAV.map(n => ({ label: T(n.zh, n.en), alt: `${n.zh} ${n.en}`, icon: n.icon, kind: T('页面', 'Page'), run: () => go(n.id) }));
    if (can('read').ok) {
      org.okrs.forEach(o => items.push({ label: L(o.title), alt: `${o.title.zh || ''} ${o.title.en || o.title}`, icon: 'target', kind: 'OKR', run: () => go(`okrs/${o.id}`) }));
    }
    org.hosts.forEach(h => items.push({ label: h.name, alt: h.name, icon: 'server', kind: T('主机', 'Host'), run: () => go(`hosts/${h.id}`) }));
    items.push(
      { label: T('新建 OKR', 'New OKR'), alt: '新建 OKR new okr create', icon: 'plus', kind: T('操作', 'Action'), run: () => go('okrs/new') },
      { label: T('接入主机', 'Add a host'), alt: '接入主机 add host invite', icon: 'server', kind: T('操作', 'Action'), run: () => U.openDialog('invite') },
      { label: T('添加我的设备', 'Add my device'), alt: '添加设备 add device pair', icon: 'phone', kind: T('操作', 'Action'), run: () => U.openDialog('pair') },
      { label: T('从 Host 发现 Agent', 'Discover Agents on a host'), alt: '发现 discover agents import', icon: 'scan', kind: T('操作', 'Action'), run: () => U.openDialog('discover') },
      { label: T('切换语言', 'Switch language'), alt: '语言 language english 中文', icon: 'lang', kind: T('偏好', 'Preference'), run: () => FM.actions['toggle-locale']() },
      { label: T('切换深色/浅色', 'Toggle dark/light'), alt: '主题 theme dark light', icon: 'moon', kind: T('偏好', 'Preference'), run: () => { U.prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; U.savePrefs(); render(); } },
      { label: T('打开评审工具', 'Open review tools'), alt: '评审 review demo', icon: 'clipboard', kind: T('评审', 'Review'), run: () => { ui.review = true; FM.review.render(); } },
    );
    const q = String(U.f('palette.q', '')).trim().toLowerCase();
    return q ? items.filter(x => `${x.label} ${x.alt}`.toLowerCase().includes(q)) : items;
  }

  FM.palette = () => {
    const items = paletteItems().slice(0, 12);
    const i = Math.min(ui.palette.i || 0, Math.max(0, items.length - 1));
    return `<div class="drawer-scrim" data-action="palette-close" style="z-index:119"></div><div class="palette" role="dialog" aria-modal="true" aria-label="${T('命令面板', 'Command palette')}">
      <div class="p-in">${icon('search')}<input id="palette-q" data-f="palette.q" value="${esc(U.f('palette.q', ''))}" placeholder="${T('搜索页面、OKR、主机或操作…', 'Search pages, OKRs, hosts or actions…')}" autocomplete="off" aria-label="${T('搜索', 'Search')}"><span class="kbd">Esc</span></div>
      <div class="p-list" role="listbox">${items.map((x, n) => `<button class="p-i ${n === i ? 'on' : ''}" data-action="palette-run" data-n="${n}" role="option" aria-selected="${n === i}">${icon(x.icon, 'sm')}<span class="ellipsis">${esc(x.label)}</span><span class="k">${esc(x.kind)}</span></button>`).join('') || `<div class="muted small" style="padding:12px">${T('没有匹配项', 'No matches')}</div>`}</div>
    </div>`;
  };
  FM.paletteKey = ev => {
    const items = paletteItems().slice(0, 12);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); ui.palette.i = Math.min((ui.palette.i || 0) + 1, items.length - 1); U.render(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); ui.palette.i = Math.max((ui.palette.i || 0) - 1, 0); U.render(); }
    if (ev.key === 'Enter') { ev.preventDefault(); const x = items[ui.palette.i || 0]; ui.palette = null; if (x) x.run(); U.render(); }
  };
  FM.actions['palette-run'] = el => { const x = paletteItems().slice(0, 12)[Number(el.dataset.n)]; ui.palette = null; if (x) x.run(); render(); };
  FM.actions['palette-close'] = () => { ui.palette = null; render(); };
  document.addEventListener('input', ev => { if (ev.target.id === 'palette-q' && ui.palette) ui.palette.i = 0; });

  /* ---------------------------------------------------- Activity text */

  function krLabel(okr, krId) {
    if (!okr) return krId || '';
    const i = okr.krs.findIndex(k => k.id === krId);
    return i >= 0 ? `KR${i + 1}` : krId || '';
  }

  FM.krLabel = krLabel;

  FM.activityText = a => {
    const org = O();
    const okr = a.okrId ? M.find(org.okrs, a.okrId) : null;
    const kr = krLabel(okr, a.krId);
    const k = okr && a.krId ? M.find(okr.krs, a.krId) : null;
    const apv = a.approvalId ? M.find(org.approvals, a.approvalId) : null;
    const action = apv && apv.action ? `<strong>${esc(L(apv.action))}</strong>` : '';
    const unit = k && k.metric ? k.metric.unit : '';
    const unlocked = (a.unlocked || []).map(id => krLabel(okr, id)).join('、');
    const h = a.hostId ? M.find(org.hosts, a.hostId) : null;
    const run = a.runId ? M.find(org.runs, a.runId) : null;
    const ev = a.evidenceId ? M.find(org.evidence, a.evidenceId) : null;
    const X = {
      measure: ['pulse', T(`${kr} 采样 <strong>${esc(U.num(a.value, unit))}</strong>${a.cost ? `（成本 ${U.money(a.cost)}）` : ''}`, `${kr} sampled <strong>${esc(U.num(a.value, unit))}</strong>${a.cost ? ` (cost ${U.money(a.cost)})` : ''}`), 'measured'],
      gate: ['alert', T(`请求批准：${action}`, `Asked for approval: ${action}`)],
      connection_lost: ['offline', T(`${esc(h ? h.name : '')} 失去连接，显示历史快照`, `${esc(h ? h.name : '')} lost connection; showing the last snapshot`)],
      claim: ['message', T(`Agent 声明：${esc(ev ? L(ev.title) : '')}（未验证）`, `Agent claims: ${esc(ev ? L(ev.title) : '')} (unverified)`), 'claimed'],
      verify_start: ['clipboard', T(`${kr} 达到目标，提交验证`, `${kr} reached its target; submitted for verification`)],
      verify_pass: ['check', a.needsAcceptance ? T(`${kr} 验证通过，等待你验收`, `${kr} verified; awaiting your acceptance`) : T(`${kr} 验证通过`, `${kr} verified`), 'verified'],
      complete: ['check', T(`${kr} 完成（预授权验证者验收）${unlocked ? `，解锁 ${unlocked}` : ''}`, `${kr} complete (accepted by the pre-authorized verifier)${unlocked ? `; unlocked ${unlocked}` : ''}`), 'accepted'],
      accepted: ['seal', T(`你验收了 ${kr}${unlocked ? `，解锁 ${unlocked}` : ''}`, `You accepted ${kr}${unlocked ? `; unlocked ${unlocked}` : ''}`), 'accepted'],
      returned: ['left', T(`你退回了 ${kr}，Agent 将补充证据`, `You returned ${kr}; the Agent will add evidence`)],
      rework: ['edit', T(`Agent 补充了 ${kr} 的证据，准备重新提交`, `The Agent added evidence for ${kr} and will resubmit`)],
      approved: ['check', T(`你同意了：${action}（尚未执行）`, `You approved: ${action} (not executed yet)`)],
      rejected: ['x', T(`你拒绝了：${action}`, `You rejected: ${action}`)],
      approved_exec: ['play', T(`已执行获批操作：${action}`, `Executed the approved action: ${action}`)],
      criteria_review: ['clipboard', T('全部 KR 完成，成功标准复核通过，等待最终验收', 'All KRs complete and success criteria re-checked; awaiting final acceptance')],
      achieved: ['flag', T('OKR 已达成，成果写入记忆', 'OKR achieved; the result was written to memory')],
      final_returned: ['left', T('最终验收被退回', 'Final acceptance was returned')],
      needs_confirmation: ['help', T(`${esc(run ? run.id : '')} 崩溃后无法确认副作用，需要你确认`, `${esc(run ? run.id : '')} crashed; side effects need your confirmation`)],
      agreement: ['file', T(`执行约定 v${a.version} 已确认`, `Agreement v${a.version} confirmed`)],
      scenario: ['clipboard', T(`评审注入：${esc(U.condName(a.scenario === 'normal' ? 'on_track' : a.scenario))}`, `Review injected: ${esc(U.condName(a.scenario === 'normal' ? 'on_track' : a.scenario))}`)],
      resolved: ['check', T('已按约定处理当前路况', 'Handled the road condition within the agreement')],
      reroute: ['route', T(`${kr} 切换到路线 ${esc(a.route)}（原外部请求标为已替代）`, `${kr} switched to route ${esc(a.route)} (the external request is superseded)`)],
      resumed: ['play', T('已明确继续自主推进', 'Explicitly resumed autonomous work')],
      reassigned: ['server', T('已改派执行位置，等待明确继续', 'Execution moved; waiting for an explicit continue')],
      handoff: ['users', T('已交接给导入的实例，等待明确继续', 'Handed off to the imported instance; waiting to continue')],
    }[a.kind] || ['info', esc(a.kind)];
    return { icon: X[0], html: X[1], trust: X[2] || null };
  };

  FM.sidebarBadge = badge;
})();
