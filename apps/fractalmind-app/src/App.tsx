import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { normalizeProfile } from "./chain";
import Welcome from "./Welcome";
import {
  BrandMark,
  NavIcon,
  TrustLadder,
  Decisions,
  OrganizationViews,
} from "./V2Views";
import { decisionFacts, trustState } from "./v2-model";
import { agentName, hostName, initial } from "./display";
import {
  IDLE_CHOICES_MINUTES,
  useDeviceSession,
  type DeviceSession,
} from "./device-session";
import { useOkrTexts } from "./use-okr-texts";
import { deviceConnection } from "./native-device";
import { matchesTarget } from "./build-target";
import type { OkrText } from "./okr-text";
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
const CreateOkr = lazy(() => import("./CreateOkr"));
const PrivateRecordView = lazy(() => import("./PrivateRecordView"));
const DeviceAccess = lazy(() => import("./DeviceAccess"));
const PairingFlow = lazy(() => import("./PairingFlow"));
const HostAccess = lazy(() => import("./HostAccess"));
const HostObservations = lazy(() => import("./HostObservations"));
const LocalHostCard = lazy(() => import("./LocalHostCard"));
const AgentCheckpointView = lazy(() => import("./AgentCheckpointView"));
const HandoverFlow = lazy(() => import("./HandoverFlow"));
const OkrContinuation = lazy(() => import("./OkrContinuation"));
const OkrVerification = lazy(() => import("./OkrVerification"));
const DirectAgentConversation = lazy(() => import("./DirectAgentConversation"));
const DirectApprovalQueue = lazy(() => import("./DirectApprovalQueue"));
const OkrIntervention = lazy(() => import("./OkrIntervention"));
const OkrAutonomy = lazy(() => import("./OkrAutonomy"));
const OkrProjection = lazy(() => import("./OkrProjection"));
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
  governance: ["治理与审批", "Governance"],
  identity: ["我的身份", "My identity"],
  settings: ["组织设置", "Settings"],
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
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const discoverDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = discoverDialog.current;
    if (!dialog) return;
    if (discoverOpen && !dialog.open) dialog.showModal();
    else if (!discoverOpen && dialog.open) dialog.close();
  });
  // One-off Agent requests needing attention, reported by DirectApprovalQueue; null = unknown.
  const [directPending, setDirectPending] = useState<number | null>(null);
  const allDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (allFeatures) allDialog.current?.showModal();
    else allDialog.current?.close();
  }, [allFeatures]);
  const [wallMs, setWallMs] = useState(Date.now());
  const data = useChain(profile);
  // Device keys are unlocked once per sign-in and kept in native memory.
  const device = useDeviceSession();
  const okrTexts = useOkrTexts(
    device.session,
    profile,
    data.snapshot?.organization.objectId,
    data.snapshot?.okrs.value,
    data.identity?.grants.value,
  );
  const sessionAddress =
    device.session.state === "unlocked" ? device.session.device.address : null;
  const grants = data.identity?.grants.value;
  useEffect(() => {
    // A revoked device grant ends the session at once.
    if (
      sessionAddress &&
      grants?.some((g) => g.device === sessionAddress) &&
      !grants.some((g) => g.device === sessionAddress && !g.revoked)
    )
      void device.lock("revoked");
  }, [sessionAddress, grants, device.lock]);
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
      if (isTauri())
        void invoke("fm_app_appearance", {
          theme: document.documentElement.dataset.theme,
        }).catch(() => {
          /* Appearance is optional and never changes chain state. */
        });
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
  const themeLabel = {
    system: t("跟随系统", "System"),
    light: t("浅色", "Light"),
    dark: t("深色", "Dark"),
  }[prefs.theme];
  const nextTheme = { system: "light", light: "dark", dark: "system" } as const;
  // Prototype v2 top-bar tools: a language toggle and an appearance button.
  const appearance = (
    <>
      <button
        className="tb-btn lang"
        title={t("Switch to English", "切换到中文")}
        aria-label={t("切换语言", "Switch language")}
        onClick={() =>
          setPrefs({ ...prefs, language: prefs.language === "zh" ? "en" : "zh" })
        }
      >
        {prefs.language === "zh" ? "EN" : "中"}
      </button>
      <button
        className="tb-btn"
        title={`${t("外观", "Appearance")}：${themeLabel}`}
        aria-label={`${t("外观", "Appearance")}：${themeLabel}`}
        onClick={() => setPrefs({ ...prefs, theme: nextTheme[prefs.theme] })}
      >
        <NavIcon
          name={{ system: "monitor", light: "sun", dark: "moon" }[prefs.theme]}
        />
      </button>
    </>
  );
  const connect = (value: ConnectionProfile) => {
    void device.resync();
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
  // A native App only opens the organization views for the identity this
  // device was set up, paired or recovered for. Without device keys, or with
  // only a saved public connection (e.g. during setup), it shows the setup
  // flow; it never falls back to a read-only browser.
  const linked =
    !isTauri() ||
    (deviceConnection()?.humanId === profile?.humanId && matchesTarget(profile));
  if (!profile || device.session.state === "no_device" || !linked)
    return (
      <Welcome
        t={t}
        appearance={appearance}
        connect={connect}
        newDevice={isTauri()}
      />
    );
  // While locked nothing from the organization is rendered: unmounting the
  // shell also drops decrypted text held by open views and dialogs.
  if (
    device.session.state === "checking" ||
    device.session.state === "unlocking" ||
    device.session.state === "locked"
  )
    return <LockScreen session={device.session} unlock={device.unlock} t={t} />;
  const snapshot = data.snapshot;
  const hostAuthorityRevision = JSON.stringify([
    data.reachable,
    data.identity?.human.generation,
    data.identity?.grants.value?.map((g) => [
      g.id,
      g.version,
      g.revoked,
      g.generation,
      g.expires_at_ms,
    ]),
    snapshot?.bindings.value,
    snapshot?.hosts.value?.map((row) => [
      row.address,
      row.current.value?.id,
      row.current.value?.version,
      row.current.value?.revoked,
      row.current.value?.expires_at_ms,
      row.current.failure,
    ]),
  ]);
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
    setDirectPending(null);
    data.selectOrganization(id);
  };
  const contextHost = snapshot?.memberships.value?.find(
    (member) => member.id === focus?.okr.membership_id,
  );
  const contextAgent = snapshot?.agents.value?.find(
    (agent) => agent.id === focus?.okr.managed_agent,
  );
  const attention = snapshot ? decisionFacts(snapshot, now, data.reachable) : null;
  const attentionCount = attention?.items.length ?? 0;
  const decisionTotal = attentionCount + (directPending ?? 0);
  const decisionsClear =
    !!attention && !attention.unavailable && attentionCount === 0 && directPending === 0;
  const counts: Partial<Record<Page, number>> = {
    workbench: decisionTotal,
    governance: decisionTotal,
  };
  const organization = data.identity?.organizations.find(
    (org) => org.objectId === data.organizationId,
  );
  const organizationName =
    organization?.name ??
    (data.identity ? t("未选择组织", "No organization") : t("正在读取", "Loading"));
  const go = (id: Page) => {
    setPage(id);
    if (id !== "okrs") setDetailId(null);
    setAllFeatures(false);
    setDiscoverOpen(false);
  };
  const navButton = (id: Page) => (
    <button
      key={id}
      className="sb-link"
      aria-current={page === id ? "page" : undefined}
      onClick={() => go(id)}
    >
      <NavIcon name={pageIcons[id]} />
      <span>{t(...labels[id])}</span>
      {!!counts[id] && <span className="count">{counts[id]}</span>}
    </button>
  );
  const organizationSelect = (
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
  );
  const refreshButton = (
    <button
      className="tb-btn"
      aria-label={t("刷新链上数据", "Refresh chain data")}
      title={data.busy ? t("同步中…", "Syncing…") : t("刷新链上数据", "Refresh chain data")}
      aria-busy={data.busy}
      disabled={data.busy}
      onClick={data.refresh}
    >
      <NavIcon name="refresh" />
    </button>
  );
  const activeGoals = okrs?.filter((row) => row.okr.state === 1).length ?? 0;
  const snapshotText = snapshot
    ? `${t("快照", "Snapshot")} ${new Date(snapshot.loadedAtMs).toLocaleTimeString()}`
    : t("尚无快照", "No snapshot");
  const pageSummary: Partial<Record<Page, string>> = {
    workbench: `${snapshotText} · ${t(`${activeGoals} 个进行中的目标`, `${activeGoals} goals in progress`)}`,
    okrs: t(
      "每个组织最多 3 个运行中的目标；打开目标查看 KR、观测与执行来源。",
      "At most 3 active goals per organization. Open a goal for KRs, observations and execution provenance.",
    ),
    hosts: t("执行主机、连接入口与运行观测", "Execution hosts, endpoints and observations"),
    agents: t(
      "Agent 实例与所在主机。可以直接和任一实例对话；没有 OKR 时它按常驻权限行事。",
      "Agent instances and their hosts. Chat with any instance; without an OKR it acts within its standing authority.",
    ),
    memory: t("已验收成果与加密记录", "Accepted results and encrypted records"),
    governance: t("待你决定的事项与审批记录", "Decisions and approval records"),
    identity: t("Human 身份与设备授权", "Human identity and device grants"),
    settings: t("连接与数据来源", "Connection and data source"),
    orgs: t("组织关系与成长路径", "Organizations and growth path"),
    network: t("公开组织与联邦协作", "Public organizations and federation"),
  };
  const decisionSection = (onWorkbench: boolean) =>
    snapshot && (
      <section
        className="sec"
        aria-label={t("需要你决定", "Needs your decision")}
      >
        <div className="sec-h">
          <h2>
            {t("需要你决定", "Needs your decision")}
            {decisionTotal > 0 && <span className="count">{decisionTotal}</span>}
          </h2>
          {onWorkbench && (
            <button className="link-btn" onClick={() => go("governance")}>
              {t("全部审批", "All approvals")} →
            </button>
          )}
        </div>
        <div className="col gap-lg">
          <Decisions
            snapshot={snapshot}
            now={now}
            reachable={data.reachable}
            t={t}
            open={(id) => goOkr(id, "okrs")}
          />
          <Suspense
            fallback={
              <p className="tiny muted">
                {t("加载 Agent 审批…", "Loading Agent approvals…")}
              </p>
            }
          >
            <DirectApprovalQueue
              key={JSON.stringify([profile, snapshot.organization.objectId])}
              profile={{
                ...profile,
                chainIdentifier:
                  data.identity?.chainIdentifier ?? profile.chainIdentifier,
              }}
              snapshot={snapshot}
              now={now}
              reachable={data.reachable}
              onChanged={data.refresh}
              onAttention={setDirectPending}
              t={t}
            />
          </Suspense>
          {decisionsClear && (
            <div>
              <div className="calm">
                <NavIcon name="check" />
                <span>
                  {t("没有需要你决定的事项。", "Nothing needs your decision.")}
                </span>
              </div>
              <p className="tiny muted">
                {t(
                  "依据已读取的链上记录；实时 Agent 观测尚未接入，不代表执行一切正常。",
                  "Based on the chain records read. Live Agent observation is not connected, so this does not establish healthy execution.",
                )}
              </p>
            </div>
          )}
        </div>
      </section>
    );
  const pagePrimary =
    page === "workbench" ? (
      <button className="primary" onClick={() => go("okrs")}>
        + {t("新建 OKR", "New OKR")}
      </button>
    ) : page === "agents" && snapshot ? (
      <button className="primary" onClick={() => setDiscoverOpen(true)}>
        <NavIcon name="globe" />
        {t("从 Host 发现 Agent", "Discover on a Host")}
      </button>
    ) : page === "okrs" && snapshot ? (
      <Suspense fallback={null}>
        <CreateOkr
          key={JSON.stringify([profile, snapshot.organization.objectId])}
          profile={{
            ...profile,
            chainIdentifier:
              data.identity?.chainIdentifier ?? profile.chainIdentifier,
          }}
          organizationId={snapshot.organization.objectId}
          t={t}
          onCreated={data.refresh}
        />
      </Suspense>
    ) : null;
  // An open OKR shows its own header; the page header would repeat it.
  const showPageHeader = !(page === "okrs" && detailId);
  return (
    <div className="shell">
      <aside className="sidebar" aria-label={t("主导航", "Main navigation")}>
        <div className="sb-brand">
          <BrandMark />
          <span>FractalMind</span>
          <span className="chip outline">Alpha</span>
        </div>
        <label className="sb-org">
          <span className="avatar">
            {initial(organizationName)}
          </span>
          <span className="grow">
            <span className="t ellipsis" style={{ display: "block" }}>
              {organizationName}
            </span>
            <span className="s">
              {profile.network} · {t("链上只读", "Read-only chain")}
            </span>
          </span>
          <NavIcon name="down" />
          {organizationSelect}
        </label>
        <nav aria-label={t("主导航", "Main navigation")}>
          {navGroups.map((group, index) => (
            <div className="col" style={{ gap: 2 }} key={group.label[1]}>
              {index > 0 && (
                <div className="sb-group">{t(...group.label)}</div>
              )}
              {group.pages.map(navButton)}
            </div>
          ))}
        </nav>
        <div className="sb-foot">
          <div className="sb-me">
            <span className="avatar round sm human">H</span>
            <span className="grow">
              {device.session.state === "unlocked" ? (
                <>
                  <span
                    className="t ellipsis"
                    style={{ display: "block" }}
                    title={device.session.device.address}
                  >
                    {t("本设备", "This device")} ·{" "}
                    {short(device.session.device.address)}
                  </span>
                  <span className="s ellipsis" style={{ display: "block" }}>
                    {t(
                      `已解锁 · ${Math.max(1, Math.round(device.session.remainingMs / 60000))} 分钟无操作后锁定`,
                      `Unlocked · locks after ${Math.max(1, Math.round(device.session.remainingMs / 60000))} min idle`,
                    )}
                  </span>
                </>
              ) : (
                <>
                  <span className="t ellipsis" style={{ display: "block" }}>
                    {t("链上只读浏览", "Read-only chain browser")}
                  </span>
                  <span className="s ellipsis" style={{ display: "block" }}>
                    {t("网页预览没有设备密钥", "No device keys in the web preview")}
                  </span>
                </>
              )}
            </span>
          </div>
          {device.session.state === "unlocked" && (
            <button className="btn ghost sm" onClick={() => void device.lock()}>
              <NavIcon name="lock" />
              <span>{t("锁定此 App", "Lock this app")}</span>
            </button>
          )}
          <button className="btn ghost sm" onClick={disconnect}>
            <NavIcon name="logout" />
            <span>{t("清除连接缓存", "Clear connection cache")}</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div
            className="ctx"
            role="group"
            aria-label={t("运行上下文", "Execution context")}
          >
            <span
              className="ctx-item"
              title={t("工作区", "Workspace")}
            >
              <NavIcon name="folder" />
              <span className="k">{t("工作区", "Workspace")}</span>
              <span className="v">
                {focus
                  ? t("约定正文待解锁", "Agreement body locked")
                  : t("未选择 OKR", "No OKR selected")}
              </span>
            </span>
            <span className="ctx-sep">
              <NavIcon name="right" />
            </span>
            <span
              className="ctx-item"
              title={`${contextHost?.host_address ?? t("执行主机", "Execution Host")} · ${t("在线状态未知", "Connectivity unknown")}`}
            >
              <span className="dot" />
              <span className="k">{t("执行", "Runs on")}</span>
              <span className="v">
                {contextHost
                  ? hostName(contextHost)
                  : t("未指定", "Not set")}
              </span>
            </span>
            <span className="ctx-sep">
              <NavIcon name="right" />
            </span>
            <span
              className="ctx-item"
              title={contextAgent?.instance_id ?? t("Agent", "Agent")}
            >
              <NavIcon name="users" />
              <span className="v">
                {contextAgent ? agentName(contextAgent) : "—"}
              </span>
            </span>
            <span
              className="chip ctx-perm"
              title={t(
                "本设备在当前组织的权限",
                "This device's permission in this organization",
              )}
            >
              <NavIcon name={device.session.state === "unlocked" ? "lock" : "laptop"} />
              {device.session.state === "unlocked"
                ? t("本设备已解锁", "This device unlocked")
                : t("公开只读 · 未核验", "Public read-only · unverified")}
            </span>
          </div>
          <div className="tb-tools">
            {appearance}
            {refreshButton}
          </div>
        </header>
        <header className="m-top">
          <label className="org">
            <span className="avatar sm">
              {initial(organizationName)}
            </span>
            <span className="t">{organizationName}</span>
            <NavIcon name="down" />
            {organizationSelect}
          </label>
          <span className="grow" />
          {refreshButton}
          <button
            className="tb-btn"
            aria-label={t("全部功能", "All features")}
            onClick={() => setAllFeatures(true)}
          >
            <NavIcon name="grid" />
          </button>
        </header>
        <main className="page" id="main">
        {showPageHeader && (
          <div className="page-h">
            <div>
              <h1>{t(...labels[page])}</h1>
              {pageSummary[page] && (
                <p className="muted">{pageSummary[page]}</p>
              )}
            </div>
            {pagePrimary}
          </div>
        )}
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
            {decisionSection(true)}
            <div className="section-heading">
              <h2>{t("进行中的目标", "Goals in progress")}</h2>
              <button className="link-btn" onClick={() => go("okrs")}>
                {t("全部 OKR", "All OKRs")} →
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
                    <strong>
                      {okrTexts.get(row.okr.id)?.objective ??
                        `OKR ${short(row.okr.logical_id)}`}
                    </strong>
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
              {!!okrs?.length && (
                <select
                  aria-label={t("关注的 OKR", "Focused OKR")}
                  value={focus?.okr.id ?? ""}
                  onChange={(e) => setFocusId(e.target.value)}
                >
                  {okrs.map((row) => (
                    <option key={row.okr.id} value={row.okr.id}>
                      {okrTexts.get(row.okr.id)?.objective ??
                        `OKR ${short(row.okr.logical_id)}`}
                    </option>
                  ))}
                </select>
              )}
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
                  {focus.okr.agreement_record && (
                    <Suspense
                      fallback={
                        <p>{t("加载执行入口…", "Loading execution entry…")}</p>
                      }
                    >
                      <OkrContinuation
                        key={JSON.stringify([
                          profile,
                          snapshot.organization.objectId,
                          focus.okr.id,
                        ])}
                        profile={profile!}
                        organizationId={snapshot.organization.objectId}
                        okrId={focus.okr.id}
                        onChanged={data.refresh}
                        t={t}
                      />
                      <OkrAutonomy
                        key={`auto:${JSON.stringify([profile, snapshot.organization.objectId, focus.okr.id])}`}
                        profile={profile!}
                        organizationId={snapshot.organization.objectId}
                        okrId={focus.okr.id}
                        onChanged={data.refresh}
                        t={t}
                      />
                      <OkrVerification
                        key={`review:${JSON.stringify([profile, snapshot.organization.objectId, focus.okr.id])}`}
                        profile={profile!}
                        organizationId={snapshot.organization.objectId}
                        okrId={focus.okr.id}
                        onChanged={data.refresh}
                        t={t}
                      />
                    </Suspense>
                  )}
                  <Suspense
                    fallback={
                      <p>{t("加载介入入口…", "Loading intervention…")}</p>
                    }
                  >
                    <OkrIntervention
                      key={`intervene:${JSON.stringify([profile, snapshot.organization.objectId, focus.okr.id])}`}
                      profile={profile!}
                      organizationId={snapshot.organization.objectId}
                      okrId={focus.okr.id}
                      onChanged={data.refresh}
                      onReviewAgreement={() => setPage("agents")}
                      t={t}
                    />
                    <OkrProjection
                      key={`projection:${JSON.stringify([profile, snapshot.organization.objectId, focus.okr.id])}`}
                      profile={profile!}
                      organizationId={snapshot.organization.objectId}
                      okrId={focus.okr.id}
                      onChanged={data.refresh}
                      onIntervene={() => goOkr(focus.okr.id, "workbench")}
                      t={t}
                    />
                  </Suspense>
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
                        "可以联系负责实例，查询状态或提出有限文件操作。暂停与调整入口用于核对原执行、停止及结算；暂停后需要重新审阅执行约定，再明确继续。",
                        "Contact the assigned instance for status or bounded file requests. Pause & adjust reviews original Runs, stops and settlement. A paused goal needs a new agreement review before explicit continuation.",
                      )}
                    </p>
                    {contextAgent && (
                      <Suspense
                        fallback={
                          <p>{t("加载沟通入口…", "Loading communication…")}</p>
                        }
                      >
                        <DirectAgentConversation
                          key={JSON.stringify([
                            profile,
                            contextAgent,
                            hostAuthorityRevision,
                          ])}
                          profile={profile!}
                          organizationId={snapshot.organization.objectId}
                          managed={contextAgent}
                          onChanged={data.refresh}
                          t={t}
                        />
                      </Suspense>
                    )}
                  </div>
                </>
              )
            )}
          </>
        )}
        {page === "okrs" && snapshot && (
          <>
            {detailId && okrs?.find((row) => row.okr.id === detailId) ? (
              <>
                <OkrDetails
                  focus={okrs.find((row) => row.okr.id === detailId)!}
                  snapshot={snapshot}
                  now={now}
                  reachable={data.reachable}
                  text={okrTexts.get(detailId)}
                  t={t}
                  back={() => setDetailId(null)}
                  workbench={() => goOkr(detailId, "workbench")}
                />
                {okrs.find((row) => row.okr.id === detailId)?.okr
                  .agreement_record && (
                  <Suspense
                    fallback={
                      <p>{t("加载执行入口…", "Loading execution entry…")}</p>
                    }
                  >
                    <OkrContinuation
                      key={JSON.stringify([
                        profile,
                        snapshot.organization.objectId,
                        detailId,
                      ])}
                      profile={profile!}
                      organizationId={snapshot.organization.objectId}
                      okrId={detailId}
                      onChanged={data.refresh}
                      t={t}
                    />
                    <OkrVerification
                      key={`review:${JSON.stringify([profile, snapshot.organization.objectId, detailId])}`}
                      profile={profile!}
                      organizationId={snapshot.organization.objectId}
                      okrId={detailId}
                      onChanged={data.refresh}
                      t={t}
                    />
                  </Suspense>
                )}
                <Suspense
                  fallback={
                    <p>{t("加载介入入口…", "Loading intervention…")}</p>
                  }
                >
                  <OkrIntervention
                    key={`intervene:${JSON.stringify([profile, snapshot.organization.objectId, detailId])}`}
                    profile={profile!}
                    organizationId={snapshot.organization.objectId}
                    okrId={detailId}
                    onChanged={data.refresh}
                    onReviewAgreement={() => setPage("agents")}
                    t={t}
                  />
                  <OkrProjection
                    key={`projection:${JSON.stringify([profile, snapshot.organization.objectId, detailId])}`}
                    profile={profile!}
                    organizationId={snapshot.organization.objectId}
                    okrId={detailId}
                    onChanged={data.refresh}
                    onIntervene={() => goOkr(detailId, "workbench")}
                    t={t}
                  />
                </Suspense>
              </>
            ) : (
              <OkrList
                okrs={okrs ?? null}
                snapshot={snapshot}
                now={now}
                reachable={data.reachable}
                texts={okrTexts}
                t={t}
                open={(id) => goOkr(id, "okrs")}
                filter={okrFilter}
                setFilter={setOkrFilter}
              />
            )}
          </>
        )}
        {page === "hosts" && snapshot && (
          <>
            {isTauri() && (
              <Suspense fallback={null}>
                <LocalHostCard
                  key={JSON.stringify([profile, snapshot.organization.objectId])}
                  profile={{
                    ...profile,
                    chainIdentifier:
                      data.identity?.chainIdentifier ?? profile.chainIdentifier,
                  }}
                  organizationId={snapshot.organization.objectId}
                  deviceProfile={
                    device.session.state === "unlocked"
                      ? device.session.profile
                      : null
                  }
                  t={t}
                  onChanged={data.refresh}
                />
              </Suspense>
            )}
            <Suspense
              fallback={
                <p>{t("加载主机接入入口…", "Loading Host onboarding…")}</p>
              }
            >
              <HostAccess
                key={JSON.stringify([profile, snapshot.organization.objectId])}
                profile={{
                  ...profile,
                  chainIdentifier:
                    data.identity?.chainIdentifier ?? profile.chainIdentifier,
                }}
                organizationId={snapshot.organization.objectId}
                t={t}
                onChanged={data.refresh}
              />
            </Suspense>
            <Suspense
              fallback={
                <p>{t("加载运行观测…", "Loading runtime observations…")}</p>
              }
            >
              <HostObservations
                key={JSON.stringify([profile, snapshot.organization.objectId])}
                profile={{
                  ...profile,
                  chainIdentifier:
                    data.identity?.chainIdentifier ?? profile.chainIdentifier,
                }}
                organizationId={snapshot.organization.objectId}
                authorityRevision={hostAuthorityRevision}
                t={t}
              />
            </Suspense>
            <HostList
              snapshot={snapshot}
              now={now}
              t={t}
              reachable={data.reachable}
            />
          </>
        )}
        {page === "agents" && snapshot && (
          <>
            <dialog
              ref={discoverDialog}
              className="discover-dialog"
              aria-label={t("从 Host 发现 Agent", "Discover Agents on a Host")}
              onClose={() => setDiscoverOpen(false)}
            >
              <div className="dialog-heading">
                <div>
                  <h2>{t("从 Host 发现已有 Agent", "Discover existing Agents on a Host")}</h2>
                  <p>
                    {t(
                      "发现快照是观测；导入关系、OKR 绑定与授权是链上状态。",
                      "Discovery snapshots are observations; imports, OKR bindings and grants are chain state.",
                    )}
                  </p>
                </div>
                <button
                  className="btn ghost icon sm"
                  aria-label={t("关闭", "Close")}
                  onClick={() => setDiscoverOpen(false)}
                >
                  <NavIcon name="x" />
                </button>
              </div>
              {/* Kept mounted while the page is open: observations live in page memory only. */}
              <Suspense
                fallback={
                  <p>{t("加载实例发现…", "Loading instance discovery…")}</p>
                }
              >
                <HostObservations
                  key={JSON.stringify([profile, snapshot.organization.objectId])}
                  profile={{
                    ...profile,
                    chainIdentifier:
                      data.identity?.chainIdentifier ?? profile.chainIdentifier,
                  }}
                  organizationId={snapshot.organization.objectId}
                  authorityRevision={hostAuthorityRevision}
                  showDiscovery
                  onChanged={data.refresh}
                  t={t}
                />
              </Suspense>
            </dialog>
            <div className="sec-h">
              <h2>
                {t("受管理实例", "Managed instances")}{" "}
                {snapshot.agents.value && (
                  <span className="muted num small">
                    {snapshot.agents.value.length}
                  </span>
                )}
              </h2>
              <span className="tiny muted">
                {t(
                  "链上纳管记录；实际能力以适配器核验为准",
                  "Chain records; actual capability is verified by the adapter",
                )}
              </span>
            </div>
            {!snapshot.agents.value ? (
              <ReadFailure t={t} />
            ) : !snapshot.agents.value.length ? (
              <Empty t={t} icon="users" />
            ) : (
              <div className="grid-2 agent-grid">
                {snapshot.agents.value.map((agent) => {
                  const member = snapshot.memberships.value?.find(
                    (row) => row.id === agent.membership_id,
                  );
                  const agentProfile = {
                    ...profile,
                    chainIdentifier:
                      data.identity?.chainIdentifier ?? profile.chainIdentifier,
                  };
                  return (
                    <article className="card agent-card" key={agent.id}>
                      <div className="row between top">
                        <div className="row">
                          <span className="avatar round">
                            {initial(agent.runtime)}
                          </span>
                          <div className="grow">
                            <div className="strong" title={agent.instance_id}>
                              {agentName(agent)}
                            </div>
                            <div
                              className="small muted"
                              title={agent.host_address}
                            >
                              {member
                                ? hostName(member)
                                : short(agent.host_address)}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`chip ${agent.revoked ? "danger" : "ok"}`}
                        >
                          {agent.revoked
                            ? t("已撤销", "Revoked")
                            : t("已登记", "Registered")}
                        </span>
                      </div>
                      <dl>
                        <dt>{t("运行时", "Runtime")}</dt>
                        <dd>
                          {agent.runtime} · v{agent.version}
                        </dd>
                        <dt>{t("控制", "Control")}</dt>
                        <dd>
                          {agent.control_confirmed ? (
                            <span className="chip warn">
                              {t(
                                "管理设备已确认 · 待适配器核验",
                                "Confirmed by a management device · adapter check pending",
                              )}
                            </span>
                          ) : (
                            <span className="chip outline">
                              {t("仅观察", "Observe only")}
                            </span>
                          )}
                        </dd>
                        <dt>{t("实例状态", "Instance state")}</dt>
                        <dd className="small muted">
                          {t(
                            "待核实 · 发送时重新检查固定实例与权限",
                            "Unverified · rechecked when sending",
                          )}
                        </dd>
                        <dt>{t("链上记录", "Chain record")}</dt>
                        <dd>
                          <code title={agent.id}>{short(agent.id)}</code>
                        </dd>
                      </dl>
                      <div className="agent-actions">
                        <Suspense fallback={null}>
                          <DirectAgentConversation
                            key={JSON.stringify([
                              profile,
                              agent,
                              hostAuthorityRevision,
                            ])}
                            profile={agentProfile}
                            organizationId={snapshot.organization.objectId}
                            managed={agent}
                            entryLabel={t("对话", "Chat")}
                            onChanged={data.refresh}
                            t={t}
                          />
                          <HandoverFlow
                            key={JSON.stringify([
                              profile,
                              snapshot.organization.objectId,
                              agent.id,
                            ])}
                            profile={agentProfile}
                            organizationId={snapshot.organization.objectId}
                            managed={agent}
                            okrs={snapshot.okrs.value}
                            onChanged={data.refresh}
                            onContinue={(id) => goOkr(id, "workbench")}
                            t={t}
                          />
                        </Suspense>
                      </div>
                      <details className="agent-check">
                        <summary>
                          {t("接管前的执行检查", "Execution check before handover")}
                        </summary>
                        <Suspense
                          fallback={
                            <p>{t("加载执行检查…", "Loading execution check…")}</p>
                          }
                        >
                          <AgentCheckpointView
                            key={JSON.stringify([
                              profile,
                              agent,
                              hostAuthorityRevision,
                            ])}
                            profile={agentProfile}
                            organizationId={snapshot.organization.objectId}
                            managed={agent}
                            grants={data.identity?.grants.value}
                            t={t}
                          />
                        </Suspense>
                      </details>
                    </article>
                  );
                })}
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
            {data.organizationId && (
              <Suspense
                fallback={
                  <p>{t("加载设备配对…", "Loading device pairing…")}</p>
                }
              >
                <PairingFlow
                  key={JSON.stringify([
                    profile,
                    data.organizationId,
                    data.identity.human.generation,
                  ])}
                  profile={{
                    ...profile,
                    chainIdentifier: data.identity.chainIdentifier,
                  }}
                  organizationId={data.organizationId}
                  t={t}
                />
              </Suspense>
            )}
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
            {snapshot && decisionSection(false)}
            <div className="panel">
              <h2>{t("权限与审批", "Authority & approvals")}</h2>
              <p>
                {t(
                  "可用操作 = 组织角色 × 设备授权 × 数据访问。Agent 单次审批可在上方查看；打开原消息后会核验本设备资格、解密边界并单独预览费用。设备配对从身份页面发起。",
                  "Available actions = organization role × device grant × data access. Review one-off Agent approvals above; opening the original message checks this device, decrypts the bounds and previews the fee separately. Start device pairing from My identity.",
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
        {page === "settings" && device.session.state === "unlocked" && (
          <div className="panel">
            <div className="card-h">
              <h2>{t("自动锁定", "Auto-lock")}</h2>
              <select
                aria-label={t("无操作多久后锁定", "Lock after idle time")}
                value={device.idleMinutes}
                onChange={(e) => void device.setIdleMinutes(Number(e.target.value))}
              >
                {IDLE_CHOICES_MINUTES.map((m) => (
                  <option key={m} value={m}>
                    {t(`${m} 分钟`, `${m} min`)}
                  </option>
                ))}
              </select>
            </div>
            <p className="small muted">
              {t(
                "登录时解锁一次，设备密钥只保存在本机原生进程的内存里；无操作超过设定时间、手动锁定、手机进入后台超过 1 分钟或设备授权被撤销时立即清除，之后需要重新解锁。",
                "Unlocked once at sign-in; device keys stay in this machine's native process memory. They are cleared on idle timeout, manual lock, more than a minute in the background on phones, or a revoked device grant; then unlock again.",
              )}
            </p>
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
            "持久产品状态以 Sui 为准 · v0.2.0 Alpha",
            "Persistent product state lives on Sui · v0.2.0 Alpha",
          )}
        </footer>
        </main>
      </div>
      <nav className="tabbar" aria-label={t("移动导航", "Mobile navigation")}>
        {(["workbench", "okrs", "hosts", "orgs", "settings"] as Page[]).map(
          (id) => (
            <button
              aria-current={page === id ? "page" : undefined}
              key={id}
              onClick={() => go(id)}
            >
              <NavIcon name={pageIcons[id]} />
              {id === "hosts"
                ? t("主机", "Hosts")
                : id === "orgs"
                  ? t("组织", "Orgs")
                  : id === "settings"
                    ? t("设置", "Settings")
                    : t(...labels[id])}
              {!!counts[id] && <span className="count">{counts[id]}</span>}
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
        <div className="dialog-heading">
          <h2>{t("全部功能", "All features")}</h2>
          <button
            className="btn ghost icon sm"
            autoFocus
            aria-label={t("关闭", "Close")}
            onClick={() => setAllFeatures(false)}
          >
            <NavIcon name="x" />
          </button>
        </div>
        {navGroups.map((group) => (
          <nav
            className="col"
            style={{ gap: 2 }}
            key={group.label[1]}
            aria-label={t(...group.label)}
          >
            <div className="sb-group">{t(...group.label)}</div>
            {group.pages.map(navButton)}
          </nav>
        ))}
        <div className="row mt-12">{appearance}</div>
      </dialog>
    </div>
  );
}

function LockScreen({
  session,
  unlock,
  t,
}: {
  session: Extract<DeviceSession, { state: "checking" | "locked" | "unlocking" }>;
  unlock: () => Promise<void>;
  t: Translate;
}) {
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
    <div
      className="lockscreen"
      role="dialog"
      aria-modal="true"
      aria-label={t("已锁定", "Locked")}
    >
      <div
        className="card"
        style={{ width: "min(380px, calc(100% - 32px))", textAlign: "center", padding: "28px 24px" }}
      >
        <div style={{ display: "flex", justifyContent: "center" }}>
          <BrandMark />
        </div>
        <h2 className="mt-12">{t("FractalMind 已锁定", "FractalMind is locked")}</h2>
        <p className="small muted mt-8">
          {why} · {t("组织内容已隐藏", "Organization content hidden")}
        </p>
        <button
          className="btn primary lg block mt-16"
          disabled={busy}
          onClick={() => void unlock()}
          autoFocus
        >
          <NavIcon name="lock" />
          <span>
            {busy
              ? t("解锁中…", "Unlocking…")
              : t("解锁本设备", "Unlock this device")}
          </span>
        </button>
        <p className="tiny muted mt-12">
          {t(
            "解锁只读取一次本机凭据，密钥留在本机内存；它不能代替链上授权，已撤销或到期的设备解锁后仍无权限。",
            "Unlocking reads local credentials once and keeps keys in local memory. It does not replace chain grants; revoked or expired devices stay without access.",
          )}
        </p>
      </div>
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
function Empty({ t, icon = "layers" }: { t: Translate; icon?: string }) {
  return (
    <div className="card">
      <div className="empty">
        <div className="ico">
          <NavIcon name={icon} />
        </div>
        <p className="small">
          {t(
            "该组织暂无此类记录。可用操作见对应功能页面。",
            "No records of this kind in this organization. Available actions are shown on the corresponding feature page.",
          )}
        </p>
      </div>
    </div>
  );
}
/** Spent and in-flight reservations against the OKR budget (prototype .meter). */
function BudgetPanel({ focus, t }: { focus: OkrSnapshot; t: Translate }) {
  const budget = focus.budget.value;
  const limit = BigInt(focus.okr.budget_limit);
  const share = (part: bigint) =>
    limit === 0n
      ? 0
      : Math.min(100, Number((part * 1000000n) / limit) / 10000);
  return (
    <div className="panel">
      <div className="card-h">
        <h3>{t("预算", "Budget")}</h3>
        <span className="tiny muted">
          {t("含在途预留", "Includes reservations")}
        </span>
      </div>
      {budget ? (
        <>
          <div className="row between small">
            <span className="muted">
              {t("已支出 + 在途 / 上限", "Spent + reserved / limit")}
            </span>
            <strong className="num">
              {budget.spent.toString()} + {budget.reserved.toString()} /{" "}
              {focus.okr.budget_limit} {budget.asset}
            </strong>
          </div>
          <div
            className="meter mt-8"
            role="img"
            aria-label={t("预算使用与预留", "Spent and reserved budget")}
          >
            <i className="spent" style={{ width: `${share(budget.spent)}%` }} />
            <i
              className="reserved"
              style={{ width: `${share(budget.reserved)}%` }}
            />
          </div>
          <div className="legend mt-8">
            <span>
              <i className="sw" style={{ background: "var(--text-2)" }} />
              {t("已支出", "Spent")}
            </span>
            <span>
              <i className="sw" style={{ background: "var(--warn)" }} />
              {t("在途预留", "Reserved")}
            </span>
          </div>
        </>
      ) : (
        <p className="small muted">
          {t("预算未知，不显示为零", "Budget unknown; not shown as zero")}
        </p>
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
const lifecycleLabels: Array<[string, string]> = [
  ["草稿", "Draft"],
  ["运行中", "Active"],
  ["暂停", "Paused"],
  ["达成", "Achieved"],
  ["归档", "Archived"],
];
const lifecycleChip = ["", "info", "", "brand", "outline"];
/** Road-condition badge class (prototype .cond) for a navigation condition. */
const conditionClass: Record<Navigation["condition"], string> = {
  achieved: "c-achieved",
  archived: "c-paused",
  draft: "c-paused",
  paused: "c-paused",
  ready: "c-idle",
  stopped: "c-paused",
  unknown: "c-unknown",
  expired: "c-blocked",
  permission: "c-blocked",
  budget: "c-blocked",
  failed: "c-blocked",
  queued: "c-waiting",
  running: "c-waiting",
  measurement: "c-waiting",
  verification: "c-boundary",
  acceptance: "c-boundary",
};
const pct = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;
function OkrTitle({
  id,
  text,
  t,
}: {
  id: string;
  text?: OkrText;
  t: Translate;
}) {
  if (text) return <span title={id}>{text.objective}</span>;
  return (
    <>
      <span title={id}>OKR {short(id)}</span>
      <span className="chip outline" title={t(
        "目标标题与成功标准已加密，需授权设备解锁",
        "Title and success criteria are encrypted; an authorized device unlocks them",
      )}>
        {t("标题已加密", "Title encrypted")}
      </span>
    </>
  );
}

function OkrList({
  okrs,
  snapshot,
  now,
  reachable,
  texts,
  t,
  open,
  filter,
  setFilter,
}: {
  okrs: OkrSnapshot[] | null;
  texts: ReadonlyMap<string, OkrText>;
  snapshot: OrganizationSnapshot;
  now: bigint;
  reachable: boolean;
  t: Translate;
  open: (id: string) => void;
  filter: string;
  setFilter: (value: string) => void;
}) {
  const filtered = okrs
    ?.filter((row) => filter === "all" || String(row.okr.state) === filter)
    .sort(
      (a, b) =>
        (a.okr.state === 1 ? -1 : a.okr.state) -
          (b.okr.state === 1 ? -1 : b.okr.state) ||
        a.okr.priority - b.okr.priority,
    );
  const attention = decisionFacts(snapshot, now, reachable);
  const tabs: Array<[string, string, string]> = [
    ["all", "全部", "All"],
    ...lifecycleLabels.map(
      ([zh, en], i) => [String(i), zh, en] as [string, string, string],
    ),
  ];
  return (
    <>
      <div className="tabs" role="tablist">
        {tabs.map(([key, zh, en]) => {
          const n =
            okrs?.filter((row) => key === "all" || String(row.okr.state) === key)
              .length ?? 0;
          return (
            <button
              key={key}
              className="tab"
              role="tab"
              aria-selected={filter === key}
              onClick={() => setFilter(key)}
            >
              {t(zh, en)}{" "}
              <span className="muted num">{key === "1" ? `${n}/3` : n}</span>
            </button>
          );
        })}
      </div>
      {!okrs ? (
        <ReadFailure t={t} />
      ) : !okrs.length ? (
        <Empty t={t} icon="target" />
      ) : !filtered?.length ? (
        <div className="card">
          <div className="empty">
            <p className="small">
              {t("没有符合筛选条件的 OKR。", "No OKRs match this filter.")}
            </p>
          </div>
        </div>
      ) : (
        <div className="okr-grid">
          {filtered.map((row) => {
            const { okr } = row;
            const nav = navigation(row, snapshot, now, reachable);
            const agent = snapshot.agents.value?.find(
              (a) => a.id === okr.managed_agent,
            );
            const verified = okr.metrics.filter((m) => m.verified).length;
            const unknown = nav.metricProgress.filter((v) => v === null).length;
            const decide = attention.items.filter(
              (item) => item.row.okr.id === okr.id,
            ).length;
            const width =
              nav.progress === null ? 0 : Math.round(nav.progress * 100);
            return (
              <button
                key={okr.id}
                className="card okr-card"
                onClick={() => open(okr.id)}
              >
                <span className="row between">
                  <span className="row gap-sm">
                    <span className={`prio P${okr.priority}`}>
                      P{okr.priority}
                    </span>
                    <span className={`chip ${lifecycleChip[okr.state] ?? ""}`}>
                      {t(...lifecycleLabels[okr.state])}
                    </span>
                  </span>
                  {okr.state === 1 && (
                    <span className={`cond ${conditionClass[nav.condition]}`}>
                      {t(...statusLabels[nav.condition])}
                    </span>
                  )}
                </span>
                <span className="t row wrap gap-sm">
                  <OkrTitle
                    id={okr.logical_id}
                    text={texts.get(okr.id)}
                    t={t}
                  />
                </span>
                <span className="row between small muted">
                  <span className="ellipsis">
                    {t("负责", "Owner")}{" "}
                    {agent ? agentName(agent) : t("未指定", "Not set")}
                  </span>
                  <span className="nowrap">
                    {t("约定", "Agreement")} v{okr.agreement_version}
                  </span>
                </span>
                <span className="col gap-sm">
                  <span className="row between small">
                    <span className="muted">
                      {t("实测达成度", "Measured progress")}
                    </span>
                    <strong className="num">{pct(nav.progress)}</strong>
                  </span>
                  <span
                    className={`bar thick ${okr.state === 3 ? "brand" : nav.progress === null ? "unknown" : ""}`}
                  >
                    <i style={{ width: `${width}%` }} />
                  </span>
                </span>
                <span className="row wrap small muted">
                  <span>
                    {t(
                      `${verified}/${okr.metrics.length} 个 KR 已验证`,
                      `${verified}/${okr.metrics.length} KRs verified`,
                    )}
                  </span>
                  {unknown > 0 && (
                    <span className="chip warn">
                      {t(`${unknown} 项未知`, `${unknown} unknown`)}
                    </span>
                  )}
                  {decide > 0 && (
                    <span className="chip danger">
                      {t("需要你决定", "Needs your decision")}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
function OkrDetails({
  focus,
  snapshot,
  now,
  reachable,
  text,
  t,
  back,
  workbench,
}: {
  focus: OkrSnapshot;
  text?: OkrText;
  snapshot: OrganizationSnapshot;
  now: bigint;
  reachable: boolean;
  t: Translate;
  back: () => void;
  workbench: () => void;
}) {
  const { okr } = focus;
  const nav = navigation(focus, snapshot, now, reachable);
  const agent = snapshot.agents.value?.find((a) => a.id === okr.managed_agent);
  const host = snapshot.memberships.value?.find(
    (m) => m.id === okr.membership_id,
  );
  return (
    <>
      <button className="link-btn back" onClick={back}>
        ← {t("全部 OKR", "All OKRs")}
      </button>
      <div className="page-h">
        <div className="col gap-sm">
          <span className="row wrap gap-sm">
            <span className={`prio P${okr.priority}`}>P{okr.priority}</span>
            <span className={`chip ${lifecycleChip[okr.state] ?? ""}`}>
              {t(...lifecycleLabels[okr.state])}
            </span>
            <span className={`cond ${conditionClass[nav.condition]}`}>
              {t(...statusLabels[nav.condition])}
            </span>
          </span>
          <h2 className="row wrap gap-sm" style={{ fontSize: 20 }}>
            <OkrTitle id={okr.logical_id} text={text} t={t} />
          </h2>
        </div>
        <button className="primary" onClick={workbench}>
          {t("在工作台查看运行", "View in workbench")}
        </button>
      </div>
      <div className="detail">
        <div className="col gap-lg">
          <section className="card">
            <div className="card-h">
              <h3>{t("关键结果", "Key results")}</h3>
              <span className="tiny muted">
                {t(
                  "原始整数；单位与精度需解密规格",
                  "Raw integers; decrypt the spec for units and scale",
                )}
              </span>
            </div>
            {okr.metrics.map((metric, i) => {
              const fresh =
                metric.current !== null &&
                BigInt(metric.sampled_at_ms) <= now &&
                now - BigInt(metric.sampled_at_ms) <=
                  BigInt(metric.max_age_ms);
              const progress = nav.metricProgress[i] ?? null;
              return (
                <div className="kr" key={i}>
                  <div className="kr-h">
                    <span className="kr-id">KR{i + 1}</span>
                    <div className="grow">
                      <div className="kr-t">
                        {text?.krTitles[i] && (
                          <span style={{ marginRight: 8 }}>
                            {text.krTitles[i]}
                          </span>
                        )}
                        <span className={`chip ${metric.verified ? "ok" : "outline"}`}>
                          {metric.verified
                            ? t("已验证", "Verified")
                            : t("未验证", "Unverified")}
                        </span>
                        {!fresh && (
                          <span className="chip warn" style={{ marginLeft: 8 }}>
                            {t("观测未知或过期", "Observation unknown or stale")}
                          </span>
                        )}
                      </div>
                      <TrustLadder {...trustState(okr, i, now)} t={t} />
                    </div>
                  </div>
                  <div className="kr-metric">
                    <span>
                      <span className="m-l">{t("基线", "Baseline")}</span>
                      <br />
                      <span className="m-v">{metric.baseline}</span>
                    </span>
                    <span>
                      <span className="m-l">{t("实测", "Measured")}</span>
                      <br />
                      <span className="m-v">{metric.current ?? "—"}</span>
                    </span>
                    <span>
                      <span className="m-l">{t("目标", "Target")}</span>
                      <br />
                      <span className="m-v">{metric.target}</span>
                    </span>
                    <span
                      className={`bar bar-cell ${metric.verified ? "ok" : progress === null ? "unknown" : ""}`}
                    >
                      <i
                        style={{
                          width: `${progress === null ? 0 : Math.round(progress * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="pct-cell num strong">{pct(progress)}</span>
                  </div>
                  <div className="kr-meta">
                    <span title={metric.run_id ?? ""}>
                      Run {short(metric.run_id)}
                    </span>
                    <span title={metric.evidence_id ?? ""}>
                      {t("证据", "Evidence")} {short(metric.evidence_id)}
                    </span>
                  </div>
                </div>
              );
            })}
          </section>
          <section className="card">
            <div className="card-h">
              <h3>{t("观测历史", "Observation history")}</h3>
            </div>
            {!focus.observations.value ? (
              <ReadFailure t={t} />
            ) : !focus.observations.value.length ? (
              <p className="small muted">
                {t("暂无已确认观测", "No confirmed observations")}
              </p>
            ) : (
              <div className="table-scroll" style={{ margin: 0 }}>
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
                        <td className="num">{row.current}</td>
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
          </section>
          <section className="card">
            <div className="card-h">
              <h3>{t("执行与验收来源", "Execution & acceptance provenance")}</h3>
            </div>
            {!focus.executions.value ? (
              <ReadFailure t={t} />
            ) : !focus.executions.value.length ? (
              <p className="small muted">{t("暂无 Run", "No Runs yet")}</p>
            ) : (
              <div className="run">
                {focus.executions.value.map((row) => (
                  <div className="run-row" key={row.run.id}>
                    <span className="run-id" title={row.run.id}>
                      {short(row.run.id)}
                    </span>
                    <span className="grow">
                      KR{Number(row.contract.kr_index) + 1} · {t("约定", "Agreement")} v
                      {row.contract.agreement_version} ·{" "}
                      {t(...runLabels[row.run.state])}
                    </span>
                    <span className="small muted nowrap">
                      {t("支出 / 预留", "Spent / reserved")} {row.claim.spent} /{" "}
                      {row.claim.reserved} ·{" "}
                      {row.claim.settled
                        ? t("已结算", "Settled")
                        : t("预留未结算", "Unsettled")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        <aside className="detail-side">
          <section className="card">
            <div className="kpi">
              <span className="kpi-l">{t("实测达成度", "Measured progress")}</span>
              <span className="kpi-v">{pct(nav.progress)}</span>
            </div>
            <p className="small muted">
              {t(
                `${nav.verifiedCheckpoints}/${okr.metrics.length} 个 KR 已验证；实测不等于验证。`,
                `${nav.verifiedCheckpoints}/${okr.metrics.length} KRs verified; measured is not verified.`,
              )}
            </p>
          </section>
          <section className="card">
            <div className="card-h">
              <h3>{t("执行约定", "Agreement")}</h3>
              <span className="chip">v{okr.agreement_version}</span>
            </div>
            <dl>
              <dt>{t("负责", "Owner")}</dt>
              <dd title={agent?.instance_id}>
                {agent ? agentName(agent) : t("未指定", "Not set")}
              </dd>
              <dt>{t("执行主机", "Host")}</dt>
              <dd title={host?.host_address}>
                {host ? hostName(host) : t("未指定", "Not set")}
              </dd>
              <dt>{t("有效至", "Expires")}</dt>
              <dd>
                {Number(okr.expires_at_ms) > 0
                  ? new Date(Number(okr.expires_at_ms)).toLocaleString()
                  : t("未设置", "Not set")}
              </dd>
              <dt>{t("规格记录", "Spec record")}</dt>
              <dd>
                <code title={okr.spec_record ?? ""}>{short(okr.spec_record)}</code>
              </dd>
            </dl>
          </section>
          <BudgetPanel focus={focus} t={t} />
          <section className="card">
            <div className="card-h">
              <h3>{t("最终验收", "Final acceptance")}</h3>
              {okr.acceptance_record ? (
                <span className="chip brand">{t("已验收", "Accepted")}</span>
              ) : (
                <span className="chip outline">{t("尚无", "None")}</span>
              )}
            </div>
            <dl>
              <dt>{t("验收记录", "Record")}</dt>
              <dd>
                <code title={okr.acceptance_record ?? ""}>
                  {short(okr.acceptance_record)}
                </code>
              </dd>
              <dt>{t("验收者", "Accepted by")}</dt>
              <dd>
                <code title={okr.accepted_by_human ?? ""}>
                  {short(okr.accepted_by_human)}
                </code>
              </dd>
            </dl>
          </section>
        </aside>
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
                ) : row.current.failure ? (
                  <p className="warn">
                    {t(
                      "当前成员目录读取失败；不会以旧记录推断新资格。",
                      "Current membership could not be read; an older record does not establish new authority.",
                    )}
                  </p>
                ) : (
                  <p className="muted">
                    {t(
                      "当前链上目录无成员记录；历史记录不授予当前权限。",
                      "No current membership is indexed on chain. Historical records grant no current authority.",
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
            "公开标识用于定位记录，不能证明你持有该身份。设备核验仅证明选定授权；批准新设备、分享组织数据或解密正文，都要在对应操作中重新核验权限。",
            "The public ID locates a record; it is not proof of possession. Device verification proves the selected grant. Device approval, organization data sharing and body decryption each recheck authority when performed.",
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
