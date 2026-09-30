/* FractalMind App prototype v2 — My identity: stable Human ID, per-device
 * grants, adding a device (J8), recovery code (J9) and revocation (J4). */
(function () {
  'use strict';
  const FM = window.FM;
  const U = FM.ui;
  const { M, T, L, esc, icon, P, O, can, ui, render, toast, DAY } = U;

  const ACT = { read: ['读取', 'Read'], operate: ['执行', 'Operate'], approve: ['审批', 'Approve'], manage_hosts: ['管理主机', 'Manage hosts'] };
  const actText = a => T(...(ACT[a] || [a, a]));

  function deviceStatus(d) {
    const now = U.now();
    if (d.grant.state === 'revoked') return `<span class="chip danger">${T('已撤销', 'Revoked')}</span>`;
    if (d.grant.state === 'pending') return `<span class="chip warn">${T('授权待确认', 'Grant pending')}</span>`;
    if (d.grant.expiresAt && now > d.grant.expiresAt) return `<span class="chip">${T('已到期', 'Expired')}</span>`;
    return `<span class="chip ok">${T('已授权', 'Authorized')}</span>`;
  }
  function syncChip(d) {
    const x = { synced: ['ok', '数据已同步', 'Data synced'], pending: ['warn', '数据待同步', 'Data not synced'], withheld: ['muted', '未共享数据', 'No data access'], none: ['muted', '—', '—'] }[d.dataSync] || ['muted', d.dataSync, d.dataSync];
    return `<span class="chip ${x[0]}">${esc(T(x[1], x[2]))}</span>`;
  }

  function deviceRow(d) {
    const p = P();
    const cur = d.id === p.currentDeviceId;
    const scopes = (d.grant.scopes || []).map(s => {
      const o = M.find(p.orgs, s.orgId);
      return `${esc(o ? L(o.name) : s.orgId)}：${s.actions.map(actText).join('、')}`;
    }).join('<br>');
    const expiry = d.grant.expiresAt ? (d.grant.state === 'revoked' ? `${T('撤销于', 'revoked')} ${U.date(d.revokedAt)}` : U.until(d.grant.expiresAt)) : T('长期（管理设备）', 'No expiry (management device)');
    const tx = U.latestTx(t => t.kind === 'device.revoke' && t.payload.deviceId === d.id && t.state !== 'confirmed');
    const actions = [];
    if (cur && d.grant.state === 'active' && d.dataSync === 'pending') actions.push(U.btn({ action: 'sync-data', data: { id: d.id }, label: T('同步加密数据', 'Sync data'), size: 'sm', kind: 'primary' }));
    if (!cur && d.grant.state !== 'revoked') actions.push(U.btn({ action: 'device-revoke', data: { id: d.id }, label: T('撤销', 'Revoke'), size: 'sm', kind: 'danger', perm: 'manage_identity' }));
    return `<div class="device-row"><span class="d-ico">${icon(U.platformIcon(d.platform))}</span>
      <div class="grow"><div class="row wrap gap-sm"><strong>${esc(d.name)}</strong>${cur ? `<span class="chip brand">${T('本机', 'This device')}</span>` : ''}<span class="chip outline">${d.role === 'manage' ? T('管理设备', 'Management') : T('访问设备', 'Access')}</span>${deviceStatus(d)}${d.grant.state !== 'revoked' ? syncChip(d) : ''}</div>
        <div class="tiny muted mt-4">${esc(U.PLATFORM[d.platform] || d.platform)} · ${T('添加于', 'added')} ${U.date(d.addedAt)} · ${esc(expiry)}</div>
        ${d.grant.state !== 'revoked' ? `<div class="small mt-4">${scopes || '—'}</div>` : ''}
        ${tx ? `<div class="mt-4">${U.txLine(tx)}</div>` : ''}</div>
      <div class="row">${actions.join('')}</div></div>`;
  }

  FM.views.identity = () => {
    const p = P();
    const dev = U.me();
    const active = p.devices.filter(d => d.grant.state === 'active').length;
    const rec = p.recovery || { state: 'unset' };
    const recTx = U.latestTx(t => t.kind === 'recovery.set' && t.state !== 'confirmed');
    const recState = { saved: ['ok', '已保存', 'Saved'], unset: ['warn', '尚未设置', 'Not set'], consumed: ['warn', '已使用，请设置新恢复码', 'Used; set a new one'] }[rec.state] || ['muted', rec.state, rec.state];
    const unlock = { touch_id: 'Touch ID', face_id: 'Face ID', fingerprint: T('指纹', 'Fingerprint'), windows_hello: 'Windows Hello', password: T('本机密码', 'Device password') }[dev.unlock] || T('本机解锁', 'Device unlock');
    return `<div class="page-h"><div><h1>${T('我的身份', 'My identity')}</h1><p class="muted">${T('一个稳定的 Human 身份，多台设备各自独立授权。', 'One stable Human identity; every device has its own grant.')}</p></div></div>
      <div class="grid-2">
        <section class="card"><div class="row gap-lg"><span class="avatar round human" style="width:52px;height:52px;font-size:20px">${esc(p.human.name.slice(0, 1).toUpperCase())}</span><div class="grow"><h2>${esc(p.human.name)}</h2>
          <div class="row small mt-4"><span class="muted">Human ID</span><span class="mono">${esc(p.human.id)}</span><button class="btn ghost icon sm" data-action="copy" data-copy="${esc(p.human.id)}" aria-label="${T('复制', 'Copy')}">${icon('copy', 'sm')}</button></div>
          <div class="tiny muted">${T('创建于', 'Created')} ${U.date(p.human.createdAt)} · ${T(`${active} 台设备已授权 · ${p.orgs.length} 个组织`, `${active} devices authorized · ${p.orgs.length} organizations`)}</div></div></div>
          <div class="note mt-12">${icon('info')}<div>${T('Human ID、钱包地址、Host ID、AgentCertificate 与运行会话各有用途，不能互相代替。', 'Human ID, wallet address, Host ID, AgentCertificate and run sessions each have a purpose; none substitutes for another.')}</div></div></section>
        <section class="card"><div class="card-h"><h2>${T('本机', 'This device')}</h2>${U.btn({ action: 'lock', label: T('锁定此 App', 'Lock this app'), icon: 'lock', size: 'sm' })}</div>
          <dl class="kv"><dt>${T('设备', 'Device')}</dt><dd>${esc(dev.name)} · ${esc(U.PLATFORM[dev.platform] || dev.platform)}</dd><dt>${T('角色', 'Role')}</dt><dd>${dev.role === 'manage' ? T('管理设备：可添加设备、撤销与恢复', 'Management: can add, revoke and recover devices') : T('访问设备：不能管理身份', 'Access: cannot manage the identity')}</dd><dt>${T('本机解锁', 'Unlock')}</dt><dd>${esc(unlock)}</dd><dt>${T('数据', 'Data')}</dt><dd>${syncChip(dev)}</dd></dl>
          <div class="tiny muted mt-12">${T('本机解锁只保护本机凭据；组织角色、设备授权与数据解密权共同决定可用操作。', 'Unlocking protects local credentials only; organization role, device grant and data access decide what you can do.')}</div></section>
      </div>
      <section class="sec"><div class="sec-h"><h2>${T('设备', 'Devices')}</h2>${U.btn({ action: 'open', data: { dialog: 'pair' }, label: T('添加我的设备', 'Add my device'), icon: 'plus', kind: 'primary', perm: 'manage_identity' })}</div>
        <div class="card">${p.devices.slice().sort((a, b) => (a.grant.state === 'revoked') - (b.grant.state === 'revoked')).map(deviceRow).join('')}</div>
        <div class="tiny muted mt-8">${T('新设备默认只获得当前组织 7 天只读；执行与审批需明确授予，从不自动授予身份管理权。撤销后，已下载的明文和密钥无法收回。', 'New devices default to read-only on this organization for 7 days; operate and approve are explicit; identity management is never granted automatically. Revocation cannot recall plaintext or keys already downloaded.')}</div></section>
      <section class="sec grid-2">
        <div class="card"><div class="card-h"><h2>${icon('key', 'sm')}${T('恢复码', 'Recovery code')}</h2><span class="chip ${recState[0]}">${esc(T(recState[1], recState[2]))}</span></div>
          <p class="small">${T('只需一份恢复码：所有设备丢失时，凭它找到身份并授权新设备。不需要另存 Human ID。', 'One code is enough: if every device is lost, it finds your identity and authorizes a new device. No need to save the Human ID.')}</p>
          ${rec.savedAt ? `<div class="tiny muted mt-8">${T('保存于', 'Saved')} ${U.date(rec.savedAt)} · FMR1 · ${T('测试网', 'testnet')}</div>` : ''}
          ${recTx ? `<div class="mt-8">${U.txLine(recTx)}</div>` : ''}
          <div class="card-f" style="justify-content:flex-start">${U.btn({ action: 'open', data: { dialog: 'recovery' }, label: rec.state === 'saved' ? T('更换恢复码', 'Replace code') : T('设置恢复码', 'Set up code'), kind: rec.state === 'saved' ? '' : 'primary', perm: 'manage_identity' })}${U.btn({ action: 'open', data: { dialog: 'lose-all' }, label: T('模拟丢失全部设备', 'Simulate losing all devices'), kind: 'ghost', disabled: rec.state !== 'saved', why: T('先保存恢复码', 'Save a recovery code first') })}</div></div>
        <div class="card"><div class="card-h"><h2>${icon('layers', 'sm')}${T('组织关系', 'Organizations')}</h2></div>
          ${p.orgs.map(o => `<div class="item"><span class="avatar sm ${o.kind === 'team' ? 'team' : ''}">${U.orgInitial(o)}</span><div class="grow"><div class="strong">${esc(L(o.name))}</div><div class="tiny muted">${o.role === 'admin' ? T('管理员 · 链上 OrgAdminCap', 'Admin · on-chain OrgAdminCap') : T('成员 · 链上成员资格对象', 'Member · on-chain membership object')} · <span class="mono">${esc(U.shortId(o.chainId, 6))}</span></div></div>${o.id === p.currentOrgId ? `<span class="chip brand">${T('当前', 'Current')}</span>` : `<button class="btn sm" data-action="switch-org" data-id="${esc(o.id)}">${T('切换', 'Switch')}</button>`}</div>`).join('')}
          <div class="tiny muted mt-8">${T('名称、缓存和网络连接不能推导成员资格。', 'Names, caches and connections never imply membership.')}</div></div>
      </section>`;
  };

  /* ------------------------------------------------------ Add a device */

  FM.dialogs.pair = st => {
    const p = P();
    const stage = st.stage || (st.id ? 'approve' : 'new');
    const pr = st.id ? M.find(p.pairings, st.id) : null;
    const dev = pr && pr.deviceId ? M.find(p.devices, pr.deviceId) : null;
    const now = U.now();
    const stages = [['new', '新设备发起', 'New device'], ['approve', '管理设备核对', 'Review'], ['granted', '授权确认', 'Authorized'], ['done', '数据同步', 'Data synced']];
    const idx = stages.findIndex(s => s[0] === stage);
    const nav = `<div class="steps-nav" style="margin:0">${stages.map(([k, zh, en], i) => `<span class="${i === idx ? 'on' : i < idx ? 'done' : ''}"><b>${i < idx ? '✓' : i + 1}</b>${esc(T(zh, en))}</span>`).join('')}</div>`;
    let body = '', foot = '';
    if (stage === 'new') {
      const plat = U.f('pair.platform', 'android');
      body = `<div class="note info">${icon('phone')}<div>${T('演示：先代表新设备生成配对请求。新设备会生成自己的独立密钥。', 'Demo: first act as the new device, which creates its own independent key.')}</div></div>
        <div class="field"><span class="label">${T('平台', 'Platform')}</span><div class="seg">${Object.keys(U.PLATFORM).map(k => `<button data-action="set-f" data-key="pair.platform" data-value="${k}" aria-pressed="${plat === k}">${esc(U.PLATFORM[k])}</button>`).join('')}</div></div>
        <div class="field"><label for="pair-name">${T('设备名称', 'Device name')}</label><input id="pair-name" class="input" data-f="pair.name" value="${esc(U.f('pair.name', plat === 'ios' ? 'iPad mini' : plat === 'android' ? 'Galaxy S25' : 'Workstation'))}"></div>`;
      foot = `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button><button class="btn primary" data-action="pair-create">${T('生成配对请求', 'Create pairing request')}</button>`;
    }
    if (stage === 'approve' && pr) {
      const status = M.pairingStatus(pr, now);
      const orgs = p.orgs;
      const days = Number(U.f(`pair-${pr.id}.days`, 7));
      const share = U.f(`pair-${pr.id}.share`, true);
      const tx = dev && U.latestTx(t => t.kind === 'device.grant' && t.payload.deviceId === dev.id);
      const manager = U.me() && U.me().role === 'manage';
      body = `${status !== 'waiting' && !dev ? `<div class="note warn">${icon('clock')}<div>${status === 'expired' ? T('请求已过期（5 分钟），请在新设备上重新发起。过期的请求不能复用。', 'The request expired (5 minutes); start again on the new device. Expired requests are never reused.') : T('请求已处理。', 'The request was handled.')}</div></div>` : ''}
        <div class="row top gap-lg">${FM.qr(pr.id)}<div class="col grow"><div class="label">${T('新设备', 'New device')}</div><div class="strong">${esc(pr.name)} · ${esc(U.PLATFORM[pr.platform])}</div>
          <div class="small">${T('核对码', 'Verification code')}：<span class="mono strong" style="font-size:18px;letter-spacing:.08em">${esc(pr.code.slice(0, 3))} ${esc(pr.code.slice(3))}</span></div><div class="tiny muted">${T('请确认两台设备显示相同核对码。', 'Confirm both devices show the same code.')} · ${U.until(pr.expiresAt)}</div></div></div>
        ${manager ? '' : `<div class="note warn">${icon('lock')}<div>${T('当前设备不是管理设备，不能批准。请在管理设备上核对。', 'This is not a management device and cannot approve. Review it on a management device.')}</div></div>`}
        <div class="field"><span class="label">${T('组织与权限', 'Organizations and permissions')}</span>${orgs.map(o => {
          const on = U.f(`pair-${pr.id}.org-${o.id}`, o.id === p.currentOrgId);
          return `<div class="card soft tight"><label class="check"><input type="checkbox" data-f="pair-${esc(pr.id)}.org-${esc(o.id)}" ${on ? 'checked' : ''}><strong>${esc(L(o.name))}</strong></label>
            ${on ? `<div class="row wrap mt-8" style="margin-left:25px">${['read', 'operate', 'approve'].map(a => {
              const allowed = M.actionsForRole(o.role).includes(a);
              const v = a === 'read' ? true : U.f(`pair-${pr.id}.${o.id}-${a}`, false);
              return `<label class="check" style="${allowed ? '' : 'opacity:.5'}"><input type="checkbox" data-f="pair-${esc(pr.id)}.${esc(o.id)}-${a}" ${v ? 'checked' : ''} ${a === 'read' || !allowed ? 'disabled' : ''}>${esc(actText(a))}${allowed ? '' : T('（角色不含）', ' (not in role)')}</label>`;
            }).join('')}</div>` : ''}</div>`;
        }).join('')}</div>
        <div class="form-grid"><div class="field"><span class="label">${T('有效期', 'Valid for')}</span><div class="seg"><button data-action="set-f" data-key="pair-${esc(pr.id)}.days" data-value="7" aria-pressed="${days === 7}">${T('7 天', '7 days')}</button><button data-action="set-f" data-key="pair-${esc(pr.id)}.days" data-value="30" aria-pressed="${days === 30}">${T('30 天', '30 days')}</button></div></div>
          <div class="field"><span class="label">${T('加密数据', 'Encrypted data')}</span><label class="check"><input type="checkbox" data-f="pair-${esc(pr.id)}.share" ${share ? 'checked' : ''}>${T('授权后单独同步组织数据', 'Sync organization data separately after authorizing')}</label></div></div>
        <div class="tiny muted">${T('不会授予身份管理权。连接或扫码本身不产生任何组织权限。', 'Identity management is never granted. Connecting or scanning alone grants nothing.')}</div>
        ${tx ? U.txLine(tx) : ''}`;
      foot = `${U.btn({ action: 'pair-reject', data: { id: pr.id }, label: T('拒绝', 'Reject'), disabled: status !== 'waiting' })}${U.btn({ action: 'pair-approve', data: { id: pr.id }, label: T('签名授权', 'Sign grant'), kind: 'primary', perm: 'manage_identity', disabled: status !== 'waiting' || !manager, why: status !== 'waiting' ? T('请求不可用', 'Request unavailable') : T('需要管理设备', 'Requires a management device') })}`;
    }
    if (stage === 'granted' && dev) {
      body = `<div class="calm">${icon('check')}<span>${T(`${dev.name} 已授权。`, `${dev.name} is authorized.`)}</span></div>
        ${dev.dataSync === 'withheld' ? `<div class="note">${icon('info')}<div>${T('你选择不共享加密数据：该设备无法读取受保护内容。', 'You chose not to share encrypted data: the device cannot read protected content.')}</div></div>`
          : `<div class="note warn">${icon('key')}<div>${T('授权已生效，数据待同步：在加密通道完成密钥交接前，新设备不能读取受保护内容。', 'Authorized; data not yet synced. Until the key handoff finishes, the device cannot read protected content.')}</div></div>`}
        <dl class="kv">${dev.grant.scopes.map(s => `<dt>${esc(L((M.find(p.orgs, s.orgId) || {}).name))}</dt><dd>${s.actions.map(actText).join('、')} · ${U.until(dev.grant.expiresAt)}</dd>`).join('')}</dl>`;
      foot = dev.dataSync === 'pending' ? `<button class="btn" data-action="close-dialog">${T('稍后同步', 'Sync later')}</button><button class="btn primary" data-action="pair-sync" data-id="${esc(dev.id)}">${icon('key', 'sm')}${T('同步加密数据（演示）', 'Sync encrypted data (demo)')}</button>` : `<button class="btn primary" data-action="close-dialog">${T('完成', 'Done')}</button>`;
    }
    if (stage === 'done' && dev) {
      body = `<div class="calm">${icon('check')}<span>${T(`${dev.name} 已授权且数据已同步。两台设备显示同一个 Human ID，授权相互独立、可分别撤销。`, `${dev.name} is authorized and synced. Both show the same Human ID with independent, separately revocable grants.`)}</span></div>
        <div class="tiny muted">${T('评审工具中的“设备视角”可以切换到这台设备，查看只读权限下的界面。', 'Use “Device perspective” in the review tools to view the app as this device.')}</div>`;
      foot = `<button class="btn primary" data-action="close-dialog">${T('完成', 'Done')}</button>`;
    }
    return { title: T('添加我的设备', 'Add my device'), sub: T('同一个 Human，逐设备独立授权（J8）', 'Same Human, independent grant per device (J8)'), size: 'lg', body: `${nav}${body}`, foot };
  };

  Object.assign(FM.actions, {
    'pair-create': () => {
      const p = P();
      const plat = U.f('pair.platform', 'android');
      const name = String(U.f('pair.name', '')).trim() || U.PLATFORM[plat];
      const pr = M.createPairing(p, { platform: plat, name }, U.now());
      U.save();
      U.clearForm('pair');
      ui.dialog = { type: 'pair', id: pr.id, stage: 'approve' };
      if (FM.review) FM.review.mark('pair.requested');
      render();
    },
    'pair-review': el => U.openDialog('pair', { id: el.dataset.id, stage: 'approve' }),
    'pair-reject': el => {
      const pr = M.find(P().pairings, el.dataset.id);
      if (pr && pr.state === 'waiting') pr.state = 'rejected';
      U.save();
      ui.dialog = null;
      toast(T('已拒绝配对请求，未授予任何权限。', 'Pairing rejected; nothing was granted.'), 'ok');
      render();
    },
    'pair-approve': el => {
      const p = P();
      const pr = M.find(p.pairings, el.dataset.id);
      const key = `pair-${pr.id}`;
      const orgIds = p.orgs.filter(o => U.f(`${key}.org-${o.id}`, o.id === p.currentOrgId)).map(o => o.id);
      if (!orgIds.length) { toast(T('至少选择一个组织', 'Choose at least one organization'), 'warn'); return; }
      const res = M.approvePairing(p, pr.id, { orgIds, actions: ['read'], days: Number(U.f(`${key}.days`, 7)), shareData: U.f(`${key}.share`, true) }, p.currentDeviceId, U.now());
      if (!res.ok) { toast(U.permText(res.code) || res.code, 'warn'); render(); return; }
      res.device.grant.scopes.forEach(s => {
        const o = M.find(p.orgs, s.orgId);
        ['operate', 'approve'].forEach(a => { if (U.f(`${key}.${s.orgId}-${a}`, false) && M.actionsForRole(o.role).includes(a)) s.actions.push(a); });
      });
      U.submitTx({ kind: 'device.grant', payload: { deviceId: res.device.id } }, {
        onConfirmed: () => { if (ui.dialog && ui.dialog.type === 'pair') ui.dialog.stage = 'granted'; if (FM.review) FM.review.mark('pair.granted'); },
        onFailed: (r, pp) => { const d = M.find(pp.devices, res.device.id); if (d) { d.grant.state = 'revoked'; d.revokedAt = U.now(); } const x = M.find(pp.pairings, pr.id); if (x) x.state = 'failed'; },
      });
    },
    'pair-sync': el => {
      const res = M.syncData(P(), el.dataset.id);
      U.save();
      if (res.ok) { ui.dialog.stage = 'done'; if (FM.review) FM.review.mark('data.synced'); }
      render();
    },
    'device-revoke': el => U.openDialog('device-revoke', { id: el.dataset.id }),
    'device-revoke-do': el => {
      const p = P();
      U.submitTx({ kind: 'device.revoke', payload: { deviceId: el.dataset.id, byId: p.currentDeviceId } }, {
        ok: T('设备已撤销：新的受保护操作将被拒绝。已下载的内容无法收回。', 'Device revoked: new protected operations are refused. Content already downloaded cannot be recalled.'),
        onConfirmed: () => { ui.dialog = null; if (FM.review) FM.review.mark('device.revoked'); },
      });
    },
  });

  FM.dialogs['device-revoke'] = ({ id }) => {
    const d = M.find(P().devices, id);
    const tx = U.latestTx(t => t.kind === 'device.revoke' && t.payload.deviceId === id);
    return {
      title: T('撤销设备', 'Revoke device'), sub: esc(d.name), size: 'sm',
      body: `<p class="small">${T('撤销确认后，这台设备的新受保护操作会被拒绝；已开始的操作按执行状态尝试停止。已获得的明文与密钥无法收回，可在之后轮换密钥保护后续数据。', 'After revocation, new protected operations from this device are refused; running ones are stopped by their own state. Plaintext and keys already obtained cannot be recalled; rotate keys to protect future data.')}</p>${tx ? U.txLine(tx) : ''}`,
      foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'device-revoke-do', data: { id }, label: T('签名撤销', 'Sign and revoke'), kind: 'danger solid', perm: 'manage_identity', disabled: !!(tx && tx.state === 'pending') })}`,
    };
  };

  /* ---------------------------------------------------------- Recovery */

  FM.recoveryKit = (code, name) => [
    'FractalMind recovery kit (DEMO — prototype only, not a production credential)',
    '',
    `Identity: ${name}`,
    `Recovery code: ${code}`,
    '',
    'Keep this offline. Anyone holding this code can recover the identity.',
    'This prototype never sends it to a server; the page stores only a comparison digest.',
  ].join('\n');

  FM.dialogs.recovery = st => {
    const p = P();
    if (!st.code) { st.code = M.makeRecoveryCode(U.randomBytes, 'T'); }
    const saved = U.f('recovery.saved', false);
    const tx = U.latestTx(t => t.kind === 'recovery.set' && t.state !== 'confirmed');
    return {
      title: p.recovery && p.recovery.state === 'saved' ? T('更换恢复码', 'Replace recovery code') : T('设置恢复码', 'Set up a recovery code'), size: 'lg', sticky: true,
      body: `<div class="code-box"><span class="grow">${esc(st.code)}</span><button class="btn ghost icon sm" data-action="copy" data-copy="${esc(st.code)}" aria-label="${T('复制', 'Copy')}">${icon('copy')}</button></div>
        <div class="row wrap"><button class="btn sm" data-action="recovery-kit">${icon('download', 'sm')}${T('下载演示备份文件（可选）', 'Download demo kit (optional)')}</button><span class="tiny muted">${T('格式：版本 · 网络 · 20 位高熵字符 · 校验位', 'Format: version · network · 20 high-entropy characters · check')}</span></div>
        <div class="note warn">${icon('key')}<div>${T('持有即可行使恢复权：请离线保存，不要截图上传或发给任何人。本页只在内存中保留它，链上与本地状态只存比对摘要。', 'Whoever holds it can recover the identity: keep it offline and never share it. This page keeps it in memory only; chain and local state keep a comparison digest.')}</div></div>
        ${p.recovery && p.recovery.state === 'saved' ? `<div class="note">${icon('info')}<div>${T('确认后旧恢复码立即失效；Human ID 保持不变。', 'The old code stops working once you confirm; the Human ID stays the same.')}</div></div>` : ''}
        <label class="check"><input type="checkbox" data-f="recovery.saved" ${saved ? 'checked' : ''}>${T('我已离线保存这份恢复码', 'I saved this code offline')}</label>
        ${tx ? U.txLine(tx) : ''}`,
      foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button>${U.btn({ action: 'recovery-save', label: T('签名确认', 'Sign and confirm'), kind: 'primary', perm: 'manage_identity', disabled: !saved || !!(tx && tx.state === 'pending'), why: T('请先确认已保存', 'Confirm you saved it first') })}`,
    };
  };

  FM.dialogs['lose-all'] = () => ({
    title: T('模拟丢失全部设备', 'Simulate losing all devices'), size: 'sm',
    body: `<p class="small">${T('将退出此设备并回到未登录入口，然后用恢复码找回身份。所有组织与工作都会保留。', 'This signs out and returns to the welcome screen, where you recover with the code. Organizations and work are kept.')}</p>
      <div class="note">${icon('info')}<div>${T('演示身份的恢复码显示在评审工具的“旅程 J9”中；本次会话生成的新码也可使用。', 'The demo identity’s code is shown in the review tools under “J9”; codes generated in this session also work.')}</div></div>`,
    foot: `<button class="btn" data-action="close-dialog">${T('取消', 'Cancel')}</button><button class="btn primary" data-action="lose-all-do">${T('退出并前往恢复', 'Sign out and recover')}</button>`,
  });

  Object.assign(FM.actions, {
    'recovery-kit': () => { U.download('fractalmind-recovery-kit-DEMO.txt', FM.recoveryKit(ui.dialog.code, P().human.name), 'text/plain'); },
    'recovery-save': () => {
      const parsed = M.parseRecoveryCode(ui.dialog.code, 'T');
      U.secrets.set('recovery:last', ui.dialog.code);
      U.submitTx({ kind: 'recovery.set', payload: { digest: parsed.digest, network: parsed.network } }, {
        ok: T('新恢复码已生效，旧码失效。', 'The new code is active; the old one no longer works.'),
        onConfirmed: () => { ui.dialog = null; U.clearForm('recovery'); if (FM.review) FM.review.mark('recovery.set'); },
      });
    },
    'lose-all-do': () => {
      ui.dialog = null;
      U.root.activeProfileId = null;
      U.root.welcome = { mode: 'recover', lost: true };
      U.save();
      U.go('welcome');
    },
  });
})();
