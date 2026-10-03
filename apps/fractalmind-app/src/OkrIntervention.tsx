import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import {
  NativeDeviceSigner,
  preferredDeviceProfile,
  scopedNativeInvoke,
} from "./native-device";
import {
  OkrIntervention,
  independentPauseAfterUnknown,
  interventionHistory,
  rememberIntervention,
  specificationDraft,
  type OkrInterventionIntent,
  type OkrInterventionView,
} from "./okr-intervention";
import type { DraftInput } from "./okr-draft";
import type { ConnectionProfile } from "./domain";
const sui = (value: string) => {
  const n = BigInt(value),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}${a / 1000000000n}.${
    String(a % 1000000000n)
      .padStart(9, "0")
      .replace(/0+$/, "") || "0"
  } SUI`;
};
const stateLabels = [
  ["草稿", "Draft"],
  ["进行中", "Active"],
  ["已暂停", "Paused"],
  ["已达成", "Achieved"],
  ["已归档", "Archived"],
] as const;
function localDate(ms: string) {
  const d = new Date(Number(ms)),
    pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function OkrInterventionView({
  profile,
  organizationId,
  okrId,
  onChanged,
  onReviewAgreement,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  okrId: string;
  onChanged: () => void;
  onReviewAgreement: () => void;
  t: (zh: string, en: string) => string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile);
  const [view, setView] = useState<OkrInterventionView | null>(null),
    [form, setForm] = useState<DraftInput | null>(null);
  const [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [editing, setEditing] = useState(false);
  const [fee, setFee] = useState<{
      quote: SelfPayFeeQuote;
      intent: OkrInterventionIntent;
    } | null>(null),
    [receipt, setReceipt] = useState<SelfPayTransactionOutcome | null>(null);
  const [history, setHistory] = useState<SelfPayTransactionOutcome[]>([]),
    [now, setNow] = useState(Date.now());
  const dialog = useRef<HTMLDialogElement>(null),
    mounted = useRef(true),
    active = useRef(false),
    epoch = useRef(0),
    flight = useRef(false);
  const journal = useRef<IndexedDbTransactionJournal | null>(null);
  const context = useRef<{
    controller: OkrIntervention;
    assertLive: () => void;
  } | null>(null);
  const key = `fractalmind.app.okr-intervention.v1:${JSON.stringify([profile.network, profile.chainIdentifier, profile.humanId, organizationId, okrId])}`;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000),
      hide = () => {
        if (document.hidden) close();
      };
    document.addEventListener("visibilitychange", hide);
    return () => {
      mounted.current = false;
      active.current = false;
      epoch.current++;
      context.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      void journal.current?.close();
    };
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  useEffect(() => {
    if (view && Number(view.authorityExpiresAtMs) <= now) close();
  }, [now, view?.authorityExpiresAtMs]);
  function clearPrivate() {
    setView(null);
    setForm(null);
    setFee(null);
    setReason("");
    setReviewed(false);
    setEditing(false);
  }
  function close() {
    active.current = false;
    epoch.current++;
    context.current = null;
    clearPrivate();
    setReceipt(null);
    setHistory([]);
    setError(null);
    setOpen(false);
    dialog.current?.close();
  }
  function begin() {
    active.current = true;
    setOpen(true);
    void perform(read);
  }
  async function perform(fn: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    const token = epoch.current;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (mounted.current && active.current && token === epoch.current) {
        clearPrivate();
        setError(
          e && typeof e === "object" && "code" in e
            ? String(e.code)
            : "operation_failed",
        );
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function load() {
    if (context.current) return context.current;
    if (!isTauri())
      throw Object.assign(new Error(), { code: "native_unavailable" });
    const token = epoch.current,
      assertLive = () => {
        if (!mounted.current || !active.current || token !== epoch.current)
          throw Object.assign(new Error(), { code: "state_changed" });
      };
    const native = scopedNativeInvoke(
        (cmd, args) => invoke(cmd, args),
        assertLive,
      ),
      signer = await NativeDeviceSigner.load(native, deviceProfile),
      chain = new ChainReadSession(profile),
      identity = await chain.human();
    assertLive();
    const grants = identity.grants.value?.filter(
      (g) =>
        g.device === signer.device.address &&
        !g.revoked &&
        g.generation === identity.human.generation &&
        g.actions.includes(1) &&
        (g.org_scope === null || g.org_scope === organizationId) &&
        BigInt(g.expires_at_ms) > identity.clockMs,
    );
    const scoped = grants?.filter((g) => g.org_scope === organizationId),
      eligible = scoped?.length ? scoped : grants;
    if (eligible?.length !== 1)
      throw Object.assign(new Error(), { code: "invalid_grant" });
    journal.current ??= new IndexedDbTransactionJournal();
    const controller = new OkrIntervention(
      chain,
      signer,
      eligible[0].id,
      organizationId,
      okrId,
      native,
      journal.current,
      assertLive,
    );
    const restored: SelfPayTransactionOutcome[] = [];
    for (const original of interventionHistory(localStorage, key)) {
      const prior = await controller.query(original);
      assertLive();
      if (prior) restored.push(prior);
    }
    setHistory(restored);
    setReceipt(restored.at(-1) ?? null);
    context.current = { controller, assertLive };
    return context.current;
  }
  async function read() {
    const ctx = await load(),
      value = await ctx.controller.read();
    ctx.assertLive();
    setView(value);
    setForm(specificationDraft(value.spec));
    setReviewed(false);
  }
  async function prepare(intent: OkrInterventionIntent) {
    const ctx = await load(),
      value = await ctx.controller.prepare(intent, {
        reviewed,
        reason,
        replacement: form ?? undefined,
        priorUnknown: history.filter((r) => r.status === "unknown"),
      });
    ctx.assertLive();
    if ("status" in value) {
      recordReceipt(value);
      rememberIntervention(localStorage, key, value.requestId);
      return;
    }
    rememberIntervention(localStorage, key, value.requestId);
    setFee({ quote: value, intent });
    setReceipt(null);
  }
  async function submit() {
    const ctx = context.current;
    if (!ctx || !fee)
      throw Object.assign(new Error(), { code: "state_changed" });
    const value = await ctx.controller.submit(fee.quote);
    ctx.assertLive();
    recordReceipt(value);
    setFee(null);
    if (value.status === "confirmed") {
      setEditing(false);
      setReason("");
      await read();
      ctx.assertLive();
      onChanged();
    }
  }
  async function query() {
    const ctx = await load();
    for (const original of interventionHistory(localStorage, key)) {
      const next = await ctx.controller.query(original);
      ctx.assertLive();
      if (next) recordReceipt(next);
    }
    await read();
  }
  function recordReceipt(value: SelfPayTransactionOutcome) {
    const preserve = (old?: SelfPayTransactionOutcome | null) =>
      value.status === "unknown" && old?.digest === value.digest &&
      old.requestId === value.requestId && old.status !== "unknown" ? old : value;
    setReceipt(preserve);
    setHistory((old) => {
      const found = old.find((r) => r.requestId === value.requestId);
      return found ? old.map((r) => r === found ? preserve(r) : r) : [...old, value];
    });
  }
  function update<K extends keyof DraftInput>(key: K, value: DraftInput[K]) {
    setForm((old) => (old ? { ...old, [key]: value } : old));
    setReviewed(false);
  }
  const unknown = history.filter((r) => r.status === "unknown"),
    blocked = busy || !!fee || unknown.length > 0,
    canOperate = view?.actions.includes("operate"),
    canApprove = view?.actions.includes("approve"),
    pauseBlocked = busy || !!fee || !view || !canOperate ||
      Number(view.authorityExpiresAtMs) <= now ||
      unknown.some((r) => !independentPauseAfterUnknown(view.okr, {
        kind: "pause", expectedVersion: view.okr.version,
      }, r));
  const labels = {
    pause: t("暂停 OKR", "Pause OKR"),
    replace: t("修改目标规格", "Change goal specification"),
    stop: t("停止原 Run", "Stop original Run"),
  };
  return (
    <>
      <button className="secondary" onClick={begin}>
        {t("暂停与调整", "Pause & adjust")}
      </button>
      <dialog
        ref={dialog}
        className="handover-dialog okr-intervention-dialog"
        aria-label={t("OKR 介入", "OKR intervention")}
        onCancel={close}
      >
        <header className="dialog-heading">
          <div>
            <span className="eyebrow">OKR</span>
            <h2>{t("暂停与调整", "Pause & adjust")}</h2>
          </div>
          <button className="secondary" onClick={close}>
            {t("关闭", "Close")}
          </button>
        </header>
        <p className="long-id">{okrId}</p>
        <p>
          {t(
            "暂停会使旧约定失效，并在下一次工具校验时阻止继续。已经开始的操作须等待原 Run 的停止和预算结算确认。",
            "Pausing invalidates the old agreement and blocks further work at the next tool check. Already started work needs the original Run's stop and budget settlement confirmation.",
          )}
        </p>
        <label>
          {t("本机设备资料", "Device profile")}
          <input
            value={deviceProfile}
            disabled={busy || !!context.current}
            onChange={(e) => setDeviceProfile(e.target.value)}
          />
        </label>
        <div className="button-row">
          <button disabled={busy} onClick={() => void perform(read)}>
            {t("读取当前目标与原执行", "Read current goal & original Runs")}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void perform(query)}
          >
            {t("查询原介入请求", "Query original intervention request")}
          </button>
        </div>
        {error && (
          <p role="alert" className="notice">
            {error === "native_unavailable"
              ? t(
                  "请在原生 FractalMind App 解锁设备；网页不能暂停、签名或读取私有规格。",
                  "Unlock a device in the native FractalMind App. The web cannot pause, sign or read private specifications.",
                )
              : t(
                  "当前事实无法继续，请查询原请求并重新核对权限和执行记录。",
                  "Cannot continue from current facts. Query the original request and review authority and execution records.",
                )}{" "}
            <small>{error}</small>
          </p>
        )}
        {view && (
          <>
            <section className="panel">
              <h3>{view.spec.objective}</h3>
              <p>{view.spec.successCriteria}</p>
              <p>
                {t(
                  "状态／目标版本／约定版本",
                  "State / goal version / agreement version",
                )}
                :{" "}
                {t(
                  stateLabels[view.okr.state][0],
                  stateLabels[view.okr.state][1],
                )}{" "}
                / {view.okr.version} / {view.okr.agreement_version}
              </p>
              <p>
                {t("已验证 KR", "Verified KRs")}: {view.okr.next_kr}/
                {view.okr.metrics.length}
              </p>
              {view.budget && (
                <p>
                  {t(
                    "累计已用＋预留／上限",
                    "Cumulative spent + reserved / limit",
                  )}
                  : {view.budget.spent.toString()} +{" "}
                  {view.budget.reserved.toString()} / {view.okr.budget_limit}
                </p>
              )}
              {view.okr.state === 1 && canOperate && (
                <>
                  <label>
                    {t("暂停原因", "Reason for pausing")}
                    <textarea
                      maxLength={4096}
                      value={reason}
                      disabled={pauseBlocked}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setReviewed(false);
                      }}
                    />
                  </label>
                  <button
                    disabled={pauseBlocked || !reviewed || !reason.trim()}
                    onClick={() =>
                      void perform(() =>
                        prepare({
                          kind: "pause",
                          expectedVersion: view.okr.version,
                        }),
                      )
                    }
                  >
                    {t("预览暂停费用", "Review pause fee")}
                  </button>
                </>
              )}
              {view.okr.state === 2 && (
                <p>
                  {t(
                    "已暂停。停止并结清旧执行后，重新审阅及批准执行约定，才能在工作台明确继续。",
                    "Paused. Stop and settle old Runs, then review and approve a new agreement before explicitly continuing in the Workbench.",
                  )}
                </p>
              )}
            </section>
            <section className="panel">
              <h3>{t("原执行与预算", "Original Runs & budgets")}</h3>
              {!view.executions.length ? (
                <p>{t("没有执行记录", "No execution records")}</p>
              ) : (
                view.executions.map((row) => (
                  <article key={row.run.id}>
                    <code className="long-id">{row.run.id}</code>
                    <p>
                      {t(
                        "约定版本／KR／原额度／已用",
                        "Agreement / KR / original allowance / spent",
                      )}
                      : {row.claim.agreement_version} /{" "}
                      {Number(row.claim.kr_index) + 1} / {row.claim.reserved} /{" "}
                      {row.claim.spent}
                    </p>
                    <p>
                      {row.claim.settled
                        ? t("已结清", "Settled")
                        : row.run.stop_requested
                          ? t(
                              "停止已请求，等待原执行确认；预留仍保留",
                              "Stop requested; await original confirmation. Reservation retained.",
                            )
                          : t(
                              "未结清，不推断已停止",
                              "Unsettled; stop is not confirmed",
                            )}
                    </p>
                    {canOperate &&
                      !row.claim.settled &&
                      !row.run.stop_requested &&
                      [0, 1, 4].includes(row.run.state) && (
                        <button
                          className="secondary"
                          disabled={blocked || !reviewed}
                          onClick={() =>
                            void perform(() =>
                              prepare({ kind: "stop", runId: row.run.id }),
                            )
                          }
                        >
                          {t(
                            "预览停止此原 Run 的费用",
                            "Review fee to stop this original Run",
                          )}
                        </button>
                      )}
                  </article>
                ))
              )}
            </section>
            {canApprove && [0, 2].includes(view.okr.state) && (
              <section className="panel">
                <h3>{t("修改目标", "Edit goal")}</h3>
                <p>
                  {t(
                    "替换规格会重置当前 KR 测量、验证与游标；原证据仍在链上，已用预算不清零。修改后保持草稿或暂停，必须重新审阅和批准。",
                    "Replacing the specification resets current KR measurements, verifications and cursor. Original evidence remains on Sui; spent budget is retained. The goal stays draft or paused and needs a new review and approval.",
                  )}
                </p>
                <button
                  className="secondary"
                  disabled={
                    blocked ||
                    !!view.budget?.reserved ||
                    view.executions.some((e) => !e.claim.settled)
                  }
                  onClick={() => {
                    setEditing(!editing);
                    setReviewed(false);
                  }}
                >
                  {editing
                    ? t("收起修改", "Close editor")
                    : t("编辑规格", "Edit specification")}
                </button>
                {editing && form && (
                  <fieldset disabled={blocked}>
                    <label>
                      Objective
                      <input
                        value={form.objective}
                        onChange={(e) => update("objective", e.target.value)}
                      />
                    </label>
                    <label>
                      {t("整体成功标准", "Overall success criteria")}
                      <textarea
                        value={form.successCriteria}
                        onChange={(e) =>
                          update("successCriteria", e.target.value)
                        }
                      />
                    </label>
                    <label>
                      {t("目标期限", "Goal deadline")}
                      <input
                        type="datetime-local"
                        value={localDate(form.deadlineMs)}
                        onChange={(e) => {
                          const ms = Date.parse(e.target.value);
                          if (Number.isFinite(ms))
                            update("deadlineMs", String(ms));
                        }}
                      />
                    </label>
                    <label>
                      {t("优先级", "Priority")}
                      <select
                        value={form.priority}
                        onChange={(e) =>
                          update("priority", Number(e.target.value))
                        }
                      >
                        <option value={0}>{t("普通", "Normal")}</option>
                        <option value={1}>{t("重要", "Important")}</option>
                        <option value={2}>{t("紧急", "Urgent")}</option>
                      </select>
                    </label>
                    <label>
                      {t(
                        "允许的目录，逗号分隔",
                        "Allowed directories, comma separated",
                      )}
                      <input
                        value={form.allowedPaths.join(", ")}
                        onChange={(e) =>
                          update(
                            "allowedPaths",
                            e.target.value.split(",").map((v) => v.trim()),
                          )
                        }
                      />
                    </label>
                    <label>
                      {t(
                        "禁止动作，每行一项",
                        "Prohibited actions, one per line",
                      )}
                      <textarea
                        value={form.prohibitedActions.join("\n")}
                        onChange={(e) =>
                          update(
                            "prohibitedActions",
                            e.target.value.split("\n"),
                          )
                        }
                      />
                    </label>
                    <label>
                      {t(
                        "总工具预算，包含累计已用",
                        "Total tool budget, including cumulative spend",
                      )}
                      <input
                        type="number"
                        min="1"
                        value={form.maxCalls}
                        onChange={(e) => update("maxCalls", e.target.value)}
                      />
                    </label>
                    {form.krs.map((kr, index) => (
                      <fieldset key={index}>
                        <legend>KR {index + 1}</legend>
                        {(
                          [
                            ["title", t("标题", "Title")],
                            ["unit", t("单位", "Unit")],
                            ["baseline", t("基线", "Baseline")],
                            ["target", t("目标值", "Target")],
                            ["weight", t("权重", "Weight")],
                            [
                              "maxAgeMinutes",
                              t(
                                "证据有效分钟",
                                "Evidence freshness in minutes",
                              ),
                            ],
                            [
                              "verificationRule",
                              t("验证规则", "Verification rule"),
                            ],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key}>
                            {label}
                            <input
                              value={kr[key]}
                              onChange={(e) =>
                                update(
                                  "krs",
                                  form.krs.map((k, i) =>
                                    i === index
                                      ? { ...k, [key]: e.target.value }
                                      : k,
                                  ),
                                )
                              }
                            />
                          </label>
                        ))}
                        <label>
                          {t("小数位数", "Decimal precision")}
                          <input
                            type="number"
                            min="0"
                            max="6"
                            value={kr.precision}
                            onChange={(e) =>
                              update(
                                "krs",
                                form.krs.map((k, i) =>
                                  i === index
                                    ? {
                                        ...k,
                                        precision: Number(e.target.value),
                                      }
                                    : k,
                                ),
                              )
                            }
                          />
                        </label>
                        <button
                          className="secondary"
                          disabled={form.krs.length <= 1}
                          onClick={() =>
                            update(
                              "krs",
                              form.krs.filter((_, i) => i !== index),
                            )
                          }
                        >
                          {t("移除此 KR", "Remove this KR")}
                        </button>
                      </fieldset>
                    ))}
                    <button
                      className="secondary"
                      disabled={form.krs.length >= 3}
                      onClick={() =>
                        update("krs", [
                          ...form.krs,
                          {
                            title: "",
                            unit: "files",
                            precision: 0,
                            baseline: "0",
                            target: "1",
                            weight: "1",
                            maxAgeMinutes: "60",
                            verificationRule: "",
                          },
                        ])
                      }
                    >
                      {t("添加 KR", "Add KR")}
                    </button>
                    <button
                      disabled={!reviewed}
                      onClick={() =>
                        void perform(() =>
                          prepare({
                            kind: "replace",
                            expectedVersion: view.okr.version,
                          }),
                        )
                      }
                    >
                      {t(
                        "预览规格修改与费用",
                        "Review specification change & fee",
                      )}
                    </button>
                  </fieldset>
                )}
              </section>
            )}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={blocked && pauseBlocked}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              {t(
                "我已核对具体操作、原执行及预算影响；修改规格时接受 KR 重置。",
                "I reviewed the exact operation, original Runs and budget impact; specification changes reset KRs.",
              )}
            </label>
            {view.okr.state === 2 && (
              <button
                className="secondary"
                disabled={blocked}
                onClick={() => {
                  close();
                  onReviewAgreement();
                }}
              >
                {t(
                  "前往实例重新审阅约定",
                  "Open instance to review the agreement",
                )}
              </button>
            )}
          </>
        )}
        {fee && (
          <section className="notice">
            <h3>{labels[fee.intent.kind]}</h3>
            {fee.intent.kind === "pause" && <p>{reason}</p>}
            {fee.intent.kind === "replace" && form && (
              <p>
                {form.objective} · {form.krs.length} KR · {form.maxCalls}{" "}
                TOOL_CALLS
              </p>
            )}
            <p>
              {profile.network} ·{" "}
              {t(
                "余额／预计费用／最大 Gas",
                "Balance / estimate / maximum Gas",
              )}
              : {sui(fee.quote.balance)} / {sui(fee.quote.estimatedGas)} /{" "}
              {sui(fee.quote.gasBudget)}
            </p>
            <p>
              {t(
                "失败也可能扣除 Gas。确认后只执行上述介入，不自动恢复或投递。",
                "Failure may also consume Gas. Confirmation performs only this intervention; it does not resume or dispatch.",
              )}
            </p>
            <button
              disabled={busy || Number(fee.quote.expiresAtMs) <= now}
              onClick={() => void perform(submit)}
            >
              {t("确认费用并签名", "Confirm fee & sign")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setFee(null)}
            >
              {t("取消", "Cancel")}
            </button>
          </section>
        )}
        {[...history.filter((r) => r.requestId !== receipt?.requestId), ...(receipt ? [receipt] : [])].map((receipt) => (
          <section className="panel" role="status" key={receipt.requestId}>
            <p>
              {t("原请求状态", "Original request status")}: {receipt.status}
            </p>
            <code className="long-id">{receipt.requestId}</code>
            <code className="long-id">{receipt.digest}</code>
            {receipt.actualGas !== undefined && (
              <p>
                {t("实际 Gas", "Actual Gas")}: {sui(receipt.actualGas)}
              </p>
            )}
            {receipt.status === "unknown" && (
              <p>
                {t(
                  "只查询原请求，不能以未知结果重试。",
                  "Query the original request; an unknown outcome cannot authorize a retry.",
                )}
              </p>
            )}
          </section>
        ))}
      </dialog>
    </>
  );
}
