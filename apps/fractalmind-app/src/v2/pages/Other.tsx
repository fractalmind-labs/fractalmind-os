// App v2 (#75): the pages M1 lays out as in the prototype with the real data
// already available; the rest arrives in M3 and is marked “即将推出”.
import { DEVICE_ACTIONS } from "@fractalmind-labs/fractalmind-sdk";
import { useApp } from "../store";
import { go } from "../router";
import { Btn, ComingSoon, date, Empty, Icon, shortId, until, useLang, useT } from "../ui";
import { decisions, okrTitle } from "../model";

function Head({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="page-h">
      <div>
        <h1>{title}</h1>
        <p className="muted">{sub}</p>
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Memory() {
  const app = useApp();
  const t = useT();
  const achieved = (app.snapshot?.okrs.value ?? []).filter((r) => r.okr.state === 3);
  return (
    <>
      <Head title={t("记忆与成果", "Memory & results")} sub={t("已验收的成果，以及带来源的组织记忆。", "Accepted results and sourced organization memory.")} />
      <section className="sec">
        <div className="sec-h">
          <h2>{t("已验收成果", "Accepted results")}</h2>
          <span className="small muted">{achieved.length}</span>
        </div>
        {achieved.length ? (
          <div className="list card">
            {achieved.map((r) => (
              <a className="item" key={r.okr.id} href={`#/okrs/${r.okr.id}`}>
                <Icon name="seal" />
                <span className="grow">{okrTitle(app, r.okr.id)}</span>
                <span className="chip brand">{t("已达成", "Achieved")}</span>
              </a>
            ))}
          </div>
        ) : (
          <Empty icon="book" title={t("还没有已验收的成果", "No accepted results yet")} />
        )}
      </section>
      <section className="sec">
        <ComingSoon title={t("组织记忆", "Organization memory")}>
          {t("带来源的记忆、编辑写入新版本与导出。", "Sourced memory, edits as new versions, and export.")}
        </ComingSoon>
      </section>
    </>
  );
}

export function Governance() {
  const app = useApp();
  const t = useT();
  const list = decisions(app);
  const p = app.permission;
  const yes = (v: boolean | undefined) => (
    <span className={`st ${v ? "ok" : "muted"}`}>
      <Icon name={v ? "check" : "x"} />
      {v ? t("允许", "Allowed") : t("不允许", "Not allowed")}
    </span>
  );
  return (
    <>
      <Head title={t("治理与审批", "Governance")} sub={t("待处理事项、本设备权限与决策记录。", "Pending items, this device's permissions and decisions.")} />
      <section className="sec">
        <div className="sec-h">
          <h2>{t("待处理", "Pending")}</h2>
          <span className="small muted">{list.items.length}</span>
        </div>
        {list.items.length ? (
          <div className="list card">
            {list.items.map(({ row }) => (
              <a className="item" key={row.okr.id} href={`#/okrs/${row.okr.id}`}>
                <span className={`prio P${row.okr.priority}`}>P{row.okr.priority}</span>
                <span className="grow">{okrTitle(app, row.okr.id)}</span>
                <Icon name="right" size="sm" />
              </a>
            ))}
          </div>
        ) : (
          <div className="calm">
            <Icon name="check" />
            <span>{t("没有待处理的事项。", "Nothing pending.")}</span>
          </div>
        )}
      </section>
      <section className="sec">
        <div className="sec-h">
          <h2>{t("本设备权限", "This device's permissions")}</h2>
        </div>
        <div className="card">
          {app.device.session.state !== "unlocked" ? (
            <p className="small muted">{t("解锁本设备后显示。", "Shown after unlocking this device.")}</p>
          ) : (
            <dl className="kv">
              <dt>{t("查看", "Read")}</dt>
              <dd>{yes(p?.read)}</dd>
              <dt>{t("执行", "Operate")}</dt>
              <dd>{yes(p?.operate)}</dd>
              <dt>{t("审批", "Approve")}</dt>
              <dd>{yes(p?.approve)}</dd>
              <dt>{t("管理主机", "Manage hosts")}</dt>
              <dd>{yes(p?.manageHosts)}</dd>
              <dt>{t("有效期", "Valid")}</dt>
              <dd>{p?.expiresAtMs ? until(p.expiresAtMs, t) : "—"}</dd>
            </dl>
          )}
        </div>
      </section>
      <section className="sec">
        <ComingSoon title={t("审批历史与决策记录", "Approval history and decisions")}>
          {t("区分已同意与已执行，执行结果关联回审批。", "Approved vs executed, with results linked back to each approval.")}
        </ComingSoon>
      </section>
    </>
  );
}

export function Identity() {
  const app = useApp();
  const t = useT();
  const lang = useLang();
  const grants = app.identity?.grants.value ?? [];
  const me = app.device.session.state === "unlocked" ? app.device.session.device.address : null;
  const names = Object.fromEntries(Object.entries(DEVICE_ACTIONS).map(([k, v]) => [v, k]));
  const label: Record<string, [string, string]> = {
    read: ["查看", "Read"],
    operate: ["执行", "Operate"],
    approve: ["审批", "Approve"],
    manage_hosts: ["管理主机", "Manage hosts"],
  };
  return (
    <>
      <Head title={t("我的身份", "My identity")} sub={t("稳定的 Human ID、逐设备授权与恢复。", "A stable Human ID, per-device grants and recovery.")} />
      <div className="grid-2">
        <section className="card">
          <div className="card-h">
            <h2>Human</h2>
          </div>
          <dl className="kv">
            <dt>Human ID</dt>
            <dd className="mono small">{shortId(app.profile?.humanId, 10)}</dd>
            <dt>{t("网络", "Network")}</dt>
            <dd>{app.profile?.network}</dd>
            <dt>{t("代数", "Generation")}</dt>
            <dd>{app.identity ? String(app.identity.human.generation) : "—"}</dd>
          </dl>
        </section>
        <ComingSoon title={t("恢复码与添加设备", "Recovery code and adding devices")}>
          {t("更换恢复码、在另一台设备上登录。", "Rotate the recovery code, sign in on another device.")}
        </ComingSoon>
      </div>
      <section className="sec">
        <div className="sec-h">
          <h2>{t("设备授权", "Device grants")}</h2>
          <span className="small muted">{grants.length}</span>
        </div>
        <div className="card flush" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>{t("设备", "Device")}</th>
                <th>{t("权限", "Actions")}</th>
                <th>{t("范围", "Scope")}</th>
                <th>{t("到期", "Expires")}</th>
                <th>{t("状态", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id}>
                  <td>
                    <span className="mono small">{shortId(g.device, 8)}</span> {g.device === me && <span className="chip outline">{t("本设备", "This device")}</span>}
                  </td>
                  <td className="small">{g.actions.map((a) => t(...(label[names[a]] ?? [String(a), String(a)]))).join(" · ")}</td>
                  <td className="small">{g.org_scope ? shortId(g.org_scope) : t("全部组织", "All organizations")}</td>
                  <td className="small">{date(Number(g.expires_at_ms), lang)}</td>
                  <td>
                    <span className={`st ${g.revoked ? "danger" : "ok"}`}>{g.revoked ? t("已撤销", "Revoked") : t("有效", "Active")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function Settings() {
  const app = useApp();
  const t = useT();
  return (
    <>
      <Head title={t("组织设置", "Settings")} sub={t("语言与外观、连接、导出与诊断。", "Language and appearance, connection, export and diagnostics.")} />
      <div className="grid-2">
        <section className="card">
          <div className="card-h">
            <h2>{t("语言与外观", "Language & appearance")}</h2>
          </div>
          <div className="col">
            <div className="seg">
              {(["zh", "en"] as const).map((l) => (
                <button key={l} aria-pressed={app.prefs.language === l} onClick={() => app.setPrefs({ ...app.prefs, language: l })}>
                  {l === "zh" ? "中文" : "English"}
                </button>
              ))}
            </div>
            <div className="seg">
              {(
                [
                  ["system", "跟随系统", "System"],
                  ["light", "浅色", "Light"],
                  ["dark", "深色", "Dark"],
                ] as const
              ).map(([k, zh, en]) => (
                <button key={k} aria-pressed={app.prefs.theme === k} onClick={() => app.setPrefs({ ...app.prefs, theme: k })}>
                  {t(zh, en)}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="card">
          <div className="card-h">
            <h2>{t("连接", "Connection")}</h2>
          </div>
          <dl className="kv">
            <dt>{t("网络", "Network")}</dt>
            <dd>{app.profile?.network}</dd>
            <dt>RPC</dt>
            <dd className="mono small">{app.profile?.rpcUrl}</dd>
            <dt>{t("协议包", "Protocol package")}</dt>
            <dd className="mono small">{shortId(app.profile?.packageId, 10)}</dd>
          </dl>
          <div className="card-f">
            <Btn label={t("清除连接缓存", "Clear connection cache")} icon="logout" size="sm" onClick={app.disconnect} />
            <Btn label={t("旧版界面", "Previous interface")} size="sm" kind="ghost" onClick={() => (location.href = "/legacy.html")} />
          </div>
        </section>
      </div>
      <section className="sec">
        <ComingSoon title={t("运行费、导出与诊断", "Fees, export and diagnostics")}>
          {t("运行费来源、导出与数据控制、诊断与更新。", "Fee sources, export and data controls, diagnostics and updates.")}
        </ComingSoon>
      </section>
    </>
  );
}

export function Orgs() {
  const app = useApp();
  const t = useT();
  const orgs = app.identity?.organizations ?? [];
  return (
    <>
      <Head title={t("我的组织", "My organizations")} sub={t("组织关系与切换；从个人组织逐步走向团队与联邦。", "Your organizations; grow from personal to team and federation.")} />
      <div className="list card">
        {orgs.map((o) => (
          <button
            className="item"
            key={o.objectId}
            style={{ width: "100%", textAlign: "left", border: 0, background: "none" }}
            onClick={() => {
              app.selectOrganization(o.objectId);
              go("workbench");
            }}
          >
            <span className="avatar">{[...(o.name || "?")][0]?.toUpperCase()}</span>
            <span className="grow">
              <span className="strong" style={{ display: "block" }}>
                {o.name}
              </span>
              <span className="tiny muted mono">{shortId(o.objectId, 8)}</span>
            </span>
            {o.objectId === app.organizationId ? <span className="chip ok">{t("当前", "Current")}</span> : <Icon name="right" size="sm" />}
          </button>
        ))}
      </div>
      <section className="sec">
        <ComingSoon title={t("团队与子组织", "Teams and sub-organizations")}>
          {t("邀请成员、创建子组织与联邦。", "Invite members, create sub-organizations and federations.")}
        </ComingSoon>
      </section>
    </>
  );
}

export function Network() {
  const t = useT();
  return (
    <>
      <Head title={t("开放网络", "Open network")} sub={t("公开组织目录。", "The public organization directory.")} />
      <ComingSoon title={t("公开组织目录", "Public organization directory")}>
        {t("浏览和查询公开的组织。", "Browse and query public organizations.")}
      </ComingSoon>
    </>
  );
}
