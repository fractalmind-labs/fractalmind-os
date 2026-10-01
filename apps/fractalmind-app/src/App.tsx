import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { normalizeProfile } from "./chain";
import Welcome from "./Welcome";
import {
  BrandMark,
  NavIcon,
  TrustLadder,
  Decisions,
  OrganizationViews,
} from "./V2Views";
import { trustState } from "./v2-model";
import { useChain } from "./use-chain";
import { clockNow, memberStatus, navigation } from "./domain";
import type {
  ConnectionProfile,
  OrganizationSnapshot,
  OkrSnapshot,
  Navigation,
} from "./domain";

type Page =
  | "workbench"
  | "okrs"
  | "hosts"
  | "agents"
  | "memory"
  | "governance"
  | "identity"
  | "settings"
  | "orgs"
  | "network";
type Translate = (zh: string, en: string) => string;
const PROFILE_KEY = "fractalmind.app.public-connection.v1";
const PREFERENCE_KEY = "fractalmind.app.appearance.v1";
const PrivateRecordView = lazy(() => import("./PrivateRecordView"));
const DeviceAccess = lazy(() => import("./DeviceAccess"));
const runLabels: Array<[string, string]> = [
  ["待启动", "Queued"],
  ["链上记录：运行中", "Chain record: running"],
  ["已成功", "Succeeded"],
  ["已失败", "Failed"],
  ["结果未知", "Outcome unknown"],
  ["已取消", "Cancelled"],
];
const short = (id?: string | null) =>
  id ? `${id.slice(0, 8)}…${id.slice(-6)}` : "—";
function savedProfile() {
  try {
    const text = localStorage.getItem(PROFILE_KEY);
    return text ? normalizeProfile(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}
function savedPreferences(): {
  language: "zh" | "en";
  theme: "system" | "light" | "dark";
} {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREFERENCE_KEY) ?? "{}");
    return {
      language: prefs.language === "en" ? "en" : "zh",
      theme: ["light", "dark"].includes(prefs.theme) ? prefs.theme : "system",
    };
  } catch {
    return { language: "zh", theme: "system" };
  }
}
const labels: Record<Page, [string, string]> = {
  workbench: ["工作台", "Workbench"],
  okrs: ["OKR", "OKRs"],
  hosts: ["主机与算力", "Hosts & compute"],
  agents: ["团队与 Agents", "Team & Agents"],
  memory: ["记忆与成果", "Memory & results"],
  governance: ["治理与审批", "Governance & approvals"],
  identity: ["我的身份", "My identity"],
  settings: ["组织设置", "Organization settings"],
  orgs: ["我的组织", "My organizations"],
  network: ["开放网络", "Open network"],
};
const statusLabels: Record<Navigation["condition"], [string, string]> = {
  achieved: ["已人工验收", "Human accepted"],
  archived: ["已归档", "Archived"],
  draft: ["草稿 · 尚未批准", "Draft · not approved"],
  paused: ["已暂停", "Paused"],
  unknown: ["状态未知 · 先查询", "Unknown · query first"],
  expired: ["约定或命令到期", "Agreement or command expired"],
  permission: ["执行资格失效", "Execution authority invalid"],
  budget: ["无新增预算额度", "No unreserved budget"],
  queued: ["已准备 · 等待启动", "Prepared · awaiting start"],
  running: ["链上记录：运行中", "Chain record: running"],
  stopped: ["已确认取消", "Cancellation confirmed"],
  failed: ["执行失败", "Execution failed"],
  measurement: ["结果已保存 · 等待测量", "Result saved · awaiting measurement"],
  verification: ["指标达标 · 待人验证", "Target measured · verify next"],
  acceptance: ["KR 已验证 · 待最终验收", "KRs verified · accept next"],
  ready: ["尚无当前执行", "No current execution"],
};
const reasons: Record<string, [string, string]> = {
  rpc_unavailable: [
    "连接失败，保留最后快照；不推断当前进度或自动重试执行。",
    "Connection failed. Keep the last snapshot; do not infer current progress or retry execution.",
  ],
  execution_outcome_unknown: [
    "执行端无法确认副作用；预留预算仍保留，必须先核实原 Run。",
    "Execution side effects are unconfirmed. Reservations remain; reconcile the original Run first.",
  ],
  human_accepted: [
    "链上有独立人工验收记录。",
    "A separate human acceptance record exists on chain.",
  ],
  not_approved: [
    "尚无生效执行约定，不会自主执行。",
    "No approved execution agreement is active.",
  ],
  chain_paused: [
    "OKR 链上状态已暂停；切换页面不会恢复执行。",
    "The OKR is paused on chain. Switching pages does not resume it.",
  ],
  agreement_expired: [
    "约定已到期，需要重新批准有效约定。",
    "The agreement expired. A new valid agreement needs approval.",
  ],
  queued_command_expired: [
    "排队命令已到期；不自动生成或投递新命令。",
    "The queued command expired. No replacement is generated or delivered automatically.",
  ],
  authority_invalid: [
    "成员资格、实例或连接授权与当前约定不一致。",
    "Membership, instance or binding differs from the current agreement.",
  ],
  authority_not_readable: [
    "未能读取完整主机与实例资格，边界状态未知。",
    "Host/instance authority could not be fully read; boundary state is unknown.",
  ],
  run_or_budget_not_readable: [
    "Run 或预算读取失败，不把缺失数据当作零支出或正常运行。",
    "Run or budget reads failed; missing data is not zero spend or normal execution.",
  ],
  multiple_unsettled_runs: [
    "当前 KR 有多条在途 Run，无法用单一位置表达，需对账。",
    "Multiple unsettled Runs exist for this KR. Reconcile before choosing one position.",
  ],
  stop_requested_not_confirmed: [
    "已请求停止，尚未得到执行端确认。",
    "Stop requested; execution has not confirmed it.",
  ],
  chain_running: [
    "链上已确认启动。主机当前心跳未知，不能仅凭此证明此刻在线。",
    "Start confirmed on chain. Current Host heartbeat is unknown; this does not prove live connectivity.",
  ],
  prepared_not_started: [
    "预留和票据已确认，尚无已确认启动；恢复后不自动重新投递。",
    "Reservation and ticket confirmed; no confirmed start. Restoration does not automatically redeliver.",
  ],
  host_or_chain_cancelled: [
    "Run 已有取消终态，保留原检查点。",
    "Run cancellation is terminal; its checkpoint remains.",
  ],
  execution_failed: [
    "当前执行有失败终态，原结果保留；新尝试需要明确决策。",
    "Execution failed and its result remains. A new attempt needs an explicit decision.",
  ],
  separate_human_acceptance: [
    "全部 KR 验证完成；必须复核成功标准并单独验收，才能抵达终点。",
    "All KRs are verified. Review success criteria and accept separately to reach the destination.",
  ],
  measurement_not_verification: [
    "实测达到目标仍不等于已验证，地图的已验证位置不会自动前移。",
    "A measured target is not verification. The verified map position does not move automatically.",
  ],
  result_without_current_measurement: [
    "Run 成功结果已保存，尚无与它匹配的当前测量。",
    "A successful result exists, but a matching current measurement is missing.",
  ],
  measurement_stale: [
    "观测缺失、过期或时间异常，只保留历史位置。",
    "Observation missing, stale or future-dated; keep the historical position.",
  ],
  no_unreserved_budget: [
    "支出与在途预留已覆盖预算。尚无证据能确定下一动作需要多少额度。",
    "Spend and pending reservations cover the budget. The next action’s required amount is not established.",
  ],
  no_current_execution: [
    "当前 KR 尚无 Run；没有动作轨迹，不能判断是否偏航或陷入死胡同。",
    "No Run for this KR. Without action traces, drift or a dead end cannot be established.",
  ],
};

const pageIcons: Record<Page, string> = {
  workbench: "home",
  okrs: "target",
  hosts: "server",
  agents: "users",
  memory: "book",
  governance: "shield",
  identity: "user",
  settings: "sliders",
  orgs: "layers",
  network: "globe",
};
const navGroups: Array<{ label: [string, string]; pages: Page[] }> = [
  {
    label: ["组织", "Organization"],
    pages: ["workbench", "okrs", "hosts", "agents", "memory", "governance"],
  },
  { label: ["个人", "You"], pages: ["identity", "settings"] },
  { label: ["网络", "Network"], pages: ["orgs", "network"] },
];

export function App() {
  const [prefs, setPrefs] = useState(savedPreferences);
  const [profile, setProfile] = useState<ConnectionProfile | null>(
    savedProfile,
  );
  const [page, setPage] = useState<Page>("workbench");
  const [focusId, setFocusId] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [okrFilter, setOkrFilter] = useState("all");
  const [allFeatures, setAllFeatures] = useState(false);
  const allDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (allFeatures) allDialog.current?.showModal();
    else allDialog.current?.close();
  }, [allFeatures]);
  const [wallMs, setWallMs] = useState(Date.now());
  const data = useChain(profile);
  const t: Translate = (zh, en) => (prefs.language === "zh" ? zh : en);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        prefs.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : prefs.theme;
      document.documentElement.lang = prefs.language === "zh" ? "zh-CN" : "en";
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem(PREFERENCE_KEY, JSON.stringify(prefs));
    } catch {
      /* Preferences are optional; never affect chain state. */
    }
    return () => media.removeEventListener("change", apply);
  }, [prefs]);
  useEffect(() => {
    const timer = setInterval(() => setWallMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const appearance = (
    <div className="appearance">
      <label>
        <span className="sr-only">{t("语言", "Language")}</span>
        <select
          aria-label={t("语言", "Language")}
          value={prefs.language}
          onChange={(e) =>
            setPrefs({ ...prefs, language: e.target.value as "zh" | "en" })
          }
        >
          <option value="zh">简体中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        <span className="sr-only">{t("外观", "Appearance")}</span>
        <select
          aria-label={t("外观", "Appearance")}
          value={prefs.theme}
          onChange={(e) =>
            setPrefs({ ...prefs, theme: e.target.value as typeof prefs.theme })
          }
        >
          <option value="system">{t("跟随系统", "System")}</option>
          <option value="light">{t("白天", "Light")}</option>
          <option value="dark">{t("黑夜", "Dark")}</option>
        </select>
      </label>
    </div>
  );
  const connect = (value: ConnectionProfile) => {
    setProfile(value);
    setPage("workbench");
    setFocusId("");
    setDetailId(null);
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(value));
    } catch {}
  };
  const disconnect = () => {
    setAllFeatures(false);
    setProfile(null);
    setFocusId("");
    setDetailId(null);
    try {
      localStorage.removeItem(PROFILE_KEY);
    } catch {}
  };
  useEffect(() => {
    if (profile && data.identity?.human.id === profile.humanId) {
      try {
        localStorage.setItem(
          PROFILE_KEY,
          JSON.stringify({
            ...profile,
            chainIdentifier: data.identity.chainIdentifier,
          }),
        );
      } catch {}
    }
    // Persist the verified pin once. Rewriting it on every snapshot refresh
    // would recreate a connection another window explicitly cleared.
  }, [profile, data.identity?.human.id, data.identity?.chainIdentifier]);
  if (!profile)
    return <Welcome t={t} appearance={appearance} connect={connect} />;
  const snapshot = data.snapshot;
  const now = snapshot ? clockNow(snapshot, wallMs) : BigInt(wallMs);
  const okrs = snapshot?.okrs.value;
  const focus =
    okrs?.find((row) => row.okr.id === focusId) ??
    okrs?.find((row) => row.okr.state === 1) ??
    okrs?.[0];
  const nav =
    focus && snapshot ? navigation(focus, snapshot, now, data.reachable) : null;
  const goOkr = (id: string, to: Page) => {
    setFocusId(id);
    setDetailId(to === "okrs" ? id : null);
    setPage(to);
  };
  const selectOrganization = (id: string) => {
    setDetailId(null);
    setFocusId("");
    setOkrFilter("all");
    data.selectOrganization(id);
  };
  const contextHost = snapshot?.memberships.value?.find(
    (member) => member.id === focus?.okr.membership_id,
  );
  const contextAgent = snapshot?.agents.value?.find(
    (agent) => agent.id === focus?.okr.managed_agent,
  );
  const navButton = (id: Page) => (
    <button
      key={id}
      aria-current={page === id ? "page" : undefined}
      onClick={() => {
        setPage(id);
        if (id !== "okrs") setDetailId(null);
        setAllFeatures(false);
      }}
    >
      <NavIcon name={pageIcons[id]} />
      {t(...labels[id])}
    </button>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark /> FractalMind <small>Alpha</small>
        </div>
        <label className="org-select">
          <span>{t("当前组织", "Current organization")}</span>
          <select
            aria-label={t("切换组织", "Switch organization")}
            value={data.organizationId}
            onChange={(e) => selectOrganization(e.target.value)}
          >
            {data.identity?.organizations.map((org) => (
              <option key={org.objectId} value={org.objectId}>
                {org.name}
              </option>
            ))}
            {!data.identity && <option>{t("正在读取", "Loading")}</option>}
          </select>
        </label>
        <nav aria-label={t("主导航", "Main navigation")}>
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label[1]}>
              <span className="nav-group-label">{t(...group.label)}</span>
              {group.pages.map(navButton)}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="badge">{profile.network}</span>
          <p>{t("链上只读浏览", "Read-only chain browser")}</p>
          <small>
            {t(
              "公开连接不提供设备授权",
              "A public connection does not grant device authority",
            )}
          </small>
          <button onClick={disconnect}>
            {t("清除连接缓存", "Clear connection cache")}
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              {t("让 Agent 朝目标前进", "Agents working toward your goals")}
            </span>
            <h1>{t(...labels[page])}</h1>
          </div>
          {appearance}
          <button className="all-features" onClick={() => setAllFeatures(true)}>
            {t("全部功能", "All features")}
          </button>
          <button
            aria-label={t("刷新链上数据", "Refresh chain data")}
            disabled={data.busy}
            onClick={data.refresh}
          >
            {data.busy ? t("同步中…", "Syncing…") : t("刷新", "Refresh")}
          </button>
        </header>
        <div
          className="context"
          aria-label={t("运行上下文", "Execution context")}
        >
          <span>
            <small>{t("工作区", "Workspace")}</small>
            <strong>
              {focus
                ? t("约定正文待解锁", "Agreement body locked")
                : t("未选择 OKR", "No OKR selected")}
            </strong>
          </span>
          <span>
            <small>{t("执行主机", "Execution Host")}</small>
            <strong>
              {short(contextHost?.host_address)} ·{" "}
              {t("在线状态未知", "Connectivity unknown")}
            </strong>
          </span>
          <span>
            <small>{t("Agent 与模型", "Agent & model")}</small>
            <strong>
              {contextAgent?.instance_id ?? "—"} ·{" "}
              {contextAgent?.runtime ?? "—"}
            </strong>
            <small>{t("模型配置待读取", "Model configuration not read")}</small>
          </span>
          <span>
            <small>{t("本设备权限", "This device's authority")}</small>
            <strong>
              {t(
                "未核验 · 公开只读入口",
                "Unverified · public read-only entry",
              )}
            </strong>
          </span>
          <span className="context-snapshot">
            {snapshot
              ? `${t("快照", "Snapshot")} ${new Date(snapshot.loadedAtMs).toLocaleTimeString()}`
              : t("尚无快照", "No snapshot")}
          </span>
        </div>
        {data.error && (
          <div role="alert" className="banner warn">
            <strong>{t("同步失败", "Sync failed")}</strong>
            <p>
              {snapshot
                ? t(
                    "保留上次已确认快照；当前状态未知。请检查连接并重新查询。",
                    "The last confirmed snapshot is retained; current state is unknown. Check the connection and query again.",
                  )
                : t(
                    "尚未获得当前组织的可验证快照；数据未知。请检查连接并重新查询。",
                    "No verified snapshot is available for this organization; data is unknown. Check the connection and query again.",
                  )}
            </p>
          </div>
        )}
        {!data.identity && !data.error && (
          <div className="panel" role="status">
            {t(
              "正在核对网络、身份记录和组织目录…",
              "Checking network, Human record and organization directory…",
            )}
          </div>
        )}
        {data.identity && !data.organizationId && (
          <div className="panel">
            {t(
              "该 Human 暂无链上组织。创建组织需接通安全设备签名。",
              "This Human has no on-chain organizations. Organization creation needs secure device signing.",
            )}
          </div>
        )}
        {data.organizationId && !snapshot && !data.error && (
          <div className="panel" role="status">
            {t(
              "正在读取当前组织；不会显示其他组织的快照。",
              "Reading this organization; another organization’s snapshot is never shown.",
            )}
          </div>
        )}
        {page === "workbench" && snapshot && (
          <>
            <Decisions
              snapshot={snapshot}
              now={now}
              reachable={data.reachable}
              t={t}
              open={(id) => goOkr(id, "okrs")}
            />
            <div className="section-heading">
              <h2>{t("进行中的目标", "Goals in progress")}</h2>
              <button onClick={() => setPage("okrs")}>
                {t("查看全部 OKR", "View all OKRs")} →
              </button>
            </div>
            <div className="goal-strip">
              {okrs
                ?.filter((row) => row.okr.state === 1)
                .map((row) => (
                  <button
                    key={row.okr.id}
                    aria-pressed={focus?.okr.id === row.okr.id}
                    onClick={() => setFocusId(row.okr.id)}
                  >
                    <strong>{row.okr.logical_id}</strong>
                    <small>
                      {t("已验证 KR", "Verified KRs")}{" "}
                      {
                        row.okr.metrics.filter((metric) => metric.verified)
                          .length
                      }
                      /{row.okr.metrics.length}
                    </small>
                  </button>
                ))}
            </div>
            <div className="section-heading">
              <div>
                <h2>{t("运行导航", "Run navigation")}</h2>
                <p>
                  {t(
                    "已验证位置、实测进度与执行状态分别展示",
                    "Verified position, measured progress and execution state are separate",
                  )}
                </p>
              </div>
              <select
                aria-label={t("关注的 OKR", "Focused OKR")}
                value={focus?.okr.id ?? ""}
                onChange={(e) => setFocusId(e.target.value)}
              >
                {okrs?.map((row) => (
                  <option key={row.okr.id} value={row.okr.id}>
                    {row.okr.logical_id}
                  </option>
                ))}
              </select>
            </div>
            {!okrs ? (
              <ReadFailure t={t} />
            ) : !focus ? (
              <Empty t={t} />
            ) : (
              nav && (
                <>
                  <div
                    className={`banner ${["unknown", "permission", "expired", "budget", "failed"].includes(nav.condition) ? "warn" : ""}`}
                  >
                    <div>
                      <strong>{t(...statusLabels[nav.condition])}</strong>
                      <p>
                        {reasons[nav.reason]
                          ? t(...reasons[nav.reason])
                          : t(
                              "当前事实不足，等待补充有效链上记录。",
                              "Current facts are insufficient; await valid chain records.",
                            )}
                      </p>
                    </div>
                    <button onClick={() => goOkr(focus.okr.id, "okrs")}>
                      {t("查看 OKR", "View OKR")} →
                    </button>
                  </div>
                  <MapView
                    focus={focus}
                    nav={nav}
                    t={t}
                    onDetails={() => goOkr(focus.okr.id, "okrs")}
                  />
                  <div className="summary-grid">
                    <div className="panel">
                      <span className="eyebrow">
                        {t("约定与边界", "Agreement & boundaries")}
                      </span>
                      <h3>
                        {t("约定版本", "Agreement version")}{" "}
                        {focus.okr.agreement_version}
                      </h3>
                      <p>
                        {nav.boundary === "valid"
                          ? t(
                              "成员与实例绑定有效；工具执行端仍逐次校验动作边界。",
                              "Membership/instance bindings are valid; the executor still checks each action.",
                            )
                          : nav.boundary === "invalid"
                            ? t(
                                "资格或期限不满足当前约定",
                                "Authority or expiry does not satisfy the agreement",
                              )
                            : t(
                                "缺少完整资格事实",
                                "Complete authority facts are missing",
                              )}
                      </p>
                      <small>
                        {t(
                          "动作偏航：缺少完整动作轨迹，尚未确定",
                          "Action drift: complete action traces unavailable; undetermined",
                        )}
                      </small>
                    </div>
                    <BudgetPanel focus={focus} t={t} />
                    <div className="panel">
                      <span className="eyebrow">
                        {t("最后执行", "Last execution")}
                      </span>
                      <h3>
                        {nav.latest
                          ? `Run ${short(nav.latest.run.id)}`
                          : t("无当前 Run", "No current Run")}
                      </h3>
                      <p>
                        {nav.latest
                          ? `${t("检查点游标", "Checkpoint cursor")} ${nav.latest.run.cursor}`
                          : t(
                              "没有执行记录不代表正常推进",
                              "No execution record is not evidence of progress",
                            )}
                      </p>
                      <small>
                        {t(
                          "Host 当前在线状态未知",
                          "Current Host connectivity is unknown",
                        )}
                      </small>
                    </div>
                  </div>
                  <div className="panel muted-panel">
                    <strong>
                      {t("沟通与介入", "Communication & intervention")}
                    </strong>
                    <p>
                      {t(
                        "当前客户端尚未接通签名身份与消息投递。暂停、调整约定、审批和联系 Agent 在接线完成后启用。",
                        "Secure identity and message delivery are not connected yet. Pause, agreement changes, approvals and Agent communication will be enabled when integrated.",
                      )}
                    </p>
                  </div>
                </>
              )
            )}
          </>
        )}
        {page === "okrs" && snapshot && (
          <>
            {detailId && okrs?.find((row) => row.okr.id === detailId) ? (
              <OkrDetails
                focus={okrs.find((row) => row.okr.id === detailId)!}
                now={now}
                t={t}
                back={() => setDetailId(null)}
                workbench={() => goOkr(detailId, "workbench")}
              />
            ) : (
              <OkrList
                okrs={okrs ?? null}
                t={t}
                open={(id) => goOkr(id, "okrs")}
                filter={okrFilter}
                setFilter={setOkrFilter}
              />
            )}
          </>
        )}
        {page === "hosts" && snapshot && (
          <HostList
            snapshot={snapshot}
            now={now}
            t={t}
            reachable={data.reachable}
          />
        )}
        {page === "agents" && snapshot && (
          <>
            <h2>{t("受管理实例", "Managed instances")}</h2>
            <p className="muted">
              {t(
                "链上纳管记录与当前运行观测分开；控制标签不能代替适配器核验。",
                "Managed records and live observations are separate. A control label does not replace adapter verification.",
              )}
            </p>
            {!snapshot.agents.value ? (
              <ReadFailure t={t} />
            ) : !snapshot.agents.value.length ? (
              <Empty t={t} />
            ) : (
              <div className="card-grid">
                {snapshot.agents.value.map((agent) => (
                  <div className="panel" key={agent.id}>
                    <span className="badge">
                      {agent.revoked
                        ? t("已撤销", "Revoked")
                        : t("已登记", "Registered")}
                    </span>
                    <h3>{agent.instance_id}</h3>
                    <p>{agent.runtime}</p>
                    <code>{short(agent.host_address)}</code>
                    <p>
                      {agent.control_confirmed
                        ? t(
                            "管理设备已确认控制标签；实际能力尚需适配器核验",
                            "Management device confirmed a control label; adapter capability still needs verification",
                          )
                        : t("仅观察登记", "Observation registration only")}
                    </p>
                    <small>
                      {t(
                        "实例状态未知 · 无已验证消息投递能力",
                        "Instance status unknown · no verified messaging capability",
                      )}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {page === "identity" && data.identity && (
          <>
            <Suspense
              fallback={
                <p>{t("加载设备核验…", "Loading device verification…")}</p>
              }
            >
              <DeviceAccess
                key={JSON.stringify([
                  profile,
                  data.identity.human.generation,
                  data.identity.grants.value?.map((grant) => [
                    grant.id,
                    grant.version,
                    grant.revoked,
                  ]),
                ])}
                profile={{
                  ...profile,
                  chainIdentifier: data.identity.chainIdentifier,
                }}
                grants={data.identity.grants.value}
                t={t}
              />
            </Suspense>
            <IdentityView identity={data.identity} wallMs={wallMs} t={t} />
          </>
        )}
        {page === "orgs" && data.identity && (
          <OrganizationViews
            organizations={data.identity.organizations}
            current={data.organizationId}
            select={selectOrganization}
            t={t}
          />
        )}
        {page === "memory" && snapshot && (
          <>
            <Suspense
              fallback={
                <p>{t("加载加密记录…", "Loading encrypted records…")}</p>
              }
            >
              <PrivateRecordView
                key={JSON.stringify([
                  profile,
                  snapshot.organization.objectId,
                  data.identity?.human.generation,
                ])}
                profile={{
                  ...profile,
                  chainIdentifier:
                    data.identity?.chainIdentifier ?? profile.chainIdentifier,
                }}
                organizationId={snapshot.organization.objectId}
                grants={data.identity?.grants.value}
                t={t}
              />
            </Suspense>
            <h2>{t("已验收成果", "Accepted results")}</h2>
            <p className="muted">
              {t(
                "下方展示有独立人工验收记录的链上成果；加密正文在上方按当前授权独立读取，不能代替验收。",
                "Results below have a separate human acceptance record. Bodies above are read under current authority and do not establish acceptance.",
              )}
            </p>
            {!okrs ? (
              <ReadFailure t={t} />
            ) : (
              <>
                {okrs
                  .filter(
                    (row) =>
                      row.okr.state === 3 &&
                      row.okr.acceptance_record &&
                      row.okr.accepted_by_human,
                  )
                  .map((row) => (
                    <div className="panel" key={row.okr.id}>
                      <h3>{row.okr.logical_id}</h3>
                      <TrustLadder level="accepted" t={t} />
                      <p>
                        {t("验收记录", "Acceptance record")}:{" "}
                        <code className="long-id">
                          {row.okr.acceptance_record}
                        </code>
                      </p>
                      <button onClick={() => goOkr(row.okr.id, "okrs")}>
                        {t("查看成果与证据", "View result and evidence")} →
                      </button>
                    </div>
                  ))}
                {!okrs.some(
                  (row) =>
                    row.okr.state === 3 &&
                    row.okr.acceptance_record &&
                    row.okr.accepted_by_human,
                ) && (
                  <div className="panel">
                    {t(
                      "已读取的 OKR 中暂无已验收成果。",
                      "No accepted results in the OKRs read.",
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
        {page === "governance" && (
          <>
            {snapshot && (
              <Decisions
                snapshot={snapshot}
                now={now}
                reachable={data.reachable}
                t={t}
                open={(id) => goOkr(id, "okrs")}
              />
            )}
            <div className="panel">
              <h2>{t("权限与审批", "Authority & approvals")}</h2>
              <p>
                {t(
                  "可用操作 = 组织角色 × 设备授权 × 数据访问。完整审批请求、角色与数据密钥尚未接入，不将授权记录直接视作本设备权限。",
                  "Available actions = organization role × device grant × data access. Full approval requests, roles and data keys are not connected; a grant record alone is not this device's authority.",
                )}
              </p>
              <button onClick={() => setPage("identity")}>
                {t("查看身份与设备授权", "View identity and device grants")} →
              </button>
            </div>
          </>
        )}
        {page === "network" && (
          <div className="panel">
            <NavIcon name="globe" />
            <h2>{t("开放网络", "Open network")}</h2>
            <p>
              {t(
                "通过分形、自相似的 Agent 组织，走向一个没有人能独占的 ASI。",
                "Through fractal, self-similar agent organizations, toward an ASI that no one owns.",
              )}
            </p>
            <p className="muted">
              {t(
                "公开组织目录与联邦协作属于后续阶段，当前没有发起网络查询。",
                "The public organization directory and federation collaboration are future stages. No network directory query has been made.",
              )}
            </p>
            <button onClick={() => setPage("orgs")}>
              {t(
                "查看我的组织与成长路径",
                "View my organizations and growth path",
              )}{" "}
              →
            </button>
          </div>
        )}
        {page === "settings" && (
          <div className="panel">
            <h2>{t("连接与数据来源", "Connection & source")}</h2>
            <dl>
              <dt>{t("网络", "Network")}</dt>
              <dd>{profile.network}</dd>
              <dt>RPC</dt>
              <dd className="long-id">{profile.rpcUrl}</dd>
              <dt>{t("已核对链标识", "Verified chain ID")}</dt>
              <dd className="long-id">
                {data.identity?.chainIdentifier ?? "—"}
              </dd>
              <dt>{t("合约包", "Package")}</dt>
              <dd className="long-id">{profile.packageId}</dd>
            </dl>
            <p>
              {t(
                "连接缓存仅包含公开端点与对象 ID。清除后重新连接会从链上读取，不会删除或修改组织。",
                "The connection cache contains public endpoints and object IDs. Clearing and reconnecting reads Sui again; it does not modify the organization.",
              )}
            </p>
            <button onClick={disconnect}>
              {t(
                "清除连接缓存并返回欢迎页",
                "Clear connection cache and return to welcome",
              )}
            </button>
            <h3>{t("公开连接资料", "Public connection profile")}</h3>
            <textarea
              readOnly
              aria-label={t("公开连接资料", "Public connection profile")}
              value={JSON.stringify(
                {
                  ...profile,
                  chainIdentifier:
                    data.identity?.chainIdentifier ?? profile.chainIdentifier,
                },
                null,
                2,
              )}
            />
          </div>
        )}
        <footer>
          {t(
            "持久产品状态以 Sui 为准 · Alpha 尚未完成 v0.2.0 验收",
            "Persistent product state lives on Sui · Alpha is not v0.2.0 acceptance",
          )}
        </footer>
      </div>
      <nav
        className="mobile-nav"
        aria-label={t("移动导航", "Mobile navigation")}
      >
        {(["workbench", "okrs", "hosts", "orgs", "settings"] as Page[]).map(
          (id) => (
            <button
              aria-current={page === id ? "page" : undefined}
              key={id}
              onClick={() => {
                setPage(id);
                setDetailId(null);
              }}
            >
              <NavIcon name={pageIcons[id]} />
              {id === "hosts"
                ? t("主机", "Hosts")
                : id === "settings"
                  ? t("设置", "Settings")
                  : t(...labels[id])}
            </button>
          ),
        )}
      </nav>
      <dialog
        ref={allDialog}
        className="features-sheet"
        aria-label={t("全部功能", "All features")}
        onCancel={() => setAllFeatures(false)}
        onClose={() => setAllFeatures(false)}
      >
        <div className="section-heading">
          <h2>{t("全部功能", "All features")}</h2>
          <button autoFocus onClick={() => setAllFeatures(false)}>
            {t("关闭", "Close")}
          </button>
        </div>
        {navGroups.map((group) => (
          <nav
            className="nav-group"
            key={group.label[1]}
            aria-label={t(...group.label)}
          >
            <span className="nav-group-label">{t(...group.label)}</span>
            {group.pages.map(navButton)}
          </nav>
        ))}
      </dialog>
    </div>
  );
}

function ReadFailure({ t }: { t: Translate }) {
  return (
    <div className="panel warn" role="status">
      {t(
        "该部分读取失败，当前数据未知；刷新重新查询。",
        "This section could not be read. Data is unknown; refresh to query again.",
      )}
    </div>
  );
}
function Empty({ t }: { t: Translate }) {
  return (
    <div className="panel">
      {t(
        "该组织暂无记录。创建与接入功能待签名身份接通后启用。",
        "No records in this organization. Creation and admission will be enabled after secure identity integration.",
      )}
    </div>
  );
}
function BudgetPanel({ focus, t }: { focus: OkrSnapshot; t: Translate }) {
  const budget = focus.budget.value;
  return (
    <div className="panel">
      <span className="eyebrow">
        {t("预算 · 含在途预留", "Budget · includes reservations")}
      </span>
      {budget ? (
        <>
          <h3>
            {budget.spent.toString()} + {budget.reserved.toString()} /{" "}
            {focus.okr.budget_limit}
          </h3>
          <p>
            {t("已支出 + 在途 / 上限", "Spent + reserved / limit")} ·{" "}
            {budget.asset || "—"}
          </p>
          <progress
            aria-label={t("预算使用与预留", "Spent and reserved budget")}
            max={1}
            value={
              BigInt(focus.okr.budget_limit) === 0n
                ? 0
                : Math.min(
                    1,
                    Number(
                      ((budget.spent + budget.reserved) * 1000000n) /
                        BigInt(focus.okr.budget_limit),
                    ) / 1000000,
                  )
            }
          />
        </>
      ) : (
        <p>{t("预算未知，不显示为零", "Budget unknown; not shown as zero")}</p>
      )}
    </div>
  );
}
function MapView({
  focus,
  nav,
  t,
  onDetails,
}: {
  focus: OkrSnapshot;
  nav: Navigation;
  t: Translate;
  onDetails: () => void;
}) {
  const { okr } = focus;
  const height = 360;
  const start = { x: 70, y: 250 };
  const end = { x: 935, y: 240 };
  const krPoints = okr.metrics.map((_, i) => {
    return {
      x:
        okr.metrics.length === 1
          ? 480
          : 200 + (540 * i) / (okr.metrics.length - 1),
      y: i % 2 === 0 ? 190 : 135,
    };
  });
  const all = [start, ...krPoints, end],
    points = (items: typeof all) =>
      items.map((point) => `${point.x},${point.y}`).join(" ");
  const acceptedCheckpoint =
    okr.state === 3 &&
    Boolean(okr.acceptance_record) &&
    Boolean(okr.accepted_by_human);
  const verifiedRoute = all.slice(
    0,
    acceptedCheckpoint ? all.length : nav.verifiedCheckpoints + 1,
  );
  const index = Math.min(nav.currentKr, okr.metrics.length - 1),
    previous = all[index],
    target = krPoints[index];
  const fraction = nav.metricProgress[index] ?? 0;
  const measured = {
    x: previous.x + (target.x - previous.x) * fraction,
    y: previous.y + (target.y - previous.y) * fraction,
  };
  const allVerified = nav.verifiedCheckpoints === okr.metrics.length;
  const hasMeasurement = !allVerified && nav.metricProgress[index] !== null;
  const position = acceptedCheckpoint
    ? end
    : allVerified
      ? krPoints[krPoints.length - 1]
      : measured;
  const positionLabel = acceptedCheckpoint
    ? t("已人工验收位置", "Human-accepted position")
    : nav.condition === "unknown"
      ? t("最后确认位置", "Last known position")
      : hasMeasurement
        ? t("当前实测位置", "Measured position")
        : t("最后验证位置", "Last verified position");
  return (
    <section
      className="map panel"
      aria-label={t("OKR 运行导航地图", "OKR navigation map")}
    >
      <div className="map-caption">
        <strong>{okr.logical_id}</strong>
        <span>
          {t("已验证", "Verified")} {nav.verifiedCheckpoints}/
          {okr.metrics.length} ·{" "}
          {nav.progress === null
            ? t("实测进度未知", "Measured progress unknown")
            : `${t("实测", "Measured")} ${Math.round(nav.progress * 100)}%`}
        </span>
      </div>
      <ol className="route-strip" aria-label={t("OKR 路线", "OKR route")}>
        <li>{t("出发", "Start")}</li>
        {okr.metrics.map((metric, i) => (
          <li key={i}>
            <button onClick={onDetails}>
              <strong>KR{i + 1}</strong>
              <span>
                {metric.verified
                  ? t("已验证", "Verified")
                  : nav.metricProgress[i] === null
                    ? t("当前实测未知", "Current measurement unknown")
                    : `${Math.round(nav.metricProgress[i]! * 100)}%`}
              </span>
            </button>
            <TrustLadder
              {...{
                level: acceptedCheckpoint
                  ? "accepted"
                  : metric.verified
                    ? "verified"
                    : nav.metricProgress[i] !== null
                      ? "measured"
                      : null,
                stale:
                  metric.current !== null && nav.metricProgress[i] === null,
              }}
              t={t}
            />
          </li>
        ))}
        <li className={acceptedCheckpoint ? "accepted" : ""}>
          {t("人工验收终点", "Human acceptance")} ·{" "}
          {acceptedCheckpoint
            ? t("已验收", "Accepted")
            : t("尚未验收", "Not accepted")}
        </li>
      </ol>
      <svg
        viewBox={`0 0 1040 ${height}`}
        role="img"
        aria-label={t(
          "绿色为已验证路线，蓝色为实测位置，虚线为计划",
          "Green is verified route, blue is measured position, dashed is planned route",
        )}
      >
        <defs>
          <pattern
            id="grid"
            width="36"
            height="36"
            patternUnits="userSpaceOnUse"
          >
            <path d="M36 0H0V36" className="map-grid" fill="none" />
          </pattern>
        </defs>
        <rect width={1040} height={height} fill="url(#grid)" />
        <path
          d="M60 80Q180 30 350 55T960 75M30 310Q200 280 430 320T1000 300"
          className="contour"
          fill="none"
        />
        <polyline points={points(all)} className="road" />
        <polyline points={points(all)} className="planned-road" />
        {verifiedRoute.length > 1 && (
          <polyline points={points(verifiedRoute)} className="verified-road" />
        )}
        {nav.condition !== "achieved" &&
          nav.metricProgress[index] !== null &&
          nav.verifiedCheckpoints < okr.metrics.length && (
            <polyline
              points={points([previous, measured])}
              className="measured-road"
            />
          )}
        <circle cx={start.x} cy={start.y} r="7" className="start-point" />
        <text x={start.x} y={start.y + 35} textAnchor="middle">
          {t("出发", "Start")}
        </text>
        {krPoints.map((point, i) => (
          <g
            key={i}
            role="button"
            tabIndex={0}
            aria-label={`${t("查看", "View")} KR${i + 1}`}
            onClick={onDetails}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onDetails();
              }
            }}
          >
            <circle
              cx={point.x}
              cy={point.y}
              r="23"
              className={
                okr.metrics[i].verified ? "verified-node" : "planned-node"
              }
            />
            <text
              x={point.x}
              y={point.y + 6}
              textAnchor="middle"
              className="node-text"
            >
              {okr.metrics[i].verified ? "✓" : i + 1}
            </text>
            <text x={point.x} y={point.y + 52} textAnchor="middle">
              KR{i + 1} ·{" "}
              {okr.metrics[i].verified
                ? t("已验证", "Verified")
                : nav.metricProgress[i] === 1
                  ? t("待验证", "Verify next")
                  : nav.metricProgress[i] === null
                    ? t("未获新鲜观测", "No fresh sample")
                    : `${Math.round(nav.metricProgress[i]! * 100)}%`}
            </text>
          </g>
        ))}
        <rect
          x={end.x - 20}
          y={end.y - 20}
          width="40"
          height="40"
          rx="12"
          className={
            nav.condition === "achieved" ? "accepted-node" : "planned-node"
          }
        />
        <text x={end.x} y={end.y + 6} textAnchor="middle" className="node-text">
          {nav.condition === "achieved" ? "✓" : "⚑"}
        </text>
        <text x={end.x} y={end.y + 50} textAnchor="middle">
          {t("人工验收终点", "Human acceptance")}
        </text>
        <circle
          cx={position.x}
          cy={position.y}
          r="35"
          className="position-ring"
        />
        <circle
          cx={position.x}
          cy={position.y}
          r="12"
          className={
            acceptedCheckpoint
              ? "accepted-position"
              : allVerified
                ? "verified-position"
                : nav.condition === "unknown" || !hasMeasurement
                  ? "unknown-position"
                  : "current-position"
          }
        />
        <text
          x={position.x}
          y={position.y - 45}
          textAnchor="middle"
          className="position-label"
        >
          {positionLabel}
        </text>
      </svg>
      <div className="legend">
        <span>● {t("已验证", "Verified")}</span>
        <span>● {t("实测，非验收", "Measured, not accepted")}</span>
        <span>◆ {t("已验收", "Accepted")}</span>
        <span>┄ {t("计划路线", "Planned route")}</span>
      </div>
      <p className="muted">
        {t(
          "结果空间示意，不代表实际文件路径、剩余时间或成功概率。缺少观测时不推断偏航或死胡同。",
          "Result-space schematic, not physical file paths, time remaining or success probability. Missing observations do not establish drift or a dead end.",
        )}
      </p>
    </section>
  );
}
function OkrList({
  okrs,
  t,
  open,
  filter,
  setFilter,
}: {
  okrs: OkrSnapshot[] | null;
  t: Translate;
  open: (id: string) => void;
  filter: string;
  setFilter: (value: string) => void;
}) {
  const lifecycle: Array<[string, string]> = [
    ["草稿", "Draft"],
    ["运行中", "Active"],
    ["暂停", "Paused"],
    ["达成", "Achieved"],
    ["归档", "Archived"],
  ];
  const filtered = okrs?.filter(
    (row) => filter === "all" || String(row.okr.state) === filter,
  );
  return (
    <>
      <div className="section-heading">
        <h2>{t("目标列表", "Objectives")}</h2>
        <select
          aria-label={t("OKR 生命周期筛选", "OKR lifecycle filter")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">{t("全部", "All")}</option>
          {lifecycle.map((label, i) => (
            <option key={i} value={String(i)}>
              {t(...label)}
            </option>
          ))}
        </select>
      </div>
      {!okrs ? (
        <ReadFailure t={t} />
      ) : !okrs.length ? (
        <Empty t={t} />
      ) : !filtered?.length ? (
        <div className="panel">
          {t("没有符合筛选条件的 OKR。", "No OKRs match this filter.")}
        </div>
      ) : (
        <div className="okr-list">
          {filtered.map(({ okr }) => (
            <button
              className="panel okr-row"
              key={okr.id}
              onClick={() => open(okr.id)}
            >
              <span>
                <strong>{okr.logical_id}</strong>
                <small>
                  {t("KR 已验证", "KRs verified")}{" "}
                  {okr.metrics.filter((metric) => metric.verified).length}/
                  {okr.metrics.length} · {t("约定", "Agreement")} v
                  {okr.agreement_version}
                </small>
              </span>
              <span className="badge">{t(...lifecycle[okr.state])}</span>
              <span>P{okr.priority}</span>
              <span>→</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
function OkrDetails({
  focus,
  now,
  t,
  back,
  workbench,
}: {
  focus: OkrSnapshot;
  now: bigint;
  t: Translate;
  back: () => void;
  workbench: () => void;
}) {
  const { okr } = focus;
  return (
    <>
      <div className="section-heading">
        <button onClick={back}>← {t("返回列表", "Back to list")}</button>
        <button className="primary" onClick={workbench}>
          {t("在工作台查看运行", "View in workbench")} →
        </button>
      </div>
      <div className="panel">
        <h2>{okr.logical_id}</h2>
        <code className="long-id">{okr.id}</code>
        <p>
          {t(
            "目标标题、成功标准、单位和执行约定正文已加密；需授权设备解锁后查看，不能用公开逻辑 ID 代替完整目标。",
            "Title, success criteria, units and agreement bodies are encrypted. An authorized device must unlock them; the public logical ID is not the complete objective.",
          )}
        </p>
        <p>
          {t("规格记录", "Spec record")}: <code>{short(okr.spec_record)}</code>{" "}
          · {t("约定版本", "Agreement version")} {okr.agreement_version}
        </p>
      </div>
      <h2>{t("关键结果", "Key results")}</h2>
      <div className="card-grid">
        {okr.metrics.map((metric, i) => {
          const fresh =
            metric.current !== null &&
            BigInt(metric.sampled_at_ms) <= now &&
            now - BigInt(metric.sampled_at_ms) <= BigInt(metric.max_age_ms);
          return (
            <div className="panel" key={i}>
              <span className="badge">
                {metric.verified
                  ? t("已验证", "Verified")
                  : t("未验证", "Unverified")}
              </span>
              <h3>KR{i + 1}</h3>
              <TrustLadder {...trustState(okr, i, now)} t={t} />
              <dl>
                <dt>
                  {t("基线 / 实测 / 目标", "Baseline / measured / target")}
                </dt>
                <dd>
                  {metric.baseline} / {metric.current ?? "—"} / {metric.target}
                </dd>
                <dt>{t("观测", "Observation")}</dt>
                <dd>
                  {fresh
                    ? t("新鲜", "Fresh")
                    : t("未知或过期", "Unknown or stale")}
                </dd>
                <dt>{t("Run", "Run")}</dt>
                <dd>
                  <code>{short(metric.run_id)}</code>
                </dd>
                <dt>{t("证据", "Evidence")}</dt>
                <dd>
                  <code>{short(metric.evidence_id)}</code>
                </dd>
              </dl>
              <small>
                {t(
                  "原始整数；单位与精度需解密规格",
                  "Raw integers; decrypt the spec for units and scale",
                )}
              </small>
            </div>
          );
        })}
      </div>
      <BudgetPanel focus={focus} t={t} />
      <h2>{t("观测历史", "Observation history")}</h2>
      {!focus.observations.value ? (
        <ReadFailure t={t} />
      ) : !focus.observations.value.length ? (
        <p>{t("暂无已确认观测", "No confirmed observations")}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("约定", "Agreement")}</th>
                <th>KR</th>
                <th>{t("实测值", "Measured")}</th>
                <th>{t("采样", "Sampled")}</th>
                <th>Run / {t("证据", "Evidence")}</th>
              </tr>
            </thead>
            <tbody>
              {focus.observations.value.map((row) => (
                <tr key={row.id}>
                  <td>
                    v{row.agreement_version}
                    {row.agreement_version !== okr.agreement_version &&
                      ` · ${t("历史", "Historical")}`}
                  </td>
                  <td>{Number(row.kr_index) + 1}</td>
                  <td>{row.current}</td>
                  <td>
                    {new Date(Number(row.sampled_at_ms)).toLocaleString()}
                  </td>
                  <td>
                    <code title={row.run_id}>{short(row.run_id)}</code>
                    <br />
                    <code title={row.evidence_id}>
                      {short(row.evidence_id)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>{t("执行与验收来源", "Execution & acceptance provenance")}</h2>
      {!focus.executions.value ? (
        <ReadFailure t={t} />
      ) : (
        focus.executions.value.map((row) => (
          <div className="panel" key={row.run.id}>
            <code className="long-id">{row.run.id}</code>
            <p>
              {t("约定", "Agreement")} v{row.contract.agreement_version} · KR
              {Number(row.contract.kr_index) + 1} ·{" "}
              {t(...runLabels[row.run.state])} ·{" "}
              {t("实际支出 / 初始预留", "Actual spend / initial reservation")}{" "}
              {row.claim.spent} / {row.claim.reserved}
            </p>
            <small>
              {row.claim.settled
                ? t("已结算", "Settled")
                : t("预留未结算", "Reservation unsettled")}
            </small>
          </div>
        ))
      )}
      <div className="panel">
        <p>
          {t("最终验收记录", "Final acceptance record")}:{" "}
          <code className="long-id">
            {okr.acceptance_record ?? t("尚无", "None")}
          </code>
        </p>
        <p>
          {t("验收者 Human", "Accepting Human")}:{" "}
          <code>{short(okr.accepted_by_human)}</code>
        </p>
      </div>
    </>
  );
}

function HostList({
  snapshot,
  now,
  t,
  reachable,
}: {
  snapshot: OrganizationSnapshot;
  now: bigint;
  t: Translate;
  reachable: boolean;
}) {
  const directory = snapshot.hosts.value;
  const status: Record<"valid" | "revoked" | "expired", [string, string]> = {
    valid: ["有效", "Valid"],
    revoked: ["已撤销", "Revoked"],
    expired: ["已到期", "Expired"],
  };
  return (
    <>
      <h2>{t("组织主机", "Organization Hosts")}</h2>
      <p className="muted">
        {t(
          "按稳定 Host 地址展示，当前成员资格由链上目录确定；重新接入保留历史，不重复显示为新主机。在线和资源数据仍需签名心跳。",
          "Hosts use stable addresses and the current chain membership directory. Rejoining retains history instead of creating a duplicate Host. Connectivity and resources still need signed heartbeats.",
        )}
      </p>
      {!directory ? (
        <ReadFailure t={t} />
      ) : !directory.length ? (
        <Empty t={t} />
      ) : (
        <div className="card-grid">
          {directory.map((row) => {
            const member = row.current.value;
            return (
              <div className="panel" key={row.address}>
                <span className="badge">
                  {t("在线状态未知", "Connectivity unknown")}
                </span>
                <h3>{member?.name ?? `Host ${short(row.address)}`}</h3>
                <code>{short(row.address)}</code>
                {member ? (
                  <dl>
                    <dt>
                      {reachable
                        ? t("成员资格", "Membership")
                        : t("快照成员资格", "Snapshot membership")}
                    </dt>
                    <dd>{t(...status[memberStatus(member, now)])}</dd>
                    <dt>{t("当前成员记录", "Current membership")}</dt>
                    <dd>
                      <code title={member.id}>{short(member.id)}</code>
                    </dd>
                    <dt>{t("到期", "Expires")}</dt>
                    <dd>
                      {new Date(Number(member.expires_at_ms)).toLocaleString()}
                    </dd>
                  </dl>
                ) : (
                  <p className="warn">
                    {t(
                      "当前成员目录读取失败；不会以旧记录推断新资格。",
                      "Current membership could not be read; an older record does not establish new authority.",
                    )}
                  </p>
                )}
                <details>
                  <summary>
                    {t("成员资格历史", "Membership history")} ·{" "}
                    {row.history.length}
                  </summary>
                  {row.history.map((old) => (
                    <p key={old.id}>
                      <code>{short(old.id)}</code> ·{" "}
                      {old.id === member?.id
                        ? t("当前", "Current")
                        : t("历史", "Historical")}{" "}
                      · {t(...status[memberStatus(old, now)])}
                    </p>
                  ))}
                </details>
                <p className="muted">
                  {t(
                    "资格有效不代表此刻在线，也不替代具体执行授权。",
                    "Valid membership does not prove current connectivity or authorize a specific action.",
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function IdentityView({
  identity,
  wallMs,
  t,
}: {
  identity: Awaited<ReturnType<import("./chain").ChainReadSession["human"]>>;
  wallMs: number;
  t: Translate;
}) {
  const now = clockNow(identity, wallMs);
  return (
    <>
      <div className="panel">
        <span className="eyebrow">Human</span>
        <h2>{t("稳定身份记录", "Stable Human record")}</h2>
        <code className="long-id">{identity.human.id}</code>
        <p>
          {t(
            "公开标识用于定位记录，不能证明你持有该身份。设备核验仅证明选定授权，当前界面尚未开启正文解密与管理操作。",
            "The public ID locates a record; it is not proof of possession. Device verification proves the selected grant. Private-body decryption and management actions are not enabled in this view yet.",
          )}
        </p>
        <dl>
          <dt>{t("授权代次", "Generation")}</dt>
          <dd>{identity.human.generation}</dd>
          <dt>{t("恢复版本", "Recovery version")}</dt>
          <dd>{identity.human.recovery_version}</dd>
          <dt>{t("组织数", "Organizations")}</dt>
          <dd>{identity.organizations.length}</dd>
          <dt>{t("身份快照时间", "Identity snapshot time")}</dt>
          <dd>{new Date(identity.loadedAtMs).toLocaleString()}</dd>
        </dl>
        <p className="muted">
          {t(
            "授权按最近一次链上快照展示，并随同步更新；实际操作仍需当次链上校验。",
            "Grants reflect the latest chain snapshot and refresh during synchronization. Each actual operation still needs a fresh chain check.",
          )}
        </p>
      </div>
      <h2>{t("链上登记设备", "Devices registered on chain")}</h2>
      {!identity.grants.value ? (
        <ReadFailure t={t} />
      ) : !identity.grants.value.length ? (
        <Empty t={t} />
      ) : (
        <div className="card-grid">
          {identity.grants.value.map((grant) => (
            <div className="panel" key={grant.id}>
              <code>{short(grant.device)}</code>
              <p>
                {grant.revoked ||
                grant.generation !== identity.human.generation ||
                BigInt(grant.expires_at_ms) <= now
                  ? t("已失效", "Invalid")
                  : t(
                      "快照中授权未失效；不构成本 App 登录凭证",
                      "Grant was valid in this snapshot; it does not sign this App in",
                    )}
              </p>
              <small>
                {t("版本", "Version")} {grant.version} ·{" "}
                {t("代次", "Generation")} {grant.generation}
              </small>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
