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
import { OkrIntervention } from "./okr-intervention";
import {
  OkrProjection,
  projectionMetricStatus,
  type OkrProjectionView,
  type OkrProposalReview,
} from "./okr-projection";
import type { ConnectionProfile } from "./domain";
import MessageOkrContext from "./MessageOkrContext";
import { OkrProjectionFilePicker } from "./okr-projection-file-picker";

const sui = (value: string) => {
  const n = BigInt(value),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}${a / 1000000000n}.${
    String(a % 1000000000n)
      .padStart(9, "0")
      .replace(/0+$/, "") || "0"
  } SUI`;
};

export default function OkrProjectionDialog({
  profile,
  organizationId,
  okrId,
  onChanged,
  onIntervene,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  okrId: string;
  onChanged: () => void;
  onIntervene: () => void;
  t: (zh: string, en: string) => string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile);
  const [view, setView] = useState<OkrProjectionView | null>(null),
    [review, setReview] = useState<OkrProposalReview | null>(null);
  const [workspaceConfirmed, setWorkspaceConfirmed] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [fee, setFee] = useState<SelfPayFeeQuote | null>(null),
    [receipt, setReceipt] = useState<SelfPayTransactionOutcome | null>(null),
    [requestId, setRequestId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    mounted = useRef(false),
    active = useRef(false),
    epoch = useRef(0),
    flight = useRef(false);
  const journal = useRef<IndexedDbTransactionJournal | null>(null);
  const picker = useRef(new OkrProjectionFilePicker<File>()),
    resumePicker = useRef<() => void>(() => {});
  const sourceScope = JSON.stringify([profile, organizationId, okrId]),
    currentScope = useRef("");
  currentScope.current = JSON.stringify([sourceScope, deviceProfile]);
  const context = useRef<{
    controller: OkrProjection;
    assertLive: () => void;
  } | null>(null);
  const key = `fractalmind.app.okr-projection.v1:${JSON.stringify([profile.network, profile.chainIdentifier, profile.humanId, organizationId, okrId])}`;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000),
      hide = () => {
        if (document.hidden) {
          picker.current.suspend();
          resetPrivateSession();
        } else resumePicker.current();
      };
    const fileInput = input.current,
      cancelPicker = () => picker.current.cancel();
    document.addEventListener("visibilitychange", hide);
    fileInput?.addEventListener("cancel", cancelPicker);
    return () => {
      mounted.current = false;
      active.current = false;
      epoch.current++;
      context.current = null;
      picker.current.cancel();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      fileInput?.removeEventListener("cancel", cancelPicker);
      void journal.current?.close();
    };
  }, []);
  useEffect(() => {
    close();
  }, [sourceScope]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  const expires = review?.authorityExpiresAtMs ?? view?.authorityExpiresAtMs;
  useEffect(() => {
    if (expires && Number(expires) <= now) close();
  }, [expires, now]);
  function clearPrivate() {
    setView(null);
    setReview(null);
    setFee(null);
    setReviewed(false);
    setWorkspaceConfirmed(false);
    if (input.current) input.current.value = "";
  }
  function resetPrivateSession() {
    active.current = false;
    epoch.current++;
    context.current = null;
    clearPrivate();
    setError(null);
    setReceipt(null);
    setOpen(false);
    dialog.current?.close();
  }
  function close() {
    picker.current.cancel();
    resetPrivateSession();
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
      scope = currentScope.current,
      assertLive = () => {
        if (
          !mounted.current ||
          !active.current ||
          document.hidden ||
          token !== epoch.current ||
          scope !== currentScope.current
        )
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
      ),
      scoped = grants?.filter((g) => g.org_scope === organizationId),
      eligible = scoped?.length ? scoped : grants;
    if (eligible?.length !== 1)
      throw Object.assign(new Error(), { code: "invalid_grant" });
    journal.current ??= new IndexedDbTransactionJournal();
    const controller = new OkrProjection(
      new OkrIntervention(
        chain,
        signer,
        eligible[0].id,
        organizationId,
        okrId,
        native,
        journal.current,
        assertLive,
      ),
      assertLive,
    );
    context.current = { controller, assertLive };
    const original = localStorage.getItem(key);
    if (original) {
      if (!/^[A-Za-z0-9._:/@+\-]{1,128}$/.test(original))
        throw Object.assign(new Error(), { code: "journal_unavailable" });
      setRequestId(original);
      const prior = await controller.query(original);
      assertLive();
      setReceipt(prior ?? null);
    }
    return context.current;
  }
  async function read() {
    const ctx = await load(),
      next = await ctx.controller.read();
    ctx.assertLive();
    setView(next);
    setReview(null);
    setFee(null);
    setReviewed(false);
    setWorkspaceConfirmed(false);
  }
  async function download() {
    const ctx = await load();
    if (!view) throw Object.assign(new Error(), { code: "state_changed" });
    const file = await ctx.controller.export(view, {
      reviewed: workspaceConfirmed,
    });
    ctx.assertLive();
    if (
      await invoke<boolean>("fm_export_okr", {
        content: file.content,
        reviewed: workspaceConfirmed,
      })
    )
      return;
    ctx.assertLive();
    const url = URL.createObjectURL(
        new Blob([file.content], { type: "text/markdown;charset=utf-8" }),
      ),
      anchor = document.createElement("a");
    try {
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  async function importFile(file: File, assertSelection: () => void) {
    assertSelection();
    const ctx = await load();
    ctx.assertLive();
    assertSelection();
    if (file.size > 262144)
      throw Object.assign(new Error(), { code: "invalid_projection" });
    const text = await file.text();
    ctx.assertLive();
    assertSelection();
    const next = await ctx.controller.review(text);
    ctx.assertLive();
    assertSelection();
    setReview(next);
    setFee(null);
    setReviewed(false);
  }
  resumePicker.current = () => {
    const selection = picker.current.take(
      currentScope.current,
      mounted.current && !document.hidden,
    );
    if (!selection) return;
    // Returning from a native file chooser is a new read session. Never reuse
    // the old native signer/controller or restore a private view/quote.
    resetPrivateSession();
    active.current = true;
    setOpen(true);
    // Desktop pickers need not hide the WebView. React can batch false/true
    // back to the previous open value, so reopen the reset dialog explicitly.
    if (!dialog.current?.open) dialog.current?.showModal();
    void perform(async () => {
      try {
        const assertSelection = () => {
          if (!picker.current.current(selection, currentScope.current))
            throw Object.assign(new Error(), { code: "state_changed" });
        };
        await importFile(selection.file, assertSelection);
      } finally {
        picker.current.finish(selection);
      }
    });
  };
  async function prepare() {
    const ctx = await load();
    if (!review) throw Object.assign(new Error(), { code: "state_changed" });
    const next = await ctx.controller.prepare(review, { reviewed });
    ctx.assertLive();
    if ("status" in next) {
      setReceipt(next);
      setRequestId(next.requestId);
      return;
    }
    localStorage.setItem(key, next.requestId);
    if (localStorage.getItem(key) !== next.requestId)
      throw Object.assign(new Error(), { code: "journal_unavailable" });
    setRequestId(next.requestId);
    setFee(next);
    setReceipt(null);
  }
  async function submit() {
    const ctx = context.current;
    if (!ctx || !fee)
      throw Object.assign(new Error(), { code: "state_changed" });
    const next = await ctx.controller.submit(fee);
    ctx.assertLive();
    setReceipt(next);
    setFee(null);
    if (next.status === "confirmed") {
      await read();
      ctx.assertLive();
      onChanged();
    }
  }
  async function query() {
    const ctx = await load(),
      original = requestId ?? localStorage.getItem(key);
    if (original) {
      const next = await ctx.controller.query(original);
      ctx.assertLive();
      setReceipt((old) =>
        next?.status === "unknown" &&
        old?.digest === next.digest &&
        old.status !== "unknown"
          ? old
          : (next ?? null),
      );
    }
    await read();
  }
  const blocked = busy || !!fee || receipt?.status === "unknown";
  const labels = {
    unknown: t("未测量", "Not measured"),
    stale: t(
      "历史样本已过期，当前未知",
      "Historical sample stale; current unknown",
    ),
    measured_unverified: t(
      "已测量，待人验证",
      "Measured, awaiting Human verification",
    ),
    human_verified: t("已人审验证", "Human verified"),
  };
  return (
    <>
      <button
        className="secondary"
        onClick={() => {
          picker.current.cancel();
          active.current = true;
          setOpen(true);
          void perform(read);
        }}
      >
        {t("技能上下文与提案", "Skill context & proposals")}
      </button>
      <dialog
        ref={dialog}
        className="handover-dialog"
        aria-label={t("OKR 技能投影", "OKR skill projection")}
        onCancel={close}
      >
        <header className="dialog-heading">
          <div>
            <span className="eyebrow">OKR.md</span>
            <h2>{t("技能上下文与提案", "Skill context & proposals")}</h2>
          </div>
          <button className="secondary" onClick={close}>
            {t("关闭", "Close")}
          </button>
        </header>
        <p className="long-id">{okrId}</p>
        <p>
          {t(
            "导出目标、KR、约定、预算和原证据作为 Agent 的本地上下文。修改文件只产生未提交提案，提交后仍需重新审阅执行约定。",
            "Export the goal, KRs, agreement, budget and original evidence as local Agent context. File edits are unsubmitted proposals; a committed revision still needs a new agreement review.",
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
          <button disabled={busy || !!fee} onClick={() => void perform(read)}>
            {t("刷新链上上下文", "Refresh chain context")}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void perform(query)}
          >
            {t("查询原提案请求", "Query original proposal request")}
          </button>
        </div>
        {error && (
          <p role="alert" className="notice">
            {error === "native_unavailable"
              ? t(
                  "请在原生 App 解锁设备后导出或提交；网页不能读取私有技能上下文。",
                  "Unlock a device in the native App to export or submit. The web cannot read private skill context.",
                )
              : error === "state_changed"
                ? t(
                    "来源版本或执行事实已变化。保留原文件，刷新后重新审阅提案；不自动合并。",
                    "Source versions or execution facts changed. Retain the original file and refresh to review again; no automatic merge.",
                  )
                : t(
                    "无法继续，请核对文件格式、权限、原请求及执行状态。",
                    "Cannot continue. Check the file format, authority, original request and execution state.",
                  )}{" "}
            <small>{error}</small>
          </p>
        )}
        {view && (
          <section className="panel">
            <h3>{view.snapshot.specification.objective}</h3>
            <p>{view.snapshot.specification.successCriteria}</p>
            {view.snapshot.specification.source && (
              <MessageOkrContext
                source={view.snapshot.specification.source}
                t={t}
              />
            )}
            <p>
              {view.snapshot.state} ·{" "}
              {t("来源版本／约定", "Source version / agreement")}:{" "}
              {view.snapshot.provenance.sourceVersion} /{" "}
              {view.snapshot.provenance.agreementVersion}
            </p>
            {view.snapshot.metrics.map((metric, i) => (
              <p key={i}>
                KR {i + 1} · {view.snapshot.specification.krs[i].title} ·{" "}
                {labels[projectionMetricStatus(metric, String(now))]} ·{" "}
                {metric.current ?? "?"} / {metric.target} ·{" "}
                {t("采样时间", "Sample time")}: {metric.sampled_at_ms}
              </p>
            ))}
            {view.snapshot.budget && (
              <p>
                {t("已用＋预留／预算上限", "Spent + reserved / budget limit")}:{" "}
                {view.snapshot.budget.spent} + {view.snapshot.budget.reserved} /{" "}
                {view.snapshot.budget.limit} TOOL_CALLS
              </p>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={workspaceConfirmed}
                disabled={busy}
                onChange={(e) => setWorkspaceConfirmed(e.target.checked)}
              />
              {t(
                "我确认导出明文，保存到为该 Agent 批准的工作目录。",
                "I confirm exporting plaintext and saving it in the workspace approved for this Agent.",
              )}
            </label>
            <button
              disabled={busy || !workspaceConfirmed}
              onClick={() => void perform(download)}
            >
              {t("导出 OKR.md", "Export OKR.md")}
            </button>
          </section>
        )}
        <section className="panel">
          <h3>{t("导入本地提案", "Import local proposal")}</h3>
          <p>
            {t(
              "只修改 OKR.md 的 Local proposal 区块。链上事实和来源区块保持原样；仅导入不会提交或执行。",
              "Edit only OKR.md's Local proposal block. Keep chain facts and provenance intact; importing does not submit or execute.",
            )}
          </p>
          <label>
            {t("选择编辑后的 OKR.md", "Choose edited OKR.md")}
            <input
              ref={input}
              type="file"
              accept=".md,text/markdown,text/plain"
              disabled={blocked}
              onClick={() => picker.current.begin(currentScope.current)}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) {
                  picker.current.cancel();
                  return;
                }
                picker.current.select(currentScope.current, file);
                resumePicker.current();
              }}
            />
          </label>
        </section>
        {review && (
          <section className="panel">
            <h3>
              {review.status === "CLEAN"
                ? t("没有本地变更", "No local changes")
                : t("未提交提案", "Unsubmitted proposal")}
            </h3>
            {review.changes.map((change) => (
              <article key={change.field}>
                <strong>{change.field}</strong>
                <p>
                  {t("当前", "Current")}:{" "}
                  <code>{JSON.stringify(change.before)}</code>
                </p>
                <p>
                  {t("提案", "Proposed")}:{" "}
                  <code>{JSON.stringify(change.after)}</code>
                </p>
              </article>
            ))}
            {review.status === "UNSUBMITTED" && (
              <>
                <p>
                  {t(
                    "替换规格将重置 KR 测量、验证和游标；保留原历史及累计已用预算。草稿或暂停目标才能提交，旧执行必须结清。",
                    "Replacing the specification resets KR measurements, verifications and cursor; history and cumulative spend remain. Submit only for draft or paused goals after old Runs settle.",
                  )}
                </p>
                {!["DRAFT", "PAUSED"].includes(review.snapshot.state) ? (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      close();
                      onIntervene();
                    }}
                  >
                    {t(
                      "前往工作台暂停与调整",
                      "Open Workbench to pause & adjust",
                    )}
                  </button>
                ) : (
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        disabled={blocked}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />
                      {t(
                        "我已审阅全部变更，确认 KR 重置和预算影响。",
                        "I reviewed all changes and confirm the KR reset and budget impact.",
                      )}
                    </label>
                    <button
                      disabled={
                        blocked ||
                        !reviewed ||
                        !review.actions.includes("approve")
                      }
                      onClick={() => void perform(prepare)}
                    >
                      {t("预览提案提交费用", "Review proposal submission fee")}
                    </button>
                  </>
                )}
              </>
            )}
          </section>
        )}
        {fee && (
          <section className="notice">
            <h3>{t("提交目标规格提案", "Submit specification proposal")}</h3>
            <p>
              {profile.network} ·{" "}
              {t(
                "余额／预计费用／最大 Gas",
                "Balance / estimate / maximum Gas",
              )}
              : {sui(fee.balance)} / {sui(fee.estimatedGas)} /{" "}
              {sui(fee.gasBudget)}
            </p>
            <p>
              {t(
                "失败也可能消耗 Gas。确认后只提交规格变更，需另行审批执行约定。",
                "Failure may consume Gas. Confirmation commits only the specification revision; the execution agreement needs separate approval.",
              )}
            </p>
            <button
              disabled={busy || Number(fee.expiresAtMs) <= now}
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
        {receipt && (
          <section className="panel" role="status">
            <p>
              {t("原请求状态", "Original request status")}: {receipt.status}
            </p>
            <code className="long-id">{receipt.digest}</code>
            {receipt.actualGas !== undefined && (
              <p>
                {t("实际 Gas", "Actual Gas")}: {sui(receipt.actualGas)}
              </p>
            )}
            {receipt.status === "unknown" && (
              <p>
                {t(
                  "查询原请求确认结果，不重新提交。",
                  "Query the original request to confirm its outcome; do not resubmit.",
                )}
              </p>
            )}
          </section>
        )}
      </dialog>
    </>
  );
}
