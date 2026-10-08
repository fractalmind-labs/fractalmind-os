// App v2 (#75, M2): New OKR, as the prototype wizard (view-okr.js): objective,
// success criteria, key results, agreement, confirm. Confirming creates the
// encrypted draft (one transaction), then assigns it to the chosen Agent (a
// second, separately confirmed transaction) and delivers it to its Home.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { IndexedDbTransactionJournal, type SelfPayFeeQuote } from "@fractalmind-labs/fractalmind-sdk";
import { useApp } from "../store";
import { go } from "../router";
import { Btn, Icon, sui, useT } from "../ui";
import { activeOkrs } from "../model";
import { AssignFlow, assignable, errorCode, errorText, useAgentLabel } from "../okr-flow";
import { ChainReadSession } from "../../chain";
import { NativeDeviceSigner } from "../../native-device";
import { deviceGrant } from "../../device-grant";
import { normalizeDraft, OkrDraftCreation, type DraftInput } from "../../okr-draft";
import { parseOkrProposal, type OkrProposal } from "../../okr-proposal";
import { awaitTransactionVisible } from "../../transaction-visibility";

const KEY = "fractalmind.v2.okr-new.v1";
type Kr = { title: string; baseline: string; target: string; unit: string; weight: string; verify: "user" | "preauthorized" };
type Form = {
  logicalId: string;
  step: number;
  objective: string;
  priority: 0 | 1 | 2;
  days: string;
  agentId: string;
  criteria: string[];
  krs: Kr[];
  maxCalls: string;
  paths: string;
  escalate: boolean[];
  /** From an Agent's proposal: extra prohibited actions, an exact deadline
   * and where it came from. */
  extraProhibited?: string[];
  deadlineMs?: string;
  importedFrom?: string;
};
const ESCALATION: [string, string][] = [
  ["调用付费外部服务或上传代码到第三方", "Paid external services or uploading code to third parties"],
  ["修改签名证书、发布渠道或凭据", "Changing signing certificates, release channels or credentials"],
  ["删除或改写已上链的记录", "Deleting or rewriting on-chain records"],
  ["在允许路径之外读写文件", "Reading or writing outside the allowed paths"],
];
const blank = (): Form => ({
  logicalId: crypto.randomUUID(),
  step: 1,
  objective: "",
  priority: 1,
  days: "30",
  agentId: "",
  criteria: [""],
  krs: [{ title: "", baseline: "", target: "", unit: "", weight: "1", verify: "user" }],
  maxCalls: "200",
  paths: ".",
  escalate: ESCALATION.map(() => true),
});
function saved(): Form {
  try {
    const f = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (f && typeof f.logicalId === "string" && Array.isArray(f.krs)) return { ...blank(), ...f };
  } catch {
    /* optional */
  }
  return blank();
}
const decimals = (v: string) => (v.includes(".") ? v.split(".")[1].length : 0);

/** The wizard form as the draft the chain record encrypts. */
export function draftInput(f: Form, t: (zh: string, en: string) => string, now = Date.now()): DraftInput {
  return {
    objective: f.objective.trim(),
    successCriteria: f.criteria.map((c) => c.trim()).filter(Boolean).join("\n"),
    priority: f.priority,
    deadlineMs: f.deadlineMs ?? String(now + Math.round(Number(f.days) * 86_400_000)),
    krs: f.krs.map((k) => ({
      title: k.title.trim(),
      unit: k.unit.trim() || "-",
      precision: Math.min(6, Math.max(decimals(k.baseline.trim()), decimals(k.target.trim()))),
      baseline: k.baseline.trim(),
      target: k.target.trim(),
      weight: k.weight.trim(),
      maxAgeMinutes: "1440",
      verificationRule:
        k.verify === "user"
          ? t("Reviewer 复核证据，由负责人验收", "A reviewer re-checks evidence; the owner accepts")
          : t("预授权验证者直接验收", "A pre-authorized verifier accepts"),
    })),
    allowedPaths: f.paths
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean),
    prohibitedActions: [...ESCALATION.filter((_, i) => f.escalate[i]).map(([zh, en]) => t(zh, en)), ...(f.extraProhibited ?? [])],
    maxCalls: f.maxCalls.trim(),
  };
}

/** Field problems the wizard shows before anything is signed. */
export function problems(f: Form, now = Date.now()) {
  const out: Record<string, [string, string]> = {};
  if (!f.objective.trim()) out.objective = ["必填", "Required"];
  if (!(Number(f.days) >= 1)) out.days = ["至少 1 天", "At least 1 day"];
  const crit = f.criteria.map((c) => c.trim()).filter(Boolean);
  if (!crit.length) out.criteria = ["至少一条成功标准", "At least one criterion"];
  else if (!crit.some((c) => /\d/.test(c))) out.criteria = ["至少一条包含可量化指标（数字）", "At least one needs a measurable number"];
  f.krs.forEach((k, i) => {
    if (!k.title.trim()) out[`kr${i}.title`] = ["必填", "Required"];
    const num = /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;
    if (!num.test(k.baseline.trim()) || !num.test(k.target.trim())) out[`kr${i}.metric`] = ["基线与目标需为非负数字", "Baseline and target must be non-negative numbers"];
    else if (Number(k.baseline) === Number(k.target)) out[`kr${i}.metric`] = ["基线不能等于目标", "Baseline cannot equal the target"];
    if (!/^[1-9][0-9]*$/.test(k.weight.trim())) out[`kr${i}.weight`] = ["需为正整数", "Must be a positive integer"];
  });
  if (!/^[1-9][0-9]*$/.test(f.maxCalls.trim())) out.maxCalls = ["需为正整数", "Must be a positive integer"];
  if (!f.escalate.some(Boolean) && !f.extraProhibited?.length) out.escalate = ["至少保留一项", "Keep at least one"];
  if (f.deadlineMs && Number(f.deadlineMs) <= now) out.days = ["截止时间已过", "The deadline has passed"];
  return out;
}

/** A proposal fills the form; the owner still reviews every step. */
export function formFromProposal(p: OkrProposal, base: Form, agentName: string, now = Date.now()): Form {
  return {
    ...base,
    step: 1,
    objective: p.objective,
    priority: p.priority,
    days: String(Math.max(1, Math.round((Number(p.deadlineMs) - now) / 86_400_000))),
    deadlineMs: p.deadlineMs,
    criteria: p.successCriteria,
    krs: p.krs.map((k) => ({ ...k })),
    maxCalls: p.maxCalls,
    paths: p.allowedPaths.join("\n"),
    escalate: ESCALATION.map(() => false),
    extraProhibited: p.prohibitedActions,
    importedFrom: agentName,
  };
}

const STEPS: [string, string][] = [
  ["目标", "Objective"],
  ["成功标准", "Criteria"],
  ["关键结果", "Key results"],
  ["执行约定", "Agreement"],
  ["确认", "Confirm"],
];
const STEP_FIELDS: Record<number, RegExp> = { 1: /^(objective|days)$/, 2: /^criteria$/, 3: /^kr/, 4: /^(maxCalls|escalate|paths)$/ };

export default function OkrNew() {
  const app = useApp();
  const t = useT();
  const { label, local } = useAgentLabel();
  const [f, setF] = useState<Form>(saved);
  const [tried, setTried] = useState(false);
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null);
  const [phase, setPhase] = useState<"form" | "quoting" | "ready" | "signing" | "created">("form");
  const [error, setError] = useState<string | null>(null);
  const [okrId, setOkrId] = useState<string | null>(null);
  const creation = useRef<OkrDraftCreation | null>(null);
  const [proposal, setProposal] = useState<OkrProposal | "invalid" | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(f));
    } catch {
      /* optional */
    }
  }, [f]);
  const agents = assignable(app.snapshot?.agents.value);
  const busy = new Set(activeOkrs(app).map((r) => r.okr.managed_agent));
  const agent = agents.find((a) => a.id === f.agentId) ?? null;
  const home = agent ? (local(agent)?.agent?.home ?? null) : null;
  useEffect(() => {
    setProposal(null);
    if (!home || !isTauri()) return;
    let live = true;
    void (invoke("fm_agent_read_proposal", { home }) as Promise<string | null>)
      .then((text) => {
        if (!live || text === null) return;
        try {
          setProposal(parseOkrProposal(text));
        } catch {
          setProposal("invalid");
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [home]);
  const issues = problems(f);
  const stepIssues = (step: number) => Object.keys(issues).filter((k) => STEP_FIELDS[step]?.test(k));
  const err = (field: string) =>
    tried && issues[field] ? (
      <div className="err-t">
        <Icon name="x" size="xs" />
        {t(...issues[field])}
      </div>
    ) : null;
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));
  const setKr = (i: number, patch: Partial<Kr>) => setF((cur) => ({ ...cur, krs: cur.krs.map((k, j) => (j === i ? { ...k, ...patch } : k)) }));
  const next = (d: number) => {
    if (d > 0 && stepIssues(f.step).length) {
      setTried(true);
      return;
    }
    set({ step: Math.min(5, Math.max(1, f.step + d)) });
  };
  const full = activeOkrs(app).length >= 3;
  const readiness = useMemo(() => {
    const out: [boolean, string, string][] = [];
    out.push([!!agent, "已选择可接 OKR 的 Agent", "An Agent that can take OKRs is chosen"]);
    out.push([!agent || !busy.has(agent.id), "这个 Agent 当前没有进行中的目标", "The Agent has no other active goal"]);
    out.push([!full, "进行中的目标未满 3 个", "Fewer than 3 goals are active"]);
    out.push([!agent || !!local(agent), "Agent 在这台电脑上，可以直接投递", "The Agent is on this computer, so the goal can be delivered"]);
    return out;
  }, [agent, full, local]);

  async function create() {
    setTried(true);
    if (Object.keys(issues).length || !app.profile || !app.deviceProfile || !app.snapshot) return;
    setPhase("quoting");
    setError(null);
    try {
      const chain = new ChainReadSession(app.profile);
      const signer = await NativeDeviceSigner.load((c, a) => invoke(c, a), app.deviceProfile);
      const orgId = app.snapshot.organization.objectId;
      const grantId = await deviceGrant(chain, signer.device.address, orgId, [1, 3]);
      creation.current = new OkrDraftCreation(chain, signer, grantId, orgId, f.logicalId, (c, a) => invoke(c, a), new IndexedDbTransactionJournal());
      // Normalizing first surfaces any remaining input problem before quoting.
      normalizeDraft(draftInput(f, t));
      const q = await creation.current.prepare(draftInput(f, t));
      if ("status" in q) {
        if (q.status === "confirmed") await created();
        else {
          setError(q.status === "failed" ? "simulation_failed" : "read_unavailable");
          setPhase("form");
        }
        return;
      }
      setQuote(q);
      setPhase("ready");
    } catch (e) {
      setError(errorCode(e));
      setPhase("form");
    }
  }
  async function sign() {
    if (!quote || !creation.current) return;
    setPhase("signing");
    try {
      const outcome = await creation.current.submit(quote);
      if (outcome.status !== "confirmed") {
        setError(outcome.status === "failed" ? "simulation_failed" : "read_unavailable");
        setPhase("form");
        return;
      }
      await awaitTransactionVisible(creation.current.chain, outcome).catch(() => false);
      await created();
    } catch (e) {
      setError(errorCode(e));
      setPhase("form");
    }
  }
  /** Finds the new OKR by its logical ID, then clears the saved form. */
  async function created() {
    const chain = creation.current!.chain;
    const orgId = app.snapshot!.organization.objectId;
    let id: string | null = null;
    for (let attempt = 0; attempt < 10 && !id; attempt++) {
      const page = await chain.sdk.okr.listOkrs(orgId, null, 50).catch(() => ({ okrs: [] as { id: string; logical_id: string }[] }));
      id = page.okrs.find((o) => o.logical_id === f.logicalId)?.id ?? null;
      if (!id) await new Promise((r) => setTimeout(r, 1000));
    }
    setOkrId(id);
    setPhase("created");
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* optional */
    }
    app.refresh();
  }

  const nav = STEPS.map(([zh, en], i) => (
    <span key={zh} className={i + 1 === f.step ? "on" : i + 1 < f.step ? "done" : ""}>
      <b>{i + 1 < f.step ? "✓" : i + 1}</b>
      {t(zh, en)}
    </span>
  ));
  let body: React.ReactNode = null;
  if (phase === "created")
    body = (
      <div className="col">
        <div className="calm">
          <Icon name="check" />
          <span>{t("OKR 已创建（草稿）。", "The OKR is created (draft).")}</span>
        </div>
        {okrId && agent && !busy.has(agent.id) ? (
          <>
            <div className="label">{t("分配给 Agent", "Assign to the Agent")}</div>
            <AssignFlow
              okrId={okrId}
              agent={agent}
              budgetLimit={f.maxCalls.trim()}
              allowedPaths={draftInput(f, t).allowedPaths}
              onAssigned={app.refresh}
            />
          </>
        ) : (
          <div className="note">
            <Icon name="info" />
            <div>
              {agent && busy.has(agent.id)
                ? t(
                    `草稿已保存。${label(agent)} 还有一个进行中的目标：暂停或完成它之后，在这个 OKR 的详情里分配。`,
                    `The draft is saved. ${label(agent)} still has an active goal: pause or finish it, then assign from this OKR's detail.`,
                  )
                : t("草稿已保存，可在 OKR 详情中分配给 Agent。", "The draft is saved; assign it to an Agent from the OKR detail.")}
            </div>
          </div>
        )}
      </div>
    );
  else if (f.step === 1)
    body = (
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="w-title">{t("Objective（一句话结果目标：动词 + 结果）", "Objective (one sentence: verb + outcome)")}</label>
          <textarea
            id="w-title"
            className="textarea"
            rows={2}
            value={f.objective}
            placeholder={t("例如：让团队周报可以一键生成并附来源", "e.g. Make weekly reports one-click with cited sources")}
            onChange={(e) => set({ objective: e.target.value })}
          />
          {err("objective")}
        </div>
        <div className="field">
          <span className="label">{t("优先级", "Priority")}</span>
          <div className="seg">
            {([0, 1, 2] as const).map((p) => (
              <button key={p} aria-pressed={f.priority === p} onClick={() => set({ priority: p })}>
                P{p}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="w-days">{t("期限（天）", "Timeframe (days)")}</label>
          <input id="w-days" className="input num" type="number" min={1} value={f.days} onChange={(e) => set({ days: e.target.value, deadlineMs: undefined })} />
          {err("days")}
        </div>
        <div className="field full">
          <label htmlFor="w-owner">{t("负责 Agent", "Owner Agent")}</label>
          <select id="w-owner" className="select" value={f.agentId} onChange={(e) => set({ agentId: e.target.value })}>
            <option value="">{t("先不分配（保存为草稿）", "Not yet (save as draft)")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {label(a)}
                {busy.has(a.id) ? t("（已有进行中的目标：先存为草稿）", " (has an active goal: saved as a draft)") : ""}
              </option>
            ))}
          </select>
          {!agents.length && (
            <div className="small muted mt-4">
              {t("还没有可接 OKR 的 Agent：在“团队与 Agents”新建或导入 agent-manager Agent。", "No Agent can take OKRs yet: create or import an agent-manager Agent in Team & Agents.")}
            </div>
          )}
        </div>
        {agent && local(agent)?.agent && (
          <div className="field full">
            <span className="label">{t("工作区（Agent Home）", "Workspace (Agent Home)")}</span>
            <div className="small mono">{local(agent)!.agent!.home}</div>
          </div>
        )}
        {agent && proposal && (
          <div className="field full">
            {proposal === "invalid" ? (
              <div className="note warn">
                <Icon name="alert" />
                <div className="small">{t("这个 Agent 留的 OKR 提案格式不正确，无法导入。", "This Agent's OKR proposal is not in the expected format.")}</div>
              </div>
            ) : (
              <div className="note info">
                <Icon name="sparkle" />
                <div className="grow">
                  <div className="strong">
                    {t(`${label(agent)} 提出了一个 OKR`, `${label(agent)} proposed an OKR`)}
                  </div>
                  <div className="small">{proposal.objective}</div>
                  <div className="tiny muted">
                    {t(`${proposal.krs.length} 个 KR`, `${proposal.krs.length} KRs`)}
                    {proposal.source ? ` · ${t("来自", "from")} ${proposal.source}` : ""} · {t("导入后逐步核对，签名前不会提交", "Review each step after importing; nothing is submitted before you sign")}
                  </div>
                </div>
                <Btn size="sm" kind="primary" label={t("导入提案", "Import proposal")} onClick={() => setF((cur) => formFromProposal(proposal, cur, label(agent)))} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  else if (f.step === 2)
    body = (
      <>
        <div className="note">
          <Icon name="info" />
          <div>
            {t(
              "1–3 条可二元验证的成功标准，至少一条包含可量化指标。自由文本不能直接推断验收通过。",
              "1–3 binary-verifiable criteria, at least one measurable. Free text alone never implies acceptance.",
            )}
          </div>
        </div>
        {f.criteria.map((c, i) => (
          <div className="field" key={i}>
            <label htmlFor={`w-c${i}`}>
              {t("成功标准", "Criterion")} {i + 1}
            </label>
            <div className="row">
              <input
                id={`w-c${i}`}
                className="input"
                value={c}
                placeholder={t("例如：核心流程成功率 ≥ 95%", "e.g. Core flow success rate ≥ 95%")}
                onChange={(e) => set({ criteria: f.criteria.map((x, j) => (j === i ? e.target.value : x)) })}
              />
              {f.criteria.length > 1 && (
                <Btn kind="ghost" size="icon" icon="x" aria={t("删除", "Remove")} onClick={() => set({ criteria: f.criteria.filter((_, j) => j !== i) })} />
              )}
            </div>
          </div>
        ))}
        {err("criteria")}
        {f.criteria.length < 3 && <Btn size="sm" icon="plus" label={t("添加成功标准", "Add criterion")} onClick={() => set({ criteria: [...f.criteria, ""] })} />}
      </>
    );
  else if (f.step === 3)
    body = (
      <>
        <div className="note">
          <Icon name="info" />
          <div>
            {t(
              "KR 描述可观察的结果；“安装工具”“实现模块”等执行步骤由 Agent 放进计划。",
              "KRs describe observable results; steps like “install a tool” go into the Agent’s plan.",
            )}
          </div>
        </div>
        {f.krs.map((k, i) => (
          <div className="card soft tight" key={i}>
            <div className="row between">
              <strong>KR{i + 1}</strong>
              {f.krs.length > 1 && (
                <Btn kind="ghost" size="icon sm" icon="x" aria={t("删除", "Remove")} onClick={() => set({ krs: f.krs.filter((_, j) => j !== i) })} />
              )}
            </div>
            <div className="form-grid mt-8">
              <div className="field full">
                <label htmlFor={`w-k${i}t`}>{t("可观察的结果", "Observable result")}</label>
                <input
                  id={`w-k${i}t`}
                  className="input"
                  value={k.title}
                  placeholder={t("例如：核心流程成功率", "e.g. Core flow success rate")}
                  onChange={(e) => setKr(i, { title: e.target.value })}
                />
                {err(`kr${i}.title`)}
              </div>
              <div className="field">
                <label htmlFor={`w-k${i}b`}>{t("基线", "Baseline")}</label>
                <input id={`w-k${i}b`} className="input num" inputMode="decimal" value={k.baseline} onChange={(e) => setKr(i, { baseline: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`w-k${i}g`}>{t("目标", "Target")}</label>
                <input id={`w-k${i}g`} className="input num" inputMode="decimal" value={k.target} onChange={(e) => setKr(i, { target: e.target.value })} />
                {err(`kr${i}.metric`)}
              </div>
              <div className="field">
                <label htmlFor={`w-k${i}u`}>{t("单位", "Unit")}</label>
                <input id={`w-k${i}u`} className="input" value={k.unit} placeholder="% / ms / 个" onChange={(e) => setKr(i, { unit: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`w-k${i}w`}>{t("权重", "Weight")}</label>
                <input id={`w-k${i}w`} className="input num" inputMode="numeric" value={k.weight} onChange={(e) => setKr(i, { weight: e.target.value })} />
                {err(`kr${i}.weight`)}
              </div>
              <div className="field full">
                <label htmlFor={`w-k${i}v`}>{t("验证方式", "Verification")}</label>
                <select id={`w-k${i}v`} className="select" value={k.verify} onChange={(e) => setKr(i, { verify: e.target.value as Kr["verify"] })}>
                  <option value="user">{t("Reviewer 复核，由你验收", "Reviewer re-checks; you accept")}</option>
                  <option value="preauthorized">{t("预授权验证者直接验收", "Pre-authorized verifier accepts")}</option>
                </select>
              </div>
            </div>
          </div>
        ))}
        {f.krs.length < 3 && (
          <Btn
            size="sm"
            icon="plus"
            label={t("添加 KR", "Add KR")}
            onClick={() => set({ krs: [...f.krs, { title: "", baseline: "", target: "", unit: "", weight: "1", verify: "user" }] })}
          />
        )}
      </>
    );
  else if (f.step === 4)
    body = (
      <>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="w-calls">{t("工具调用上限（记录在约定中）", "Tool-call limit (recorded in the agreement)")}</label>
            <input id="w-calls" className="input num" inputMode="numeric" value={f.maxCalls} onChange={(e) => set({ maxCalls: e.target.value })} />
            {err("maxCalls")}
          </div>
          <div className="field">
            <label htmlFor="w-paths">{t("允许的路径（相对 Home，每行一个）", "Allowed paths (relative to Home, one per line)")}</label>
            <textarea id="w-paths" className="textarea mono" rows={3} value={f.paths} onChange={(e) => set({ paths: e.target.value })} />
          </div>
          <div className="field full">
            <span className="label">{t("升级条件（需要你批准）", "Escalate (needs your approval)")}</span>
            {ESCALATION.map(([zh, en], i) => (
              <label className="check" key={zh}>
                <input type="checkbox" checked={f.escalate[i]} onChange={(e) => set({ escalate: f.escalate.map((x, j) => (j === i ? e.target.checked : x)) })} />
                {t(zh, en)}
              </label>
            ))}
            {(f.extraProhibited ?? []).map((x, i) => (
              <label className="check" key={`x${i}`}>
                <input type="checkbox" checked onChange={() => set({ extraProhibited: f.extraProhibited!.filter((_, j) => j !== i) })} />
                {x}
              </label>
            ))}
            {err("escalate")}
          </div>
        </div>
        <div className="note">
          <Icon name="shield" />
          <div>
            <div className="strong">{t("agent-manager Agent 的约束如实说明", "What applies to an agent-manager Agent")}</div>
            <div className="small">
              {t(
                "FractalMind 会：把目标写入 Agent 的 Home 并通知它、到期或手动停止、记录进度与证据（标为“Agent 声明”，由你验收）。",
                "FractalMind will deliver the goal to the Agent's Home and tell it, stop it on deadline or request, and record progress and evidence (marked Agent-claimed, for your acceptance).",
              )}
            </div>
            <div className="small">
              {t(
                "不能强制：工具调用、路径与模型花费由 Agent 自己的启动配置决定；上面的上限和路径写进约定，供 Agent 遵守与你核对。",
                "Cannot enforce: tool use, paths and model spending follow the Agent's own launch configuration; the limit and paths above go into the agreement for the Agent to follow and you to check.",
              )}
            </div>
          </div>
        </div>
      </>
    );
  else
    body = (
      <>
        <div className="card soft tight">
          <div className="row gap-sm">
            <span className={`prio P${f.priority}`}>P{f.priority}</span>
            <strong>{f.objective || t("（未填写目标）", "(no objective)")}</strong>
          </div>
          <div className="small muted mt-4">
            {agent ? label(agent) : t("暂不分配", "Not assigned yet")} · {t(`${f.days} 天`, `${f.days} days`)} ·{" "}
            {t(`工具调用上限 ${f.maxCalls}`, `tool-call limit ${f.maxCalls}`)}
          </div>
          <ul className="small mt-8" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {f.criteria.filter((c) => c.trim()).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <div className="col gap-sm mt-8">
            {f.krs.map((k, i) => (
              <div className="small" key={i}>
                <strong>KR{i + 1}</strong> {k.title} · {k.baseline} → {k.target} {k.unit} · {t("权重", "weight")} {k.weight}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="label">{t("质量校验", "Quality gate")}</div>
          {(
            [
              [!issues.objective, "Objective 以结果为导向", "Objective is outcome-oriented"],
              [!issues.criteria, "成功标准可量化并可二元验证", "Criteria are measurable and binary"],
              [!Object.keys(issues).some((k) => k.startsWith("kr")), "每个 KR 有基线、目标、权重与验证方式", "Each KR has baseline, target, weight and verification"],
              [!issues.maxCalls && !issues.escalate, "执行约定完整", "Agreement complete"],
            ] as const
          ).map(([ok, zh, en]) => (
            <div key={zh} className="row small mt-4" style={{ color: ok ? "var(--ok)" : "var(--danger)" }}>
              <Icon name={ok ? "check" : "x"} size="sm" />
              {t(zh, en)}
            </div>
          ))}
        </div>
        {agent && (
          <div>
            <div className="label">{t("运行准备", "Readiness")}</div>
            {readiness.map(([ok, zh, en]) => (
              <div key={zh} className="row small mt-4" style={{ color: ok ? "var(--ok)" : "var(--danger)" }}>
                <Icon name={ok ? "check" : "x"} size="sm" />
                {t(zh, en)}
              </div>
            ))}
          </div>
        )}
        <div className="small muted">
          {agent && !busy.has(agent.id)
            ? t("两笔链上交易：创建 OKR，然后分配给 Agent；每笔都会先显示费用。", "Two chain transactions: create the OKR, then assign it; each shows its fee first.")
            : t("一笔链上交易：创建 OKR 草稿。", "One chain transaction: create the OKR draft.")}
        </div>
      </>
    );

  const back =
    f.step > 1 && phase === "form" ? (
      <Btn icon="left" label={t("上一步", "Back")} onClick={() => next(-1)} />
    ) : (
      <Btn label={t("取消", "Cancel")} onClick={() => go("okrs")} disabled={phase === "signing"} />
    );
  const actions =
    phase === "created" ? (
      <Btn label={t("完成", "Done")} kind="primary" onClick={() => go(okrId ? `okrs/${okrId}` : "okrs")} />
    ) : f.step < 5 ? (
      <Btn kind="primary" label={t("下一步", "Next")} iconEnd="right" onClick={() => next(1)} />
    ) : phase === "ready" ? (
      <Btn kind="primary" label={t(`签名创建 · 预计 ${sui(quote!.estimatedGas)}`, `Sign and create · est. ${sui(quote!.estimatedGas)}`)} onClick={() => void sign()} />
    ) : (
      <Btn
        kind="primary"
        disabled={!isTauri() || !app.deviceProfile || phase !== "form"}
        why={!isTauri() ? t("需要在桌面 App 中操作", "Needs the desktop App") : t("请先解锁本设备", "Unlock this device first")}
        label={
          phase === "quoting"
            ? t("计算费用…", "Estimating…")
            : phase === "signing"
              ? t("正在创建…", "Creating…")
              : agent && !busy.has(agent.id)
                ? t("创建并分配", "Create and assign")
                : t("保存为草稿", "Save as draft")
        }
        onClick={() => void create()}
      />
    );
  return (
    <>
      <a className="back" href="#/okrs">
        <Icon name="left" size="sm" />
        {t("OKR 列表", "OKRs")}
      </a>
      <div className="page-h">
        <div>
          <h1>{t("新建 OKR", "New OKR")}</h1>
          <p className="muted">{t("你确认结果与边界；Agent 自主拆解任务、执行和汇报。", "You confirm results and limits; the Agent plans, executes and reports.")}</p>
        </div>
      </div>
      <div className="steps-nav">{nav}</div>
      {f.importedFrom && phase === "form" && (
        <div className="note" style={{ maxWidth: 820, marginBottom: 12 }}>
          <Icon name="info" />
          <div className="small">
            {t(
              `内容来自 ${f.importedFrom} 的提案，尚未提交。请逐步核对，尤其是 KR 的基线与目标。`,
              `Imported from ${f.importedFrom}'s proposal and not submitted. Review each step, especially the KR baselines and targets.`,
            )}
          </div>
        </div>
      )}
      <div className="card" style={{ maxWidth: 820 }}>
        <div className="col gap-lg">
          {error && (
            <div className="note warn" role="alert">
              <Icon name="alert" />
              <div>{errorText(error, t)}</div>
            </div>
          )}
          {body}
        </div>
        <div className="card-f" style={{ justifyContent: "space-between" }}>
          {back}
          <div className="row">{actions}</div>
        </div>
      </div>
    </>
  );
}
