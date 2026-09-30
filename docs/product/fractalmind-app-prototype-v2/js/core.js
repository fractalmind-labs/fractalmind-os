/* FractalMind App prototype v2 — UI core.
 *
 * Store, preferences, i18n, formatting, icons, routing, rendering, overlays
 * and the simulated transaction flow shared by every view. Views register on
 * FM.views / FM.actions / FM.dialogs / FM.drawers.
 */
(function () {
  'use strict';
  const FM = window.FM;
  const M = FM.model;
  const F = FM.fixtures;
  const { MIN, HOUR, DAY } = M;

  FM.views = {};
  FM.actions = {};
  FM.dialogs = {};
  FM.drawers = {};
  FM.pops = {};

  /* ------------------------------------------------------------ Storage */

  const STATE_KEY = 'fractalmind.prototype-v2.state';
  const PREFS_KEY = 'fractalmind.prototype-v2.prefs';
  const secrets = new Map(); // invitation and recovery codes: page memory only, never persisted

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function seedRoot(now) {
    const demo = F.createDemoProfile(now, M);
    return {
      schema: 'fm-prototype-v2', version: 1, rev: 0, seededAt: now,
      activeProfileId: demo.id, profiles: { [demo.id]: demo },
      faults: { nextTxFail: false, rpcDown: false, coordinatorDown: false, networkFail: false },
      network: F.networkDirectory(now, M),
      welcome: null,
    };
  }

  let root = read(STATE_KEY);
  if (!root || root.schema !== 'fm-prototype-v2' || root.version !== 1) root = seedRoot(Date.now());

  const prefs = Object.assign({ locale: 'zh-CN', theme: 'system' }, read(PREFS_KEY) || {});

  function save() {
    const stored = read(STATE_KEY);
    if (stored && stored.rev > root.rev) {
      // Another window wrote first: adopt its state rather than overwrite it.
      root = stored;
      toast(T('另一个窗口更新了演示状态，已载入最新版本。', 'Another window updated the demo; loaded the latest state.'), 'warn');
      return;
    }
    root.rev += 1;
    write(STATE_KEY, root);
  }
  function savePrefs() { write(PREFS_KEY, prefs); }

  window.addEventListener('storage', e => {
    if (e.key === STATE_KEY && e.newValue) {
      try { root = JSON.parse(e.newValue); render(); } catch (err) { /* ignore */ }
    }
    if (e.key === PREFS_KEY && e.newValue) {
      try { Object.assign(prefs, JSON.parse(e.newValue)); applyTheme(); render(); } catch (err) { /* ignore */ }
    }
  });

  function resetDemo() {
    timers.forEach(clearTimeout);
    timers.clear();
    secrets.clear();
    ui.autoplay = false;
    // Keep the revision moving forward so the stale-write guard does not undo the reset.
    const stored = read(STATE_KEY);
    const rev = Math.max(root.rev || 0, (stored && stored.rev) || 0);
    root = seedRoot(Date.now());
    root.rev = rev;
    ui.journey = null;
    save();
  }

  /* --------------------------------------------------------------- i18n */

  const T = (zh, en) => (prefs.locale === 'en' ? en : zh);
  const L = v => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && 'zh' in v) return prefs.locale === 'en' ? v.en : v.zh;
    return String(v);
  };
  const locale = () => (prefs.locale === 'en' ? 'en' : 'zh-CN');

  /* ---------------------------------------------------------- Formatting */

  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
  const money = cents => `$${(cents / 100).toFixed(2)}`;
  const sui = mist => `${(mist / M.MIST).toFixed(4)} SUI`;
  function num(v, unit) {
    if (v === null || v === undefined) return '—';
    const u = L(unit);
    const n = Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v * 10) / 10) : String(v);
    if (!u) return n;
    return u === '%' ? `${n}%` : /^[a-z]/i.test(u) && u.length <= 3 ? `${n} ${u}` : `${n} ${u}`;
  }
  function ago(ts) {
    if (!ts) return T('从未', 'never');
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 0) return until(ts);
    if (s < 45) return T('刚刚', 'just now');
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
    if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
    if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
    return rtf.format(-Math.round(s / 86400), 'day');
  }
  function until(ts) {
    const s = Math.round((ts - Date.now()) / 1000);
    if (s <= 0) return T('已到期', 'expired');
    if (s < 3600) return T(`剩 ${Math.max(1, Math.round(s / 60))} 分钟`, `${Math.max(1, Math.round(s / 60))} min left`);
    if (s < 86400) return T(`剩 ${Math.round(s / 3600)} 小时`, `${Math.round(s / 3600)} h left`);
    const d = Math.round(s / 86400);
    return T(`剩 ${d} 天`, `${d} day${d === 1 ? '' : 's'} left`);
  }
  const date = ts => (ts ? new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric' }).format(ts) : '—');
  const dateTime = ts => (ts ? new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ts) : '—');
  const clock = ts => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(ts);
  const shortId = (id, head = 6) => (id && id.length > head + 6 ? `${id.slice(0, head)}…${id.slice(-4)}` : id || '');
  const agoTag = ts => `<span data-ago="${ts || ''}">${esc(ago(ts))}</span>`;

  /* -------------------------------------------------------------- Icons */

  const ICONS = {
    home: '<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.8 9.8V20h12.4V9.8"/><path d="M10 20v-5.2h4V20"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
    server: '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7.5 7.5h.01M7.5 16.5h.01"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3 2.9-5 5.5-5s4.9 2 5.5 5"/><path d="M15.5 5.2a3.2 3.2 0 0 1 0 6"/><path d="M17.5 14.8c1.6.6 2.7 2.3 3 4.7"/>',
    book: '<path d="M5 5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2z"/><path d="M5 19.5a2 2 0 0 0 2 2h12v-4"/>',
    shield: '<path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.8 7 9 4.1-1.2 7-4.8 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1-3.8 4-6 7.5-6s6.5 2.2 7.5 6"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16 8.5 4.5 8.5-4.5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    monitor: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
    lang: '<path d="M4 5.5h9M8.5 3.5v2M6 5.5c.6 3 2.5 5.4 5 7"/><path d="M11 5.5c-.8 3.5-3 6.2-6.5 8"/><path d="m12.5 20.5 3.8-9 3.8 9M13.8 17.5h5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    hourglass: '<path d="M7 3.5h10M7 20.5h10"/><path d="M8 3.5c0 4.2 8 4.4 8 8.5s-8 4.3-8 8.5M16 3.5c0 4.2-8 4.4-8 8.5s8 4.3 8 8.5"/>',
    pause: '<path d="M9 5.5v13M15 5.5v13"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
    refresh: '<path d="M20 11.5A8 8 0 0 0 6.2 6.3L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 12.5a8 8 0 0 0 13.8 5.2L20 15.5"/><path d="M20 20v-4.5h-4.5"/>',
    fork: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 8v8"/><path d="M18 9c0 4.5-4.5 5.5-11 6.8"/>',
    loop: '<path d="M17 3.5l3 3-3 3"/><path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20"/><path d="M7 20.5l-3-3 3-3"/><path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4"/>',
    block: '<path d="M8.2 3.5h7.6l4.7 4.7v7.6l-4.7 4.7H8.2l-4.7-4.7V8.2z"/><path d="M8 12h8"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.4h.01"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.3-.9.8-.9 1.4v.4M12 16.8h.01"/>',
    trend: '<path d="M4 16l5-5 3.5 3.5L20 7"/><path d="M14.5 7H20v5.5"/>',
    flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11l-2 3.5 2 3.5h-11"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/>',
    key: '<circle cx="8" cy="15" r="3.8"/><path d="m10.8 12.2 8.7-8.7M16.5 6.5l2 2M14 9l1.8 1.8"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M4.5 19.5h15"/>',
    terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17"/>',
    cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3"/>',
    offline: '<path d="M3 3l18 18"/><path d="M8.5 16a5 5 0 0 1 6.4-.4M5 12.5a10 10 0 0 1 4-2.3M19 12.5a10 10 0 0 0-3.1-2M2 9a14.5 14.5 0 0 1 4.6-2.9M22 9a14.5 14.5 0 0 0-9.2-3.6M12 20h.01"/>',
    message: '<path d="M20.5 12a8 8 0 0 1-11.7 7.1L4 20.5l1.4-4.6A8 8 0 1 1 20.5 12z"/>',
    send: '<path d="M20.5 3.5 10 14"/><path d="M20.5 3.5 14 20.5l-4-6.5-6.5-4z"/>',
    more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
    external: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
    sparkle: '<path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/><path d="M9 13h6M9 16.5h4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    laptop: '<rect x="4.5" y="5" width="15" height="10" rx="1.5"/><path d="M2.5 19h19"/>',
    cloud: '<path d="M7.5 18.5h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.6 9.3a4.6 4.6 0 0 0 .9 9.2z"/>',
    archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
    seal: '<path d="M12 2.8l2.3 1.7 2.9-.1.9 2.7 2.3 1.8-.9 2.7.9 2.7-2.3 1.8-.9 2.7-2.9-.1L12 21.2l-2.3-1.7-2.9.1-.9-2.7-2.3-1.8.9-2.7-.9-2.7 2.3-1.8.9-2.7 2.9.1z"/><path d="m8.8 12.2 2.2 2.2 4.3-4.4"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M7 12h10"/>',
    zap: '<path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z"/>',
    pulse: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
    wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v2.5"/><rect x="4" y="7.5" width="16.5" height="12" rx="2"/><path d="M16 13.5h.01"/>',
    clipboard: '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 3.5h6v3H9z"/><path d="m9 13 2 2 4-4"/>',
    logout: '<path d="M9.5 20.5h-4A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5h4"/><path d="M16 16.5l4.5-4.5L16 7.5"/><path d="M20.5 12H9.5"/>',
    box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    folder: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 15l3.5-4 3 2.5L19 8"/>',
    fingerprint: '<path d="M6.5 18.5c1-1.8 1.5-4 1.5-6.5a4 4 0 0 1 8 0c0 1.6-.1 3-.4 4.3"/><path d="M12 12c0 3.3-.8 6.1-2.3 8.4"/><path d="M4.5 14.5c.3-.8.5-1.6.5-2.5a7 7 0 0 1 12.2-4.7"/><path d="M19 10c.3.7.5 1.5.5 2.3 0 2.2-.3 4.3-.9 6.2"/>',
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16"/>',
    upload: '<path d="M12 16V5M7 9.5l5-5 5 5"/><path d="M4.5 19.5h15"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/>',
  };
  const icon = (name, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const LOGO = '<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="6" y="6" width="6.2" height="6.2" rx="1.4" fill="currentColor"/><rect x="13.2" y="13.2" width="3.3" height="3.3" rx=".8" fill="currentColor"/><rect x="17" y="17" width="1.7" height="1.7" rx=".4" fill="currentColor"/></svg>';

  /* -------------------------------------------------------------- State */

  const now = () => Date.now();
  const P = () => (root.activeProfileId ? root.profiles[root.activeProfileId] || null : null);
  const O = () => { const p = P(); return p ? p.data[p.currentOrgId] : null; };
  const orgMeta = (id) => { const p = P(); return p ? M.find(p.orgs, id || p.currentOrgId) : null; };
  const me = () => { const p = P(); return p ? M.find(p.devices, p.currentDeviceId) : null; };
  function can(action, orgId) {
    const p = P();
    if (!p) return { ok: false, code: 'signed_out' };
    const res = M.can(p, p.currentDeviceId, orgId || p.currentOrgId, action, now());
    return Object.assign({ deviceId: p.currentDeviceId }, res);
  }
  const agent = id => M.find((O() || {}).agents, id) || { name: '—' };
  const host = id => M.find((O() || {}).hosts, id) || null;
  const inst = id => M.find((O() || {}).instances, id) || null;
  const okrById = id => M.find((O() || {}).okrs, id) || null;
  const focusOkr = () => {
    const org = O();
    if (!org) return null;
    const active = org.okrs.filter(o => o.lifecycle === 'ACTIVE');
    return M.find(active, org.focusOkrId) || active[0] || null;
  };

  const PERM_TEXT = {
    locked: ['App 已锁定', 'The app is locked'],
    revoked: ['此设备的授权已被撤销', "This device's authorization was revoked"],
    grant_pending: ['设备授权待链上确认', 'The device grant awaits chain confirmation'],
    expired: ['此设备的授权已到期', "This device's authorization expired"],
    org_not_granted: ['此设备未获得当前组织的授权', 'This device has no grant for this organization'],
    data_not_synced: ['授权已生效，但加密数据尚未同步', 'Authorized, but encrypted data has not been synced'],
    role_insufficient: ['你在此组织的角色不包含该操作', 'Your role in this organization does not include this action'],
    action_not_granted: ['此设备的授权不包含该操作（例如只读）', "This device's grant does not include this action (e.g. read-only)"],
    not_manager: ['需要管理设备', 'Requires a management device'],
    unknown_device: ['未知设备', 'Unknown device'],
    signed_out: ['未登录', 'Signed out'],
    host_offline: ['执行主机不可达', 'The execution host is unreachable'],
    agent_unavailable: ['负责 Agent 不可用', 'The responsible Agent is unavailable'],
  };
  const permText = code => { const t = PERM_TEXT[code]; return t ? T(t[0], t[1]) : code; };

  /* ------------------------------------------------------------ UI state */

  const ui = {
    dialog: null, drawer: null, pop: null, palette: null,
    forms: {}, expanded: {}, tab: {}, filters: {}, mapView: {},
    autoplay: false, review: false, journey: null, framed: false,
    lastRoute: '', toasts: [], mobileOverride: null,
  };

  const f = (key, fallback) => {
    const [form, field] = key.split('.');
    const v = ui.forms[form] && ui.forms[form][field];
    return v === undefined ? fallback : v;
  };
  const setF = (key, value) => {
    const [form, field] = key.split('.');
    ui.forms[form] = ui.forms[form] || {};
    ui.forms[form][field] = value;
  };
  const clearForm = name => { delete ui.forms[name]; };

  /* ------------------------------------------------------------- Router */

  function route() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    return { name: parts[0] || 'workbench', parts, query: new URLSearchParams(qs || '') };
  }
  function go(path) {
    const target = `#/${path}`;
    if (location.hash === target) render();
    else location.hash = target;
  }
  window.addEventListener('hashchange', () => { ui.pop = null; render(); });

  /* ------------------------------------------------------ Theme & viewport */

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && media.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.lang = prefs.locale === 'en' ? 'en' : 'zh-CN';
  }
  media.addEventListener('change', () => { if (prefs.theme === 'system') applyTheme(); });
  const narrow = window.matchMedia('(max-width: 760px)');
  narrow.addEventListener('change', () => render());
  const isMobile = () => ui.framed || narrow.matches;

  /* ------------------------------------------------------------- Timers */

  const timers = new Set();
  function later(ms, fn) {
    const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  }

  /* ------------------------------------------------------------- Toasts */

  function toast(msg, kind, ms) {
    const id = Math.random().toString(36).slice(2);
    ui.toasts.push({ id, msg, kind: kind || 'info' });
    if (ui.toasts.length > 3) ui.toasts.shift();
    renderToasts();
    setTimeout(() => { ui.toasts = ui.toasts.filter(t => t.id !== id); renderToasts(); }, ms || 3800);
  }
  function renderToasts() {
    const el = document.getElementById('toasts');
    if (!el) return;
    const ico = { ok: 'check', warn: 'alert', danger: 'x', info: 'info' };
    el.innerHTML = ui.toasts.map(t => `<div class="toast ${t.kind}" role="status">${icon(ico[t.kind] || 'info')}<div>${esc(t.msg)}</div></div>`).join('');
  }

  /* ------------------------------------------------ Simulated transactions */

  const TX_LABEL = {
    'identity.create': ['创建身份与个人组织', 'Create identity and personal organization'],
    'okr.activate': ['激活 OKR', 'Activate OKR'],
    'okr.update': ['确认新的执行约定', 'Confirm a new agreement'],
    'okr.archive': ['归档 OKR', 'Archive OKR'],
    'approval.decide': ['记录审批决定', 'Record an approval decision'],
    'invite.create': ['签发主机邀请', 'Issue a host invitation'],
    'invite.redeem': ['兑换邀请并入组', 'Redeem invitation and join'],
    'invite.revoke': ['撤销邀请', 'Revoke invitation'],
    'binding.create': ['绑定连接入口', 'Bind a connection endpoint'],
    'host.revoke': ['撤销主机资格', 'Revoke host membership'],
    'device.grant': ['授权新设备', 'Authorize a new device'],
    'device.revoke': ['撤销设备', 'Revoke a device'],
    'recovery.set': ['更换恢复码', 'Replace recovery code'],
    'recovery.apply': ['使用恢复码恢复', 'Recover with a recovery code'],
    'agent.import': ['导入 Agent（仅观察）', 'Import Agent (observe only)'],
    'agent.include': ['授权 Agent 纳入 OKR', 'Authorize Agent for an OKR'],
    'memory.write': ['写入记忆', 'Write memory'],
    'memory.archive': ['归档记忆', 'Archive memory'],
  };
  const txLabel = kind => { const t = TX_LABEL[kind]; return t ? T(t[0], t[1]) : kind; };
  const FEE_TEXT = {
    insufficient: ['运行费余额不足，请补充资金或选择有效代付。', 'Run-fee balance is too low. Add funds or use a working sponsor.'],
    sponsor_offline: ['赞助方离线，暂时无法代付。', 'The sponsor is offline and cannot pay right now.'],
    sponsor_quota: ['赞助方额度不足。', 'The sponsor quota is exhausted.'],
  };
  const TX_ERR = {
    simulated_failure: ['交易失败（演示故障）', 'Transaction failed (demo fault)'],
    consumed: ['邀请已被使用', 'Invitation already used'],
    expired: ['已过期', 'Expired'],
    revoked: ['已撤销', 'Revoked'],
    invalidated: ['约定版本已变化，审批失效', 'The agreement changed; the approval is invalid'],
    version_conflict: ['约定已被其他设备更新，请基于最新版本修改', 'Another device updated the agreement; edit the latest version'],
    bad_proof: ['兑换证明与本机设备不匹配', 'The redemption proof does not match this device'],
    stale: ['确认页已过期，请重新核对', 'This confirmation is stale; review again'],
    not_pending: ['状态已变化', 'The state changed'],
    role_insufficient: ['角色不包含该操作', 'Role does not include this action'],
  };
  const txErr = code => { const t = TX_ERR[code] || PERM_TEXT[code]; return t ? T(t[0], t[1]) : code; };

  /**
   * Starts a simulated chain write and settles it after a short delay. Results
   * are applied to the organization that started it, even after a switch; only
   * toasts are suppressed when the context changed (FR-40).
   */
  function submitTx(spec, opts) {
    opts = opts || {};
    const p = opts.profile || P();
    const res = M.beginTx(p, Object.assign({ orgId: p.currentOrgId }, spec), now());
    if (!res.ok) {
      const t = FEE_TEXT[res.code];
      toast(t ? T(t[0], t[1]) : res.code, 'danger', 5200);
      if (opts.onRejected) opts.onRejected(res);
      return null;
    }
    const token = M.contextToken(p);
    save();
    render();
    later(opts.delay || 1100, () => settleTx(token, res.tx.id, opts));
    return res.tx;
  }

  function settleTx(token, txId, opts) {
    const p = root.profiles[token.profileId];
    if (!p) return;
    const faults = root.faults;
    let fault = null;
    if (faults.rpcDown) fault = 'rpc';
    else if (faults.nextTxFail) { fault = 'fail'; faults.nextTxFail = false; }
    const res = M.commitTx(p, txId, now(), fault);
    save();
    const here = M.sameContext(p, token) || (root.activeProfileId === token.profileId && !opts.strictContext);
    if (res.ok) {
      if (opts.onConfirmed) opts.onConfirmed(res, p);
      if (here && opts.ok) toast(typeof opts.ok === 'function' ? opts.ok(res) : opts.ok, 'ok');
    } else if (res.code === 'unknown') {
      if (here) toast(T('交易结果未知：已保留原交易，恢复连接后查询，不会重放。', 'Outcome unknown: the original transaction is kept for a query; it will not be replayed.'), 'warn', 5200);
      if (opts.onUnknown) opts.onUnknown(res, p);
    } else {
      if (opts.onFailed) opts.onFailed(res, p);
      if (here) toast(`${txLabel(res.tx ? res.tx.kind : '')}：${txErr(res.code)}`, 'danger', 5200);
    }
    save();
    render();
  }

  function queryTx(txId) {
    const p = P();
    const res = M.queryTx(p, txId, now(), root.faults.rpcDown ? 'rpc' : null);
    save();
    if (res.code === 'unknown') toast(T('Sui RPC 仍不可用，稍后再查询。', 'Sui RPC is still unavailable; query again later.'), 'warn');
    else if (res.ok) toast(T('已查询到原交易：已确认。', 'Found the original transaction: confirmed.'), 'ok');
    else toast(`${T('原交易', 'Original transaction')}：${txErr(res.code)}`, 'danger');
    render();
  }

  const latestTx = kindOrFilter => {
    const p = P();
    if (!p) return null;
    return p.txs.find(typeof kindOrFilter === 'function' ? kindOrFilter : t => t.kind === kindOrFilter) || null;
  };

  function txState(tx) {
    if (!tx) return '';
    const map = {
      pending: ['info', 'refresh', T('待链上确认', 'Awaiting confirmation')],
      confirmed: ['ok', 'check', T('已确认', 'Confirmed')],
      failed: ['danger', 'x', T('失败', 'Failed')],
      unknown: ['warn', 'help', T('结果未知', 'Outcome unknown')],
    };
    const [cls, ic, label] = map[tx.state];
    const spin = tx.state === 'pending' ? 'spin' : '';
    return `<span class="st ${cls}">${icon(ic, spin)}${esc(label)}</span>`;
  }

  function txLine(tx) {
    if (!tx) return '';
    const q = tx.state === 'unknown' ? ` <button class="link-btn" data-action="tx-query" data-id="${esc(tx.id)}">${T('查询原交易', 'Query transaction')}</button>` : '';
    const err = tx.state === 'failed' && tx.error ? ` · ${esc(txErr(tx.error))}` : '';
    return `<div class="row wrap small">${txState(tx)}<span class="muted mono">${esc(shortId(tx.id, 4))}</span><span class="muted">${esc(txLabel(tx.kind))} · ${esc(sui(tx.charged || tx.fee))}${tx.state === 'pending' ? T('（预计）', ' (est.)') : ''}${err}</span>${q}</div>`;
  }

  /* ----------------------------------------------------------- Buttons */

  function attrs(data) {
    return Object.entries(data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  }

  /** A button whose permission is checked; locked buttons explain why on click. */
  function btn(o) {
    const chk = o.perm ? can(o.perm) : { ok: true };
    const blocked = o.disabled || !chk.ok;
    const why = !chk.ok ? permText(chk.code) : o.why || '';
    const cls = ['btn', o.kind || '', o.size || '', o.cls || ''].join(' ').trim();
    const label = o.label ? `<span>${esc(o.label)}</span>` : '';
    const aria = o.label ? '' : ` aria-label="${esc(o.aria || '')}"`;
    return `<button type="button" class="${cls}" data-action="${esc(o.action)}" ${attrs(o.data)}${blocked ? ` aria-disabled="true" data-why="${esc(why)}"` : ''}${why ? ` title="${esc(why)}"` : ''}${aria}>${o.icon ? icon(o.icon) : ''}${label}${!chk.ok ? icon('lock', 'lock') : ''}</button>`;
  }

  /* ------------------------------------------------------- Common views */

  const COND = {
    on_track: ['trend', '正常推进', 'On track'],
    boundary: ['alert', '临近/触及边界', 'At the boundary'],
    drift: ['fork', '目标偏航', 'Drifting'],
    loop: ['loop', '疑似空转', 'Possibly looping'],
    blocked: ['block', '当前路径阻断', 'Path blocked'],
    waiting: ['hourglass', '正常等待依赖', 'Waiting on a dependency'],
    unknown: ['help', '状态未知', 'Status unknown'],
    paused: ['pause', '已暂停', 'Paused'],
    achieved: ['flag', '已抵达', 'Arrived'],
    idle: ['clock', '未激活', 'Not active'],
  };
  const condName = code => { const c = COND[code] || COND.idle; return T(c[1], c[2]); };
  const condIcon = code => (COND[code] || COND.idle)[0];
  const condBadge = code => `<span class="cond c-${code}">${icon(condIcon(code))}${esc(condName(code))}</span>`;

  const TRUST_TEXT = {
    claimed: ['Agent 声明', 'Claimed'],
    measured: ['已测量', 'Measured'],
    verified: ['已验证', 'Verified'],
    accepted: ['已验收', 'Accepted'],
  };
  function trust(level, opts) {
    if (!level) return `<span class="trust">${T('无数据', 'No data')}</span>`;
    const stale = opts && opts.stale;
    const t = TRUST_TEXT[level];
    const label = stale ? T('待更新', 'Stale') : T(t[0], t[1]);
    const title = T('可信度：Agent 声明 → 已测量 → 已验证 → 已验收', 'Trust: claimed → measured → verified → accepted');
    return `<span class="trust ${level}${stale ? ' stale' : ''}" title="${esc(title)}"><span class="steps"><i></i><i></i><i></i><i></i></span>${esc(label)}</span>`;
  }

  const LIFE = {
    ACTIVE: ['info', '进行中', 'Active'],
    ACTIVATING: ['info', '激活中', 'Activating'],
    CANDIDATE: ['wait', '候选', 'Candidate'],
    DRAFT: ['muted', '草稿', 'Draft'],
    ACHIEVED: ['brand', '已达成', 'Achieved'],
    ARCHIVED: ['muted', '已归档', 'Archived'],
  };
  const lifeChip = l => { const x = LIFE[l] || LIFE.DRAFT; return `<span class="chip ${x[0]}">${esc(T(x[1], x[2]))}</span>`; };

  const KR_STATUS = { PENDING: ['待开始', 'Pending'], IN_PROGRESS: ['进行中', 'In progress'], COMPLETE: ['已完成', 'Complete'] };
  const krStatusText = s => { const x = KR_STATUS[s] || KR_STATUS.PENDING; return T(x[0], x[1]); };

  const RUN = {
    queued: ['muted', 'clock', '排队', 'Queued'],
    running: ['info', 'play', '运行', 'Running'],
    awaiting_approval: ['warn', 'alert', '待审批', 'Awaiting approval'],
    recovering: ['wait', 'refresh', '恢复中', 'Recovering'],
    needs_confirmation: ['danger', 'help', '需要确认', 'Needs confirmation'],
    succeeded: ['ok', 'check', '成功', 'Succeeded'],
    failed: ['danger', 'x', '失败', 'Failed'],
    cancelled: ['muted', 'stop', '已取消', 'Cancelled'],
  };
  function runState(run) {
    if (run.stopping) return `<span class="st warn">${icon('refresh', 'spin')}${T('正在停止', 'Stopping')}</span>`;
    const r = RUN[run.state] || RUN.queued;
    return `<span class="st ${r[0]}">${icon(r[1])}${esc(T(r[2], r[3]))}</span>`;
  }

  const APV = {
    pending: ['warn', 'clock', '待处理', 'Pending'],
    approved: ['ok', 'check', '已同意', 'Approved'],
    rejected: ['danger', 'x', '已拒绝', 'Rejected'],
    expired: ['muted', 'clock', '已过期', 'Expired'],
    invalidated: ['muted', 'block', '已失效', 'Invalidated'],
  };
  function apvState(a) {
    const s = M.approvalStatus(a, now());
    const x = APV[s];
    let label = T(x[2], x[3]);
    if (a.kind !== 'boundary' && s === 'approved') label = T('已验收', 'Accepted');
    if (a.kind !== 'boundary' && s === 'rejected') label = T('已退回', 'Returned');
    if (s === 'invalidated' && a.superseded) label = T('已替代', 'Superseded');
    return `<span class="st ${x[0]}">${icon(x[1])}${esc(label)}</span>`;
  }

  const HOST_STATUS = {
    online: ['ok', '在线', 'Online'],
    offline: ['muted', '离线', 'Offline'],
    connecting: ['info', '连接中', 'Connecting'],
    waiting_connection: ['warn', '已入组，等待连接', 'Joined, awaiting connection'],
  };
  function hostState(h) {
    if (h.membership && h.membership.state === 'revoked') return `<span class="st danger">${icon('block')}${T('资格已撤销', 'Membership revoked')}</span>`;
    const x = HOST_STATUS[h.status] || HOST_STATUS.offline;
    const dot = `<span class="dot ${x[0] === 'muted' ? '' : x[0]}${h.status === 'online' ? ' pulse' : ''}"></span>`;
    return `<span class="st ${x[0]}">${dot}${esc(T(x[1], x[2]))}</span>`;
  }

  const platformIcon = p => ({ ios: 'phone', android: 'phone', macos: 'laptop', windows: 'laptop', ubuntu: 'laptop' }[p] || 'laptop');
  const PLATFORM = { ios: 'iOS', android: 'Android', macos: 'macOS', windows: 'Windows', ubuntu: 'Ubuntu' };

  const orgInitial = o => {
    const n = L(o.name);
    return esc((n.match(/[A-Za-z一-龥]/) || ['?'])[0].toUpperCase());
  };

  /** Decision queue: approvals, acceptance, unconfirmed side effects, pairing requests. */
  function decisions(org) {
    const p = P();
    const t = now();
    const out = [];
    if (!org) return out;
    org.approvals.filter(a => M.approvalStatus(a, t) === 'pending').forEach(a => out.push({ kind: a.kind === 'boundary' ? 'boundary' : a.kind, id: a.id, item: a, at: a.createdAt }));
    org.runs.filter(r => r.state === 'needs_confirmation').forEach(r => out.push({ kind: 'confirmation', id: r.id, item: r, at: r.startedAt }));
    const dev = me();
    if (dev && dev.role === 'manage') {
      p.pairings.filter(x => M.pairingStatus(x, t) === 'waiting').forEach(x => out.push({ kind: 'pairing', id: x.id, item: x, at: x.createdAt }));
    }
    const rank = { boundary: 0, confirmation: 1, pairing: 2, acceptance: 3, okr_acceptance: 4 };
    return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.at - a.at);
  }

  /* --------------------------------------------------------------- Render */

  // Batch synchronous state changes into one paint. A microtask (not
  // requestAnimationFrame) keeps rendering working in hidden or background tabs.
  let pendingRender = false;
  function render() {
    if (pendingRender) return;
    pendingRender = true;
    queueMicrotask(() => { pendingRender = false; paint(); });
  }

  function scroller() {
    return ui.framed ? document.getElementById('shell') : document.scrollingElement;
  }

  function paint() {
    applyTheme();
    const app = document.getElementById('app');
    const shell = document.getElementById('shell');
    if (!app || !shell) return;
    const mobile = isMobile();
    app.classList.toggle('m', mobile);
    app.classList.toggle('framed', ui.framed);

    const r = route();
    const key = `${root.activeProfileId}|${r.parts.join('/')}`;
    const changed = key !== ui.lastRoute;
    const sc = scroller();
    const top = sc ? sc.scrollTop : 0;
    const active = document.activeElement;
    const focusKey = active && (active.id || active.getAttribute('data-f'));
    const sel = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;

    const p = P();
    if (!p) {
      shell.className = 'shell bare';
      shell.innerHTML = FM.views.welcome(r);
    } else {
      shell.className = 'shell';
      shell.innerHTML = FM.shell(r);
    }
    renderOverlay();
    renderToasts();
    if (FM.review) FM.review.render();

    const sc2 = scroller();
    if (sc2) sc2.scrollTop = changed ? 0 : top;
    ui.lastRoute = key;
    if (focusKey) {
      const el = document.getElementById(focusKey) || document.querySelector(`[data-f="${CSS.escape(focusKey)}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        if (sel && 'setSelectionRange' in el) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text input */ } }
      }
    } else if (changed) {
      const h = document.querySelector('.page h1');
      if (h) h.setAttribute('tabindex', '-1');
    }
    document.title = p ? `${FM.pageTitle ? FM.pageTitle(r) : 'FractalMind'} · FractalMind` : 'FractalMind';
  }

  function renderOverlay() {
    const el = document.getElementById('overlay');
    if (!el) return;
    let html = '';
    const p = P();
    if (ui.drawer && FM.drawers[ui.drawer.type]) {
      const d = FM.drawers[ui.drawer.type](ui.drawer);
      if (d) html += `<div class="drawer-scrim" data-action="close-drawer"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(d.label || '')}">${d.html}</aside>`;
    }
    if (ui.dialog && FM.dialogs[ui.dialog.type]) {
      const d = FM.dialogs[ui.dialog.type](ui.dialog);
      if (d) {
        html += `<div class="scrim" data-action="scrim"><div class="dialog ${d.size || ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-t">
          <div class="dialog-h"><div><h2 id="dlg-t">${d.title}</h2>${d.sub ? `<p>${d.sub}</p>` : ''}</div>${d.noClose ? '' : `<button class="btn ghost icon sm" data-action="close-dialog" aria-label="${T('关闭', 'Close')}">${icon('x')}</button>`}</div>
          <div class="dialog-b">${d.body}</div>${d.foot ? `<div class="dialog-f">${d.foot}</div>` : ''}</div></div>`;
      }
    }
    if (ui.pop && FM.pops[ui.pop.type]) html += FM.pops[ui.pop.type](ui.pop);
    if (ui.palette) html += FM.palette();
    if (p && p.locked) html += FM.lockscreen();
    el.innerHTML = html;
    if (ui.pop && ui.pop.anchor) placePop();
    if (ui.palette) {
      const input = document.getElementById('palette-q');
      if (input && document.activeElement !== input) input.focus();
    }
  }

  function placePop() {
    const pop = document.querySelector('.pop');
    const a = document.querySelector(`[data-pop-anchor="${ui.pop.anchor}"]`);
    if (!pop || !a) return;
    const box = ui.framed ? document.querySelector('.device').getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const r = a.getBoundingClientRect();
    const w = pop.offsetWidth;
    let left = r.left - box.left;
    if (left + w > box.width - 8) left = Math.max(8, r.right - box.left - w);
    let top = r.bottom - box.top + 6;
    if (top + pop.offsetHeight > box.height - 8) top = Math.max(8, r.top - box.top - pop.offsetHeight - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  /* ------------------------------------------------------------- Events */

  function run(name, el, ev) {
    const fn = FM.actions[name];
    if (!fn) { console.warn('No action', name); return; }
    fn(el, ev);
  }

  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-action]');
    if (!el) {
      if (ui.pop && !ev.target.closest('.pop')) { ui.pop = null; renderOverlay(); }
      return;
    }
    if (el.getAttribute('aria-disabled') === 'true') {
      ev.preventDefault();
      const why = el.getAttribute('data-why');
      if (why) toast(why, 'warn');
      return;
    }
    const name = el.getAttribute('data-action');
    if (name === 'scrim' && ev.target !== el) return;
    ev.preventDefault();
    if (ui.pop && !el.closest('.pop') && !el.hasAttribute('data-pop-anchor')) ui.pop = null;
    run(name, el, ev);
  });

  document.addEventListener('input', ev => {
    const el = ev.target;
    const key = el.getAttribute && el.getAttribute('data-f');
    if (!key) return;
    setF(key, el.type === 'checkbox' ? el.checked : el.value);
    if (el.hasAttribute('data-live')) render();
    if (el.id === 'palette-q') renderOverlay();
  });
  document.addEventListener('change', ev => {
    const el = ev.target;
    const key = el.getAttribute && el.getAttribute('data-f');
    if (!key) return;
    setF(key, el.type === 'checkbox' ? el.checked : el.value);
    if (el.hasAttribute('data-rerender') || el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'radio') render();
  });
  document.addEventListener('submit', ev => ev.preventDefault());

  document.addEventListener('keydown', ev => {
    const k = ev.key;
    const t = ev.target;
    // Non-button controls (SVG checkpoints, clickable cards) activate like buttons.
    if ((k === 'Enter' || k === ' ') && t && t.matches && t.matches('[data-action][role="button"]:not(button), [data-action][role="link"]:not(a)')) {
      ev.preventDefault();
      run(t.getAttribute('data-action'), t, ev);
      return;
    }
    if ((ev.metaKey || ev.ctrlKey) && k.toLowerCase() === 'k') {
      ev.preventDefault();
      if (!P()) return;
      ui.palette = ui.palette ? null : { q: '', i: 0 };
      if (ui.palette) setF('palette.q', '');
      renderOverlay();
      return;
    }
    if ((ev.metaKey || ev.ctrlKey) && k === '.') {
      ev.preventDefault();
      ui.review = !ui.review;
      if (FM.review) FM.review.render();
      return;
    }
    if (k === 'Escape') {
      if (ui.palette) { ui.palette = null; renderOverlay(); return; }
      if (ui.pop) { ui.pop = null; renderOverlay(); return; }
      if (ui.dialog) { closeDialog(); return; }
      if (ui.drawer) { ui.drawer = null; render(); return; }
      if (ui.review) { ui.review = false; FM.review.render(); return; }
    }
    if (ui.palette && FM.paletteKey) FM.paletteKey(ev);
  });

  function openDialog(type, params) { ui.dialog = Object.assign({ type }, params || {}); ui.pop = null; render(); }
  function closeDialog() {
    const d = ui.dialog;
    ui.dialog = null;
    if (d && d.onClose) d.onClose();
    render();
  }
  function openDrawer(type, params) { ui.drawer = Object.assign({ type }, params || {}); ui.pop = null; render(); }
  function togglePop(type, anchor, params) {
    ui.pop = ui.pop && ui.pop.type === type && ui.pop.anchor === anchor ? null : Object.assign({ type, anchor }, params || {});
    renderOverlay();
  }

  Object.assign(FM.actions, {
    'close-dialog': () => closeDialog(),
    scrim: () => { if (ui.dialog && !ui.dialog.sticky) closeDialog(); },
    'close-drawer': () => { ui.drawer = null; render(); },
    go: el => { ui.pop = null; ui.drawer = null; go(el.dataset.to); },
    'tx-query': el => queryTx(el.dataset.id),
    'set-tab': el => { ui.tab[el.dataset.scope] = el.dataset.tab; render(); },
    'set-f': el => { setF(el.dataset.key, el.dataset.value); render(); },
    'toggle-f': el => { setF(el.dataset.key, !f(el.dataset.key, el.dataset.default === 'true')); render(); },
    expand: el => { ui.expanded[el.dataset.key] = !ui.expanded[el.dataset.key]; render(); },
    copy: el => {
      const text = el.dataset.copy || '';
      const done = () => toast(el.dataset.done || T('已复制', 'Copied'), 'ok');
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, done);
      else done();
    },
    'toggle-review': () => { ui.review = !ui.review; FM.review.render(); },
  });

  /* ------------------------------------------------ Periodic refreshers */

  setInterval(() => {
    document.querySelectorAll('[data-ago]').forEach(el => {
      const ts = Number(el.getAttribute('data-ago'));
      if (ts) el.textContent = ago(ts);
    });
  }, 15000);

  /** Online hosts keep reporting heartbeats; offline ones keep their last snapshot. */
  setInterval(() => {
    const p = P();
    if (!p) return;
    let changed = false;
    Object.values(p.data).forEach(org => org.hosts.forEach(h => {
      if (h.status === 'online') {
        h.lastHeartbeatAt = now() - Math.floor(Math.random() * 20e3);
        h.sampledAt = h.lastHeartbeatAt;
        h.cpu = Math.max(3, Math.min(96, Math.round(h.cpu + (Math.random() - 0.5) * 8)));
        changed = true;
      }
    }));
    if (changed) write(STATE_KEY, root);
  }, 20000);

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function randomBytes(n) {
    const out = new Uint8Array(n);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(out) : out.forEach((_, i) => { out[i] = Math.floor(Math.random() * 256); });
    return out;
  }

  FM.ui = {
    M, F, MIN, HOUR, DAY, T, L, esc, pct, money, sui, num, ago, until, date, dateTime, clock, shortId, agoTag,
    icon, LOGO, now, P, O, orgMeta, me, can, agent, host, inst, okrById, focusOkr, permText,
    ui, f, setF, clearForm, route, go, isMobile, later, toast, submitTx, queryTx, latestTx, txState, txLine, txLabel, txErr,
    btn, attrs, condName, condIcon, condBadge, trust, lifeChip, krStatusText, runState, apvState, hostState,
    platformIcon, PLATFORM, orgInitial, decisions, render, openDialog, closeDialog, openDrawer, togglePop,
    applyTheme, save, savePrefs, prefs, resetDemo, download, randomBytes, secrets,
    get root() { return root; },
    set root(v) { root = v; },
  };
})();
