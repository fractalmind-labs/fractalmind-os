/* FractalMind App prototype v2 — signed-out entry: create an identity (J1 with
 * run-fee preparation J10), use an existing identity on a new device (J8) and
 * recover with a single code (J9). No private organization content is shown. */
(function () {
  'use strict';
  const FM = window.FM;
  const U = FM.ui;
  const { M, F, T, L, esc, icon, ui, render, toast, DAY } = U;

  const W = () => U.root.welcome || (U.root.welcome = { mode: 'choose' });
  const wf = (k, d) => U.f(`welcome.${k}`, d);
  const setW = patch => { Object.assign(W(), patch); U.save(); render(); };
  const IDENTITY_FEE = M.FEES['identity.create'];
  const BUDGET = 10000000;

  // Self-similar squares along the diagonal: each level repeats the one before it.
  const ART = `<svg class="art" viewBox="0 0 200 200" aria-hidden="true"><rect x="4" y="4" width="192" height="192" rx="44" fill="none" stroke="url(#fm-g200)" stroke-width="2.5" opacity=".75"/><rect x="104" y="30" width="62" height="62" rx="14" fill="none" stroke="url(#fm-g200)" stroke-width="1.5" opacity=".35"/><rect x="30" y="104" width="62" height="62" rx="14" fill="none" stroke="url(#fm-g200)" stroke-width="1.5" opacity=".35"/><rect x="30" y="30" width="62" height="62" rx="14" fill="url(#fm-g200)" opacity=".92"/><rect x="104" y="104" width="34" height="34" rx="8" fill="url(#fm-g200)" opacity=".85"/><rect x="146" y="146" width="18" height="18" rx="4" fill="url(#fm-g200)" opacity=".8"/><rect x="170" y="170" width="9" height="9" rx="2" fill="url(#fm-g200)" opacity=".75"/></svg>`;

  function stepsNav(list, cur) {
    return `<div class="steps-nav" style="margin:0">${list.map(([zh, en], i) => `<span class="${i + 1 === cur ? 'on' : i + 1 < cur ? 'done' : ''}"><b>${i + 1 < cur ? '✓' : i + 1}</b>${esc(T(zh, en))}</span>`).join('')}</div>`;
  }

  const PLATFORMS = ['macos', 'windows', 'ubuntu', 'ios', 'android'];
  const UNLOCK = { macos: 'touch_id', windows: 'windows_hello', ubuntu: 'password', ios: 'face_id', android: 'fingerprint' };
  const UNLOCK_T = { touch_id: 'Touch ID', windows_hello: 'Windows Hello', password: ['本机密码', 'Device password'], face_id: 'Face ID', fingerprint: ['指纹', 'Fingerprint'] };
  const unlockText = k => { const x = UNLOCK_T[k]; return Array.isArray(x) ? T(x[0], x[1]) : x; };

  function platformSeg(key) {
    const v = wf(key, 'macos');
    return `<div class="seg">${PLATFORMS.map(k => `<button data-action="set-f" data-key="welcome.${key}" data-value="${k}" aria-pressed="${v === k}">${esc(U.PLATFORM[k])}</button>`).join('')}</div>`;
  }

  /* ------------------------------------------------ Local chain helper */

  /** Signed-out flows have no active identity; this settles a demo transaction locally. */
  function localTx(onDone) {
    const w = W();
    const id = M.digest(`welcome:${Date.now()}:${Math.random()}`).slice(0, 12);
    w.tx = { id, state: 'pending', at: U.now() };
    U.save();
    render();
    U.later(1200, () => {
      const f = U.root.faults;
      const x = W().tx;
      if (!x || x.id !== id) return;
      if (f.rpcDown) x.state = 'unknown';
      else if (f.nextTxFail) { f.nextTxFail = false; x.state = 'failed'; }
      else x.state = 'confirmed';
      U.save();
      onDone(x.state);
      render();
    });
  }

  function txBox(tx) {
    if (!tx) return '';
    const map = { pending: ['info', 'refresh', '待链上确认（资料与支付来源已固定）', 'Awaiting confirmation (details and payer are fixed)'], confirmed: ['ok', 'check', '已确认', 'Confirmed'], failed: ['danger', 'x', '交易失败', 'Transaction failed'], unknown: ['warn', 'help', '结果未知：请查询原交易，不会重放', 'Outcome unknown: query the original transaction; it will not be replayed'] }[tx.state];
    return `<div class="row small"><span class="st ${map[0]}">${icon(map[1], tx.state === 'pending' ? 'spin' : '')}${esc(T(map[2], map[3]))}</span><span class="mono muted">${esc(tx.id)}</span></div>`;
  }

  /* ------------------------------------------------------------ Choose */

  function choose() {
    const opt = (mode, ic, zh, en, dzh, den) => `<button class="opt" data-action="w-mode" data-mode="${mode}"><span class="ico">${icon(ic)}</span><span class="grow"><span class="strong">${esc(T(zh, en))}</span><span class="small muted" style="display:block">${esc(T(dzh, den))}</span></span>${icon('right', 'sm')}</button>`;
    return `<div><h2 style="font-size:22px">${T('欢迎使用 FractalMind', 'Welcome to FractalMind')}</h2><p class="muted small mt-4">${T('选择开始方式。未登录时不显示任何组织私有内容。', 'Choose how to start. Nothing private is shown while signed out.')}</p></div>
      <div class="col">${opt('create', 'sparkle', '创建我的身份', 'Create my identity', '新建 Human 身份和个人组织，从空组织开始', 'A new Human identity and personal organization, starting empty')}
      ${opt('existing', 'phone', '我已有身份', 'I already have an identity', '在这台设备上登录，由已有设备批准', 'Sign in on this device, approved by one you already use')}
      ${opt('recover', 'key', '使用恢复码找回', 'Recover with a code', '所有设备都丢失时，用一份恢复码找回身份', 'If every device is lost, one code recovers your identity')}</div>
      <div class="note">${icon('info')}<div>${T('没有 FractalMind 云账号：身份、设备授权和组织记录在 Sui 上，私钥留在你的设备里。', 'There is no FractalMind cloud account: identity, device grants and organizations live on Sui; private keys stay on your devices.')}</div></div>`;
  }

  /* ------------------------------------------------------------ Create */

  function create() {
    const w = W();
    const step = w.step || 1;
    // Step 5 (this computer as the execution host) continues in the App right
    // after the organization opens (issue #64).
    const nav = stepsNav([['资料', 'Profile'], ['运行费', 'Run fee'], ['核对提交', 'Review'], ['恢复码', 'Recovery'], ['执行主机', 'Host']], step);
    const name = wf('name', '');
    let body = '', foot = '';
    if (step === 1) {
      const plat = wf('platform', 'macos');
      body = `<div class="field"><label for="w-name">${T('称呼', 'Your name')}</label><input id="w-name" class="input" data-f="welcome.name" value="${esc(name)}" placeholder="${esc(T('例如：林', 'e.g. Lin'))}"></div>
        <div class="field"><label for="w-org">${T('个人组织名称', 'Personal organization')}</label><input id="w-org" class="input" data-f="welcome.org" value="${esc(wf('org', ''))}" placeholder="${esc(name ? T(`${name} 的组织`, `${name}'s organization`) : T('例如：林的组织', "e.g. Lin's organization"))}"><span class="hint">${T('组织名称是公开字段，上链后不能承诺保密。', 'The organization name is public on chain and cannot be made private.')}</span></div>
        <div class="field"><span class="label">${T('这台设备', 'This device')}</span>${platformSeg('platform')}</div>
        <div class="field"><span class="label">${T('本机解锁', 'Unlock on this device')}</span><div class="small">${esc(unlockText(UNLOCK[plat]))} · <span class="muted">${T('只保护本机凭据', 'protects local credentials only')}</span></div></div>`;
      foot = `<button class="btn" data-action="w-mode" data-mode="choose">${T('返回', 'Back')}</button><button class="btn primary" data-action="w-create-next" data-step="2">${T('下一步', 'Next')}</button>`;
    }
    if (step === 2) {
      const src = wf('source', 'self');
      const bal = w.balance || 0;
      const sponsorOnline = !U.root.faults.sponsorOffline;
      const backup = wf('backup', false);
      body = `<div class="field"><span class="label">${T('首次运行费', 'First run fee')}</span><div class="seg block"><button data-action="set-f" data-key="welcome.source" data-value="self" aria-pressed="${src === 'self'}">${T('自己支付', 'Pay myself')}</button><button data-action="set-f" data-key="welcome.source" data-value="sponsor" aria-pressed="${src === 'sponsor'}">${T('已有赞助方', 'Existing sponsor')}</button></div></div>
        ${src === 'self' ? `<div class="card soft tight"><dl class="kv"><dt>${T('网络', 'Network')}</dt><dd>Sui ${T('测试网', 'testnet')}</dd><dt>${T('收款地址', 'Address')}</dt><dd class="mono small">0x0000…de770 <span class="chip warn">${T('演示地址，请勿转账', 'Demo — do not send funds')}</span></dd><dt>${T('余额', 'Balance')}</dt><dd class="num strong">${U.sui(bal)}</dd><dt>${T('预计费用', 'Estimated fee')}</dt><dd class="num">${U.sui(IDENTITY_FEE)} · ${T('Gas 预算', 'gas budget')} ${U.sui(BUDGET)}</dd></dl></div>
          <label class="check"><input type="checkbox" data-f="welcome.backup" ${backup ? 'checked' : ''}>${T('我已保存初始签名凭据的临时备份（身份尚未创建时，不能用恢复码代替）', 'I saved a temporary backup of the initial signing key (before the identity exists, a recovery code cannot stand in)')}</label>
          <div class="row wrap">${U.btn({ action: 'w-deposit', label: T('模拟到账 0.01 SUI（演示）', 'Simulate a 0.01 SUI deposit (demo)'), icon: 'download', size: 'sm' })}<span class="tiny muted">${T('到账只更新余额，不会自动签名或创建。', 'A deposit only updates the balance; nothing is signed or created automatically.')}</span></div>
          ${bal > 0 && bal < IDENTITY_FEE ? `<div class="note warn">${icon('alert')}<div>${T('余额不足以支付预计费用。', 'The balance does not cover the estimated fee.')}</div></div>` : ''}`
        : `<div class="card soft tight"><div class="row between"><strong>${T('测试网赞助方（演示）', 'Testnet sponsor (demo)')}</strong><span class="chip ${sponsorOnline ? 'ok' : 'danger'}">${sponsorOnline ? T('在线', 'Online') : T('离线', 'Offline')}</span></div><div class="small mt-4">${T('剩余代付额度', 'Quota left')} ${U.sui(20000000)} · ${T('有效代付可以免去先充值', 'A working sponsor lets you skip the deposit')}</div></div>
          ${sponsorOnline ? '' : `<div class="note warn">${icon('offline')}<div>${T('赞助方离线：可以改为自己支付，或稍后重试。', 'The sponsor is offline: pay yourself instead or retry later.')}</div></div>`}`}
        <div class="tiny muted">${T('没有 FractalMind 官方 Gas 后台。数额均为示例，不是实时估价或充值建议。', 'There is no official FractalMind gas backend. Amounts are examples, not live quotes or advice.')}</div>`;
      const ready = src === 'self' ? bal >= IDENTITY_FEE && backup : sponsorOnline;
      foot = `<button class="btn" data-action="w-create-next" data-step="1">${T('上一步', 'Back')}</button>${U.btn({ action: 'w-create-next', data: { step: 3 }, label: T('下一步', 'Next'), kind: 'primary', disabled: !ready, why: src === 'self' ? T('需要足够余额并确认临时备份', 'Needs enough balance and a saved backup') : T('赞助方离线', 'The sponsor is offline') })}`;
    }
    if (step === 3) {
      const tx = w.tx;
      const locked = tx && (tx.state === 'pending' || tx.state === 'unknown');
      const src = wf('source', 'self');
      body = `<div class="card soft tight"><div class="label">${T('将要提交的内容', 'What will be submitted')}</div><dl class="kv mt-8">
          <dt>${T('称呼', 'Name')}</dt><dd>${esc(name)}</dd><dt>${T('个人组织', 'Organization')}</dt><dd>${esc(wf('org', '') || T(`${name} 的组织`, `${name}'s organization`))} <span class="chip outline">${T('公开', 'Public')}</span></dd>
          <dt>${T('首台设备', 'First device')}</dt><dd>${esc(U.PLATFORM[wf('platform', 'macos')])} · ${T('管理设备', 'management device')}</dd><dt>${T('网络', 'Network')}</dt><dd>Sui ${T('测试网', 'testnet')}</dd>
          <dt>${T('费用', 'Fee')}</dt><dd class="num">${U.sui(IDENTITY_FEE)} ${T('（预计）', '(est.)')}</dd><dt>${T('付款方', 'Payer')}</dt><dd>${src === 'self' ? T('你的运行费账户', 'Your run-fee account') : T('测试网赞助方（演示）', 'Testnet sponsor (demo)')}</dd></dl></div>
        <div class="small muted">${T('一笔交易建立 Human 身份、首个设备授权和个人组织。新身份从空组织开始，不继承任何示例或其他身份的数据。', 'One transaction creates the Human identity, the first device grant and the personal organization. It starts empty and inherits nothing.')}</div>
        ${txBox(tx)}
        ${tx && tx.state === 'failed' ? `<div class="note danger">${icon('x')}<div>${T(`交易失败，按链上结果扣除 ${U.sui(M.FAIL_FEE)}。重试会使用新的交易。`, `The transaction failed and was charged ${U.sui(M.FAIL_FEE)} per the chain result. A retry uses a new transaction.`)}</div></div>` : ''}`;
      foot = `${U.btn({ action: 'w-create-next', data: { step: 2 }, label: T('上一步', 'Back'), disabled: locked, why: T('交易进行中，资料已固定', 'A transaction is in flight; details are fixed') })}${tx && tx.state === 'unknown' ? U.btn({ action: 'w-query', label: T('查询原交易', 'Query transaction'), kind: 'primary' }) : U.btn({ action: 'w-submit', label: tx && tx.state === 'failed' ? T('重试（新交易）', 'Retry (new transaction)') : T('签名并提交', 'Sign and submit'), kind: 'primary', disabled: locked, why: T('等待确认', 'Awaiting confirmation') })}`;
    }
    if (step === 4) {
      if (!U.secrets.has('welcome:code')) U.secrets.set('welcome:code', M.makeRecoveryCode(U.randomBytes, 'T'));
      const code = U.secrets.get('welcome:code');
      body = `<div class="calm">${icon('check')}<span>${T('身份、首个设备与个人组织已在链上确认。', 'Identity, first device and personal organization are confirmed on chain.')}</span></div>
        <div><div class="label">${T('保存一份恢复码', 'Save one recovery code')}</div><p class="small muted mt-4">${T('所有设备丢失时，只凭它就能找回身份。请离线保存。', 'If every device is lost, this alone recovers your identity. Keep it offline.')}</p></div>
        <div class="code-box"><span class="grow">${esc(code)}</span><button class="btn ghost icon sm" data-action="copy" data-copy="${esc(code)}" aria-label="${T('复制', 'Copy')}">${icon('copy')}</button></div>
        <button class="btn sm" data-action="w-kit">${icon('download', 'sm')}${T('下载演示备份文件（可选）', 'Download demo kit (optional)')}</button>
        <label class="check"><input type="checkbox" data-f="welcome.saved" ${wf('saved', false) ? 'checked' : ''}>${T('我已离线保存', 'I saved it offline')}</label>`;
      foot = `<button class="btn ghost" data-action="w-finish" data-skip="1">${T('稍后在“我的身份”设置', 'Set up later in My identity')}</button>${U.btn({ action: 'w-finish', label: T('进入我的组织', 'Open my organization'), kind: 'primary', disabled: !wf('saved', false), why: T('请先确认已保存', 'Confirm you saved it first') })}`;
    }
    return `${nav}${body}<div class="row between mt-8">${foot}</div>`;
  }

  /* ---------------------------------------------------------- Existing */

  const target = () => Object.values(U.root.profiles).find(p => p.kind === 'demo') || Object.values(U.root.profiles)[0];

  function existing() {
    const w = W();
    const step = w.step || 1;
    const nav = stepsNav([['本机请求', 'This device'], ['已有设备批准', 'Approval'], ['同步数据', 'Sync']], step);
    let body = '', foot = '';
    const tp = w.profileId ? U.root.profiles[w.profileId] : target();
    if (!tp) return `${nav}<div class="note warn">${icon('alert')}<div>${T('这个浏览器里没有可配对的身份。请先重置演示或创建身份。', 'No identity in this browser to pair with. Reset the demo or create one.')}</div></div>`;
    if (step === 1) {
      body = `<div class="field"><span class="label">${T('这台设备', 'This device')}</span>${platformSeg('eplatform')}</div>
        <div class="field"><label for="w-dev">${T('设备名称', 'Device name')}</label><input id="w-dev" class="input" data-f="welcome.edev" value="${esc(wf('edev', 'Studio PC'))}"></div>
        <div class="small muted">${T('这台设备会生成独立密钥和短期配对请求。连接和扫码本身不产生任何组织权限。', 'This device creates its own key and a short-lived pairing request. Connecting or scanning alone grants nothing.')}</div>`;
      foot = `<button class="btn" data-action="w-mode" data-mode="choose">${T('返回', 'Back')}</button><button class="btn primary" data-action="w-pair">${T('生成配对请求', 'Create pairing request')}</button>`;
    }
    if (step === 2) {
      const pr = M.find(tp.pairings, w.pairingId);
      const st = pr ? M.pairingStatus(pr, U.now()) : 'missing';
      const dev = pr && pr.deviceId ? M.find(tp.devices, pr.deviceId) : null;
      const tx = dev && M.find(tp.txs, w.grantTx);
      body = `<div class="row top gap-lg">${FM.qr(pr ? pr.id : 'x')}<div class="col grow"><div class="label">${T('在已有的管理设备上核对', 'Review on a management device you already use')}</div>
          <div class="small">${T('核对码', 'Code')}：<span class="mono strong" style="font-size:20px;letter-spacing:.08em">${pr ? `${esc(pr.code.slice(0, 3))} ${esc(pr.code.slice(3))}` : '—'}</span></div>
          <div class="tiny muted">${pr ? U.until(pr.expiresAt) : ''} · ${T('二维码为示意，不能扫描', 'The QR is illustrative and cannot be scanned')}</div></div></div>
        ${st === 'expired' ? `<div class="note warn">${icon('clock')}<div>${T('请求已过期，请重新发起。', 'The request expired; start again.')}</div></div>` : ''}
        ${dev ? `${txBox(tx ? { id: U.shortId(tx.id, 4), state: tx.state } : null)}` : `<div class="card soft tight"><div class="row between"><span class="label">${T('评审：切换到旧管理设备批准', 'Review: approve on the old management device')}</span><span class="demo-tag">${T('演示', 'Demo')}</span></div>
          <div class="small mt-4">${esc(tp.human.name)} · ${esc((M.find(tp.devices, tp.currentDeviceId) || {}).name || '')}</div>
          <label class="check mt-8"><input type="checkbox" data-f="welcome.eoperate" ${wf('eoperate', false) ? 'checked' : ''}>${T('同时允许执行与审批（默认只读）', 'Also allow operate and approve (default: read-only)')}</label>
          <div class="tiny muted">${T('默认：当前组织、7 天只读；不授予身份管理权。', 'Default: current organization, read-only, 7 days; never identity management.')}</div></div>`}`;
      foot = `<button class="btn" data-action="w-mode" data-mode="choose">${T('取消', 'Cancel')}</button>${dev ? '' : U.btn({ action: 'w-approve', label: T('在旧设备上签名授权（演示）', 'Sign on the old device (demo)'), kind: 'primary', disabled: st !== 'waiting', why: T('请求不可用', 'Request unavailable') })}`;
    }
    if (step === 3) {
      const dev = M.find(tp.devices, w.deviceId);
      body = `<div class="calm">${icon('check')}<span>${T('已授权。', 'Authorized.')}</span></div>
        ${dev.dataSync === 'synced' ? `<div class="note ok">${icon('key')}<div>${T('加密数据已同步。', 'Encrypted data synced.')}</div></div>` : `<div class="note warn">${icon('key')}<div>${T('已授权，数据待同步：同步前不能读取受保护内容。', 'Authorized, data not synced: protected content stays unreadable until you sync.')}</div></div>`}
        <dl class="kv"><dt>Human ID</dt><dd class="mono">${esc(tp.human.id)}</dd><dt>${T('权限', 'Access')}</dt><dd>${dev.grant.scopes.map(s => `${esc(L((M.find(tp.orgs, s.orgId) || {}).name))}：${s.actions.join(', ')}`).join('<br>')} · ${U.until(dev.grant.expiresAt)}</dd></dl>`;
      foot = dev.dataSync === 'synced' ? `<span></span><button class="btn primary" data-action="w-enter" data-profile="${esc(tp.id)}" data-device="${esc(dev.id)}">${T('进入', 'Continue')}</button>`
        : `<button class="btn" data-action="w-enter" data-profile="${esc(tp.id)}" data-device="${esc(dev.id)}">${T('暂不同步，先进入', 'Continue without syncing')}</button><button class="btn primary" data-action="w-sync" data-profile="${esc(tp.id)}" data-device="${esc(dev.id)}">${icon('key', 'sm')}${T('同步加密数据', 'Sync encrypted data')}</button>`;
    }
    return `${nav}${body}<div class="row between mt-8">${foot}</div>`;
  }

  /* ----------------------------------------------------------- Recover */

  const PARSE_ERR = {
    empty: ['请输入恢复码', 'Enter a recovery code'], format: ['格式不正确', 'The format is not valid'], version: ['恢复码版本不受支持', 'Unsupported code version'],
    network: ['恢复码属于其他网络', 'The code belongs to another network'], checksum: ['校验失败：请检查是否输错', 'Checksum failed: check for typos'],
    not_found: ['没有找到对应的恢复记录', 'No recovery record matches'], consumed: ['该恢复码已被使用或已更换，不能再次恢复', 'This code was used or replaced and cannot recover again'],
  };

  function recover() {
    const w = W();
    const step = w.step || 1;
    const nav = stepsNav([['输入恢复码', 'Code'], ['核对身份', 'Verify'], ['恢复授权', 'Authorize'], ['恢复数据', 'Data'], ['新恢复码', 'New code']], step);
    const tp = w.profileId ? U.root.profiles[w.profileId] : null;
    let body = '', foot = '';
    if (w.lost && step === 1) body += `<div class="note info">${icon('info')}<div>${T('演示：假设你的所有设备都已丢失。', 'Demo: assume every one of your devices is lost.')}</div></div>`;
    if (step === 1) {
      body += `<div class="field"><label for="w-code">${T('恢复码', 'Recovery code')}</label><textarea id="w-code" class="textarea mono" rows="2" data-f="welcome.code" placeholder="FMR1-T-XXXXX-XXXXX-XXXXX-XXXXX-X">${esc(wf('code', ''))}</textarea>${w.err ? `<div class="err-t">${icon('x', 'xs')}${esc(T(...(PARSE_ERR[w.err] || [w.err, w.err])))}</div>` : ''}
        <span class="hint">${T('不需要输入 Human ID。大小写、空格和换行会自动规范化。恢复码只在本机解析，不会发送到 Coordinator。', 'No Human ID needed. Case, spaces and line breaks are normalized. The code is parsed locally and never sent to a coordinator.')}</span></div>`;
      foot = `<button class="btn" data-action="w-mode" data-mode="choose">${T('返回', 'Back')}</button><button class="btn primary" data-action="w-lookup">${T('查找身份', 'Find identity')}</button>`;
    }
    if (step === 2 && tp) {
      body = `<div class="card soft tight"><div class="row gap-lg"><span class="avatar round human" style="width:44px;height:44px">${esc(tp.human.name.slice(0, 1))}</span><div><div class="strong">${esc(tp.human.name)}</div><div class="mono small">${esc(tp.human.id)}</div></div></div>
          <div class="small mt-8">${tp.orgs.map(o => `${esc(L(o.name))}（${o.role === 'admin' ? T('管理员', 'admin') : T('成员', 'member')}）`).join('、')}</div>
          <div class="tiny muted mt-4">${T(`当前 ${tp.devices.filter(d => d.grant.state === 'active').length} 台有效设备将被撤销`, `${tp.devices.filter(d => d.grant.state === 'active').length} active devices will be revoked`)}</div></div>
        <div class="note">${icon('info')}<div>${T('找到记录只代表定位到身份，不代表已登录或获得权限。', 'Finding the record only locates the identity; it signs nothing in and grants nothing.')}</div></div>
        <div class="field"><span class="label">${T('这台新设备', 'This new device')}</span>${platformSeg('rplatform')}</div>
        <label class="check"><input type="checkbox" data-f="welcome.rconfirm" ${wf('rconfirm', false) ? 'checked' : ''}>${T('我确认撤销所有旧设备，并授权这台设备为管理设备', 'I confirm revoking every old device and authorizing this one as a management device')}</label>
        ${txBox(w.tx)}`;
      const busy = w.tx && (w.tx.state === 'pending');
      foot = `<button class="btn" data-action="w-back-lookup">${T('上一步', 'Back')}</button>${w.tx && w.tx.state === 'unknown' ? U.btn({ action: 'w-recover', data: { query: 1 }, label: T('查询原交易', 'Query transaction'), kind: 'primary' }) : U.btn({ action: 'w-recover', label: T('签名恢复', 'Sign recovery'), kind: 'primary', disabled: !wf('rconfirm', false) || busy, why: T('请先确认撤销旧设备', 'Confirm revoking old devices first') })}`;
    }
    if (step === 3 && tp) {
      body = `<div class="calm">${icon('check')}<span>${T('身份权限已恢复：旧设备授权失效，恢复码已消费；Human ID、组织关系和原有工作保留。', 'Identity access restored: old device grants are void and the code is consumed; Human ID, organizations and work are kept.')}</span></div>
        <div class="note warn">${icon('key')}<div>${T('加密数据尚未恢复：身份权限与数据访问是两件事。', 'Encrypted data is not restored yet: identity access and data access are separate.')}</div></div>`;
      foot = `<span></span><button class="btn primary" data-action="w-rdata">${icon('key', 'sm')}${T('恢复加密数据（演示）', 'Restore encrypted data (demo)')}</button>`;
    }
    if (step === 4 && tp) {
      if (!U.secrets.has('welcome:rcode')) U.secrets.set('welcome:rcode', M.makeRecoveryCode(U.randomBytes, 'T'));
      const code = U.secrets.get('welcome:rcode');
      body = `<div class="note ok">${icon('check')}<div>${T('加密数据已恢复。', 'Encrypted data restored.')}</div></div>
        <div><div class="label">${T('保存新的恢复码', 'Save a new recovery code')}</div><p class="small muted mt-4">${T('旧恢复码已消费。更换恢复码不会改变 Human ID。', 'The old code is consumed. A new code keeps the same Human ID.')}</p></div>
        <div class="code-box"><span class="grow">${esc(code)}</span><button class="btn ghost icon sm" data-action="copy" data-copy="${esc(code)}" aria-label="${T('复制', 'Copy')}">${icon('copy')}</button></div>
        <label class="check"><input type="checkbox" data-f="welcome.rsaved" ${wf('rsaved', false) ? 'checked' : ''}>${T('我已离线保存', 'I saved it offline')}</label>
        ${txBox(w.tx)}`;
      foot = `<button class="btn ghost" data-action="w-enter" data-profile="${esc(tp.id)}" data-device="${esc(tp.currentDeviceId)}">${T('稍后设置', 'Later')}</button>${U.btn({ action: 'w-rsave', label: T('签名保存并进入', 'Sign, save and continue'), kind: 'primary', disabled: !wf('rsaved', false) || (w.tx && w.tx.state === 'pending'), why: T('请先确认已保存', 'Confirm you saved it first') })}`;
    }
    return `${nav}${body}<div class="row between mt-8">${foot}</div>`;
  }

  /* -------------------------------------------------------------- View */

  FM.views.welcome = () => {
    const w = W();
    const card = { choose, create, existing, recover }[w.mode] || choose;
    return `<div class="welcome">
      <section class="w-hero">${ART}
        <div style="position:relative"><div class="row">${U.LOGO.replace('class="logo"', 'class="logo" style="width:30px;height:30px"')}<strong style="font-size:17px;color:#fff">FractalMind</strong></div>
          <span class="eyebrow"><i></i>${T('开放 · 可验证 · 无需许可', 'Open · Verifiable · Permissionless')}</span>
          <h1>${T('从一个人的组织开始', 'Start with an organization of one')}</h1>
          <p>${T('建立自己的组织，和 Agent 一起完成可验证的目标，再逐步加入更大的团队与开放网络。', 'Create your own organization, deliver verifiable goals with Agents, then grow into larger teams and the open network.')}</p>
          <p class="mission">${T('我们通过分形、自相似的 Agent 组织，走向一个没有人能独占的 ASI。', 'Through fractal, self-similar agent organizations, toward an ASI that no one owns.')}</p></div>
        <div class="fine">${T('测试网 · 原型演示：不连接真实服务，不要输入真实密钥或恢复码。', 'Testnet · prototype demo: no real services; never enter real keys or recovery codes.')}</div>
      </section>
      <main class="w-main"><div class="w-card">
        <div class="w-top"><button class="tb-btn" data-action="toggle-locale" aria-label="${T('切换语言', 'Switch language')}"><span style="font-weight:700;font-size:12px">${U.prefs.locale === 'en' ? '中' : 'EN'}</span></button><button class="tb-btn" data-action="theme-menu" data-pop-anchor="theme-w" aria-label="${T('外观', 'Appearance')}">${icon({ light: 'sun', dark: 'moon', system: 'monitor' }[U.prefs.theme])}</button></div>
        ${card()}
      </div></main></div>`;
  };

  /* ----------------------------------------------------------- Actions */

  function enter(profileId, deviceId) {
    const p = U.root.profiles[profileId];
    if (!p) return;
    if (deviceId) p.currentDeviceId = deviceId;
    U.root.activeProfileId = profileId;
    U.root.welcome = null;
    U.secrets.delete('welcome:code');
    U.secrets.delete('welcome:rcode');
    U.clearForm('welcome');
    U.save();
    U.go('workbench');
  }

  Object.assign(FM.actions, {
    'w-mode': el => { U.root.welcome = { mode: el.dataset.mode, step: 1 }; U.save(); render(); },
    'w-create-next': el => {
      const to = Number(el.dataset.step);
      if (to === 2 && !String(wf('name', '')).trim()) { toast(T('请填写称呼', 'Enter your name'), 'warn'); return; }
      setW({ step: to });
    },
    'w-deposit': () => { const w = W(); w.balance = (w.balance || 0) + 10000000; U.save(); toast(T('演示到账 0.01 SUI：只更新余额。', 'Demo deposit of 0.01 SUI: balance only.'), 'ok'); render(); },
    'w-submit': () => {
      const w = W();
      localTx(state => {
        const x = W();
        if (state === 'failed') { if (wf('source', 'self') === 'self') x.balance = Math.max(0, (x.balance || 0) - M.FAIL_FEE); return; }
        if (state === 'confirmed') createIdentity();
      });
      if (w.step !== 3) setW({ step: 3 });
    },
    'w-query': () => {
      const w = W();
      if (U.root.faults.rpcDown) { toast(T('Sui RPC 仍不可用，稍后再查询。', 'Sui RPC is still unavailable; query later.'), 'warn'); return; }
      w.tx.state = 'confirmed';
      createIdentity();
      toast(T('已查询到原交易：已确认，没有重复提交。', 'Found the original transaction: confirmed; nothing was resubmitted.'), 'ok');
      render();
    },
    'w-kit': () => U.download('fractalmind-recovery-kit-DEMO.txt', FM.recoveryKit(U.secrets.get('welcome:code'), wf('name', '')), 'text/plain'),
    'w-finish': el => {
      const w = W();
      const p = U.root.profiles[w.newProfileId];
      if (!p) return;
      if (!el.dataset.skip) {
        const parsed = M.parseRecoveryCode(U.secrets.get('welcome:code'), 'T');
        const tx = M.beginTx(p, { kind: 'recovery.set', payload: { digest: parsed.digest, network: parsed.network } }, U.now());
        if (tx.ok) M.commitTx(p, tx.tx.id, U.now());
        if (FM.review) FM.review.mark('recovery.set');
      }
      if (FM.review) FM.review.mark('identity.created');
      enter(p.id);
      // Desktops continue straight into "use this computer as an execution host".
      const dev = M.find(p.devices, p.currentDeviceId);
      if (dev && ['macos', 'windows', 'ubuntu'].includes(dev.platform)) U.openDialog('bootstrap');
    },
    'w-pair': () => {
      const tp = target();
      const plat = wf('eplatform', 'macos');
      const pr = M.createPairing(tp, { platform: plat, name: String(wf('edev', 'Studio PC')).trim() || U.PLATFORM[plat] }, U.now());
      setW({ step: 2, profileId: tp.id, pairingId: pr.id });
      if (FM.review) FM.review.mark('pair.requested');
    },
    'w-approve': () => {
      const w = W();
      const tp = U.root.profiles[w.profileId];
      const manager = tp.devices.find(d => d.role === 'manage' && M.deviceActive(d, U.now()));
      if (!manager) { toast(T('这个身份没有可用的管理设备，请改用恢复码。', 'This identity has no usable management device; use the recovery code.'), 'warn'); return; }
      const actions = wf('eoperate', false) ? ['read', 'operate', 'approve'] : ['read'];
      const res = M.approvePairing(tp, w.pairingId, { orgIds: [tp.currentOrgId], actions, days: 7, shareData: true }, manager.id, U.now());
      if (!res.ok) { toast(res.code, 'warn'); render(); return; }
      const tx = U.submitTx({ kind: 'device.grant', payload: { deviceId: res.device.id } }, {
        profile: tp,
        onConfirmed: () => { const x = W(); if (x.mode === 'existing') { x.step = 3; x.deviceId = res.device.id; } if (FM.review) FM.review.mark('pair.granted'); },
      });
      if (tx) { w.grantTx = tx.id; U.save(); }
    },
    'w-sync': el => { M.syncData(U.root.profiles[el.dataset.profile], el.dataset.device); U.save(); if (FM.review) FM.review.mark('data.synced'); render(); },
    'w-enter': el => enter(el.dataset.profile, el.dataset.device),
    'w-lookup': () => {
      const w = W();
      const parsed = M.parseRecoveryCode(wf('code', ''), 'T');
      w.err = null;
      if (!parsed.ok) { w.err = parsed.code; U.save(); render(); return; }
      const hit = M.lookupRecovery(Object.values(U.root.profiles), parsed);
      if (!hit.ok) { w.err = hit.code; U.save(); render(); return; }
      setW({ step: 2, profileId: hit.profileId, tx: null });
      if (FM.review) FM.review.mark('recovery.found');
    },
    'w-back-lookup': () => setW({ step: 1, profileId: null, tx: null }),
    'w-recover': el => {
      const w = W();
      const tp = U.root.profiles[w.profileId];
      if (el.dataset.query) {
        if (U.root.faults.rpcDown) { toast(T('Sui RPC 仍不可用，稍后再查询。', 'Sui RPC is still unavailable; query later.'), 'warn'); return; }
        const r = M.queryTx(tp, w.chainTx, U.now(), null);
        w.tx = { id: U.shortId(w.chainTx, 4), state: r.ok ? 'confirmed' : 'failed' };
        if (r.ok) { w.step = 3; if (FM.review) FM.review.mark('recovery.applied'); }
        U.save(); render();
        return;
      }
      const parsed = M.parseRecoveryCode(wf('code', ''), 'T');
      if (!parsed.ok) { toast(T('页面已刷新，请重新输入恢复码。', 'The page reloaded; enter the code again.'), 'warn'); setW({ step: 1 }); return; }
      const plat = wf('rplatform', 'macos');
      const res = M.beginTx(tp, { kind: 'recovery.apply', payload: { digest: parsed.digest, device: { name: T(`新的 ${U.PLATFORM[plat]} 设备`, `New ${U.PLATFORM[plat]} device`), platform: plat } } }, U.now());
      if (!res.ok) { toast(T('运行费不足，且没有可用的赞助方。', 'Not enough run fee and no sponsor available.'), 'danger'); return; }
      w.chainTx = res.tx.id;
      w.tx = { id: U.shortId(res.tx.id, 4), state: 'pending' };
      U.save();
      render();
      U.later(1200, () => {
        const f = U.root.faults;
        let fault = null;
        if (f.rpcDown) fault = 'rpc'; else if (f.nextTxFail) { fault = 'fail'; f.nextTxFail = false; }
        const r = M.commitTx(tp, res.tx.id, U.now(), fault);
        const x = W();
        x.tx = { id: U.shortId(res.tx.id, 4), state: r.ok ? 'confirmed' : r.code === 'unknown' ? 'unknown' : 'failed' };
        if (r.ok) { x.step = 3; if (FM.review) FM.review.mark('recovery.applied'); }
        else if (r.code !== 'unknown') toast(`${T('恢复失败', 'Recovery failed')}：${U.txErr(r.code)}`, 'danger');
        U.save();
        render();
      });
    },
    'w-rdata': () => { const w = W(); const tp = U.root.profiles[w.profileId]; M.syncData(tp, tp.currentDeviceId); setW({ step: 4, tx: null }); if (FM.review) FM.review.mark('data.synced'); },
    'w-rsave': () => {
      const w = W();
      const tp = U.root.profiles[w.profileId];
      const parsed = M.parseRecoveryCode(U.secrets.get('welcome:rcode'), 'T');
      U.submitTx({ kind: 'recovery.set', payload: { digest: parsed.digest, network: parsed.network } }, {
        profile: tp,
        onConfirmed: () => { if (FM.review) FM.review.mark('recovery.set'); enter(tp.id, tp.currentDeviceId); },
      });
      w.tx = { id: '…', state: 'pending' };
      U.save();
    },
  });

  function createIdentity() {
    const w = W();
    if (w.newProfileId && U.root.profiles[w.newProfileId]) { w.step = 4; return; }
    const name = String(wf('name', '')).trim();
    const plat = wf('platform', 'macos');
    const src = wf('source', 'self');
    const wallet = src === 'self'
      ? { address: '0x00000000000000000000000000000000000000000000000000000000000de771', balance: (w.balance || 0) - Math.round(IDENTITY_FEE * 0.92), source: 'self', sponsor: null, records: [{ txId: w.tx.id, kind: 'identity.create', amount: Math.round(IDENTITY_FEE * 0.92), payer: 'self', state: 'confirmed', at: U.now() }] }
      : { address: '0x00000000000000000000000000000000000000000000000000000000000de771', balance: 0, source: 'sponsor', sponsor: { id: 'sponsor-demo', name: { zh: '测试网赞助方（演示）', en: 'Testnet sponsor (demo)' }, quota: 20000000 - Math.round(IDENTITY_FEE * 0.92), online: true }, records: [{ txId: w.tx.id, kind: 'identity.create', amount: Math.round(IDENTITY_FEE * 0.92), payer: 'sponsor', state: 'confirmed', at: U.now() }] };
    const p = F.createEmptyProfile({ name, orgName: String(wf('org', '')).trim() || T(`${name} 的组织`, `${name}'s organization`), platform: plat, deviceName: { macos: 'MacBook', windows: 'Windows PC', ubuntu: 'Ubuntu PC', ios: 'iPhone', android: 'Android' }[plat], unlock: UNLOCK[plat], wallet }, U.now(), M);
    U.root.profiles[p.id] = p;
    w.newProfileId = p.id;
    w.step = 4;
    U.save();
  }
})();
