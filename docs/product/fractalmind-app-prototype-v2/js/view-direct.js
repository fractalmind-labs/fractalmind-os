/* FractalMind App prototype v2 — direct conversations with an Agent (J12),
 * standing permissions, and message-channel bindings (PRD §8.2.3, FR-41/42). */
(function () {
  'use strict';
  const FM = window.FM;
  const U = FM.ui;
  const { M, T, L, esc, icon, P, O, can, ui, render, toast } = U;

  const ACTION_T = {
    test: ['运行测试', 'Run tests'],
    edit_sandbox: ['在沙箱分支修改文件', 'Edit files on a sandbox branch'],
    external: ['调用付费外部服务', 'Call a paid external service'],
    upload: ['上传代码到第三方', 'Upload code to a third party'],
  };
  const actionLabel = a => T(...(ACTION_T[a] || [a, a]));
  FM.directActionLabel = actionLabel;
  const SOURCE_T = { app: 'App', telegram: 'Telegram', imessage: 'iMessage', feishu: T('飞书', 'Feishu') };

  const agentById = id => M.find(O().agents, id);

  function standingLine(agent) {
    const st = M.standingToday(agent, U.now());
    const acts = st.actions.length ? st.actions.map(actionLabel).join('、') : T('仅对话与只读', 'Chat and read-only');
    return `${T('常驻权限', 'Standing')} v${st.version}：${esc(acts)} · ${T('今日', 'today')} ${U.money(st.spentToday)} / ${U.money(st.dailyBudget)}`;
  }
  FM.standingLine = standingLine;

  const isManager = () => { const d = U.me(); return !!d && d.role === 'manage'; };
  const sendCtx = () => Object.assign(can('operate'), { manager: isManager() });

  /* ------------------------------------------------------- Reply text */

  function replyText(m, agent) {
    const org = O();
    const inst = M.find(org.instances, m.instanceId) || {};
    const h = U.host(inst.hostId) || {};
    const run = m.runId ? M.find(org.runs, m.runId) : null;
    const apv = m.approvalId ? M.find(org.approvals, m.approvalId) : null;
    if (m.text) return L(m.text);
    if (m.outcome === 'answer') return T(`（演示回复）我在 ${inst.name} 上读取了工作区和最近的日志来回答，没有执行任何写操作。`, `(Demo reply) I answered from the workspace and recent logs on ${inst.name}; nothing was written.`);
    if (m.outcome === 'status') {
      const okr = org.okrs.find(o => o.lifecycle === 'ACTIVE' && o.instanceId === inst.id);
      const st = M.standingToday(agent, U.now());
      return T(`当前在 ${inst.name}（${h.name}）：${okr ? `正在执行「${L(okr.title)}」` : '空闲'}。今日常驻预算已用 ${U.money(st.spentToday)} / ${U.money(st.dailyBudget)}。`,
        `On ${inst.name} (${h.name}): ${okr ? `working on “${L(okr.title)}”` : 'idle'}. Standing budget today: ${U.money(st.spentToday)} / ${U.money(st.dailyBudget)}.`);
    }
    if (m.outcome === 'executed') return T(`已在常驻权限内执行：${actionLabel(run ? run.action : '')}（${run ? run.id : ''}，花费 ${U.money(run ? run.cost : 0)}）。`, `Done within my standing permission: ${actionLabel(run ? run.action : '')} (${run ? run.id : ''}, cost ${U.money(run ? run.cost : 0)}).`);
    if (m.outcome === 'approval_requested') {
      const why = (apv ? apv.reasons : []).map(r => ({ outside_standing: T('不在常驻权限内', 'not in my standing permission'), workspace_busy: T('会改动正在执行 OKR 的工作区', 'it would write to a workspace an OKR is using') }[r])).join(T('，', '; '));
      return T(`「${actionLabel(apv ? apv.action : '')}」${why}，我已发起审批；你批准前不会执行。`, `“${actionLabel(apv ? apv.action : '')}”: ${why}. I asked for approval and will not run it until you approve.`);
    }
    if (m.outcome === 'budget_exhausted') return T('今日常驻预算不足，没有执行。可以提高预算，或把它转为任务 / OKR。', 'Not enough standing budget left today, so nothing ran. Raise the budget or turn it into a task or OKR.');
    if (m.outcome === 'unconstrained') return T('这是不受约束的桌面应用：请求已交给它自己的运行时处理，FractalMind 无法限制或记录其副作用。', 'This desktop app is unconstrained: its own runtime handles the request, and FractalMind cannot limit or record side effects.');
    if (m.outcome === 'approved_executed') return T(`审批已通过，已执行一次：${actionLabel(run ? run.action : '')}（${run ? run.id : ''}）。`, `Approved and run once: ${actionLabel(run ? run.action : '')} (${run ? run.id : ''}).`);
    return '';
  }

  /* ----------------------------------------------------------- Drawer */

  const KIND = { ask: ['提问', 'Ask'], status: ['查看状态', 'Status'], action: ['请它做事', 'Ask it to act'] };

  FM.drawers.direct = ({ agentId }) => {
    const org = O();
    const agent = agentById(agentId);
    if (!agent) return null;
    const conv = (org.direct || {})[agentId] || { messages: [], draft: '', instanceId: null };
    const key = `dm-${agentId}`;
    const kind = U.f(`${key}.kind`, 'ask');
    const action = U.f(`${key}.action`, 'test');
    const insts = org.instances.filter(i => i.agentId === agentId);
    const pinned = conv.instanceId ? M.find(org.instances, conv.instanceId) : null;
    const pick = M.pickInstance(org, agentId, conv.instanceId);
    const target = pinned || pick.instance;
    const unconstrained = target && !M.constrainable(target);
    const ctx = sendCtx();
    let blocked = !ctx.ok ? U.permText(ctx.code) : !pick.ok ? T('负责实例所在主机离线，消息会保存为草稿，不会自动重发', 'The instance’s host is offline; messages stay as drafts and are not resent') : unconstrained && !ctx.manager ? T('不受约束的 Agent 只能由管理设备发送', 'Only a management device can message an unconstrained Agent') : '';
    const st = M.standingToday(agent, U.now());
    const def = M.DIRECT_ACTIONS[action];
    const within = def.grantable && st.actions.includes(action);
    const hint = kind !== 'action' ? T('只读：回答问题或报告状态，不执行写操作', 'Read-only: answers or reports status; nothing is written')
      : unconstrained ? T('执行不受 FractalMind 约束', 'Execution is not constrained by FractalMind')
        : within ? (st.spentToday + def.cost > st.dailyBudget ? T(`在常驻权限内，但今日预算不足（需 ${U.money(def.cost)}）`, `Within standing permission, but today’s budget is short (needs ${U.money(def.cost)})`) : T(`在常驻权限内 · 预计 ${U.money(def.cost)}`, `Within standing permission · est. ${U.money(def.cost)}`))
          : T('超出常驻权限：会先发起审批，批准前不执行', 'Outside standing permission: approval first, nothing runs before that');
    const msgs = conv.messages.map(m => {
      const mine = m.from === 'user';
      const apv = m.approvalId ? M.find(org.approvals, m.approvalId) : null;
      const inst = M.find(org.instances, m.instanceId) || {};
      const tags = mine ? `<span class="chip outline">${esc(T(...KIND[m.kind]))}${m.action ? ` · ${esc(actionLabel(m.action))}` : ''}</span>` : '';
      const tools = mine ? (m.taskId ? `<span class="tiny muted">${T('已转为任务', 'Turned into task')} ${esc(m.taskId)}</span>` : `<button class="link-btn tiny" data-action="dm-task" data-agent="${esc(agentId)}" data-id="${esc(m.id)}">${T('转为任务', 'Make a task')}</button><button class="link-btn tiny" data-action="dm-okr" data-agent="${esc(agentId)}" data-id="${esc(m.id)}">${T('转为 OKR 草稿', 'Draft an OKR')}</button>`) : '';
      const follow = apv && M.approvalStatus(apv, U.now()) === 'pending' ? `<div>${U.btn({ action: 'approval-detail', data: { id: apv.id }, label: T('去审批', 'Review approval'), size: 'sm' })}</div>` : '';
      return `<div class="msg ${mine ? 'me' : 'agent'}">${tags}
        <div class="bubble">${esc(mine ? (L(m.text) || T(...KIND[m.kind])) : replyText(m, agent))}</div>${follow}
        <div class="meta">${esc(mine ? T('你', 'You') : agent.name)} · ${U.agoTag(m.at)} · ${mine ? `<span class="chip ${m.source === 'app' ? 'outline' : 'info'}">${esc(SOURCE_T[m.source] || m.source)}</span>` : T('演示回复', 'Demo reply')} · ${esc(inst.name || '')}</div>
        ${tools ? `<div class="row gap-sm">${tools}</div>` : ''}</div>`;
    }).join('');
    return {
      label: T('与 Agent 对话', 'Chat with agent'),
      html: `<div class="drawer-h">
          <div class="row between"><span class="row"><span class="avatar sm round">${esc(agent.name.slice(0, 1))}</span><strong>${T(`与 ${agent.name} 对话`, `Chat with ${agent.name}`)}</strong></span><button class="btn ghost icon sm" data-action="close-drawer" aria-label="${T('关闭', 'Close')}">${icon('x')}</button></div>
          <div class="small muted">${esc(L(agent.role))} · ${unconstrained ? T('不绑定 OKR，执行不受约束', 'No OKR; execution unconstrained') : T('不绑定 OKR，受常驻权限约束', 'No OKR; bounded by the standing permission')}</div>
          <div class="row wrap gap-sm"><select class="select" style="width:auto;min-height:30px;padding:3px 8px;font-size:12.5px" data-action-select="dm-instance" data-agent="${esc(agentId)}" aria-label="${T('对话实例', 'Instance')}">${insts.map(i => { const h = U.host(i.hostId) || {}; return `<option value="${esc(i.id)}" ${target && target.id === i.id ? 'selected' : ''}>${esc(i.name)} @ ${esc(h.name || '')} · ${h.status === 'online' ? T('在线', 'online') : T('离线', 'offline')}</option>`; }).join('')}</select>
            <span class="tiny muted">${T('对话固定在所选实例上', 'The thread stays on this instance')}</span></div>
          ${unconstrained ? '' : `<div class="snap row between"><span>${standingLine(agent)}</span>${U.btn({ action: 'open', data: { dialog: 'standing', agent: agentId }, label: T('调整', 'Adjust'), size: 'sm', kind: 'ghost', perm: 'approve' })}</div>`}
          ${unconstrained ? `<div class="note warn">${icon('alert')}<div>${T('执行不受 FractalMind 约束：只能对话，不能承接 OKR，操作结果不在执行记录中。', 'Execution is not constrained by FractalMind: chat only, cannot own OKRs, and its actions are not in the run record.')}</div></div>` : ''}
        </div>
        <div class="drawer-b" id="dm-body">${msgs || `<div class="empty"><div class="ico">${icon('message', 'lg')}</div><p class="small">${unconstrained ? T('请求会交给它自己的运行时处理，FractalMind 只转发与记录对话。', 'Requests go to its own runtime; FractalMind only relays and records the conversation.') : T('直接提问、查看状态，或请它在常驻权限内做事。超出权限的请求会先发起审批。', 'Ask, check status, or ask it to act within its standing permission. Anything beyond asks for approval first.')}</p></div>`}</div>
        <div class="drawer-f">
          <div class="purpose" role="radiogroup" aria-label="${T('请求类型', 'Request type')}">${Object.keys(KIND).map(k => `<button class="chip lg ${kind === k ? 'brand' : 'outline'}" style="border:0;cursor:pointer" data-action="set-f" data-key="${key}.kind" data-value="${k}" role="radio" aria-checked="${kind === k}">${esc(T(...KIND[k]))}</button>`).join('')}</div>
          ${kind === 'action' ? `<select class="select" data-f="${key}.action" aria-label="${T('动作', 'Action')}">${Object.keys(M.DIRECT_ACTIONS).map(a => `<option value="${a}" ${a === action ? 'selected' : ''}>${esc(actionLabel(a))}</option>`).join('')}</select>` : ''}
          <div class="tiny muted">${esc(hint)}</div>
          <textarea class="textarea" id="${key}-text" data-f="${key}.text" rows="2" placeholder="${T('输入消息…', 'Write a message…')}" aria-label="${T('消息', 'Message')}">${esc(U.f(`${key}.text`, conv.draft || ''))}</textarea>
          ${blocked ? `<div class="note warn">${icon('lock')}<div>${esc(blocked)}</div></div>` : ''}
          <div class="row between"><span class="tiny muted">${T('聊天不能提高预算或扩大权限。', 'Chat cannot raise budgets or widen permissions.')}</span>${U.btn({ action: 'dm-send', data: { agent: agentId }, label: T('发送', 'Send'), icon: 'send', kind: 'primary', size: 'sm', disabled: !!blocked, why: blocked })}</div>
        </div>`,
    };
  };

  function afterSend(agentId, msgId) {
    const token = M.contextToken(P());
    U.later(900, () => {
      const p = U.root.profiles[token.profileId];
      if (!p) return;
      const org = p.data[token.orgId];
      const res = M.directReply(p, org, agentId, msgId, U.now());
      U.save();
      render();
      const b = document.getElementById('dm-body');
      if (b) b.scrollTop = b.scrollHeight;
      if (res.ok && FM.review) FM.review.mark(`direct.${res.reply.outcome}`);
    });
  }
  FM.directAfterSend = afterSend;

  Object.assign(FM.actions, {
    'open-direct': el => { ui.pop = null; U.openDrawer('direct', { agentId: el.dataset.agent }); },
    'dm-send': el => {
      const agentId = el.dataset.agent;
      const key = `dm-${agentId}`;
      const kind = U.f(`${key}.kind`, 'ask');
      const text = String(U.f(`${key}.text`, '')).trim();
      const res = M.sendDirect(P(), O(), agentId, { kind, action: kind === 'action' ? U.f(`${key}.action`, 'test') : null, text, source: 'app' }, sendCtx(), U.now());
      U.save();
      if (!res.ok) { toast({ host_offline: T('主机离线：已保存草稿，不会自动重发。', 'Host offline: saved as a draft; it will not be resent.'), unconstrained_requires_manager: T('不受约束的 Agent 只能由管理设备发送。', 'Only a management device can message an unconstrained Agent.') }[res.code] || U.permText(res.code), 'warn'); render(); return; }
      U.setF(`${key}.text`, '');
      render();
      afterSend(agentId, res.msg.id);
    },
    'dm-task': el => {
      const res = M.promoteDirect(P(), O(), el.dataset.agent, el.dataset.id, U.now());
      U.save();
      toast(res.ok ? T(`已转为任务 ${res.task.id}（不挂在任何 KR 下），上下文已带入。`, `Created task ${res.task.id} (not tied to a KR) with the context attached.`) : T('这条消息已经转过任务。', 'This message is already a task.'), res.ok ? 'ok' : 'warn');
      if (res.ok && FM.review) FM.review.mark('direct.promoted');
      render();
    },
    'dm-okr': el => {
      const conv = O().direct[el.dataset.agent];
      const m = M.find(conv.messages, el.dataset.id);
      U.clearForm('okrnew');
      U.setF('okrnew.title', L(m.text));
      if (!(agentById(el.dataset.agent) || {}).unconstrained) U.setF('okrnew.owner', el.dataset.agent);
      ui.drawer = null;
      U.go('okrs/new');
      if (FM.review) FM.review.mark('direct.promoted');
    },
    'standing-save': el => {
      const agent = agentById(el.dataset.agent);
      const key = `st-${agent.id}`;
      const actions = Object.keys(M.DIRECT_ACTIONS).filter(a => M.DIRECT_ACTIONS[a].grantable && U.f(`${key}.${a}`, agent.standing.actions.includes(a)));
      const budget = Math.round(Number(U.f(`${key}.budget`, agent.standing.dailyBudget / 100)) * 100);
      if (!(budget >= 0)) { toast(T('请输入有效预算', 'Enter a valid budget'), 'warn'); return; }
      U.submitTx({ kind: 'agent.policy', payload: { agentId: agent.id, fromVersion: agent.standing.version, patch: { actions, dailyBudget: budget } } }, {
        ok: T('常驻权限已更新；绑定旧版本的待处理审批已失效。', 'Standing permission updated; pending approvals bound to the old version are invalid.'),
        onConfirmed: () => { U.clearForm(key); if (ui.dialog && ui.dialog.type === 'standing') ui.dialog = null; if (FM.review) FM.review.mark('standing.updated'); },
      });
    },
  });

  // Instance switcher (a select, so it listens for change rather than click).
  document.addEventListener('change', ev => {
    const el = ev.target;
    if (el.getAttribute && el.getAttribute('data-action-select') === 'dm-instance') {
      M.setDirectInstance(O(), el.dataset.agent, el.value);
      U.save();
      render();
    }
  });

  FM.dialogs.standing = ({ agent: agentId }) => {
    const agent = agentById(agentId);
    if (!agent) return null;
    const st = agent.standing;
    const key = `st-${agentId}`;
    const tx = U.latestTx(t => t.kind === 'agent.policy' && t.payload.agentId === agentId && t.state !== 'confirmed');
    return {
      title: T(`${agent.name} 的常驻权限`, `${agent.name}’s standing permission`), sub: `v${st.version} · ${T('没有 OKR 时的执行边界', 'The limits when no OKR applies')}`, size: 'lg',
      body: agent.unconstrained ? `<div class="note warn">${icon('alert')}<div>${T('这个 Agent 不能接受约束，没有可授予的动作。', 'This Agent cannot take constraints, so nothing can be granted.')}</div></div>` : `
        <div class="grid-2">
          <div class="col"><span class="label">${T('对话与只读', 'Chat and read-only')}</span><div class="row small">${icon('check', 'sm')}${T('始终允许：回答问题、读取工作区、查看状态与日志', 'Always allowed: answer questions, read the workspace, view status and logs')}</div>
            <span class="label mt-8">${T('可授予的动作', 'Grantable actions')}</span>${Object.keys(M.DIRECT_ACTIONS).filter(a => M.DIRECT_ACTIONS[a].grantable).map(a => `<label class="check"><input type="checkbox" data-f="${key}.${a}" ${U.f(`${key}.${a}`, st.actions.includes(a)) ? 'checked' : ''}>${esc(actionLabel(a))} <span class="muted small">· ${U.money(M.DIRECT_ACTIONS[a].cost)}</span></label>`).join('')}</div>
          <div class="col"><span class="label">${T('始终需要审批', 'Always needs approval')}</span>${Object.keys(M.DIRECT_ACTIONS).filter(a => !M.DIRECT_ACTIONS[a].grantable).map(a => `<div class="row small">${icon('alert', 'sm')}${esc(actionLabel(a))}</div>`).join('')}
            <div class="field mt-8"><label for="st-budget">${T('每日预算（USD）', 'Daily budget (USD)')}</label><input id="st-budget" class="input num" type="number" min="0" step="1" data-f="${key}.budget" value="${esc(U.f(`${key}.budget`, st.dailyBudget / 100))}"></div>
            <div class="tiny muted">${T('今日已用', 'Used today')} ${U.money(M.standingToday(agent, U.now()).spentToday)}</div></div>
        </div>
        <div class="note">${icon('info')}<div>${T('确认后生成新版本；绑定旧版本的待处理审批会失效。直接对话的花费计入这里，不占用任何 OKR 的预算。', 'Confirming creates a new version; pending approvals bound to the old one become invalid. Direct-chat spending counts here, never against an OKR budget.')}</div></div>
        ${tx ? U.txLine(tx) : ''}`,
      foot: agent.unconstrained ? `<button class="btn primary" data-action="close-dialog">${T('关闭', 'Close')}</button>` : `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'standing-save', data: { agent: agentId }, label: T('签名确认新版本', 'Sign the new version'), kind: 'primary', perm: 'approve', disabled: !!(tx && tx.state === 'pending') })}`,
    };
  };

  /* --------------------------------------------- Standing decision card */

  FM.standingCard = (a, busyTx) => {
    const agent = agentById(a.agentId) || { name: '—' };
    const inst = U.inst(a.instanceId) || {};
    const conv = (O().direct || {})[a.agentId];
    const msg = conv && M.find(conv.messages, a.messageId);
    const reasons = (a.reasons || []).map(r => ({ outside_standing: T('不在常驻权限内', 'Outside standing permission'), workspace_busy: T('与执行中的 OKR 共用工作区', 'Shares a workspace with a running OKR') }[r]));
    return `<article class="decision k-boundary">
      <div class="d-top"><span class="chip warn">${icon('alert')}${T('超出常驻权限', 'Beyond standing permission')}</span><span>${esc(agent.name)} · ${esc(inst.name || '')}</span></div>
      <div class="d-title">${esc(actionLabel(a.action))}</div>
      <div class="d-body">
        <div class="row wrap">${reasons.map(r => `<span class="chip outline">${esc(r)}</span>`).join('')}</div>
        ${msg && L(msg.text) ? `<div>${T('来自对话', 'From chat')}：“${esc(L(msg.text))}” · <span class="chip ${msg.source === 'app' ? 'outline' : 'info'}">${esc(SOURCE_T[msg.source] || msg.source)}</span></div>` : ''}
        <div>${T('预计花费', 'Est. cost')} ${U.money(a.budgetImpact || 0)} · ${T('常驻权限', 'standing')} v${a.boundVersion} · ${T('仅授权这一次', 'this one action only')}</div>
      </div>
      ${busyTx ? `<div class="d-tx">${U.txLine(busyTx)}</div>` : `<div class="d-actions">${U.btn({ action: 'decide', data: { id: a.id, d: 'approve' }, label: T('同意本次', 'Approve once'), kind: 'primary', size: 'sm', perm: 'approve' })}${U.btn({ action: 'decide', data: { id: a.id, d: 'reject' }, label: T('拒绝', 'Reject'), size: 'sm', perm: 'approve' })}${U.btn({ action: 'open-direct', data: { agent: a.agentId }, label: T('打开对话', 'Open chat'), kind: 'ghost', size: 'sm' })}</div>`}
    </article>`;
  };

  /* ----------------------------------------------- Channels (settings) */

  const CH_STATE = { online: ['ok', '在线', 'Online'], disabled: ['muted', '已停用', 'Disabled'], offline: ['warn', '网关离线', 'Gateway offline'] };

  FM.channelsCard = () => {
    const org = O();
    const list = org.channels || [];
    return `<section class="card mt-16"><div class="card-h"><h2>${icon('message', 'sm')}${T('消息渠道', 'Message channels')}</h2><span class="small muted">${T('渠道网关 · 每个渠道只在一台主机运行', 'Channel gateway · one host per channel')}</span></div>
      ${list.map(c => {
        const h = U.host(c.hostId) || {};
        const x = h.status !== 'online' && c.state === 'online' ? CH_STATE.offline : CH_STATE[c.state];
        return `<div class="item"><span class="host-ico">${icon('message')}</span><div class="grow"><div class="strong">${esc(L(c.label))}</div><div class="tiny muted">${T('运行于', 'Runs on')} <a href="#/hosts/${esc(h.id)}">${esc(h.name || '')}</a> · ChannelBinding v${c.version}${c.kind === 'imessage' ? ` · ${T('需要登录“信息”的 Mac', 'needs a Mac signed in to Messages')}` : ''}</div></div>
          <span class="chip ${x[0]}">${esc(T(x[1], x[2]))}</span>${U.btn({ action: 'channel-toggle', data: { id: c.id }, label: c.state === 'online' ? T('停用', 'Disable') : T('启用', 'Enable'), size: 'sm', perm: 'manage_hosts' })}</div>`;
      }).join('') || `<div class="muted small">${T('还没有渠道', 'No channels yet')}</div>`}
      <div class="note mt-12">${icon('info')}<div>${T('渠道凭据只加密下发到承载它的主机；消息经 Coordinator 以签名请求送到任意主机上的 Agent。聊天中的“同意”不构成审批，审批与验收一律回到 App 完成。', 'Channel credentials are encrypted to the hosting machine only; messages reach Agents on any host through the coordinator as signed requests. “OK” in chat is never an approval; approvals and acceptance happen in the app.')}</div></div></section>`;
  };

  /* ----------------------------------------------- Channels (identity) */

  FM.channelGrantsCard = () => {
    const p = P();
    const list = (p.channelGrants || []).filter(g => !g.revoked);
    return `<div class="card"><div class="card-h"><h2>${icon('message', 'sm')}${T('已绑定的聊天账号', 'Linked chat accounts')}</h2>${U.btn({ action: 'open', data: { dialog: 'link-channel' }, label: T('绑定', 'Link'), size: 'sm', icon: 'plus' })}</div>
      ${list.map(g => `<div class="item"><span class="host-ico">${icon('message')}</span><div class="grow"><div class="strong">${esc(SOURCE_T[g.channel] || g.channel)} · ${esc(g.handle)}</div><div class="tiny muted">${esc(L((M.find(p.orgs, g.orgId) || {}).name))} · ${T('可以：读取、询问、补充、暂停、与 Agent 对话', 'Can: read, ask, add context, pause, chat with Agents')} · ${U.date(g.linkedAt)}</div></div>${U.btn({ action: 'channel-revoke', data: { id: g.id }, label: T('撤销', 'Revoke'), size: 'sm', kind: 'danger', perm: 'manage_identity' })}</div>`).join('') || `<div class="muted small">${T('还没有绑定聊天账号', 'No chat accounts linked')}</div>`}
      <div class="tiny muted mt-8">${T('聊天账号不是设备：不能审批、不能执行，也不能管理身份。', 'A chat account is not a device: it cannot approve, execute, or manage the identity.')}</div></div>`;
  };

  FM.dialogs['link-channel'] = st => {
    if (!st.code) st.code = String(Math.floor(Math.random() * 900000) + 100000);
    const ch = U.f('link.channel', 'telegram');
    return {
      title: T('绑定聊天账号', 'Link a chat account'), size: 'sm',
      body: `<div class="seg">${['telegram', 'imessage'].map(c => `<button data-action="set-f" data-key="link.channel" data-value="${c}" aria-pressed="${ch === c}">${esc(SOURCE_T[c])}</button>`).join('')}</div>
        <p class="small">${T('在聊天里向 FractalMind 机器人发送下面这条消息（5 分钟内有效）：', 'Send this message to the FractalMind bot in chat (valid for 5 minutes):')}</p>
        <div class="code-box"><span class="grow">/link ${esc(st.code)}</span></div>
        <div class="tiny muted">${T('绑定只授予读取、询问、补充、暂停与对话，不含审批与执行；随时可撤销。', 'Linking grants read, ask, add context, pause and chat only — never approval or execution; revocable anytime.')}</div>`,
      foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button><button class="btn primary" data-action="channel-link">${T('模拟已在聊天中发送（演示）', 'Simulate sending it (demo)')}</button>`,
    };
  };

  Object.assign(FM.actions, {
    'channel-toggle': el => {
      const c = M.find(O().channels, el.dataset.id);
      c.state = c.state === 'online' ? 'disabled' : 'online';
      c.version += 1;
      U.save();
      render();
    },
    'channel-link': () => {
      const p = P();
      const ch = U.f('link.channel', 'telegram');
      p.channelGrants = p.channelGrants || [];
      p.channelGrants.push({ id: M.nextId(p, 'cg'), channel: ch, handle: ch === 'telegram' ? '@ada_demo' : '+1 555 0100', orgId: p.currentOrgId, actions: ['read', 'ask', 'inform', 'pause', 'chat'], linkedAt: U.now(), revoked: false });
      U.save();
      ui.dialog = null;
      U.clearForm('link');
      toast(T('聊天账号已绑定到你的 Human 身份（演示）。', 'Chat account linked to your Human identity (demo).'), 'ok');
      render();
    },
    'channel-revoke': el => {
      const g = M.find(P().channelGrants, el.dataset.id);
      g.revoked = true;
      U.save();
      toast(T('已撤销：这个聊天账号发来的消息将被拒绝。', 'Revoked: messages from this chat account will be refused.'), 'ok');
      render();
    },
  });
})();
