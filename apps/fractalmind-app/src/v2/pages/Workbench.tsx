// App v2 (#75): Workbench, as in the prototype (view-workbench.js) — decisions
// first, then the first-result guide or the active goals with the focused
// goal, its current Run and its footprints.
import { isTauri } from "@tauri-apps/api/core";
import { useState } from "react";
import { useApp } from "../store";
import { go } from "../router";
import { useDialogs } from "../dialogs";
import { ago, Btn, Icon, shortId, useLang, useT, type Translate } from "../ui";
import { activeOkrs, COND, condOf, decisions, focusOkr, nav, okrTitle, onboarding, type Cond } from "../model";
import { trustState } from "../../v2-model";
import type { OkrSnapshot } from "../../domain";

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

export function CondBadge({ code }: { code: Cond }) {
  const t = useT();
  const [icon, zh, en] = COND[code];
  return (
    <span className={`cond c-${code}`}>
      <Icon name={icon} />
      {t(zh, en)}
    </span>
  );
}

const TRUST: Record<string, [string, string]> = {
  claimed: ["Agent 声明", "Claimed"],
  measured: ["已测量", "Measured"],
  verified: ["已验证", "Verified"],
  accepted: ["已验收", "Accepted"],
};
export function Trust({ level, stale }: { level: string | null; stale?: boolean }) {
  const t = useT();
  if (!level) return <span className="trust">{t("无数据", "No data")}</span>;
  return (
    <span
      className={`trust ${level}${stale ? " stale" : ""}`}
      title={t("可信度：Agent 声明 → 已测量 → 已验证 → 已验收", "Trust: claimed → measured → verified → accepted")}
    >
      <span className="steps">
        <i />
        <i />
        <i />
        <i />
      </span>
      {stale ? t("待更新", "Stale") : t(...TRUST[level])}
    </span>
  );
}

const RUN: [string, string, string, string][] = [
  ["muted", "clock", "排队", "Queued"],
  ["info", "play", "运行", "Running"],
  ["ok", "check", "成功", "Succeeded"],
  ["danger", "x", "失败", "Failed"],
  ["danger", "help", "需要确认", "Needs confirmation"],
  ["muted", "stop", "已取消", "Cancelled"],
];
export function RunState({ state }: { state: number }) {
  const t = useT();
  const [tone, icon, zh, en] = RUN[state] ?? RUN[0];
  return (
    <span className={`st ${tone}`}>
      <Icon name={icon} />
      {t(zh, en)}
    </span>
  );
}

function Decisions() {
  const app = useApp();
  const t = useT();
  const list = decisions(app);
  const head = (
    <div className="sec-h" id="decisions">
      <h2>
        {t("需要你决定", "Needs your decision")}
        {list.items.length > 0 && <span className="count">{list.items.length}</span>}
      </h2>
      <a className="small" href="#/governance">
        {t("全部审批", "All approvals")} →
      </a>
    </div>
  );
  if (list.unavailable)
    return (
      <section className="sec">
        {head}
        <div className="note warn">
          <Icon name="help" />
          <div>{t("还没有读到最新链上记录，待决定事项未知。", "Latest chain records not read yet; pending decisions unknown.")}</div>
        </div>
      </section>
    );
  if (!list.items.length)
    return (
      <section className="sec">
        {head}
        <div className="calm">
          <Icon name="check" />
          <span>{t("没有需要你决定的事项。Agent 在授权范围内继续推进。", "Nothing needs you right now. Agents keep working within their authority.")}</span>
        </div>
      </section>
    );
  return (
    <section className="sec">
      {head}
      <div className="decisions">
        {list.items.slice(0, 6).map(({ row, nav }) => (
          <DecisionCard key={row.okr.id} row={row} condition={nav.condition} t={t} />
        ))}
      </div>
    </section>
  );
}

function DecisionCard({ row, condition, t }: { row: OkrSnapshot; condition: string; t: Translate }) {
  const app = useApp();
  const title = okrTitle(app, row.okr.id);
  const kind =
    condition === "verification" || condition === "acceptance"
      ? (["acceptance", "seal", "ok", "待你验收", "Awaiting your acceptance"] as const)
      : condition === "unknown" || condition === "failed"
        ? (["confirmation", "help", "danger", "需要确认", "Needs confirmation"] as const)
        : (["boundary", "alert", "warn", "触及边界", "At the boundary"] as const);
  const body: Record<string, [string, string]> = {
    verification: ["KR 已达标，等待验证者核验。", "A KR reached its target and awaits verification."],
    acceptance: ["指标达标不等于完成：你检查证据后才构成验收。", "Reaching the metric is not completion: acceptance needs your review."],
    unknown: ["有一次执行的结果未知：查询原交易并确认后才能继续，不会重放。", "A run's outcome is unknown: query the original transaction and confirm; nothing is replayed."],
    failed: ["最近一次执行失败，需要你决定重试或调整。", "The last run failed; decide whether to retry or adjust."],
    budget: ["预算已用完，Agent 不能再预留花费。", "The budget is used up; the Agent cannot reserve more."],
    permission: ["执行资格失效（主机或 Agent 记录变化），需要重新确认。", "Execution authority is no longer valid (host or Agent changed); confirm again."],
    expired: ["执行约定已到期。", "The execution agreement has expired."],
  };
  return (
    <article className={`decision k-${kind[0]}`}>
      <div className="d-top">
        <span className={`chip ${kind[2]}`}>
          <Icon name={kind[1]} />
          {t(kind[3], kind[4])}
        </span>
        <span className="row gap-sm">
          <span className={`prio P${row.okr.priority}`}>P{row.okr.priority}</span>
        </span>
      </div>
      <div className="d-title">{title}</div>
      <div className="d-body">
        <div>{t(...(body[condition] ?? ["需要你处理。", "Needs your attention."]))}</div>
      </div>
      <div className="d-actions">
        <Btn label={t("去处理", "Review")} kind="primary" size="sm" onClick={() => go(`okrs/${row.okr.id}`)} />
      </div>
    </article>
  );
}

function FirstResult() {
  const app = useApp();
  const t = useT();
  const dialogs = useDialogs();
  const steps = onboarding(app);
  if (!steps) return null;
  const native = isTauri();
  const unlocked = !!app.deviceProfile;
  const notNative = t("需要在桌面 App 中操作", "Needs the desktop App");
  const step = (done: boolean, n: number, title: string, desc: string, action: React.ReactNode) => (
    <div className="item top" key={n}>
      <span
        className="avatar sm round"
        style={{ background: done ? "var(--ok)" : "var(--surface-3)", color: done ? "#fff" : "var(--text-2)" }}
      >
        {done ? <Icon name="check" size="xs" /> : n}
      </span>
      <div className="grow">
        <div className="strong">{title}</div>
        <div className="small muted">{desc}</div>
      </div>
      {done ? (
        <span className="st ok">
          <Icon name="check" />
          {t("完成", "Done")}
        </span>
      ) : (
        action
      )}
    </div>
  );
  return (
    <section className="card accent">
      <div className="card-h">
        <h2>
          <Icon name="sparkle" size="sm" />
          {t("开始你的第一个成果", "Get to your first result")}
        </h2>
        <span className="chip">{t("三步完成", "Three steps")}</span>
      </div>
      <div className="list">
        {step(
          steps.host,
          1,
          t("把这台电脑设为执行主机", "Use this computer as an execution host"),
          t("一次确认：本机运行 Host 与 Coordinator 后台服务，Agent 在这里执行。", "One confirmation: this computer runs the Host and Coordinator service, and Agents run here."),
          <Btn
            label={t("设为执行主机", "Use this computer")}
            size="sm"
            kind="primary"
            disabled={!native || !unlocked}
            why={!native ? notNative : t("请先解锁本设备", "Unlock this device first")}
            onClick={() => dialogs.open({ kind: "host-setup" })}
          />,
        )}
        {step(
          steps.agent,
          2,
          t("新建或导入 Agent", "Create or import an Agent"),
          t("选择 Home 目录、ROM 和模型新建；或一键导入本机已在运行的 Agent。", "Pick a Home, ROM and model; or import Agents already running here in one click."),
          <span className="row gap-sm">
            <Btn
              label={t("导入已有", "Import")}
              size="sm"
              disabled={!steps.host || !unlocked}
              why={t("先准备执行主机", "Prepare a host first")}
              onClick={() => dialogs.open({ kind: "agent-import" })}
            />
            <Btn
              label={t("新建 Agent", "New Agent")}
              size="sm"
              kind={steps.host ? "primary" : ""}
              disabled={!steps.host || !native}
              why={!native ? notNative : t("先准备执行主机", "Prepare a host first")}
              onClick={() => dialogs.open({ kind: "agent-create" })}
            />
          </span>,
        )}
        {step(
          steps.okr,
          3,
          t("创建第一个 OKR", "Create your first OKR"),
          t("写下目标和可量化的 KR，分配给 Agent，确认边界后开始。", "Write the goal and measurable KRs, assign an Agent, confirm limits, then start."),
          <Btn
            label={t("新建 OKR", "New OKR")}
            size="sm"
            kind={steps.agent ? "primary" : ""}
            disabled={!steps.agent || !native}
            why={!native ? notNative : t("先新建或导入 Agent", "Create or import an Agent first")}
            onClick={() => dialogs.open({ kind: "okr-create" })}
          />,
        )}
      </div>
    </section>
  );
}

function FocusCard({ row }: { row: OkrSnapshot }) {
  const app = useApp();
  const t = useT();
  const n = nav(app, row);
  const texts = app.okrTexts.get(row.okr.id) as { krTitles?: string[] } | undefined;
  const code = n ? condOf(n.condition) : "unknown";
  return (
    <section className="card" aria-label={okrTitle(app, row.okr.id)}>
      <div className="card-h">
        <h2 className="row gap-sm">
          <span className={`prio P${row.okr.priority}`}>P{row.okr.priority}</span>
          {okrTitle(app, row.okr.id)}
        </h2>
        <span className="row gap-sm">
          <CondBadge code={code} />
          <Btn label={t("详情", "Details")} size="sm" kind="ghost" onClick={() => go(`okrs/${row.okr.id}`)} />
        </span>
      </div>
      <div className="row between small mt-4">
        <span className="muted">{t("实测达成度", "Measured progress")}</span>
        <span className="strong">{pct(n?.progress)}</span>
      </div>
      <div className="bar mt-4">
        <i style={{ width: `${Math.round((n?.progress ?? 0) * 100)}%` }} />
      </div>
      <div className="list mt-12">
        {row.okr.metrics.map((m, i) => {
          const trust = trustState(row.okr, i, app.now);
          return (
            <div className="item" key={i}>
              <span className={`chip ${i === Number(row.okr.next_kr) ? "info" : "outline"}`}>KR{i + 1}</span>
              <span className="grow ellipsis">{texts?.krTitles?.[i] ?? t(`结果 ${i + 1}`, `Result ${i + 1}`)}</span>
              <span className="small muted mono">
                {m.current ?? "—"} / {m.target}
              </span>
              <Trust level={trust.level} stale={trust.stale} />
            </div>
          );
        })}
      </div>
      <p className="tiny muted mt-12">
        {t(
          "运行导航地图将在 OKR 页面完成后提供；这里显示每个 KR 的实测值和可信度。",
          "The route map arrives with the OKR pages; this shows each KR's measured value and trust level.",
        )}
      </p>
    </section>
  );
}

function RunCard({ row }: { row: OkrSnapshot }) {
  const t = useT();
  const runs = row.executions.value ?? [];
  const current = runs.find((r) => r.run.state === 1 || r.run.state === 0) ?? null;
  return (
    <section className="card">
      <div className="card-h">
        <h2>
          <Icon name="play" size="sm" />
          {t("当前执行", "Current run")}
        </h2>
        <a className="small" href={`#/okrs/${row.okr.id}`}>
          {t("全部", "All")} →
        </a>
      </div>
      {row.executions.value === null ? (
        <div className="muted small">{t("执行记录读取失败，状态未知。", "Runs could not be read; unknown.")}</div>
      ) : current ? (
        <div className="row between">
          <span className="row">
            <span className="run-id">{shortId(current.run.id)}</span>
            <RunState state={current.run.state} />
          </span>
          <span className="small muted">KR{Number(current.contract.kr_index) + 1}</span>
        </div>
      ) : (
        <div className="muted small">{t("当前没有进行中的 Run", "No run in progress")}</div>
      )}
      <div className="divider" />
      <div className="col" style={{ gap: 0 }}>
        {runs
          .filter((r) => r !== current)
          .slice(0, 4)
          .map((r) => (
            <div className="run-row" key={r.run.id}>
              <span className="run-id">{shortId(r.run.id)}</span>
              <span className="grow ellipsis">KR{Number(r.contract.kr_index) + 1}</span>
              <RunState state={r.run.state} />
            </div>
          ))}
        {runs.length <= (current ? 1 : 0) && <div className="muted small">{t("暂无历史 Run", "No earlier runs")}</div>}
      </div>
    </section>
  );
}

function FeedCard({ row }: { row: OkrSnapshot }) {
  const t = useT();
  const lang = useLang();
  const items = (row.observations.value ?? [])
    .map((o) => ({ at: Number(o.recorded_at_ms), kr: Number(o.kr_index), current: o.current }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 7);
  return (
    <section className="card">
      <div className="card-h">
        <h2>
          <Icon name="pulse" size="sm" />
          {t("执行足迹", "Footprints")}
        </h2>
        <span className="tiny muted">{t("只记录进展、阻塞与决定", "Progress, blockers and decisions only")}</span>
      </div>
      <div className="feed">
        {items.map((x, i) => (
          <div className="ev" key={i}>
            <span className="e-ico">
              <Icon name="trend" />
            </span>
            <div className="grow">
              <div className="e-t">
                {t(`KR${x.kr + 1} 测得 ${x.current}`, `KR${x.kr + 1} measured ${x.current}`)}
              </div>
              <div className="e-s">{ago(x.at, t, lang)}</div>
            </div>
          </div>
        ))}
        {!items.length && <div className="muted small">{t("暂无记录", "Nothing yet")}</div>}
      </div>
    </section>
  );
}

export default function Workbench() {
  const app = useApp();
  const t = useT();
  const lang = useLang();
  const dialogs = useDialogs();
  const [focusId, setFocusId] = useState<string | null>(null);
  const active = activeOkrs(app);
  const focus = focusOkr(app, focusId);
  const steps = onboarding(app);
  const running = active.filter((r) => {
    const n = nav(app, r);
    return n && condOf(n.condition) === "on_track";
  }).length;
  const dateLine = new Intl.DateTimeFormat(lang === "en" ? "en" : "zh-CN", { weekday: "long", month: "long", day: "numeric" }).format(
    app.wallMs,
  );
  return (
    <>
      <div className="page-h">
        <div>
          <h1>{t("工作台", "Workbench")}</h1>
          <p className="muted">
            {dateLine} ·{" "}
            {t(`${active.length} 个进行中的目标 · ${running} 个自主推进中`, `${active.length} active goals · ${running} progressing autonomously`)}
          </p>
        </div>
        <div className="row">
          <Btn
            label={t("新建 OKR", "New OKR")}
            icon="plus"
            kind="primary"
            disabled={!isTauri()}
            why={t("需要在桌面 App 中操作", "Needs the desktop App")}
            onClick={() => dialogs.open({ kind: "okr-create" })}
          />
        </div>
      </div>
      {!app.snapshot ? (
        <div className="card">
          <div className="empty">
            <div className="ico">
              <Icon name="refresh" size="lg" className="spin" />
            </div>
            <h3>{t("正在读取组织", "Reading the organization")}</h3>
          </div>
        </div>
      ) : (
        <>
          <Decisions />
          {!active.length && (
            <section className="sec">
              {steps && !steps.done ? (
                <FirstResult />
              ) : (
                <section className="card">
                  <div className="empty">
                    <div className="ico">
                      <Icon name="target" size="lg" />
                    </div>
                    <h3>{t("没有进行中的目标", "No active goals")}</h3>
                    <p className="small">
                      {t("创建 OKR 并确认执行边界后，Agent 会在授权范围内自主推进。", "Create an OKR and confirm its limits; Agents then work autonomously within them.")}
                    </p>
                    <div className="row center mt-8">
                      <Btn label={t("查看候选", "View candidates")} onClick={() => go("okrs")} />
                    </div>
                  </div>
                </section>
              )}
            </section>
          )}
          {active.length > 0 && (
            <section className="sec">
              <div className="sec-h">
                <h2>{t("进行中的目标", "Active goals")}</h2>
                <span className="small muted">{active.length}/3 ACTIVE</span>
              </div>
              <div className="okr-tabs" role="tablist">
                {active.map((r) => {
                  const n = nav(app, r);
                  return (
                    <button
                      className="okr-tab"
                      role="tab"
                      key={r.okr.id}
                      aria-selected={focus?.okr.id === r.okr.id}
                      onClick={() => setFocusId(r.okr.id)}
                    >
                      <span className="row between">
                        <span className="row gap-sm">
                          <span className={`prio P${r.okr.priority}`}>P{r.okr.priority}</span>
                          <CondBadge code={n ? condOf(n.condition) : "unknown"} />
                        </span>
                        <span className="pct">{pct(n?.progress)}</span>
                      </span>
                      <span className="t">{okrTitle(app, r.okr.id)}</span>
                    </button>
                  );
                })}
                {active.length < 3 && (
                  <button className="okr-tab add" disabled={!isTauri()} onClick={() => dialogs.open({ kind: "okr-create" })}>
                    <Icon name="plus" />
                    <span>{t("新建 OKR", "New OKR")}</span>
                  </button>
                )}
              </div>
            </section>
          )}
          {focus && focus.okr.state === 1 && (
            <section className="sec" style={{ marginTop: 14 }}>
              <FocusCard row={focus} />
              <div className="grid-2 mt-16">
                <RunCard row={focus} />
                <FeedCard row={focus} />
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
