// App v2 (#75): ⌘K command palette and the notification menu (prototype
// shell.js). The palette jumps to pages, OKRs, hosts and Agents and runs the
// common actions; notifications come from chain facts (activity.ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { useApp } from "./store";
import { go } from "./router";
import { useDialogs } from "./dialogs";
import { ago, Icon, useLang, useT } from "./ui";
import { decisions, okrTitle } from "./model";
import { activity, markSeen, seenAt } from "./activity";
import { ALL_NAV } from "./Shell";
import { agentName, hostName } from "../display";

type Item = { label: string; alt: string; icon: string; kind: string; run: () => void };

export function usePaletteItems(): Item[] {
  const app = useApp();
  const t = useT();
  const dialogs = useDialogs();
  return useMemo(() => {
    const items: Item[] = ALL_NAV.map((n) => ({ label: t(n.zh, n.en), alt: `${n.zh} ${n.en}`, icon: n.icon, kind: t("页面", "Page"), run: () => go(n.id) }));
    for (const r of app.snapshot?.okrs.value ?? [])
      items.push({ label: okrTitle(app, r.okr.id), alt: r.okr.logical_id, icon: "target", kind: "OKR", run: () => go(`okrs/${r.okr.id}`) });
    for (const m of app.snapshot?.memberships.value ?? [])
      if (!m.revoked) items.push({ label: hostName(m), alt: m.host_address, icon: "server", kind: t("主机", "Host"), run: () => go(`hosts/${m.host_address}`) });
    for (const a of app.snapshot?.agents.value ?? [])
      if (!a.revoked) items.push({ label: agentName(a), alt: a.instance_id, icon: "users", kind: "Agent", run: () => go("agents") });
    const action = (label: string, alt: string, icon: string, run: () => void) => items.push({ label, alt, icon, kind: t("操作", "Action"), run });
    action(t("新建 OKR", "New OKR"), "新建 OKR new okr create", "plus", () => go("okrs/new"));
    action(t("接入主机", "Add a host"), "接入主机 add host invite", "server", () => dialogs.open({ kind: "host-access", operation: "invite" }));
    action(t("从主机导入 Agent", "Import Agents from a host"), "导入 发现 import discover agents", "scan", () => dialogs.open({ kind: "agent-import" }));
    if (isTauri()) action(t("新建 Agent", "New Agent"), "新建 agent create", "plus", () => dialogs.open({ kind: "agent-create" }));
    items.push({
      label: t("切换语言", "Switch language"),
      alt: "语言 language english 中文",
      icon: "lang",
      kind: t("偏好", "Preference"),
      run: () => app.setPrefs({ ...app.prefs, language: app.prefs.language === "zh" ? "en" : "zh" }),
    });
    items.push({
      label: t("切换深色/浅色", "Toggle dark/light"),
      alt: "主题 theme dark light",
      icon: "moon",
      kind: t("偏好", "Preference"),
      run: () => app.setPrefs({ ...app.prefs, theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }),
    });
    if (app.device.session.state === "unlocked")
      items.push({ label: t("锁定此 App", "Lock this app"), alt: "锁定 lock", icon: "lock", kind: t("操作", "Action"), run: () => void app.device.lock() });
    return items;
  }, [app.snapshot, app.okrTexts, app.prefs, app.device.session.state]);
}

export function Palette({ onClose }: { onClose: () => void }) {
  const t = useT();
  const all = usePaletteItems();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const query = q.trim().toLowerCase();
  const items = (query ? all.filter((x) => `${x.label} ${x.alt}`.toLowerCase().includes(query)) : all).slice(0, 12);
  const run = (x: Item | undefined) => {
    onClose();
    x?.run();
  };
  // Portalled: the top bar's backdrop filter would otherwise contain it.
  return createPortal(
    <>
      <div className="drawer-scrim" style={{ zIndex: 119 }} onMouseDown={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label={t("命令面板", "Command palette")}>
        <div className="p-in">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            placeholder={t("搜索页面、OKR、主机或操作…", "Search pages, OKRs, hosts or actions…")}
            autoComplete="off"
            aria-label={t("搜索", "Search")}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setI((n) => Math.min(n + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setI((n) => Math.max(n - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(items[i]);
              } else if (e.key === "Escape") onClose();
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="p-list" role="listbox">
          {items.map((x, n) => (
            <button key={`${x.kind}:${x.label}:${n}`} className={`p-i ${n === i ? "on" : ""}`} role="option" aria-selected={n === i} onMouseEnter={() => setI(n)} onClick={() => run(x)}>
              <Icon name={x.icon} size="sm" />
              <span className="ellipsis">{x.label}</span>
              <span className="k">{x.kind}</span>
            </button>
          ))}
          {!items.length && (
            <div className="muted small" style={{ padding: 12 }}>
              {t("没有匹配项", "No matches")}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

export function useUnread() {
  const app = useApp();
  const [seen, setSeen] = useState(seenAt);
  const items = activity(app.snapshot, (id) => okrTitle(app, id));
  const unread = items.filter((x) => x.at > seen).length + decisions(app).items.length;
  return { items, unread, seen, markRead: () => setSeen(markSeen()) };
}

export function Notifications({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const app = useApp();
  const t = useT();
  const lang = useLang();
  const { items, seen } = useUnread();
  const pending = decisions(app).items;
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
  const open = (to: string) => {
    onClose();
    go(to);
  };
  return createPortal(
    <div className="pop" ref={ref} style={{ width: 380, padding: 8, top: anchor.bottom + 6, left: Math.max(8, Math.min(anchor.right, innerWidth - 8) - 380) }}>
      <div className="menu-h">{t("通知", "Notifications")}</div>
      {pending.map(({ row }) => (
        <button className="menu-i" key={`d:${row.okr.id}`} onClick={() => open(`okrs/${row.okr.id}`)}>
          <span className="e-ico" style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--danger-soft, var(--surface-3))", flex: "none" }}>
            <Icon name="alert" size="sm" />
          </span>
          <span className="grow">
            <span style={{ display: "block", fontSize: 13, lineHeight: 1.4 }}>
              {t("需要你决定：", "Needs your decision: ")}
              {okrTitle(app, row.okr.id)}
            </span>
          </span>
        </button>
      ))}
      {items.slice(0, 8).map((x) => (
        <button className="menu-i" key={x.key} onClick={() => open(x.to)}>
          <span className="e-ico" style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--surface-3)", flex: "none" }}>
            <Icon name={x.icon} size="sm" />
          </span>
          <span className="grow">
            <span style={{ display: "block", fontSize: 13, lineHeight: 1.4, fontWeight: x.at > seen ? 600 : 400 }}>{t(x.zh, x.en)}</span>
            <span className="tiny muted">{ago(x.at, t, lang)}</span>
          </span>
        </button>
      ))}
      {!pending.length && !items.length && (
        <div className="muted small" style={{ padding: "8px 10px" }}>
          {t("暂无通知", "No notifications")}
        </div>
      )}
      <div className="menu-sep" />
      <div className="tiny muted" style={{ padding: "4px 10px 6px" }}>
        {t("通知来自链上记录：目标开始与达成、KR 测量、执行结果和导入的 Agent。", "From chain records: goals started and achieved, KR measurements, run results and imported Agents.")}
      </div>
    </div>,
    document.body,
  );
}
