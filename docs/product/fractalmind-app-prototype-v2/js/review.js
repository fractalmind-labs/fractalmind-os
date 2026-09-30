/* FractalMind App prototype v2 — review tools. Everything here simulates the
 * world around the product (heartbeats, faults, other devices) for reviewers.
 * It is deliberately kept out of the product UI. */
(function () {
  'use strict';
  const FM = window.FM;
  const U = FM.ui;
  const { M, F, T, L, esc, icon, ui, render, toast } = U;

  let autoplay = null;
  let hbSeq = 0;
  let lastHb = null;

  const P = () => U.P();
  const org = () => U.O();

  /* ----------------------------------------------------------- Journeys */

  const R = () => U.route();
  const personal = () => { const p = P(); return p ? p.orgs.find(o => o.kind === 'personal') : null; };
  const alpha = () => { const p = P(); return p && p.data['org-personal'] ? M.find(p.data['org-personal'].okrs, 'okr-alpha') : null; };

  function demoActive(focusId) {
    if (!U.root.profiles['demo-ada']) { U.resetDemo(); }
    U.root.activeProfileId = 'demo-ada';
    U.root.welcome = null;
    const p = P();
    if (p.currentOrgId !== 'org-personal') M.switchOrg(p, 'org-personal');
    if (focusId) p.data['org-personal'].focusOkrId = focusId;
    U.save();
  }

  const JOURNEYS = [
    {
      id: 'NAV', zh: '运行导航：从推进到达成', en: 'Run navigation: progress to achievement',
      dzh: '推进 heartbeat、验收、越界与换路、纠偏，直到 OKR 达成', den: 'Heartbeats, acceptance, boundaries, rerouting and correction until the OKR is achieved',
      start: () => { demoActive('okr-alpha'); U.go('workbench'); },
      steps: [
        { zh: '推进 heartbeat，直到 KR2 达标并通过验证', en: 'Send heartbeats until KR2 hits its target and is verified', check: () => { const a = alpha(); return a && M.find(a.krs, 'kr2').status === 'COMPLETE'; } },
        { zh: '在“需要你决定”中验收 KR1', en: 'Accept KR1 under “Needs your decision”', ev: 'approval.acceptance.approve' },
        { zh: 'KR3 触及边界：拒绝外部请求后切换本地路线 B', en: 'KR3 hits a boundary: reject the external request, then switch to route B', ev: ['nav.reroute', 'talk.adopted', 'nav.resolve.reroute'] },
        { zh: '注入“目标偏航”，查看判断依据后纠偏', en: 'Inject “drift”, read the basis, then correct course', ev: 'nav.resolve.correct' },
        { zh: '继续推进，验收 KR3 与最终结果', en: 'Keep going; accept KR3 and the final result', check: () => { const a = alpha(); return a && a.lifecycle === 'ACHIEVED'; } },
      ],
    },
    {
      id: 'J1', zh: '安装到首个成果', en: 'Install to first result', dzh: '新身份 → 运行费 → 恢复码 → 空组织 → 第一个 OKR', den: 'New identity → run fee → recovery code → empty org → first OKR',
      start: () => { U.root.activeProfileId = null; U.root.welcome = { mode: 'create', step: 1 }; U.save(); U.go('welcome'); },
      steps: [
        { zh: '创建身份：填写资料、准备运行费、签名提交', en: 'Create the identity: profile, run fee, sign and submit', ev: 'identity.created' },
        { zh: '保存恢复码', en: 'Save the recovery code', ev: 'recovery.set' },
        { zh: '选择项目目录', en: 'Choose a project folder', ev: 'onboard.workspace' },
        { zh: '准备本机执行主机（一次性邀请）', en: 'Prepare this computer as a host (one-time invitation)', ev: 'onboard.host' },
        { zh: '配置模型', en: 'Configure a model', ev: 'onboard.model' },
        { zh: '创建并激活第一个 OKR', en: 'Create and activate the first OKR', ev: 'okr.activated' },
      ],
    },
    {
      id: 'J2', zh: '从手机接手桌面任务', en: 'Pick up desktop work on a phone', dzh: '手机预览 + iPhone 授权：决定、验收、对话', den: 'Phone preview + iPhone grant: decide, accept, talk',
      start: () => { demoActive('okr-alpha'); P().currentDeviceId = 'dev-iphone'; ui.framed = true; U.save(); U.go('workbench'); },
      steps: [
        { zh: '在手机上查看待决定事项与路况', en: 'See decisions and road conditions on the phone', check: () => ui.framed },
        { zh: '同意或拒绝一个越界请求', en: 'Approve or reject an out-of-bounds request', ev: ['approval.boundary.approve', 'approval.boundary.reject'] },
        { zh: '检查证据后验收一个 KR', en: 'Check evidence, then accept a KR', ev: 'approval.acceptance.approve' },
        { zh: '与 Agent 沟通：询问原因', en: 'Talk to the Agent: ask why', ev: 'talk.ask' },
        { zh: '回到 MacBook 视角并关闭手机预览', en: 'Return to the MacBook and close the phone preview', check: () => !ui.framed && P() && P().currentDeviceId === 'dev-mbp' },
      ],
    },
    {
      id: 'J3', zh: '失败、取消与恢复', en: 'Failure, cancel and recovery', dzh: '正在停止 → 已取消；需要确认；失去观测后对账', den: 'Stopping → cancelled; needs confirmation; reconcile after lost observation',
      start: () => { demoActive('okr-alpha'); U.go('workbench'); },
      steps: [
        { zh: '取消当前 Run：先显示“正在停止”，确认后才“已取消”', en: 'Cancel the run: “stopping” first, “cancelled” only after confirmation', ev: 'run.cancelled' },
        { zh: '处理“需要确认”的 Run：检查结果后确认', en: 'Handle the “needs confirmation” run: check, then confirm', ev: 'run.confirmed' },
        { zh: '评审工具注入“失去观测”，再重新连接并对账', en: 'Inject “lost observation”, then reconnect and reconcile', ev: 'nav.resolve.reconnect' },
        { zh: '明确继续自主推进', en: 'Explicitly continue', ev: 'nav.resumed' },
      ],
    },
    {
      id: 'J4', zh: '管理权限与设备', en: 'Permissions and devices', dzh: '设备视角、只读与数据待同步、撤销', den: 'Device perspective, read-only, unsynced data, revocation',
      start: () => { demoActive(); U.go('identity'); },
      steps: [
        { zh: '切换到 Pixel 9 视角：只读且数据待同步，受保护内容被隐藏', en: 'View as Pixel 9: read-only, data not synced, protected content hidden', check: () => P() && P().currentDeviceId === 'dev-pixel' },
        { zh: '切回 MacBook，撤销 iPhone', en: 'Back on the MacBook, revoke the iPhone', ev: 'device.revoked' },
        { zh: '在“治理与审批 → 权限”中查看权限来源', en: 'Open Governance → Permissions to see where access comes from', check: () => ui.tab.gov === 'perm' && R().name === 'governance' },
      ],
    },
    {
      id: 'J5', zh: '走向更大的协作', en: 'Toward larger collaboration', dzh: '成长路径、切换组织、开放网络', den: 'Growth path, switching organizations, open network',
      start: () => { demoActive(); U.go('orgs'); },
      steps: [
        { zh: '切换到 FractalMind Labs：OKR、主机与权限随组织变化', en: 'Switch to FractalMind Labs: OKRs, hosts and access follow', check: () => P() && P().currentOrgId === 'org-labs' },
        { zh: '在 Labs 的工作台尝试审批：成员角色不包含审批', en: 'Try approving in Labs: the member role cannot approve', check: () => P() && P().currentOrgId === 'org-labs' && R().name === 'workbench' },
        { zh: '在开放网络查看另一个组织的参与规则', en: 'Open another organization in the open network', check: () => R().name === 'network' && R().parts[1] && R().parts[1] !== 'net-labs' },
        { zh: '切回个人组织', en: 'Switch back to the personal organization', check: () => P() && P().currentOrgId === 'org-personal' && ui.journey && ui.journey.done.size >= 3 },
      ],
    },
    {
      id: 'J6', zh: '升级、导出与退出', en: 'Update, export and quit', dzh: '导出清单与缺失项、在安全检查点更新', den: 'Export manifest and gaps; update at a safe checkpoint',
      start: () => { demoActive(); U.go('settings/data'); },
      steps: [
        { zh: '预览导出清单：注意缺失项与“不完整”', en: 'Preview the manifest: note the gaps and “incomplete”', check: () => R().name === 'settings' && R().parts[1] === 'data' },
        { zh: '导出 JSON（仅当前组织，不含凭据）', en: 'Export JSON (this org only, no credentials)', ev: 'export.done' },
        { zh: '在“关于与更新”下载更新并安排到安全检查点', en: 'Under About, download the update and schedule it', check: () => U.f('update.state', '') === 'scheduled' },
      ],
    },
    {
      id: 'J7', zh: '一次性邀请码接入主机', en: 'Add a host with a one-time code', dzh: '管理员签名一次，新主机输入一次', den: 'Admin signs once; the host enters the code once',
      start: () => { demoActive(); U.go('hosts'); U.openDialog('invite'); },
      steps: [
        { zh: '选择有效期与范围，签名创建邀请码', en: 'Pick validity and scope; sign to create', ev: 'invite.created' },
        { zh: '以新主机身份读取邀请、同意并加入', en: 'As the new host, read the invitation, consent and join', ev: ['invite.redeemed', 'invite.waiting'] },
        { zh: '可选：打开“Coordinator 不可达”再兑换一次，观察“已加入，等待连接”', en: 'Optional: with “coordinator unreachable”, redeem again to see “joined, waiting”', ev: 'invite.waiting', optional: true },
      ],
    },
    {
      id: 'J8', zh: '在另一台设备使用同一 Human', en: 'Same Human on another device', dzh: '配对请求 → 管理设备授权 → 单独同步数据', den: 'Pairing request → grant from a management device → separate data sync',
      start: () => { demoActive(); U.go('identity'); U.openDialog('pair'); },
      steps: [
        { zh: '新设备生成配对请求', en: 'The new device creates a pairing request', ev: 'pair.requested' },
        { zh: '管理设备核对并签名授权（默认只读 7 天）', en: 'A management device reviews and signs (read-only, 7 days by default)', ev: 'pair.granted' },
        { zh: '单独同步加密数据', en: 'Sync encrypted data separately', ev: 'data.synced' },
      ],
    },
    {
      id: 'J9', zh: '只凭一份恢复码找回身份', en: 'Recover with one code', dzh: '丢失全部设备 → 查找 → 恢复授权 → 恢复数据 → 新码', den: 'Lose all devices → find → restore access → restore data → new code',
      start: () => { demoActive(); U.go('identity'); U.openDialog('lose-all'); },
      steps: [
        { zh: '模拟丢失全部设备', en: 'Simulate losing all devices', check: () => !P() && U.root.welcome && U.root.welcome.mode === 'recover' },
        { zh: '输入恢复码并核对身份（演示码见下方）', en: 'Enter the code and verify the identity (demo code below)', ev: 'recovery.found' },
        { zh: '确认撤销旧设备并恢复授权', en: 'Confirm revoking old devices and restore access', ev: 'recovery.applied' },
        { zh: '单独恢复加密数据', en: 'Restore encrypted data separately', ev: 'data.synced' },
        { zh: '保存新的恢复码', en: 'Save a new recovery code', ev: 'recovery.set' },
      ],
    },
    {
      id: 'J10', zh: '运行费', en: 'Run fees', dzh: '余额与估算、失败扣费、到账、赞助方', den: 'Balance and estimates, failure charges, deposits, sponsors',
      start: () => { demoActive(); U.go('settings/fees'); },
      steps: [
        { zh: '打开“下一笔交易失败”，再发起任意链上操作（如归档记忆）', en: 'Turn on “next transaction fails”, then do any chain write (e.g. archive a memory)', check: () => { const p = P(); return p && p.wallet.records[0] && p.wallet.records[0].state === 'failed' && p.wallet.records[0].at > (ui.journey ? ui.journey.at : 0); } },
        { zh: '模拟到账：余额变化，但不会自动签名', en: 'Simulate a deposit: the balance changes; nothing is signed', ev: 'fees.topup' },
        { zh: '改为由赞助方支付', en: 'Switch to the sponsor', check: () => P() && P().wallet.source === 'sponsor' },
      ],
    },
    {
      id: 'J11', zh: '发现并导入 Host 上已有 Agent', en: 'Discover and import existing Agents', dzh: '扫描 → 仅观察导入 → 约束交接 → 明确继续', den: 'Scan → observe-only import → constrained handoff → explicit continue',
      start: () => { demoActive(); U.go('agents'); U.openDialog('discover', { host: 'host-mini' }); U.setF('discover.host', 'host-mini'); },
      steps: [
        { zh: '扫描 Mac mini M4', en: 'Scan the Mac mini M4', ev: 'agent.scanned' },
        { zh: '导入为仅观察（tmux 会话不能被控制）', en: 'Import as observe-only (tmux sessions cannot be controlled)', ev: 'agent.imported' },
        { zh: '确认交接检查后纳入 OKR', en: 'Complete the handoff checks and add it to an OKR', ev: 'agent.included' },
      ],
    },
  ];

  function startJourney(id) {
    const j = JOURNEYS.find(x => x.id === id);
    if (!j) return;
    stopAutoplay();
    ui.journey = { id, done: new Set(), at: U.now() };
    ui.review = false;
    j.start();
    render();
  }

  function mark(ev) {
    const j = ui.journey && JOURNEYS.find(x => x.id === ui.journey.id);
    if (!j) return;
    j.steps.forEach((s, i) => {
      const evs = Array.isArray(s.ev) ? s.ev : s.ev ? [s.ev] : [];
      if (evs.includes(ev)) ui.journey.done.add(i);
    });
  }

  function progress(j) {
    j.steps.forEach((s, i) => { try { if (s.check && s.check()) ui.journey.done.add(i); } catch (e) { /* state not ready */ } });
    return j.steps.map((s, i) => ui.journey.done.has(i));
  }

  /* ------------------------------------------------------- Simulation */

  const HB_TEXT = {
    progress: r => T(`heartbeat：采样 ${r.value}（花费 ${U.money(r.cost)}）`, `Heartbeat: sampled ${r.value} (spent ${U.money(r.cost)})`),
    verify_start: () => T('heartbeat：达到目标，提交验证（尚未点亮检查点）', 'Heartbeat: target reached; submitted for verification (checkpoint not lit yet)'),
    kr_complete: () => T('heartbeat：预授权验证通过，KR 完成', 'Heartbeat: pre-authorized verification passed; KR complete'),
    acceptance_requested: () => T('heartbeat：验证通过，等待你验收', 'Heartbeat: verified; awaiting your acceptance'),
    approval_requested: () => T('heartbeat：下一步超出约定，已请求批准', 'Heartbeat: the next step is outside the agreement; approval requested'),
    final_review: () => T('heartbeat：成功标准复核通过，等待最终验收', 'Heartbeat: criteria re-checked; awaiting final acceptance'),
    rework: () => T('heartbeat：Agent 补充证据，准备重新提交', 'Heartbeat: the Agent added evidence and will resubmit'),
    duplicate: () => T('已忽略重复的 heartbeat（重连补发去重）', 'Ignored a duplicate heartbeat (reconnect replay)'),
    nothing_to_do: () => T('heartbeat：没有可推进的工作', 'Heartbeat: nothing to advance'),
  };

  function heartbeat(replay) {
    const p = P();
    const okr = U.focusOkr();
    if (!p || !okr) { toast(T('当前组织没有进行中的目标', 'No active goal in this organization'), 'warn'); return null; }
    const id = replay && lastHb ? lastHb : `hb-${U.now()}-${++hbSeq}`;
    lastHb = id;
    const res = M.heartbeat(p, p.currentOrgId, okr.id, U.now(), id);
    U.save();
    const t = HB_TEXT[res.code];
    toast(t ? t(res) : T(`未推进：${U.condName(res.code)}`, `No progress: ${U.condName(res.code)}`), res.ok ? 'ok' : 'warn');
    mark('review.heartbeat');
    if (res.ok && res.code === 'kr_complete') mark('kr.complete');
    render();
    return res;
  }

  function stopAutoplay() { if (autoplay) { clearInterval(autoplay); autoplay = null; } ui.autoplay = false; }
  function toggleAutoplay() {
    if (autoplay) { stopAutoplay(); render(); return; }
    ui.autoplay = true;
    autoplay = setInterval(() => {
      const r = heartbeat(false);
      if (!r || !r.ok || ['approval_requested', 'acceptance_requested', 'final_review'].includes(r.code)) {
        stopAutoplay();
        toast(T('自动推进已停止：需要你决定或当前路况不允许推进。', 'Autoplay stopped: a decision is needed or the road condition blocks progress.'), 'info');
        render();
      }
    }, 2400);
    render();
  }

  function scenario(code) {
    const p = P();
    const okr = U.focusOkr();
    if (!okr) return;
    stopAutoplay();
    M.injectScenario(p, org(), okr, code, U.now());
    U.save();
    toast(code === 'normal' ? T('已清除注入场景；真实的预算、期限、依赖与授权检查仍然生效。', 'Cleared the injected scenario; real budget, deadline, dependency and authority checks still apply.') : T(`已注入演示观测：${U.condName(code)}`, `Injected a demo observation: ${U.condName(code)}`), 'info');
    if (code === 'unknown') mark('scenario.unknown');
    if (U.route().name !== 'workbench') U.go('workbench'); else render();
  }

  function toggleHost() {
    const okr = U.focusOkr();
    if (!okr) return;
    const h = U.host(okr.hostId);
    if (h.status === 'online') {
      h.status = 'offline';
      M.log(P(), org(), { okrId: okr.id, kind: 'connection_lost', hostId: h.id }, U.now());
    } else { h.status = 'online'; h.lastHeartbeatAt = U.now(); }
    U.save();
    toast(h.status === 'online' ? T(`${h.name} 已恢复心跳；需要时明确继续。`, `${h.name} is reporting again; continue when ready.`) : T(`${h.name} 失去心跳：只有它负责的目标变为未知。`, `${h.name} stopped reporting: only its goals become unknown.`), 'info');
    render();
  }

  /* ----------------------------------------------------------- Render */

  function panel() {
    const p = P();
    const f = U.root.faults;
    const okr = p ? U.focusOkr() : null;
    const cond = okr ? M.condition(org(), okr, U.now()) : null;
    const b = (action, ic, label, pressed, data) => `<button class="rv-btn" data-action="${action}" ${U.attrs(data)} ${pressed !== undefined ? `aria-pressed="${!!pressed}"` : ''}>${icon(ic)}<span>${esc(label)}</span></button>`;
    const onRecover = !p && U.root.welcome && U.root.welcome.mode === 'recover' && (U.root.welcome.step || 1) === 1;
    const demo = U.root.profiles['demo-ada'];
    const demoCode = F.demoRecoveryCode(M);
    const demoCodeOk = demo && demo.recovery && demo.recovery.state === 'saved' && demo.recovery.digest === M.parseRecoveryCode(demoCode).digest;
    const sessionCode = U.secrets.get('recovery:last');
    const journeyList = JOURNEYS.map(j => `<button class="journey" data-action="rv-journey" data-id="${j.id}"><b>${j.id}</b><span><span class="t" style="display:block">${esc(T(j.zh, j.en))}</span><span class="s">${esc(T(j.dzh, j.den))}</span></span></button>`).join('');
    const devices = p ? p.devices.filter(d => d.grant.state !== 'revoked').map(d => b('rv-device', U.platformIcon(d.platform), `${d.name} · ${d.role === 'manage' ? T('管理', 'manage') : d.grant.scopes.some(s => s.actions.includes('approve')) ? T('可审批', 'approve') : T('只读', 'read-only')}${d.dataSync !== 'synced' ? T(' · 待同步', ' · unsynced') : ''}`, p.currentDeviceId === d.id, { id: d.id })).join('') : '';
    return `<div class="rv-panel" role="dialog" aria-label="${T('评审工具', 'Review tools')}">
      <div class="rv-h"><div class="row between"><strong>${T('评审工具', 'Review tools')}</strong><span class="row"><span class="demo-tag">${T('演示', 'Demo')}</span><button class="btn ghost icon sm" data-action="toggle-review" aria-label="${T('关闭', 'Close')}">${icon('x')}</button></span></div>
        <div class="tiny muted mt-4">${T('模拟产品之外的世界：heartbeat、故障、其他设备。所有数据、交易与执行都是演示。快捷键 ⌘. 开关。', 'Simulates the world around the product: heartbeats, faults, other devices. All data, transactions and execution are demo. Toggle with ⌘.')}</div></div>
      <div class="rv-b">
        ${onRecover ? `<div class="rv-sec"><h3>${T('演示恢复码', 'Demo recovery code')}</h3>${demoCodeOk ? `<div class="code-box" style="font-size:12px">${esc(demoCode)}</div><button class="rv-btn" data-action="rv-fill-code" data-code="${esc(demoCode)}">${icon('key')}<span>${T('填入演示身份的恢复码', "Fill the demo identity's code")}</span></button>` : `<div class="tiny muted">${T('演示身份的恢复码已使用或更换；重置演示后可再次使用。', 'The demo code was used or replaced; reset the demo to use it again.')}</div>`}${sessionCode ? `<button class="rv-btn" data-action="rv-fill-code" data-code="${esc(sessionCode)}">${icon('key')}<span>${T('填入本次会话生成的新码', 'Fill the code generated this session')}</span></button>` : ''}</div>` : ''}
        <div class="rv-sec"><h3>${T('按 PRD 旅程走查', 'Walk through PRD journeys')}</h3>${journeyList}</div>
        ${okr ? `<div class="rv-sec"><h3>${T('运行模拟', 'Run simulation')} · ${esc(okr.priority)} ${esc(L(okr.title).slice(0, 16))}…</h3>
          <div class="rv-grid">${b('rv-hb', 'zap', T('推进一次 heartbeat', 'Send one heartbeat'))}${b('rv-auto', ui.autoplay ? 'pause' : 'play', ui.autoplay ? T('停止自动推进', 'Stop autoplay') : T('自动推进', 'Autoplay'), ui.autoplay)}${b('rv-replay', 'refresh', T('重连补发上一个 heartbeat', 'Replay the last heartbeat'))}${cond && cond.code === 'waiting' && cond.reason === 'dependency' ? b('rv-dep', 'check', T('模拟依赖返回', 'Dependency returns')) : ''}</div>
          <h3 class="mt-8">${T('注入路况（演示观测）', 'Inject a road condition (demo)')}</h3>
          <div class="rv-grid">${[['normal', 'trend'], ['boundary', 'alert'], ['drift', 'fork'], ['loop', 'loop'], ['blocked', 'block'], ['waiting', 'hourglass'], ['unknown', 'help']].map(([c, ic]) => b('rv-scenario', ic, c === 'normal' ? T('正常推进（清除）', 'Normal (clear)') : c === 'unknown' ? T('失去观测', 'Lost observation') : U.condName(c), cond && (c === 'normal' ? cond.code === 'on_track' : cond.code === c && (cond.scenario || c === 'waiting' || c === 'unknown')), { c })).join('')}</div></div>` : ''}
        <div class="rv-sec"><h3>${T('故障注入', 'Faults')}</h3><div class="rv-grid">
          ${b('rv-fault', 'x', T('下一笔交易失败', 'Next transaction fails'), f.nextTxFail, { k: 'nextTxFail' })}${b('rv-fault', 'help', T('Sui RPC 不可用', 'Sui RPC unavailable'), f.rpcDown, { k: 'rpcDown' })}
          ${b('rv-fault', 'link', T('Coordinator 不可达', 'Coordinator unreachable'), f.coordinatorDown, { k: 'coordinatorDown' })}${b('rv-fault', 'globe', T('开放网络查询失败', 'Network query fails'), f.networkFail, { k: 'networkFail' })}
          ${b('rv-fault', 'wallet', T('赞助方离线', 'Sponsor offline'), f.sponsorOffline, { k: 'sponsorOffline' })}${okr ? b('rv-host', 'offline', T('执行主机失联/恢复', 'Host drops/returns'), U.host(okr.hostId) && U.host(okr.hostId).status !== 'online') : ''}
        </div></div>
        ${p ? `<div class="rv-sec"><h3>${T('设备视角（视口不授予权限）', 'Device perspective (viewport grants nothing)')}</h3><div class="col" style="gap:6px">${devices}</div></div>` : ''}
        <div class="rv-sec"><h3>${T('视图与数据', 'View and data')}</h3><div class="rv-grid">
          ${b('rv-frame', 'phone', T('手机预览', 'Phone preview'), ui.framed)}${b('rv-export', 'download', T('导出演示状态', 'Export demo state'))}
          ${p ? b('rv-signout', 'logout', T('退出此设备（欢迎页）', 'Sign out (welcome)')) : b('rv-demo', 'user', T('载入演示身份', 'Load the demo identity'))}${b('rv-reset', 'refresh', T('重置演示', 'Reset demo'))}
        </div><div class="tiny muted">${T('本地存储模拟链记录；邀请码与恢复码只在页面内存中。重置不影响语言与外观偏好。', 'Local storage simulates chain records; invitation and recovery codes live in page memory only. Reset keeps language and appearance.')}</div></div>
      </div></div>`;
  }

  function dock() {
    const j = JOURNEYS.find(x => x.id === ui.journey.id);
    if (!j) return '';
    const done = progress(j);
    const next = done.findIndex((d, i) => !d && !j.steps[i].optional);
    const all = next === -1;
    return `<div class="jr-dock" role="region" aria-label="${T('旅程走查', 'Journey walkthrough')}">
      <div class="row between"><span class="row gap-sm"><span class="chip brand">${j.id}</span><strong class="small">${esc(T(j.zh, j.en))}</strong></span><button class="btn ghost icon sm" data-action="rv-end" aria-label="${T('结束走查', 'End walkthrough')}">${icon('x')}</button></div>
      <ol>${j.steps.map((s, i) => `<li class="${done[i] ? 'done' : i === next ? 'now' : ''}">${icon(done[i] ? 'check' : i === next ? 'arrow' : 'clock')}<span>${esc(T(s.zh, s.en))}${s.optional ? T('（可选）', ' (optional)') : ''}</span></li>`).join('')}</ol>
      ${all ? `<div class="calm small">${icon('check')}<span>${T('本旅程已走完。', 'Journey complete.')}</span></div>` : ''}
      ${j.id === 'J9' && !P() ? `<div class="tiny muted">${T('演示恢复码在评审工具中（⌘.）。', 'The demo code is in the review tools (⌘.).')}</div>` : ''}
    </div>`;
  }

  FM.review = {
    mark,
    render() {
      const el = document.getElementById('review');
      if (!el) return;
      const pill = `<button class="rv-pill" data-action="toggle-review" aria-expanded="${ui.review}">${icon('clipboard')}<span>${T('评审', 'Review')}</span><span class="demo-tag">${T('演示', 'Demo')}</span></button>`;
      el.innerHTML = `${ui.journey ? dock() : ''}${ui.review ? panel() : ''}${pill}`;
    },
  };

  Object.assign(FM.actions, {
    'rv-journey': el => startJourney(el.dataset.id),
    'rv-end': () => { ui.journey = null; FM.review.render(); },
    'rv-hb': () => heartbeat(false),
    'rv-replay': () => { if (!lastHb) { toast(T('还没有发送过 heartbeat', 'No heartbeat sent yet'), 'warn'); return; } heartbeat(true); },
    'rv-auto': () => toggleAutoplay(),
    'rv-dep': () => { const okr = U.focusOkr(); M.resolveScenario(P(), org(), okr, 'dependency_returned', U.now()); U.save(); toast(T('依赖已返回，约束检查通过后继续。', 'The dependency returned; continuing after checks.'), 'ok'); render(); },
    'rv-scenario': el => scenario(el.dataset.c),
    'rv-host': () => toggleHost(),
    'rv-fault': el => {
      const k = el.dataset.k;
      U.root.faults[k] = !U.root.faults[k];
      U.save();
      const on = U.root.faults[k];
      const msg = {
        nextTxFail: T('下一笔链上交易会失败（一次性）。', 'The next chain transaction will fail (once).'),
        rpcDown: on ? T('Sui RPC 不可用：新交易结果将显示为未知，需查询原交易。', 'Sui RPC down: new transactions end up unknown and must be queried.') : T('Sui RPC 已恢复：可以查询未知交易。', 'Sui RPC restored: unknown transactions can be queried.'),
        coordinatorDown: on ? T('Coordinator 不可达：新入组主机会等待连接；命令收不到回执。', 'Coordinator unreachable: new hosts wait to connect; commands get no receipt.') : T('Coordinator 已恢复。', 'Coordinator restored.'),
        networkFail: on ? T('开放网络查询将失败。', 'Open network queries will fail.') : T('开放网络查询已恢复。', 'Open network queries restored.'),
        sponsorOffline: on ? T('赞助方离线。', 'The sponsor is offline.') : T('赞助方在线。', 'The sponsor is online.'),
      }[k];
      if (k === 'sponsorOffline') Object.values(U.root.profiles).forEach(p => { if (p.wallet.sponsor) p.wallet.sponsor.online = !on; });
      if (on || k !== 'nextTxFail') toast(msg, 'info');
      render();
    },
    'rv-device': el => {
      const p = P();
      p.currentDeviceId = el.dataset.id;
      U.save();
      const d = U.me();
      toast(T(`现在以 ${d.name} 视角查看：权限跟随这台设备的授权。`, `Now viewing as ${d.name}: permissions follow this device's grant.`), 'info');
      render();
    },
    'rv-frame': () => { ui.framed = !ui.framed; ui.review = false; render(); },
    'rv-export': () => {
      U.download(`fractalmind-prototype-v2-state-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(U.root, null, 2));
      toast(T('已导出演示状态（不含页面内存中的邀请码和恢复码）。', 'Exported demo state (codes held in page memory are not included).'), 'ok');
    },
    'rv-signout': () => { stopAutoplay(); U.root.activeProfileId = null; U.root.welcome = { mode: 'choose' }; U.save(); ui.review = false; U.go('welcome'); },
    'rv-demo': () => { demoActive(); ui.review = false; U.go('workbench'); },
    'rv-reset': () => { stopAutoplay(); U.resetDemo(); ui.review = false; ui.framed = false; toast(T('演示已重置。', 'Demo reset.'), 'ok'); U.go('workbench'); },
    'rv-fill-code': el => { U.setF('welcome.code', el.dataset.code); render(); },
  });

  FM.review.journeys = JOURNEYS;
  FM.review.start = startJourney;
})();
