// App v2 (#75): the prototype shell (js/shell.js) — sidebar, context bar,
// top tools, phone navigation, organization menu and lock screen.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useApp } from "./store";
import { go, type PageName, type Route } from "./router";
import { ago, Icon, Logo, shortId, until, useLang, useT } from "./ui";
import { focusOkr, orgCounts, okrTitle } from "./model";
import { agentName, hostName } from "../display";

type Nav = { id: PageName; icon: string; zh: string; en: string };
const NAV: Nav[] = [
  { id: "workbench", icon: "home", zh: "工作台", en: "Workbench" },
  { id: "okrs", icon: "target", zh: "OKR", en: "OKRs" },
  { id: "hosts", icon: "server", zh: "主机与算力", en: "Hosts & compute" },
  { id: "agents", icon: "users", zh: "团队与 Agents", en: "Team & Agents" },
  { id: "memory", icon: "book", zh: "记忆与成果", en: "Memory & results" },
  { id: "governance", icon: "shield", zh: "治理与审批", en: "Governance" },
];
const NAV_ME: Nav[] = [
  { id: "identity", icon: "user", zh: "我的身份", en: "My identity" },
  { id: "settings", icon: "sliders", zh: "组织设置", en: "Settings" },
];
const NAV_GLOBAL: Nav[] = [
  { id: "orgs", icon: "layers", zh: "我的组织", en: "My organizations" },
  { id: "network", icon: "globe", zh: "开放网络", en: "Open network" },
];
export const ALL_NAV = [...NAV, ...NAV_ME, ...NAV_GLOBAL];

function useOrgMeta() {
  const app = useApp();
  const t = useT();
  const org = app.identity?.organizations.find((o) => o.objectId === app.organizationId);
  const name = org?.name || (app.identity ? t("未选择组织", "No organization") : t("正在读取", "Loading"));
  const admin = !!org && !!app.profile && org.admin === app.profile.humanId;
  const kind = org && Number(org.depth) > 0 ? t("子组织", "Sub-organization") : t("个人组织", "Personal");
  const network = { testnet: t("测试网", "Testnet"), mainnet: t("主网", "Mainnet"), devnet: "Devnet", localnet: t("本地网络", "Localnet") }[
    app.profile?.network ?? "testnet"
  ];
  return { name, sub: `${kind} · ${admin ? t("管理员", "Admin") : t("成员", "Member")} · ${network}` };
}

function OrgMenu({ onClose, anchor }: { onClose: () => void; anchor: DOMRect }) {
  const app = useApp();
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => addEventListener("mousedown", away));
    addEventListener("keydown", key);
    return () => {
      removeEventListener("mousedown", away);
      removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div className="pop" ref={ref} role="menu" style={{ top: anchor.bottom + 6, left: anchor.left, width: Math.max(anchor.width, 260) }}>
      <div className="menu-h">{t("切换组织", "Switch organization")}</div>
      {(app.identity?.organizations ?? []).map((o) => (
        <button
          key={o.objectId}
          className={`menu-i ${o.objectId === app.organizationId ? "on" : ""}`}
          role="menuitem"
          onClick={() => {
            app.selectOrganization(o.objectId);
            onClose();
          }}
        >
          <span className="avatar sm">{[...(o.name || "?")][0]?.toUpperCase()}</span>
          <span className="grow ellipsis">{o.name || shortId(o.objectId)}</span>
          {o.objectId === app.organizationId && <Icon name="check" size="sm" />}
        </button>
      ))}
      <div className="divider" />
      <button
        className="menu-i"
        role="menuitem"
        onClick={() => {
          go("orgs");
          onClose();
        }}
      >
        <Icon name="layers" size="sm" />
        {t("我的组织", "My organizations")}
      </button>
    </div>
  );
}

function Sidebar({ route }: { route: Route }) {
  const app = useApp();
  const t = useT();
  const meta = useOrgMeta();
  const counts = orgCounts(app);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const link = (n: Nav) => {
    const badge =
      n.id === "workbench" && counts.decisions ? (
        <span className="count">{counts.decisions}</span>
      ) : n.id === "hosts" && counts.hostsAttention ? (
        <span className="count soft">{counts.hostsAttention}</span>
      ) : null;
    return (
      <a key={n.id} className="sb-link" href={`#/${n.id}`} aria-current={route.name === n.id ? "page" : undefined}>
        <Icon name={n.icon} />
        <span>{t(n.zh, n.en)}</span>
        {badge}
      </a>
    );
  };
  const session = app.device.session;
  return (
    <aside className="sidebar" aria-label={t("主导航", "Main navigation")}>
      <div className="sb-brand">
        <Logo />
        <span>FractalMind</span>
        <span className="chip outline">Alpha</span>
      </div>
      <button
        className="sb-org"
        aria-haspopup="menu"
        aria-label={t("切换组织", "Switch organization")}
        onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
      >
        <span className="avatar">{[...meta.name][0]?.toUpperCase()}</span>
        <span className="grow">
          <span className="t ellipsis" style={{ display: "block" }}>
            {meta.name}
          </span>
          <span className="s">{meta.sub}</span>
        </span>
        <Icon name="down" size="sm" />
      </button>
      {menu && <OrgMenu anchor={menu} onClose={() => setMenu(null)} />}
      <nav className="col" style={{ gap: 2 }}>
        {NAV.map(link)}
      </nav>
      <div className="sb-group">{t("个人", "You")}</div>
      <nav className="col" style={{ gap: 2 }}>
        {NAV_ME.map(link)}
      </nav>
      <div className="sb-group">{t("网络", "Network")}</div>
      <nav className="col" style={{ gap: 2 }}>
        {NAV_GLOBAL.map(link)}
      </nav>
      <div className="sb-foot">
        <a className="sb-me" href="#/identity">
          <span className="avatar round sm human">H</span>
          <span className="grow">
            <span className="t ellipsis" style={{ display: "block" }}>
              {t("我", "Me")} · {shortId(app.profile?.humanId)}
            </span>
            <span className="s ellipsis" style={{ display: "block" }}>
              {session.state === "unlocked"
                ? `${t("本设备", "This device")} · ${app.permission?.manageHosts ? t("管理设备", "Management device") : t("访问设备", "Access device")}`
                : t("网页预览 · 链上只读", "Web preview · read-only")}
            </span>
          </span>
        </a>
        {session.state === "unlocked" && (
          <button className="btn ghost sm" style={{ justifyContent: "flex-start" }} onClick={() => void app.device.lock()}>
            <Icon name="lock" size="sm" />
            <span>{t("锁定此 App", "Lock this app")}</span>
          </button>
        )}
      </div>
    </aside>
  );
}

function usePermissionChip() {
  const app = useApp();
  const t = useT();
  const p = app.permission;
  if (app.device.session.state !== "unlocked")
    return { tone: "info", text: t("链上只读", "Read-only chain") };
  if (!p?.read) return { tone: "warn", text: t("本设备无此组织授权", "No grant for this organization") };
  const parts = [];
  if (p.operate) parts.push(t("可执行", "Operate"));
  if (p.approve) parts.push(t("可审批", "Approve"));
  if (!parts.length) parts.push(t("只读", "Read-only"));
  return {
    tone: parts.length > 1 ? "ok" : "info",
    text: `${parts.join(" · ")}${p.expiresAtMs ? ` · ${until(p.expiresAtMs, t)}` : ""}`,
  };
}

function useContextParts() {
  const app = useApp();
  const focus = focusOkr(app);
  const member = focus
    ? app.snapshot?.memberships.value?.find((m) => m.id === focus.okr.membership_id)
    : null;
  const agent = focus ? app.snapshot?.agents.value?.find((a) => a.id === focus.okr.managed_agent) : null;
  return { focus, member, agent };
}

function ContextBar() {
  const app = useApp();
  const t = useT();
  const perm = usePermissionChip();
  const { focus, member, agent } = useContextParts();
  return (
    <div className="ctx" role="group" aria-label={t("当前上下文", "Current context")}>
      <button className="ctx-item" onClick={() => focus && go(`okrs/${focus.okr.id}`)} title={t("当前目标", "Current goal")}>
        <Icon name="target" size="sm" />
        <span className="k">{t("目标", "Goal")}</span>
        <span className="v">{focus ? okrTitle(app, focus.okr.id) : t("未选择", "None")}</span>
      </button>
      <span className="ctx-sep">
        <Icon name="right" size="xs" />
      </span>
      <button className="ctx-item" onClick={() => member && go(`hosts/${member.host_address}`)} title={t("执行主机", "Execution host")}>
        <span className="k">{t("执行", "Runs on")}</span>
        <span className="v">{member ? hostName(member) : t("未指定", "Not set")}</span>
      </button>
      <span className="ctx-sep">
        <Icon name="right" size="xs" />
      </span>
      <button className="ctx-item" onClick={() => go("agents")}>
        <Icon name="users" size="sm" />
        <span className="v">{agent ? agentName(agent) : "—"}</span>
      </button>
      <span className={`chip ${perm.tone} ctx-perm`} title={t("本设备在当前组织的权限", "This device's permission in this organization")}>
        <Icon name="laptop" />
        {perm.text}
      </span>
    </div>
  );
}

/** Sync state: the cached snapshot is labelled until the chain answers. */
function SyncIndicator() {
  const app = useApp();
  const t = useT();
  const lang = useLang();
  if (app.staleSince)
    return (
      <button className="tx-ind" onClick={app.refresh} title={t("正在从链上刷新", "Refreshing from chain")}>
        <Icon name="refresh" size="sm" className="spin" />
        {t(`上次同步 ${ago(app.staleSince, t, lang)}`, `Last synced ${ago(app.staleSince, t, lang)}`)}
      </button>
    );
  if (app.chain.error)
    return (
      <button className="tx-ind warn" onClick={app.refresh}>
        <Icon name="help" size="sm" />
        {t("同步失败 · 重试", "Sync failed · retry")}
      </button>
    );
  return null;
}

function Tools() {
  const app = useApp();
  const t = useT();
  const next = { system: "light", light: "dark", dark: "system" } as const;
  const themeIcon = { system: "monitor", light: "sun", dark: "moon" }[app.prefs.theme];
  return (
    <div className="tb-tools">
      <SyncIndicator />
      <button className="tb-btn" aria-label={t("刷新", "Refresh")} title={t("刷新链上数据", "Refresh chain data")} onClick={app.refresh}>
        <Icon name="refresh" className={app.chain.busy ? "spin" : undefined} />
      </button>
      <button
        className="tb-btn"
        title={t("Switch to English", "切换到中文")}
        aria-label={t("切换语言", "Switch language")}
        onClick={() => app.setPrefs({ ...app.prefs, language: app.prefs.language === "zh" ? "en" : "zh" })}
      >
        <span style={{ fontWeight: 700, fontSize: 12 }}>{app.prefs.language === "en" ? "中" : "EN"}</span>
      </button>
      <button
        className="tb-btn"
        aria-label={t("外观", "Appearance")}
        onClick={() => app.setPrefs({ ...app.prefs, theme: next[app.prefs.theme] })}
      >
        <Icon name={themeIcon} />
      </button>
    </div>
  );
}

function MobileTop() {
  const meta = useOrgMeta();
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const t = useT();
  return (
    <header className="m-top">
      <button
        className="org"
        aria-label={t("切换组织", "Switch organization")}
        onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}
      >
        <span className="avatar sm">{[...meta.name][0]?.toUpperCase()}</span>
        <span className="t">{meta.name}</span>
        <Icon name="down" size="xs" />
      </button>
      {menu && <OrgMenu anchor={menu} onClose={() => setMenu(null)} />}
      <span className="grow" />
      <SyncIndicator />
    </header>
  );
}

function CtxMini({ route }: { route: Route }) {
  const { member, agent } = useContextParts();
  const perm = usePermissionChip();
  const t = useT();
  if (!["workbench", "okrs"].includes(route.name)) return null;
  return (
    <button className="ctx-mini" onClick={() => go("hosts")}>
      <span className="dot" />
      <span className="grow ellipsis">
        {member ? hostName(member) : t("未指定主机", "No host")} · {agent ? agentName(agent) : "—"}
      </span>
      <span className={`chip ${perm.tone}`}>{perm.text}</span>
      <Icon name="right" size="xs" />
    </button>
  );
}

function Tabbar({ route }: { route: Route }) {
  const app = useApp();
  const t = useT();
  const counts = orgCounts(app);
  const tabs: [PageName, string, string, string][] = [
    ["workbench", "home", "工作台", "Workbench"],
    ["okrs", "target", "OKR", "OKRs"],
    ["hosts", "server", "主机", "Hosts"],
    ["agents", "users", "Agents", "Agents"],
    ["settings", "sliders", "设置", "Settings"],
  ];
  return (
    <nav className="tabbar" aria-label={t("主导航", "Main navigation")}>
      {tabs.map(([id, icon, zh, en]) => (
        <a key={id} href={`#/${id}`} aria-current={route.name === id ? "page" : undefined}>
          <Icon name={icon} />
          <span>{t(zh, en)}</span>
          {id === "workbench" && counts.decisions > 0 && <span className="count">{counts.decisions}</span>}
        </a>
      ))}
    </nav>
  );
}

export function Shell({ route, wide, children }: { route: Route; wide?: boolean; children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar route={route} />
      <div className="main">
        <header className="topbar">
          <ContextBar />
          <Tools />
        </header>
        <MobileTop />
        <main className={`page ${wide ? "wide" : ""}`} id="main">
          <CtxMini route={route} />
          {children}
        </main>
      </div>
      <Tabbar route={route} />
    </div>
  );
}

export function LockScreen() {
  const app = useApp();
  const t = useT();
  const session = app.device.session;
  const busy = session.state !== "locked";
  const why =
    session.state !== "locked"
      ? t("正在读取本机凭据…", "Reading this device's credentials…")
      : {
          manual: t("已手动锁定", "Locked manually"),
          idle: t("长时间无操作，已自动锁定", "Locked after inactivity"),
          background: t("在后台停留过久，已锁定", "Locked while in the background"),
          revoked: t("本设备授权已撤销，已锁定", "Locked: this device's grant was revoked"),
          error: t(
            "未能读取本机凭据：系统凭据库不可用或访问被拒绝。",
            "Could not read this device's credentials: the OS store is unavailable or access was denied.",
          ),
        }[session.reason];
  return (
    <div className="lockscreen" role="dialog" aria-modal="true" aria-label={t("已锁定", "Locked")}>
      <div className="card" style={{ width: "min(380px, calc(100% - 32px))", textAlign: "center", padding: "28px 24px" }}>
        <div className="row center">
          <Logo />
        </div>
        <h2 className="mt-12">{t("FractalMind 已锁定", "FractalMind is locked")}</h2>
        <p className="small muted mt-8">
          {why} · {t("组织内容已隐藏", "Organization content hidden")}
        </p>
        <button className="btn primary lg block mt-16" disabled={busy} onClick={() => void app.device.unlock()} autoFocus>
          <Icon name="lock" />
          <span>{busy ? t("解锁中…", "Unlocking…") : t("解锁本设备", "Unlock this device")}</span>
        </button>
      </div>
    </div>
  );
}
