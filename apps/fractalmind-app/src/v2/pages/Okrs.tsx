// App v2 (#75): OKR list and detail (prototype view-okr.js). The detail's
// actions are the tested flows of the first App until M2 redoes them.
import { lazy, Suspense, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useApp } from "../store";
import { go, type Route } from "../router";
import { Btn, date, Icon, shortId, useLang, useT } from "../ui";
import { condOf, decisions, LIFE, lifeOf, nav, okrTitle, type Life } from "../model";
import { CondBadge, RunState, Trust } from "./Workbench";
import OkrNew from "./OkrNew";
import { AssignFlow, DeliveryResult, PauseFlow, assignable, errorCode, errorText, useAgentLabel, useDelivery } from "../okr-flow";
import { trustState } from "../../v2-model";
import { agentName, hostName } from "../../display";
import type { Agent, OkrSnapshot } from "../../domain";

const OkrContinuation = lazy(() => import("../../OkrContinuation"));
const OkrVerification = lazy(() => import("../../OkrVerification"));
const OkrIntervention = lazy(() => import("../../OkrIntervention"));
const OkrProjection = lazy(() => import("../../OkrProjection"));

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);
const FILTERS: [Life | "all", string, string][] = [
  ["all", "全部", "All"],
  ["ACTIVE", "进行中", "Active"],
  ["PAUSED", "已暂停", "Paused"],
  ["DRAFT", "草稿", "Drafts"],
  ["ACHIEVED", "已达成", "Achieved"],
  ["ARCHIVED", "已归档", "Archived"],
];

function LifeChip({ life }: { life: Life }) {
  const t = useT();
  const [tone, zh, en] = LIFE[life];
  return <span className={`chip ${tone}`}>{t(zh, en)}</span>;
}

function OkrCard({ row }: { row: OkrSnapshot }) {
  const app = useApp();
  const t = useT();
  const lang = useLang();
  const n = nav(app, row);
  const life = lifeOf(row.okr.state);
  const agent = app.snapshot?.agents.value?.find((a) => a.id === row.okr.managed_agent);
  const verified = row.okr.metrics.filter((m) => m.verified).length;
  const pending = decisions(app).items.filter((d) => d.row.okr.id === row.okr.id).length;
  return (
    <article
      className="card okr-card"
      role="link"
      tabIndex={0}
      onClick={() => go(`okrs/${row.okr.id}`)}
      onKeyDown={(e) => e.key === "Enter" && go(`okrs/${row.okr.id}`)}
    >
      <div className="row between">
        <span className="row gap-sm">
          <span className={`prio P${row.okr.priority}`}>P{row.okr.priority}</span>
          <LifeChip life={life} />
        </span>
        {life === "ACTIVE" && <CondBadge code={n ? condOf(n.condition) : "unknown"} />}
      </div>
      <div className="t">{okrTitle(app, row.okr.id)}</div>
      <div className="row between small muted">
        <span>
          {t("负责", "Owner")} {agent ? agentName(agent) : "—"}
        </span>
        <span>
          {t("截止", "Due")} {date(Number(row.okr.deadline_ms) || null, lang)}
        </span>
      </div>
      <div>
        <div className="row between small">
          <span className="muted">{t("结果达成度", "Result progress")}</span>
          <strong className="num">{pct(n?.progress)}</strong>
        </div>
        <div className={`bar thick ${life === "ACHIEVED" ? "brand" : ""} mt-4`}>
          <i style={{ width: `${Math.round((n?.progress ?? 0) * 100)}%` }} />
        </div>
      </div>
      <div className="row wrap small muted">
        <span>{t(`${verified}/${row.okr.metrics.length} 个 KR 已验证`, `${verified}/${row.okr.metrics.length} KRs verified`)}</span>
        {pending > 0 && <span className="chip danger">{t(`${pending} 项待决定`, `${pending} to decide`)}</span>}
      </div>
    </article>
  );
}

function List() {
  const app = useApp();
  const t = useT();
  const [filter, setFilter] = useState<Life | "all">("all");
  const rows = app.snapshot?.okrs.value;
  const shown = (rows ?? [])
    .filter((r) => filter === "all" || lifeOf(r.okr.state) === filter)
    .sort((a, b) => a.okr.state - b.okr.state || a.okr.priority - b.okr.priority);
  const active = (rows ?? []).filter((r) => r.okr.state === 1).length;
  return (
    <>
      <div className="page-h">
        <div>
          <h1>OKR</h1>
          <p className="muted">
            {t(
              "每个组织最多 3 个进行中的目标。点击目标查看 KR、执行记录与证据。",
              "At most 3 active goals per organization. Open a goal for KRs, runs and evidence.",
            )}
          </p>
        </div>
        <div className="row">
          <Btn
            label={t("新建 OKR", "New OKR")}
            icon="plus"
            kind="primary"
            disabled={!isTauri()}
            why={t("需要在桌面 App 中操作", "Needs the desktop App")}
            onClick={() => go("okrs/new")}
          />
        </div>
      </div>
      <div className="tabs" role="tablist">
        {FILTERS.map(([k, zh, en]) => {
          const n = (rows ?? []).filter((r) => k === "all" || lifeOf(r.okr.state) === k).length;
          return (
            <button className="tab" role="tab" key={k} aria-selected={filter === k} onClick={() => setFilter(k)}>
              {t(zh, en)} <span className="muted num">{k === "ACTIVE" ? `${n}/3` : n}</span>
            </button>
          );
        })}
      </div>
      {active >= 3 && (
        <div className="note info" style={{ marginBottom: 14 }}>
          <Icon name="info" />
          <div>{t("进行中的目标已满 3 个。完成或归档一个后再激活新的。", "Three goals are active. Finish or archive one before activating another.")}</div>
        </div>
      )}
      {rows === null || rows === undefined ? (
        <div className="note warn">
          <Icon name="help" />
          <div>{t("OKR 读取失败，当前数据未知。", "OKRs could not be read; data unknown.")}</div>
        </div>
      ) : shown.length ? (
        <div className="okr-grid">
          {shown.map((r) => (
            <OkrCard key={r.okr.id} row={r} />
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="empty">
            <div className="ico">
              <Icon name="target" size="lg" />
            </div>
            <h3>{t("这里还没有目标", "No goals here yet")}</h3>
          </div>
        </div>
      )}
    </>
  );
}

function Detail({ id }: { id: string }) {
  const app = useApp();
  const t = useT();
  const lang = useLang();
  const [tab, setTab] = useState<"overview" | "runs" | "actions">("overview");
  const row = app.snapshot?.okrs.value?.find((r) => r.okr.id === id);
  const back = (
    <a className="back" href="#/okrs">
      <Icon name="left" size="sm" />
      {t("OKR 列表", "OKRs")}
    </a>
  );
  if (!row || !app.snapshot || !app.profile)
    return (
      <>
        {back}
        <div className="card">
          <div className="empty">
            <h3>{t("该目标不在当前组织", "This goal is not in the current organization")}</h3>
          </div>
        </div>
      </>
    );
  const n = nav(app, row);
  const life = lifeOf(row.okr.state);
  const agent = app.snapshot.agents.value?.find((a) => a.id === row.okr.managed_agent);
  const member = app.snapshot.memberships.value?.find((m) => m.id === row.okr.membership_id);
  const texts = app.okrTexts.get(id) as { krTitles?: string[] } | undefined;
  const orgId = app.snapshot.organization.objectId;
  const key = JSON.stringify([app.profile.humanId, orgId, id]);
  return (
    <>
      {back}
      <div className="page-h">
        <div className="grow" style={{ minWidth: 280 }}>
          <div className="row wrap gap-sm">
            <span className={`prio P${row.okr.priority}`}>P{row.okr.priority}</span>
            <LifeChip life={life} />
            {(life === "ACTIVE" || life === "ACHIEVED") && <CondBadge code={n ? condOf(n.condition) : "unknown"} />}
          </div>
          <h1 className="mt-8">{okrTitle(app, id)}</h1>
          <p className="small muted">
            {t("负责", "Owner")} {agent ? agentName(agent) : "—"} · {t("截止", "Due")}{" "}
            {date(Number(row.okr.deadline_ms) || null, lang)} · {t("执行", "Runs on")} {member ? hostName(member) : "—"}
          </p>
        </div>
        <div className="row wrap">
          {life === "ACTIVE" && <Btn label={t("在工作台查看", "View on workbench")} icon="home" kind="primary" onClick={() => go("workbench")} />}
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ["overview", "概览", "Overview"],
            ["runs", "执行记录", "Runs"],
            ["actions", "操作", "Actions"],
          ] as const
        ).map(([k, zh, en]) => (
          <button className="tab" role="tab" key={k} aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(zh, en)}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <div className="grid-2">
          <section className="card">
            <div className="card-h">
              <h2>{t("关键结果", "Key results")}</h2>
              <span className="strong">{pct(n?.progress)}</span>
            </div>
            <div className="list">
              {row.okr.metrics.map((m, i) => {
                const trust = trustState(row.okr, i, app.now);
                return (
                  <div className="item top" key={i}>
                    <span className={`chip ${i === Number(row.okr.next_kr) ? "info" : "outline"}`}>KR{i + 1}</span>
                    <div className="grow">
                      <div className="strong">{texts?.krTitles?.[i] ?? t(`结果 ${i + 1}`, `Result ${i + 1}`)}</div>
                      <div className="small muted mono">
                        {t("基线", "baseline")} {m.baseline} → {t("目标", "target")} {m.target} · {t("当前", "now")} {m.current ?? "—"} ·{" "}
                        {t("权重", "weight")} {m.weight}
                      </div>
                    </div>
                    <Trust level={trust.level} stale={trust.stale} />
                  </div>
                );
              })}
            </div>
          </section>
          <section className="card">
            <div className="card-h">
              <h2>{t("执行约定", "Agreement")}</h2>
            </div>
            <dl className="kv">
              <dt>{t("负责 Agent", "Agent")}</dt>
              <dd>{agent ? agentName(agent) : "—"}</dd>
              <dt>{t("执行主机", "Host")}</dt>
              <dd>{member ? hostName(member) : "—"}</dd>
              <dt>{t("预算", "Budget")}</dt>
              <dd>
                {row.budget.value ? `${row.budget.value.spent} / ${row.okr.budget_limit} ${row.okr.budget_asset}` : "—"}
              </dd>
              <dt>{t("截止", "Due")}</dt>
              <dd>{date(Number(row.okr.deadline_ms) || null, lang)}</dd>
              <dt>{t("约定版本", "Agreement")}</dt>
              <dd>v{row.okr.agreement_version}</dd>
            </dl>
          </section>
        </div>
      )}
      {tab === "overview" && (
        <div className="mt-16">
          <AgentPanel row={row} />
        </div>
      )}
      {tab === "runs" && (
        <section className="card">
          {row.executions.value === null ? (
            <div className="muted small">{t("执行记录读取失败，状态未知。", "Runs could not be read; unknown.")}</div>
          ) : row.executions.value.length ? (
            row.executions.value.map((r) => (
              <div className="run-row" key={r.run.id}>
                <span className="run-id">{shortId(r.run.id)}</span>
                <span className="grow">
                  KR{Number(r.contract.kr_index) + 1} · {t("约定", "agreement")} v{r.contract.agreement_version}
                </span>
                <span className="small muted">
                  {t("支出", "spent")} {r.claim.spent} · {r.claim.settled ? t("已结算", "settled") : t("未结算", "unsettled")}
                </span>
                <RunState state={r.run.state} />
              </div>
            ))
          ) : (
            <div className="muted small">{t("暂无 Run", "No runs yet")}</div>
          )}
        </section>
      )}
      {tab === "actions" && (
        <Suspense fallback={<p className="small muted">{t("加载…", "Loading…")}</p>}>
          <div className="col">
            {row.okr.agreement_record && (
              <>
                <OkrContinuation key={`c:${key}`} profile={app.profile} organizationId={orgId} okrId={id} onChanged={app.refresh} t={t} />
                <OkrVerification key={`v:${key}`} profile={app.profile} organizationId={orgId} okrId={id} onChanged={app.refresh} t={t} />
              </>
            )}
            <OkrIntervention
              key={`i:${key}`}
              profile={app.profile}
              organizationId={orgId}
              okrId={id}
              onChanged={app.refresh}
              onReviewAgreement={() => go("agents")}
              t={t}
            />
            <OkrProjection
              key={`p:${key}`}
              profile={app.profile}
              organizationId={orgId}
              okrId={id}
              onChanged={app.refresh}
              onIntervene={() => go("workbench")}
              t={t}
            />
          </div>
        </Suspense>
      )}
    </>
  );
}

export default function Okrs({ route }: { route: Route }) {
  if (route.parts[1] === "new") return <OkrNew />;
  return route.parts[1] ? <Detail id={route.parts[1]} /> : <List />;
}

/** Assign a draft or paused goal; deliver an active one again. */
function AgentPanel({ row }: { row: OkrSnapshot }) {
  const app = useApp();
  const t = useT();
  const { label } = useAgentLabel();
  const deliver = useDelivery();
  const agents = assignable(app.snapshot?.agents.value);
  const busy = new Set((app.snapshot?.okrs.value ?? []).filter((r) => r.okr.state === 1).map((r) => r.okr.managed_agent));
  const [agentId, setAgentId] = useState("");
  const [limit, setLimit] = useState("200");
  const [paths, setPaths] = useState(".");
  const [start, setStart] = useState(false);
  const [delivered, setDelivered] = useState<Awaited<ReturnType<typeof deliver>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [pausing, setPausing] = useState(false);
  const pauseAgent = useRef<Agent | null>(null);
  const pauseVersion = useRef("");
  const owner = app.snapshot?.agents.value?.find((a) => a.id === row.okr.managed_agent) ?? null;
  const chosen = agents.find((a) => a.id === agentId) ?? null;
  // A flow that has started stays on screen through the refresh that changes
  // the goal's state, so its result (delivery, stop notice) remains visible.
  if (start && chosen)
    return (
      <section className="card">
        <div className="card-h">
          <h2>{t("分配给 Agent", "Assign to an Agent")}</h2>
        </div>
        <AssignFlow
          okrId={row.okr.id}
          agent={chosen}
          budgetLimit={limit.trim()}
          allowedPaths={paths.split("\n").map((p) => p.trim()).filter(Boolean)}
          onAssigned={app.refresh}
        />
      </section>
    );
  if (pausing && pauseAgent.current)
    return (
      <section className="card">
        <div className="card-h">
          <h2>{t("暂停目标", "Pause the goal")}</h2>
        </div>
        <p className="small muted">
          {t(
            "暂停后目标不再进行，Agent 会收到停止通知；之后可以重新分配给它或其他 Agent。",
            "Once paused the goal stops, and the Agent is told to stop; you can assign it again later, to it or another Agent.",
          )}
        </p>
        <PauseFlow okrId={row.okr.id} version={pauseVersion.current} agent={pauseAgent.current} />
      </section>
    );
  if (row.okr.state === 1 && owner?.runtime === "agent-manager-v1")
    return (
      <section className="card">
        <div className="card-h">
          <h2>{t("投递到 Agent", "Delivery to the Agent")}</h2>
        </div>
        <p className="small muted">
          {t(
            "目标已分配给 ",
            "Assigned to ",
          )}
          <strong>{label(owner)}</strong>
          {t("。如果 Agent 没收到或文件被改动，可以重新投递最新的链上内容。", ". If the Agent missed it or the file changed, deliver the current chain content again.")}
        </p>
        {error && (
          <div className="note warn">
            <Icon name="alert" />
            <div>{errorText(error, t)}</div>
          </div>
        )}
        {delivered && <DeliveryResult result={delivered} t={t} />}
        <div className="card-f">
          <Btn
            label={t("暂停目标", "Pause the goal")}
            icon="pause"
            kind="ghost"
            onClick={() => {
              pauseAgent.current = owner;
              pauseVersion.current = row.okr.version;
              setPausing(true);
            }}
          />
          <Btn
            label={delivering ? t("正在投递…", "Delivering…") : t("重新投递", "Deliver again")}
            icon="send"
            disabled={delivering || !app.deviceProfile}
            why={t("请先解锁本设备", "Unlock this device first")}
            onClick={async () => {
              setDelivering(true);
              setError(null);
              try {
                setDelivered(await deliver(row.okr.id, owner));
              } catch (e) {
                setError(errorCode(e));
              }
              setDelivering(false);
            }}
          />
        </div>
      </section>
    );
  if (row.okr.state !== 0 && row.okr.state !== 2) return null;
  const agent = agents.find((a) => a.id === agentId) ?? null;
  return (
    <section className="card">
      <div className="card-h">
        <h2>{t("分配给 Agent", "Assign to an Agent")}</h2>
      </div>
      {start && agent ? (
        <AssignFlow
          okrId={row.okr.id}
          agent={agent}
          budgetLimit={limit.trim()}
          allowedPaths={paths.split("\n").map((p) => p.trim()).filter(Boolean)}
          onAssigned={app.refresh}
        />
      ) : (
        <div className="form-grid">
          <div className="field full">
            <label htmlFor="a-agent">{t("负责 Agent", "Owner Agent")}</label>
            <select id="a-agent" className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">{t("选择 Agent", "Choose an Agent")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id} disabled={busy.has(a.id)}>
                  {label(a)}
                  {busy.has(a.id) ? t("（已有进行中的目标）", " (has an active goal)") : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-limit">{t("工具调用上限", "Tool-call limit")}</label>
            <input id="a-limit" className="input num" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="a-paths">{t("允许的路径", "Allowed paths")}</label>
            <textarea id="a-paths" className="textarea mono" rows={2} value={paths} onChange={(e) => setPaths(e.target.value)} />
          </div>
          <div className="field full">
            <Btn
              kind="primary"
              label={t("下一步：查看费用", "Next: see the fee")}
              disabled={!agent || !/^[1-9][0-9]*$/.test(limit.trim()) || !paths.trim() || !app.deviceProfile}
              why={t("选择 Agent 并填写约定", "Choose an Agent and fill in the agreement")}
              onClick={() => setStart(true)}
            />
          </div>
        </div>
      )}
    </section>
  );
}
