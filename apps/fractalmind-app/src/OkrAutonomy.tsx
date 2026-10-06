import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import {
  NativeDeviceSigner,
  preferredDeviceProfile,
  scopedNativeInvoke,
} from "./native-device";
import { IndexedDbOkrDeliveryJournal } from "./okr-delivery-journal";
import {
  NativeOkrAutonomy,
  type AutonomyReview,
  type AutonomyState,
} from "./okr-autonomy";
import { canonical } from "./handover-plan";
import type { ConnectionProfile } from "./domain";
const mist = (v: string) => {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?$/.test(v))
    throw new Error("invalid_input");
  const [whole, fraction = ""] = v.split(".");
  const n = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, "0"));
  if (n < 1n || n > 0xffffffffffffffffn) throw new Error("invalid_input");
  return n.toString();
};
const sui = (v: string) => {
  const n = BigInt(v),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}${a / 1000000000n}.${(a % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "") || "0"}`;
};
const labels = {
  idle: ["准备当前 KR", "Preparing current KR"],
  paused: ["自动推进已暂停", "Automatic progress paused"],
  awaiting_approval: ["需要重新审批", "New approval needed"],
  queued: ["原执行待核对", "Original Run needs review"],
  running: ["执行中", "Running"],
  awaiting_confirmation: [
    "原结果未知，请查询",
    "Query the unknown original result",
  ],
  awaiting_verification: [
    "等待人工验证 KR",
    "Waiting for Human KR verification",
  ],
  awaiting_acceptance: [
    "等待最终人工验收",
    "Waiting for final Human acceptance",
  ],
  achieved: ["已达成并验收", "Achieved and accepted"],
  blocked: ["执行受阻", "Blocked"],
} as const;
/** Session stays mounted on the workbench while separate Human review dialogs
 * run. Unmount/background/close invalidates pending native actions. */
export default function OkrAutonomy({
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
  const [view, setView] = useState<AutonomyReview | null>(null),
    [state, setState] = useState<AutonomyState | null>(null);
  const [receipts, setReceipts] = useState<
    Pick<
      SelfPayTransactionOutcome,
      "requestId" | "digest" | "status" | "actualGas"
    >[]
  >([]);
  const [gas, setGas] = useState("0.8"),
    [minutes, setMinutes] = useState("15"),
    [reviewed, setReviewed] = useState(false);
  const mounted = useRef(true),
    epoch = useRef(0),
    live = useRef(false),
    flight = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  const context = useRef<{
    controller: NativeOkrAutonomy;
    journal: IndexedDbTransactionJournal;
    delivery: IndexedDbOkrDeliveryJournal;
    assertLive: () => void;
  } | null>(null);
  const previous = useRef("");
  const onChangeRef = useRef(onChanged);
  onChangeRef.current = onChanged;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => {
      if (context.current?.controller.state?.active) void tick();
    }, 3000);
    const hidden = () => {
      if (document.hidden) end("app_backgrounded");
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted.current = false;
      live.current = false;
      epoch.current++;
      context.current?.controller.stop("view_closed");
      void context.current?.journal.close();
      void context.current?.delivery.close();
      context.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  function publish(s: AutonomyState) {
    if (!mounted.current) return;
    setState(s);
    if (!s.active) {
      setView(null);
      setReviewed(false);
    }
    const key = canonical([s.active, s.runner, s.gasCommitted]);
    if (previous.current !== key) {
      previous.current = key;
      onChangeRef.current();
    }
  }
  function end(reason = "session_stopped") {
    const ctx = context.current;
    const s = ctx?.controller.stop(reason);
    if (s) publish(s);
    live.current = false;
    epoch.current++;
    void ctx?.journal.close();
    void ctx?.delivery.close();
    context.current = null;
    setView(null);
    setReviewed(false);
    setOpen(false);
    dialog.current?.close();
  }
  async function perform(fn: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    const token = epoch.current;
    try {
      await fn();
    } catch (e) {
      if (mounted.current && token === epoch.current) {
        setView(null);
        setReviewed(false);
        setError(
          e && typeof e === "object" && "code" in e
            ? String(e.code)
            : e instanceof Error
              ? e.message
              : "operation_failed",
        );
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function read() {
    if (!isTauri())
      throw Object.assign(new Error(), { code: "native_unavailable" });
    const token = epoch.current,
      assertLive = () => {
        if (
          !mounted.current ||
          !live.current ||
          token !== epoch.current ||
          document.hidden
        )
          throw Object.assign(new Error(), { code: "state_changed" });
      };
    const native = scopedNativeInvoke(
      (command, args) => invoke(command, args),
      assertLive,
    );
    const chain = new ChainReadSession(profile),
      signer = await NativeDeviceSigner.load(native, deviceProfile);
    const identity = await chain.human();
    assertLive();
    const eligible = identity.grants.value?.filter(
      (g) =>
        g.device === signer.device.address &&
        !g.revoked &&
        g.generation === identity.human.generation &&
        [1, 2, 3].every((a) => g.actions.includes(a)) &&
        (g.org_scope === null || g.org_scope === organizationId) &&
        BigInt(g.expires_at_ms) > identity.clockMs,
    );
    const scoped = eligible?.filter((g) => g.org_scope === organizationId),
      grants = scoped?.length ? scoped : eligible;
    if (grants?.length !== 1)
      throw Object.assign(new Error(), { code: "invalid_grant" });
    const journal = new IndexedDbTransactionJournal(),
      delivery = new IndexedDbOkrDeliveryJournal();
    const controller = new NativeOkrAutonomy(
      chain,
      signer,
      grants[0].id,
      organizationId,
      okrId,
      native,
      journal,
      delivery,
      {
        onSubmission: async (r) => {
          if (mounted.current && token === epoch.current)
            setReceipts((old) => [
              ...old,
              {
                requestId: r.requestId,
                digest: r.digest,
                status: r.status,
                actualGas: r.actualGas,
              },
            ]);
        },
      },
      fetch,
      assertLive,
    );
    context.current = { controller, journal, delivery, assertLive };
    const result = await controller.review();
    assertLive();
    setView(result);
    setGas(
      sui(
        String(
          (result.plan.krs.length - Number(result.okr.next_kr)) * 400000000,
        ),
      ),
    );
    setReviewed(false);
  }
  function begin() {
    if (context.current) end();
    live.current = true;
    setReceipts([]);
    setOpen(true);
    void perform(read);
  }
  async function start() {
    const ctx = context.current;
    if (!ctx || !view) throw new Error("state_changed");
    if (!/^[1-9][0-9]?$/.test(minutes) || Number(minutes) > 60)
      throw new Error("invalid_input");
    const expiry = [
      BigInt(Date.now() + Number(minutes) * 60000),
      BigInt(view.authorityExpiresAtMs),
      BigInt(view.okr.expires_at_ms),
    ].reduce((a, b) => (a < b ? a : b));
    const s = await ctx.controller.start(view, {
      reviewed,
      gasLimit: mist(gas),
      expiresAtMs: expiry.toString(),
    });
    ctx.assertLive();
    publish(s);
    setOpen(false);
    dialog.current?.close();
    publish(await ctx.controller.heartbeat());
    ctx.assertLive();
  }
  async function tick() {
    if (flight.current) return;
    await perform(async () => {
      const ctx = context.current;
      if (ctx) {
        const s = await ctx.controller.heartbeat();
        ctx.assertLive();
        publish(s);
      }
    });
  }
  return (
    <>
      <button disabled={busy || !!state?.active} onClick={begin}>
        {t("持续推进", "Continuous progress")}
      </button>
      {state && (
        <section
          className="panel"
          aria-label={t("持续推进状态", "Continuous progress status")}
        >
          <div className="section-heading">
            <h3>
              {t(
                labels[state.runner.status][0],
                labels[state.runner.status][1],
              )}
            </h3>
            {state.active && (
              <button className="secondary" onClick={() => end()}>
                {t("结束自动推进", "End automatic progress")}
              </button>
            )}
          </div>
          <p>
            {["awaiting_acceptance", "achieved"].includes(state.runner.status)
              ? `${t("已验证 KR", "Verified KRs")} ${state.runner.krIndex}`
              : `KR ${Number(state.runner.krIndex ?? 0) + 1}`}{" "}
            ·{" "}
            {state.runner.reason ??
              t("按当前约定运行", "Following the current agreement")}
          </p>
          {state.runner.executionId && (
            <code className="long-id">{state.runner.executionId}</code>
          )}
          <p>
            {t(
              "本次已承诺 Gas 上限／总上限",
              "Session committed Gas ceiling / limit",
            )}
            : {sui(state.gasCommitted)} / {sui(state.gasLimit)} SUI
          </p>
          <small>
            {t("最后核对", "Last checked")}:{" "}
            {new Date(state.observedAtMs).toLocaleTimeString()} ·{" "}
            {state.expiresAtMs &&
              new Date(Number(state.expiresAtMs)).toLocaleTimeString()}
          </small>
          <p className="muted">
            {t(
              "KR 达标后等待人工验证；验证通过再自动准备下一 KR。最终验收须单独决定。关闭页面或切入后台结束本次自动推进；已开始的原 Run 请在暂停与调整中检查停止和结算。",
              "A measured KR waits for Human verification before the next KR is prepared automatically. Final acceptance is separate. Closing the view or entering the background ends this session. Check already started Runs, stop confirmation and settlement in Pause & adjust.",
            )}
          </p>
          {receipts.length > 0 && (
            <details>
              <summary>
                {t(
                  "本次交易与实际费用",
                  "Session transactions and actual fees",
                )}
              </summary>
              {receipts.map((r) => (
                <div key={r.digest}>
                  <strong>
                    {r.requestId.startsWith("okr-control:")
                      ? t("当前 KR 执行权限", "Current KR execution authority")
                      : t(
                          "当前 KR 执行准备",
                          "Current KR execution preparation",
                        )}
                  </strong>
                  <p>
                    {r.status} ·{" "}
                    {r.actualGas === undefined
                      ? t("实际费用未知", "Actual fee unknown")
                      : `${sui(r.actualGas)} SUI`}
                  </p>
                  <code className="long-id">{r.digest}</code>
                </div>
              ))}
            </details>
          )}
        </section>
      )}
      {error && !open && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {open && (
        <dialog
          ref={dialog}
          aria-label={t("确认持续推进", "Confirm continuous progress")}
          onCancel={() => end()}
        >
          <header className="section-heading">
            <h2>{t("确认持续推进", "Confirm continuous progress")}</h2>
            <button className="secondary" onClick={() => end()}>
              {t("关闭", "Close")}
            </button>
          </header>
          <p className="muted">
            {t(
              "确认当前目标、文件计划和本次费用上限。只推进这一份约定；权限、范围、期限或预算不满足时停止，未知原结果不重发。",
              "Review this goal, file plan and session fee limit. Progress stays within this agreement; changed authority, boundaries, expiry or insufficient budget stop it. Unknown original results are never resent.",
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
          {error && (
            <p role="alert" className="notice">
              {error === "native_unavailable"
                ? t(
                    "请在原生 FractalMind App 解锁设备；网页不能启动持续执行或签名。",
                    "Unlock your device in the native FractalMind App. The web cannot start continuous execution or sign.",
                  )
                : t(
                    "请重新读取当前约定，核对原请求及设备权限。",
                    "Read the current agreement again and check original requests and device authority.",
                  )}{" "}
              <small>{error}</small>
            </p>
          )}
          {!view && (
            <button disabled={busy} onClick={() => void perform(read)}>
              {t("读取已批准计划", "Read approved plan")}
            </button>
          )}
          {view && (
            <>
              <h3>{view.spec.objective}</h3>
              <p>{view.spec.successCriteria}</p>
              <p>
                {t("约定版本", "Agreement version")}{" "}
                {view.okr.agreement_version} ·{" "}
                {t(
                  "工具预算：已用＋预留／上限",
                  "Tool budget: spent + reserved / limit",
                )}
                : {view.budget.spent.toString()} +{" "}
                {view.budget.reserved.toString()} / {view.okr.budget_limit}
              </p>
              {view.plan.krs.map((kr, i) => (
                <details key={i} open={i === Number(view.okr.next_kr)}>
                  <summary>
                    KR{i + 1} · {view.spec.krs[i].title} · {kr.maxCalls}{" "}
                    {t("次工具上限", "tool call ceiling")}
                  </summary>
                  {kr.files.map((file) => (
                    <div key={file.path}>
                      <strong>{file.path}</strong>
                      <pre>{file.content}</pre>
                    </div>
                  ))}
                </details>
              ))}
              <label>
                {t("本次 Gas 总上限（SUI）", "Session total Gas ceiling (SUI)")}
                <input
                  inputMode="decimal"
                  value={gas}
                  disabled={busy}
                  onChange={(e) => setGas(e.target.value)}
                />
              </label>
              <p className="muted">
                {t(
                  "按能力和执行准备交易的最大 Gas 预算保守累计；人工验证与最终验收费另行确认。不会自动充值，预算耗尽需重新确认。",
                  "Conservatively counts maximum Gas budgets for capability and preparation transactions. Human verification and final acceptance fees are confirmed separately. Funds are never topped up automatically; a depleted ceiling needs new confirmation.",
                )}
              </p>
              <label>
                {t(
                  "本次最多持续（分钟，1–60）",
                  "Session duration (minutes, 1–60)",
                )}
                <input
                  inputMode="numeric"
                  value={minutes}
                  disabled={busy}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                {t(
                  "我确认此计划和费用上限，允许在本次解锁期间自动准备、签名及投递；KR 验证和最终验收仍由我决定。",
                  "I confirm this plan and fee ceiling, allowing automatic preparation, signing and delivery during this unlocked session. I will decide KR verification and final acceptance separately.",
                )}
              </label>
              <button
                disabled={
                  busy ||
                  !reviewed ||
                  Number(view.okr.next_kr) >= view.okr.metrics.length
                }
                onClick={() => void perform(start)}
              >
                {t("确认并开始持续推进", "Confirm & start continuous progress")}
              </button>
            </>
          )}
        </dialog>
      )}
    </>
  );
}
