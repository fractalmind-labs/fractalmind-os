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
  type NativeInvoke,
} from "./native-device";
import {
  OkrHumanReview,
  humanReviewIntent,
  type HumanReviewIntent,
  type HumanReviewView,
} from "./okr-human-review";
import type { ConnectionProfile } from "./domain";

type Locator = {
  deviceProfile: string;
  grantId: string;
  intent: HumanReviewIntent;
};
function sui(value: string) {
  const n = BigInt(value),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}${a / 1000000000n}.${
    String(a % 1000000000n)
      .padStart(9, "0")
      .replace(/0+$/, "") || "0"
  } SUI`;
}
/** Human verification and acceptance are separate from execution. Private
 * evidence/reasons/quotes are memory-only, and native scopes close on hiding. */
export default function OkrVerification({
  profile,
  organizationId,
  okrId,
  onChanged,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  okrId: string;
  onChanged: () => void;
  t: (zh: string, en: string) => string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile);
  const [view, setView] = useState<HumanReviewView | null>(null),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null),
    [outcome, setOutcome] = useState<SelfPayTransactionOutcome | null>(null);
  const [done, setDone] = useState<"verify" | "accept" | null>(null),
    [now, setNow] = useState(Date.now());
  const dialog = useRef<HTMLDialogElement>(null),
    mounted = useRef(true),
    opened = useRef(false),
    epoch = useRef(0),
    flight = useRef(false);
  const journal = useRef<IndexedDbTransactionJournal | null>(null);
  const context = useRef<{
    chain: ChainReadSession;
    signer: NativeDeviceSigner;
    grantId: string;
    native: NativeInvoke;
    assertLive: () => void;
    review?: OkrHumanReview;
  } | null>(null);
  const key = `fractalmind.app.okr-human-review.v1:${JSON.stringify([profile.network, profile.chainIdentifier, profile.humanId, organizationId, okrId])}`;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const hide = () => {
      if (document.hidden) close();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      mounted.current = false;
      opened.current = false;
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
  function clearPrivate() {
    setView(null);
    setReason("");
    setReviewed(false);
    setQuote(null);
  }
  function close() {
    opened.current = false;
    epoch.current++;
    context.current = null;
    clearPrivate();
    setOutcome(null);
    setDone(null);
    setError(null);
    setOpen(false);
    dialog.current?.close();
  }
  function begin() {
    opened.current = true;
    setOpen(true);
    setError(null);
  }
  async function perform(action: () => Promise<void>) {
    if (flight.current) return;
    const token = epoch.current;
    flight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (mounted.current && opened.current && token === epoch.current) {
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
        if (!mounted.current || !opened.current || token !== epoch.current)
          throw Object.assign(new Error(), { code: "state_changed" });
      };
    const native = scopedNativeInvoke(
        (command, args) => invoke(command, args),
        assertLive,
      ),
      signer = await NativeDeviceSigner.load(native, deviceProfile),
      chain = new ChainReadSession(profile);
    const identity = await chain.human();
    assertLive();
    const grants = identity.grants.value?.filter(
      (g) =>
        g.device === signer.device.address &&
        !g.revoked &&
        g.generation === identity.human.generation &&
        [1, 3].every((a) => g.actions.includes(a)) &&
        (g.org_scope === null || g.org_scope === organizationId) &&
        BigInt(g.expires_at_ms) > identity.clockMs,
    );
    const scoped = grants?.filter((g) => g.org_scope === organizationId),
      eligible = scoped?.length ? scoped : grants;
    if (eligible?.length !== 1)
      throw Object.assign(new Error(), { code: "invalid_grant" });
    journal.current ??= new IndexedDbTransactionJournal();
    context.current = {
      chain,
      signer,
      grantId: eligible[0].id,
      native,
      assertLive,
    };
    return context.current;
  }
  async function select(current: boolean) {
    const ctx = await load();
    let intent: HumanReviewIntent | undefined;
    if (!current) {
      let saved: Locator | null;
      try {
        saved = JSON.parse(localStorage.getItem(key) ?? "null");
      } catch {
        throw Object.assign(new Error(), { code: "journal_unavailable" });
      }
      if (
        saved?.deviceProfile === deviceProfile &&
        saved.grantId === ctx.grantId
      )
        intent = saved.intent;
    }
    if (!intent) {
      const okr = await ctx.chain.sdk.okr.getOkr(okrId);
      ctx.assertLive();
      if (okr.org_id !== organizationId || okr.owner_human !== profile.humanId)
        throw Object.assign(new Error(), { code: "invalid_source" });
      if (okr.state === 3) {
        clearPrivate();
        setDone("accept");
        return null;
      }
      if (okr.state !== 1)
        throw Object.assign(new Error(), { code: "state_changed" });
      intent = humanReviewIntent(okr);
    }
    const review = new OkrHumanReview(
      ctx.chain,
      ctx.signer,
      ctx.grantId,
      organizationId,
      okrId,
      intent,
      ctx.native,
      journal.current!,
      ctx.assertLive,
    );
    ctx.assertLive();
    localStorage.setItem(
      key,
      JSON.stringify({
        deviceProfile,
        grantId: ctx.grantId,
        intent,
      } satisfies Locator),
    );
    ctx.review = review;
    return review;
  }
  async function receive(result: SelfPayTransactionOutcome) {
    const ctx = context.current;
    if (!ctx?.review)
      throw Object.assign(new Error(), { code: "state_changed" });
    ctx.assertLive();
    setOutcome((old) =>
      result.status === "unknown" &&
      old?.digest === result.digest &&
      old.status !== "unknown"
        ? old
        : result,
    );
    clearPrivate();
    if (result.status === "confirmed") {
      await ctx.review.confirmed(result);
      ctx.assertLive();
      setDone(ctx.review.intent.kind);
      onChanged();
    }
  }
  async function read(current = false) {
    clearPrivate();
    setDone(null);
    if (current) setOutcome(null);
    const review = await select(current);
    if (!review) return;
    const original = await review.query();
    context.current!.assertLive();
    if (original) {
      await receive(original);
      return;
    }
    const evidence = await review.read();
    context.current!.assertLive();
    setView(evidence);
  }
  async function query() {
    const review = context.current?.review ?? (await select(false));
    if (!review) return;
    const original = await review.query();
    context.current!.assertLive();
    if (original) await receive(original);
    else await read();
  }
  async function prepare() {
    const ctx = context.current;
    if (!ctx?.review || !view)
      throw Object.assign(new Error(), { code: "state_changed" });
    const result = await ctx.review.prepare(view, { reviewed, reason });
    ctx.assertLive();
    if ("status" in result) await receive(result);
    else setQuote(result);
  }
  async function submit() {
    const ctx = context.current;
    if (!ctx?.review || !quote)
      throw Object.assign(new Error(), { code: "state_changed" });
    const result = await ctx.review.submit(quote);
    ctx.assertLive();
    await receive(result);
  }
  const final = context.current?.review?.intent.kind === "accept";
  return (
    <>
      <button className="secondary" onClick={begin}>
        {t("验证与验收", "Verify & accept")}
      </button>
      <dialog
        ref={dialog}
        className="okr-create-dialog handover-dialog"
        aria-label={t(
          "OKR 人工验证与验收",
          "Human OKR verification and acceptance",
        )}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <header className="dialog-heading">
          <div>
            <span className="eyebrow">{t("人工验收", "Human review")}</span>
            <h2>
              {t(
                "检查证据，确认达成",
                "Inspect evidence and confirm achievement",
              )}
            </h2>
          </div>
          <button className="secondary" onClick={close}>
            {t("关闭", "Close")}
          </button>
        </header>
        <p>
          {t(
            "独立检查原始证据，确认当前 KR 并记录理由；全部 KR 验证后，再单独确认整体成功标准。",
            "Independently inspect original evidence, verify this KR and record your reason. After every KR is verified, separately confirm the overall success criteria.",
          )}
        </p>
        <label>
          {t("当前设备配置", "Current device profile")}
          <input
            value={deviceProfile}
            disabled={busy || !!context.current || !!quote}
            onChange={(e) => setDeviceProfile(e.target.value)}
          />
        </label>
        <div className="button-row">
          <button
            disabled={busy || !!quote}
            onClick={() => void perform(() => read())}
          >
            {t("读取原证据", "Read original evidence")}
          </button>
          <button
            className="secondary"
            disabled={busy || !!quote}
            onClick={() => void perform(query)}
          >
            {t("查询原验收交易", "Query original review transaction")}
          </button>
        </div>
        {error && (
          <p role="alert">
            {error === "native_unavailable"
              ? t(
                  "请在 FractalMind 原生 App 中解锁设备并验收。",
                  "Unlock your device in the native FractalMind App to review.",
                )
              : error === "invalid_grant"
                ? t(
                    "当前设备需要此组织的读取与审批权限。",
                    "This device needs read and approve access to this organization.",
                  )
                : error === "measurement_stale"
                  ? t(
                      "测量已过期，需要新的有效测量后才能验收。",
                      "The measurement has expired. Review requires a fresh measurement.",
                    )
                  : error === "unsettled_execution"
                    ? t(
                        "仍有执行未结清，请先确认原执行状态。",
                        "Execution is unsettled. Confirm the original execution first.",
                      )
                    : error === "sync_pending"
                      ? t(
                          "原交易已确认，等待链上记录可读；请继续查询原交易。",
                          "The original transaction is confirmed; its records are not yet readable. Keep querying that transaction.",
                        )
                      : t(
                          "当前状态不能验收，请查询原交易或重新读取证据。",
                          "Cannot review this state. Query the original transaction or read the evidence again.",
                        )}
            <details>
              <summary>{t("技术详情", "Technical details")}</summary>
              <code>{error}</code>
            </details>
          </p>
        )}
        {view && (
          <section>
            <h3>{view.spec.objective}</h3>
            <p>
              <strong>{t("整体成功标准", "Overall success criteria")}</strong>:{" "}
              {view.spec.successCriteria}
            </p>
            <h4>
              {final
                ? t(
                    "最终验收：复核全部 KR",
                    "Final acceptance: review every KR",
                  )
                : t(
                    `验证 KR ${Number(view.okr.next_kr) + 1}`,
                    `Verify KR ${Number(view.okr.next_kr) + 1}`,
                  )}
            </h4>
            {view.evidence.map((e) => (
              <section key={e.krIndex} className="panel">
                <h4>
                  KR {e.krIndex + 1} · {view.spec.krs[e.krIndex].title}
                </h4>
                <p>{view.spec.krs[e.krIndex].verificationRule}</p>
                <p>
                  {t("原测量", "Original measurement")}: {e.metric.current} /{" "}
                  {e.metric.target} · {t("采样时间", "Sampled at")}:{" "}
                  {new Date(Number(e.metric.sampled_at_ms)).toLocaleString()}
                </p>
                {e.files.map((file) => (
                  <details key={file.path}>
                    <summary>{file.path}</summary>
                    <p>{t("约定文件内容", "Approved file content")}</p>
                    <pre>{file.content}</pre>
                    <p className="long-id">
                      {t("约定 SHA-256", "Approved SHA-256")}:{" "}
                      {file.expectedHash}
                    </p>
                    <p className="long-id">
                      {t("Host 回报 SHA-256", "Host-reported SHA-256")}:{" "}
                      {file.observedHash}
                    </p>
                  </details>
                ))}
                {e.priorVerification && (
                  <p>
                    {t(
                      "已记录的人工验证理由",
                      "Recorded Human verification reason",
                    )}
                    : {e.priorVerification.reason}
                  </p>
                )}
                <details>
                  <summary>
                    {t(
                      "原执行与证据详情",
                      "Original execution & evidence details",
                    )}
                  </summary>
                  <p className="long-id">Run: {e.result.run.id}</p>
                  <p className="long-id">
                    {t("原证据记录", "Original evidence record")}:{" "}
                    {e.result.recordId}
                  </p>
                  <p className="long-id">
                    {t(
                      "原证据创建交易",
                      "Original evidence creation transaction",
                    )}
                    : {e.result.transactionDigest}
                  </p>
                  <pre>{JSON.stringify(e.result.response, null, 2)}</pre>
                  {e.priorVerification && (
                    <p className="long-id">
                      {t("人工验证记录", "Human verification record")}:{" "}
                      {e.priorVerification.recordId}
                    </p>
                  )}
                </details>
              </section>
            ))}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={busy || !!quote}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              {final
                ? t(
                    "我已复核全部 KR，并确认整体成功标准已达成。",
                    "I reviewed every KR and confirm the overall success criteria are met.",
                  )
                : t(
                    "我已独立检查上述原始证据，确认本 KR 达成。",
                    "I independently inspected this original evidence and confirm this KR is met.",
                  )}
            </label>
            <label>
              {t("我的验收理由", "My review reason")}
              <textarea
                value={reason}
                maxLength={4096}
                disabled={busy || !!quote}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {!quote && (
              <button
                disabled={busy || !reviewed || !reason.trim()}
                onClick={() => void perform(prepare)}
              >
                {final
                  ? t("准备最终验收费用", "Prepare final acceptance fee")
                  : t("准备 KR 验证费用", "Prepare KR verification fee")}
              </button>
            )}
          </section>
        )}
        {quote && (
          <section className="notice">
            <h3>
              {final
                ? t("确认最终验收费用", "Confirm final acceptance fee")
                : t("确认 KR 验证费用", "Confirm KR verification fee")}
            </h3>
            <p>
              {profile.network} · {t("余额", "Balance")}: {sui(quote.balance)}
            </p>
            <p>
              {t("预计费用", "Estimated fee")}: {sui(quote.estimatedGas)} ·{" "}
              {t("费用上限", "Fee limit")}: {sui(quote.gasBudget)}
            </p>
            <p className="long-id">
              {t("付款地址", "Payer")}: {quote.sender}
            </p>
            <p>
              {t("报价有效至", "Quote valid until")}:{" "}
              {new Date(quote.expiresAtMs).toLocaleTimeString()}
            </p>
            <button
              disabled={busy || now >= quote.expiresAtMs}
              onClick={() => void perform(submit)}
            >
              {t("确认费用并签名提交", "Confirm fee, sign & submit")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setQuote(null)}
            >
              {t("取消本次报价", "Cancel this quote")}
            </button>
          </section>
        )}
        {outcome && (
          <section>
            <p>
              {outcome.status === "confirmed"
                ? t("原验收交易已确认", "Original review transaction confirmed")
                : outcome.status === "failed"
                  ? t(
                      "原验收交易明确失败",
                      "Original review transaction failed",
                    )
                  : t(
                      "原验收结果未知，请查询原摘要",
                      "Original review outcome unknown; query its original digest",
                    )}
            </p>
            <details>
              <summary>{t("交易详情", "Transaction details")}</summary>
              <code className="long-id">{outcome.digest}</code>
              {outcome.actualGas && (
                <p>
                  {t("实际费用", "Actual fee")}: {sui(outcome.actualGas)}
                </p>
              )}
            </details>
          </section>
        )}
        {done && (
          <section className="notice">
            <h3>
              {done === "accept"
                ? t("OKR 已达成并验收", "OKR achieved and accepted")
                : t("本 KR 已验证", "This KR is verified")}
            </h3>
            {done === "verify" && (
              <>
                <p>
                  {t(
                    "进入下一项检查，或返回执行与继续推进下一个 KR。",
                    "Review the next item, or return to Execute & continue for the next KR.",
                  )}
                </p>
                <button
                  disabled={busy}
                  onClick={() => void perform(() => read(true))}
                >
                  {t("读取当前待验收内容", "Read the current review item")}
                </button>
              </>
            )}
          </section>
        )}
      </dialog>
    </>
  );
}
