import { useEffect, useRef, useState } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  TransactionPreflightError,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  NativeDeviceSigner,
  NativeDeviceError,
  preferredDeviceProfile,
  type NativeInvoke,
} from "./native-device";
import { ChainReadSession, normalizeProfile } from "./chain";
import {
  OkrDraftCreation,
  normalizeDraft,
  OkrDraftError,
  type DraftInput,
  type DraftKr,
} from "./okr-draft";
import type { ConnectionProfile } from "./domain";
const transport: NativeInvoke = (command, args) => invoke(command, args);
const blankKr = (): DraftKr => ({
  title: "",
  unit: "",
  precision: 0,
  baseline: "0",
  target: "1",
  weight: "1",
  maxAgeMinutes: "5",
  verificationRule: "",
});
function deadlineDefault() {
  const d = new Date(Date.now() + 7 * 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
const pendingKey = "fractalmind.app.okr-draft-attempt.v1";
type Attempt = {
  logicalId: string;
  deviceProfile: string;
  profile: ConnectionProfile;
  organizationId: string;
};
export default function CreateOkr({
  profile,
  organizationId,
  t,
  onCreated,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  t: (zh: string, en: string) => string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false),
    [objective, setObjective] = useState(""),
    [criteria, setCriteria] = useState("");
  const [priority, setPriority] = useState(1),
    [deadline, setDeadline] = useState(deadlineDefault),
    [krs, setKrs] = useState<DraftKr[]>([blankKr()]);
  const [paths, setPaths] = useState(""),
    [prohibited, setProhibited] = useState(""),
    [maxCalls, setMaxCalls] = useState("20");
  const [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile),
    [attempt, setAttempt] = useState<Attempt | null>(null);
  const [review, setReview] = useState<ReturnType<
      typeof normalizeDraft
    > | null>(null),
    [quote, setQuote] = useState<SelfPayFeeQuote | null>(null),
    [outcome, setOutcome] = useState<SelfPayTransactionOutcome | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [now, setNow] = useState(Date.now());
  const session = useRef<OkrDraftCreation | null>(null),
    journal = useRef<IndexedDbTransactionJournal | null>(null),
    flight = useRef(false),
    mounted = useRef(true);
  const attemptKey = `${pendingKey}:${JSON.stringify([profile.network, profile.chainIdentifier ?? "", profile.humanId, organizationId])}`;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      void journal.current?.close();
    };
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  function change() {
    setReview(null);
    setQuote(null);
    setError(null);
  }
  const locked = busy || !!outcome || !!quote;
  function input(): DraftInput {
    const time = new Date(deadline).getTime();
    if (!Number.isSafeInteger(time) || time < 1)
      throw new OkrDraftError("invalid_input");
    return {
      objective,
      successCriteria: criteria,
      priority,
      deadlineMs: String(time),
      krs,
      allowedPaths: paths.split("\n").filter((p) => p.trim()),
      prohibitedActions: prohibited.split("\n").filter((p) => p.trim()),
      maxCalls,
    };
  }
  function reviewDraft() {
    try {
      const spec = normalizeDraft(input());
      if (BigInt(spec.deadlineMs) <= BigInt(Date.now()))
        throw new OkrDraftError("deadline_expired");
      setReview(spec);
      setError(null);
    } catch (e) {
      setReview(null);
      setError(e instanceof OkrDraftError ? e.code : "invalid_input");
    }
  }
  function editKr(index: number, key: keyof DraftKr, value: string | number) {
    change();
    setKrs((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  }
  function saveAttempt(value: Attempt) {
    localStorage.setItem(attemptKey, JSON.stringify(value));
    setAttempt(value);
  }
  async function load(value: Attempt, forQuery = false) {
    const signer = await NativeDeviceSigner.load(
        transport,
        value.deviceProfile,
      ),
      chain = new ChainReadSession(profile);
    const identity = await chain.human();
    const all = identity.grants.value?.filter(
      (g) => g.device === signer.device.address,
    );
    const candidates = all?.filter(
      (g) =>
        g.device === signer.device.address &&
        !g.revoked &&
        g.generation === identity.human.generation &&
        g.actions.includes(1) &&
        g.actions.includes(3) &&
        (g.org_scope === null || g.org_scope === organizationId) &&
        BigInt(g.expires_at_ms) > identity.clockMs,
    );
    // Prefer a specifically scoped grant, then the root; ambiguous sources fail closed.
    const scoped = candidates?.filter((g) => g.org_scope === organizationId),
      usable = scoped?.length ? scoped : candidates;
    const selected = forQuery
      ? all?.[0]
      : usable?.length === 1
        ? usable[0]
        : undefined;
    // Public original-digest queries remain available after revocation. The
    // controller independently requires live approval authority before writes.
    if (!selected) throw new Error("Device grant not found");
    journal.current ??= new IndexedDbTransactionJournal();
    session.current = new OkrDraftCreation(
      chain,
      signer,
      selected.id,
      organizationId,
      value.logicalId,
      transport,
      journal.current,
    );
    return session.current;
  }
  async function run(action: "prepare" | "submit" | "query") {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    try {
      let value = attempt;
      if (!value) {
        value = {
          logicalId: crypto.randomUUID(),
          deviceProfile,
          profile,
          organizationId,
        };
      }
      const client = session.current ?? (await load(value, action === "query"));
      if (!attempt) saveAttempt(value);
      if (action === "query") {
        const found = await client.query();
        if (mounted.current) {
          setOutcome(found ?? null);
          if (found) setQuote(null);
          else if (!quote) session.current = null;
          if (!found) setError("not_sent");
          if (found?.status === "confirmed") onCreated();
        }
      } else if (action === "submit") {
        if (!quote) throw new OkrDraftError("invalid_quote");
        const found = await client.submit(quote);
        if (mounted.current) {
          setQuote(null);
          setOutcome(found);
          if (found.status === "confirmed") onCreated();
        }
      } else {
        const result = await client.prepare(input());
        if (mounted.current) {
          if ("status" in result) {
            setOutcome(result);
            setQuote(null);
            if (result.status === "confirmed") onCreated();
          } else setQuote(result);
        }
      }
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof OkrDraftError ||
            e instanceof TransactionPreflightError ||
            e instanceof NativeDeviceError
            ? e.code
            : "operation_failed",
        );
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function start() {
    setOpen(true);
    setError(null);
    try {
      const raw = JSON.parse(localStorage.getItem(attemptKey) ?? "null");
      if (
        raw &&
        JSON.stringify(normalizeProfile(raw.profile)) ===
          JSON.stringify(normalizeProfile(profile)) &&
        raw.organizationId === organizationId &&
        typeof raw.deviceProfile === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          raw.logicalId,
        )
      ) {
        setAttempt(raw);
        setDeviceProfile(raw.deviceProfile);
      }
    } catch {}
  }
  function newCandidate() {
    if (busy || !outcome || outcome.status === "unknown") return;
    localStorage.removeItem(attemptKey);
    setAttempt(null);
    session.current = null;
    setOutcome(null);
    setQuote(null);
    setReview(null);
    setError(null);
  }
  function close() {
    if (busy) return;
    dialog.current?.close();
    setOpen(false);
    setObjective("");
    setCriteria("");
    setKrs([blankKr()]);
    setPaths("");
    setProhibited("");
    setReview(null);
    setQuote(null);
    session.current = null;
    setOutcome(null);
  }
  const ready = isTauri();
  return (
    <>
      <button onClick={start}>{t("创建 OKR 候选", "Create OKR draft")}</button>
      {open && (
        <dialog
          ref={dialog}
          className="okr-create-dialog"
          aria-labelledby="okr-create-title"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <header>
            <h2 id="okr-create-title">
              {t("创建 OKR 候选", "Create OKR draft")}
            </h2>
            <button
              disabled={busy}
              onClick={close}
              aria-label={t("关闭", "Close")}
            >
              ×
            </button>
          </header>
          <p>
            {t(
              "先保存目标、量化 KR 和约束。链上确认后为草稿；激活还需要工作区、Host、Agent 能力和执行授权。",
              "Save the objective, measurable KRs and constraints first. Confirmation creates a draft; activation still requires workspace, Host, Agent capability and execution authority.",
            )}
          </p>
          {!ready && (
            <p role="status">
              {t(
                "网页可检查候选；保存需要原生 App 的已授权设备，不会导入私钥。",
                "The web can review a candidate; saving requires an authorized native App device, with no private-key import.",
              )}
            </p>
          )}
          {attempt && (
            <div className="panel">
              <p>
                {t("本次请求", "This request")}:{" "}
                <code>{attempt.logicalId}</code>
              </p>
              <button
                disabled={busy || !ready}
                onClick={() => void run("query")}
              >
                {t(
                  "查询原交易，不重新提交",
                  "Query original transaction without resubmitting",
                )}
              </button>
            </div>
          )}
          <fieldset disabled={locked}>
            <label>
              {t("目标 Objective", "Objective")}
              <input
                maxLength={512}
                value={objective}
                onChange={(e) => {
                  change();
                  setObjective(e.target.value);
                }}
              />
            </label>
            <label>
              {t("总体成功标准", "Overall success criteria")}
              <textarea
                maxLength={4096}
                value={criteria}
                onChange={(e) => {
                  change();
                  setCriteria(e.target.value);
                }}
              />
            </label>
            <div className="okr-form-grid">
              <label>
                {t("优先级", "Priority")}
                <select
                  value={priority}
                  onChange={(e) => {
                    change();
                    setPriority(Number(e.target.value));
                  }}
                >
                  {[0, 1, 2].map((n) => (
                    <option key={n} value={n}>
                      P{n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("截止时间（本地时区）", "Deadline (local time)")}
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => {
                    change();
                    setDeadline(e.target.value);
                  }}
                />
              </label>
            </div>
            <h3>{t("量化 KR（1–3 个）", "Measurable KRs (1–3)")}</h3>
            {krs.map((kr, i) => (
              <section className="panel" key={i}>
                <h4>KR {i + 1}</h4>
                <label>
                  {t("结果名称", "Result title")}
                  <input
                    maxLength={256}
                    value={kr.title}
                    onChange={(e) => editKr(i, "title", e.target.value)}
                  />
                </label>
                <div className="okr-form-grid">
                  <label>
                    {t("单位", "Unit")}
                    <input
                      maxLength={64}
                      value={kr.unit}
                      onChange={(e) => editKr(i, "unit", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("小数位（0–6）", "Decimal places (0–6)")}
                    <select
                      value={kr.precision}
                      onChange={(e) =>
                        editKr(i, "precision", Number(e.target.value))
                      }
                    >
                      {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("非负基线", "Nonnegative baseline")}
                    <input
                      inputMode="decimal"
                      value={kr.baseline}
                      onChange={(e) => editKr(i, "baseline", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("非负目标值", "Nonnegative target")}
                    <input
                      inputMode="decimal"
                      value={kr.target}
                      onChange={(e) => editKr(i, "target", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("权重（1–1000000）", "Weight (1–1000000)")}
                    <input
                      inputMode="numeric"
                      value={kr.weight}
                      onChange={(e) => editKr(i, "weight", e.target.value)}
                    />
                  </label>
                  <label>
                    {t("观测有效期（分钟）", "Observation max age (minutes)")}
                    <input
                      inputMode="numeric"
                      value={kr.maxAgeMinutes}
                      onChange={(e) =>
                        editKr(i, "maxAgeMinutes", e.target.value)
                      }
                    />
                  </label>
                </div>
                <label>
                  {t(
                    "证据与独立验证规则",
                    "Evidence and independent verification rule",
                  )}
                  <textarea
                    maxLength={2048}
                    value={kr.verificationRule}
                    onChange={(e) =>
                      editKr(i, "verificationRule", e.target.value)
                    }
                  />
                </label>
                <button
                  type="button"
                  disabled={krs.length === 1}
                  onClick={() => {
                    change();
                    setKrs((rows) => rows.filter((_, n) => n !== i));
                  }}
                >
                  {t("删除此 KR", "Remove KR")}
                </button>
              </section>
            ))}
            <button
              type="button"
              disabled={krs.length >= 3}
              onClick={() => {
                change();
                setKrs((rows) => [...rows, blankKr()]);
              }}
            >
              {t("添加 KR", "Add KR")}
            </button>
            <h3>{t("执行约束", "Execution constraints")}</h3>
            <label>
              {t(
                "允许的项目内路径（每行一个）",
                "Allowed project-relative paths (one per line)",
              )}
              <textarea
                value={paths}
                placeholder="src"
                onChange={(e) => {
                  change();
                  setPaths(e.target.value);
                }}
              />
            </label>
            <label>
              {t("禁止的动作（每行一个）", "Prohibited actions (one per line)")}
              <textarea
                value={prohibited}
                onChange={(e) => {
                  change();
                  setProhibited(e.target.value);
                }}
              />
            </label>
            <label>
              {t(
                "工具调用预算上限（激活前再次确认）",
                "Tool-call limit (confirm again before activation)",
              )}
              <input
                inputMode="numeric"
                value={maxCalls}
                onChange={(e) => {
                  change();
                  setMaxCalls(e.target.value);
                }}
              />
            </label>
            <label>
              {t("已授权本机设备配置名", "Authorized local device profile")}
              <input
                maxLength={64}
                value={deviceProfile}
                disabled={!!attempt}
                onChange={(e) => {
                  change();
                  setDeviceProfile(e.target.value);
                }}
              />
            </label>
            <button onClick={reviewDraft}>
              {t("检查候选", "Review candidate")}
            </button>
          </fieldset>
          {review && (
            <div className="panel">
              <h3>{t("待保存候选", "Candidate to save")}</h3>
              <strong>{review.objective}</strong>
              <p>{review.successCriteria}</p>
              <p>
                {t("KR 数量", "KR count")}: {review.krs.length} ·{" "}
                {t("预算上限", "Budget limit")}:{" "}
                {review.constraints.budget.limit} TOOL_CALLS
              </p>
              {review.krs.map((kr, i) => (
                <p key={i}>
                  KR{i + 1}: {kr.title} · {kr.baseline} → {kr.target} /{" "}
                  {t("比例因子", "Scale")} {kr.scale} · {kr.unit}
                </p>
              ))}
            </div>
          )}
          <button
            disabled={!ready || busy || !review || !!quote || !!outcome}
            onClick={() => void run("prepare")}
          >
            {t("原生加密并获取费用报价", "Encrypt natively and quote fee")}
          </button>
          {quote && (
            <div className="panel">
              <h3>{t("确认保存草稿的费用", "Confirm the draft fee")}</h3>
              <p>
                {t("付款设备", "Paying device")}:{" "}
                <code className="long-id">{quote.sender}</code>
              </p>
              <p>
                {t("预计费用", "Estimated fee")}:{" "}
                {Number(quote.estimatedGas) / 1e9} SUI ·{" "}
                {t("Gas 上限", "Gas ceiling")}: {Number(quote.gasBudget) / 1e9}{" "}
                SUI
              </p>
              <code className="long-id">{quote.digest}</code>
              <p>
                {t(
                  "只有目标正文加密；组织、截止时间、指标整数、优先级和交易元数据公开。保存不会启动 Agent。",
                  "The specification body is encrypted; organization, deadline, integer metrics, priority and transaction metadata are public. Saving does not start an Agent.",
                )}
              </p>
              <button
                disabled={busy || now >= quote.expiresAtMs}
                onClick={() => void run("submit")}
              >
                {t("确认费用并保存草稿", "Confirm fee and save draft")}
              </button>
              <button disabled={busy} onClick={() => setQuote(null)}>
                {t("取消报价，继续编辑", "Cancel quote and edit")}
              </button>
              {now >= quote.expiresAtMs && (
                <p>
                  {t(
                    "报价已过期，请取消后重新报价。",
                    "Quote expired. Cancel it and obtain a new quote.",
                  )}
                </p>
              )}
            </div>
          )}
          {outcome && (
            <div className="panel" role="status">
              <h3>
                {outcome.status === "confirmed"
                  ? t("草稿交易已确认", "Draft transaction confirmed")
                  : outcome.status === "failed"
                    ? t("交易失败", "Transaction failed")
                    : t(
                        "结果未知，先查询原交易",
                        "Unknown outcome; query original transaction",
                      )}
              </h3>
              <code className="long-id">{outcome.digest}</code>
              <p>
                {t("实际 Gas", "Actual Gas")}:{" "}
                {outcome.actualGas === undefined
                  ? t("待查询", "Pending query")
                  : `${Number(outcome.actualGas) / 1e9} SUI`}
              </p>
              <p>
                {t(
                  "候选和正文以链上记录为准，目录可能稍后可见。没有自动激活或重放。",
                  "Draft and body are chain-owned; indexing may lag. No automatic activation or replay.",
                )}
              </p>
            </div>
          )}
          {outcome && outcome.status !== "unknown" && (
            <button disabled={busy} onClick={newCandidate}>
              {t(
                "原交易已终结，创建另一候选",
                "Original transaction resolved; create another candidate",
              )}
            </button>
          )}
          {busy && (
            <p role="status">
              {t(
                "检查授权、原生密钥与链上交易…",
                "Checking authority, native keys and chain transaction…",
              )}
            </p>
          )}
          {error && (
            <p role="alert">
              {error === "invalid_input"
                ? t(
                    "请填写目标、成功标准、1–3 个完整 KR 和约束。使用精确非负数，基线不能等于目标；路径不可越出项目。",
                    "Complete the objective, success criteria, 1–3 KRs and constraints. Use exact nonnegative numbers, different baseline/target and project-relative paths.",
                  )
                : error === "not_initialized"
                  ? t(
                      "此本机配置没有设备密钥。请检查配置名或在“我的身份”加载已授权设备；不会自动生成替代身份。",
                      "This local profile has no device keys. Check the profile or load an authorized device under My identity. No replacement identity is generated.",
                    )
                  : error === "needs_funds"
                    ? t(
                        "付款设备余额不足。充值后重新报价；到账不会自动提交。",
                        "Paying device needs funds. Fund it and obtain a new quote; funding does not submit.",
                      )
                    : error === "not_sent"
                      ? t(
                          "原请求尚无已发送摘要，可以检查候选后准备报价。",
                          "No sent digest for this request. Review the candidate before preparing a quote.",
                        )
                      : t(
                          "未完成保存。报价、授权、截止时间或网络可能已变化；已有摘要时先查询原交易。没有自动重放。",
                          "Save did not complete. Quote, authority, deadline or network may have changed; query any recorded digest first. No automatic replay.",
                        )}
            </p>
          )}
        </dialog>
      )}
    </>
  );
}
