import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  okrRunnerTicketName,
  type OkrRunnerState,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { NativeOkrRunner } from "./native-okr-runner";
import {
  NativeDeviceSigner,
  preferredDeviceProfile,
  scopedNativeInvoke,
} from "./native-device";
import { OkrControl } from "./okr-control";
import {
  IndexedDbOkrDeliveryJournal,
  okrDeliveryKey,
} from "./okr-delivery-journal";
import { canonical } from "./handover-plan";
import { readRecordPointer } from "./record-pointer";
import type { ConnectionProfile } from "./domain";
type Description = Awaited<ReturnType<NativeOkrRunner["describe"]>>;
type Locator = {
  deviceProfile: string;
  grantId: string;
  agreementVersion: string;
  krIndex: string;
  capabilityId?: string;
  deliveryAttempted?: boolean;
};
type Fee = { kind: "control" | "run"; quote: SelfPayFeeQuote };
const id = /^0x[0-9a-f]{64}$/;
const emptyCapability = `0x${"0".repeat(64)}`;
function sui(v: string) {
  const n = BigInt(v),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}${a / 1000000000n}.${
    String(a % 1000000000n)
      .padStart(9, "0")
      .replace(/0+$/, "") || "0"
  } SUI`;
}
function retainReceipt(
  previous: SelfPayTransactionOutcome | null,
  next: SelfPayTransactionOutcome | null,
) {
  return next?.status === "unknown" &&
    previous?.digest === next.digest &&
    previous.status !== "unknown"
    ? previous
    : next;
}
const labels: Record<OkrRunnerState["status"], [string, string]> = {
  idle: ["等待准备", "Ready to prepare"],
  paused: ["已暂停", "Paused"],
  awaiting_approval: ["需要重新审批", "Approval needed"],
  queued: ["已排队", "Queued"],
  running: ["运行中", "Running"],
  awaiting_confirmation: [
    "等待确认原请求",
    "Awaiting original request confirmation",
  ],
  awaiting_verification: ["等待人工验证 KR", "Awaiting Human KR verification"],
  awaiting_acceptance: ["等待最终验收", "Awaiting final acceptance"],
  achieved: ["已达成并验收", "Achieved and accepted"],
  blocked: ["执行受阻", "Blocked"],
};

/** V2 explicit execution entry. Private plans and quotes are memory-only;
 * locators are disposable and never authorize execution. */
export default function OkrContinuation({
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
  const [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile),
    [description, setDescription] = useState<Description | null>(null);
  const [state, setState] = useState<OkrRunnerState | null>(null),
    [locator, setLocator] = useState<Locator | null>(null);
  const [fee, setFee] = useState<Fee | null>(null),
    [controlOutcome, setControlOutcome] =
      useState<SelfPayTransactionOutcome | null>(null),
    [runOutcome, setRunOutcome] = useState<SelfPayTransactionOutcome | null>(
      null,
    );
  const [now, setNow] = useState(Date.now());
  const [chainDelivery, setChainDelivery] = useState(false);
  const [chainOutcome, setChainOutcome] =
    useState<SelfPayTransactionOutcome | null>(null);
  const [scheduleConsent, setScheduleConsent] = useState(false);
  const [scheduledRows, setScheduledRows] = useState<
    Array<{
      krIndex: string;
      agreementVersion: string;
      stage: "control" | "run" | "delivery";
      status: string;
      executionId?: string;
      digest?: string;
      runState?: number;
      deliveryPresent?: boolean;
    }>
  >([]);
  const dialog = useRef<HTMLDialogElement>(null),
    mounted = useRef(true),
    opened = useRef(false),
    epoch = useRef(0),
    flight = useRef(false);
  const journal = useRef<IndexedDbTransactionJournal | null>(null),
    deliveryJournal = useRef<IndexedDbOkrDeliveryJournal | null>(null),
    feeAnswer = useRef<{
      quote: SelfPayFeeQuote;
      resolve: (accepted: boolean) => void;
    } | null>(null);
  const context = useRef<{
    chain: ChainReadSession;
    signer: NativeDeviceSigner;
    grantId: string;
    runner: NativeOkrRunner;
    control?: OkrControl;
    assertLive: () => void;
  } | null>(null);
  const key = `fractalmind.app.okr-continuation.v1:${JSON.stringify([profile.network, profile.chainIdentifier, profile.humanId, organizationId, okrId])}`;
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
      feeAnswer.current?.resolve(false);
      feeAnswer.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      void journal.current?.close();
      void deliveryJournal.current?.close();
    };
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  function close() {
    opened.current = false;
    epoch.current++;
    context.current = null;
    feeAnswer.current?.resolve(false);
    feeAnswer.current = null;
    setDescription(null);
    setFee(null);
    setState(null);
    setChainOutcome(null);
    setChainDelivery(false);
    setScheduleConsent(false);
    setScheduledRows([]);
    setLocator(null);
    setControlOutcome(null);
    setRunOutcome(null);
    setOpen(false);
    dialog.current?.close();
  }
  function begin() {
    opened.current = true;
    setError(null);
    setOpen(true);
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
        // A failed current authorization/read must not leave the earlier
        // private plan or actionable execution state on screen.
        setDescription(null);
        setState(null);
        setLocator(null);
        setFee(null);
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
  function save(value: Locator) {
    context.current?.assertLive();
    localStorage.setItem(key, JSON.stringify(value));
    setLocator(value);
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
    );
    const signer = await NativeDeviceSigner.load(native, deviceProfile),
      chain = new ChainReadSession(profile);
    const identity = await chain.human();
    assertLive();
    const grants = identity.grants.value?.filter(
      (g) =>
        g.device === signer.device.address &&
        !g.revoked &&
        g.generation === identity.human.generation &&
        [1, 2, 3].every((a) => g.actions.includes(a)) &&
        (g.org_scope === null || g.org_scope === organizationId) &&
        BigInt(g.expires_at_ms) > identity.clockMs,
    );
    const scoped = grants?.filter((g) => g.org_scope === organizationId),
      eligible = scoped?.length ? scoped : grants;
    if (eligible?.length !== 1)
      throw Object.assign(new Error(), { code: "invalid_grant" });
    journal.current ??= new IndexedDbTransactionJournal();
    const runner = new NativeOkrRunner(
      chain,
      signer,
      eligible[0].id,
      organizationId,
      native,
      journal.current,
      requestFee,
      async (url, init) => {
        assertLive();
        return fetch(url, init);
      },
      assertLive,
    );
    context.current = {
      chain,
      signer,
      grantId: eligible[0].id,
      runner,
      assertLive,
    };
    return context.current;
  }
  function requestFee(quote: SelfPayFeeQuote) {
    if (!context.current)
      throw Object.assign(new Error(), { code: "state_changed" });
    context.current.assertLive();
    if (feeAnswer.current)
      throw Object.assign(new Error(), { code: "state_changed" });
    return new Promise<boolean>((resolve) => {
      feeAnswer.current = { quote, resolve };
      setFee({ kind: "run", quote });
    });
  }
  async function scheduleLaterKrs() {
    const ctx = context.current;
    if (!ctx || !description || !scheduleConsent)
      throw Object.assign(new Error(), { code: "state_changed" });
    const reviewed = description;
    const update = (
      input: Omit<(typeof scheduledRows)[number], "agreementVersion">,
    ) => {
      const row = {
        ...input,
        agreementVersion: reviewed.okr.agreement_version,
      };
      ctx.assertLive();
      setScheduledRows((previous) => [
        ...previous.filter(
          (old) => !(old.krIndex === row.krIndex && old.stage === row.stage),
        ),
        row,
      ]);
    };
    // Prepare the most distant KR first. The current KR is released separately
    // through the existing original-command flow, after this authorization.
    for (
      let i = reviewed.plan.krs.length - 1;
      i > Number(reviewed.okr.next_kr);
      i--
    ) {
      const desc = await ctx.runner.describe(okrId);
      if (
        desc.okr.state !== 1 ||
        desc.okr.next_kr !== reviewed.okr.next_kr ||
        desc.okr.agreement_version !== reviewed.okr.agreement_version ||
        desc.okr.spec_record !== reviewed.okr.spec_record ||
        desc.okr.agreement_record !== reviewed.okr.agreement_record ||
        canonical(desc.plan) !== canonical(reviewed.plan) ||
        canonical(desc.policy) !== canonical(reviewed.policy)
      )
        throw Object.assign(new Error(), { code: "state_changed" });
      const krIndex = String(i);
      // Use the SDK's exact original-ticket identity, never a generated nonce
      // after a previously confirmed or unknown request.
      const head = await readRecordPointer(
        ctx.chain,
        organizationId,
        "checkpoint",
        okrRunnerTicketName(okrId, desc.okr.agreement_version, krIndex),
      );
      ctx.assertLive();
      if (!head.pointer) {
        const control = new OkrControl(
          ctx.chain,
          ctx.signer,
          ctx.grantId,
          organizationId,
          okrId,
          desc.okr.agreement_version,
          krIndex,
          journal.current!,
          ctx.assertLive,
          {
            scheduled: true,
            okrVersion: desc.okr.version,
            policyPin: canonical(desc.policy),
          },
        );
        const q = await control.prepare();
        let result: SelfPayTransactionOutcome;
        if ("status" in q) result = q;
        else {
          if (!(await requestFee(q))) {
            update({ krIndex, stage: "control", status: "declined" });
            return;
          }
          result = await control.submit(q);
        }
        update({
          krIndex,
          stage: "control",
          status: result.status,
          digest: result.digest,
        });
        if (result.status !== "confirmed") return;
        const capabilityId = await control.confirmed(result);
        const prepared = await ctx.runner.step({
          okrId,
          capabilityId,
          createIfMissing: true,
          prepareOnly: true,
          scheduledKrIndex: krIndex,
          expectedKrIndex: reviewed.okr.next_kr,
          expectedAgreementVersion: reviewed.okr.agreement_version,
        });
        update({
          krIndex,
          stage: "run",
          status: prepared.status,
          executionId: prepared.executionId,
          digest: prepared.transactionDigest,
        });
        if (prepared.status !== "queued") return;
      }
      const published = await ctx.runner.queuePreparedKr(
        okrId,
        reviewed.okr.agreement_version,
        krIndex,
      );
      update({
        krIndex,
        stage: "delivery",
        status: published.alreadyPublished
          ? "published"
          : (published.receipt?.status ?? "unknown"),
        executionId: published.executionId,
        digest: published.receipt?.digest,
      });
      if (
        !published.alreadyPublished &&
        published.receipt?.status !== "confirmed"
      )
        return;
    }
    ctx.assertLive();
    setScheduleConsent(false);
    onChanged();
    setDescription(await ctx.runner.describe(okrId));
  }
  async function queryScheduledRow(row: (typeof scheduledRows)[number]) {
    const ctx = await load();
    const result =
      row.stage === "control"
        ? await new OkrControl(
            ctx.chain,
            ctx.signer,
            ctx.grantId,
            organizationId,
            okrId,
            row.agreementVersion,
            row.krIndex,
            journal.current!,
            ctx.assertLive,
          ).query()
        : row.stage === "run"
          ? await ctx.runner.queryPreparedKr(
              okrId,
              row.agreementVersion,
              row.krIndex,
            )
          : row.executionId
            ? await ctx.runner.queryChainDelivery(row.executionId)
            : undefined;
    const original =
      row.stage === "control"
        ? null
        : await ctx.runner.readPreparedKr(
            okrId,
            row.agreementVersion,
            row.krIndex,
          );
    if (original && row.executionId && original.run.id !== row.executionId)
      throw new Error("Original prepared Run changed");
    ctx.assertLive();
    setScheduledRows((previous) =>
      previous.map((old) =>
        old.krIndex === row.krIndex &&
        old.stage === row.stage &&
        old.agreementVersion === row.agreementVersion
          ? {
              ...old,
              status: result?.status ?? old.status,
              digest: result?.digest ?? old.digest,
              executionId: original?.run.id ?? old.executionId,
              runState: original?.run.state,
              deliveryPresent: original ? !!original.delivery : undefined,
            }
          : old,
      ),
    );
    onChanged();
  }
  async function read() {
    const ctx = await load();
    const restored = await ctx.runner.step({
      okrId,
      capabilityId: emptyCapability,
    });
    ctx.assertLive();
    const desc = await ctx.runner.describe(okrId);
    const originals: typeof scheduledRows = [];
    for (let index = 0; index < desc.plan.krs.length; index++) {
      const krIndex = String(index);
      const original = await ctx.runner.readPreparedKr(
        okrId,
        desc.okr.agreement_version,
        krIndex,
      );
      if (!original) continue;
      const base = {
        krIndex,
        agreementVersion: desc.okr.agreement_version,
        executionId: original.run.id,
        runState: original.run.state,
        deliveryPresent: !!original.delivery,
      };
      originals.push({ ...base, stage: "run", status: "chain_found" });
      originals.push({
        ...base,
        stage: "delivery",
        status: original.delivery ? "published" : "not_published",
      });
    }
    ctx.assertLive();
    setScheduledRows(originals);
    setDescription(desc);
    setScheduleConsent(false);
    setState(restored);
    if (
      desc.okr.state !== 1 ||
      Number(desc.okr.next_kr) >= desc.plan.krs.length
    ) {
      ctx.control = undefined;
      setLocator(null);
      setControlOutcome(null);
      return;
    }
    ctx.control = new OkrControl(
      ctx.chain,
      ctx.signer,
      ctx.grantId,
      organizationId,
      okrId,
      desc.okr.agreement_version,
      desc.okr.next_kr,
      journal.current!,
      ctx.assertLive,
      { okrVersion: desc.okr.version, policyPin: canonical(desc.policy) },
    );
    let saved: Locator = {
      deviceProfile,
      grantId: ctx.grantId,
      agreementVersion: desc.okr.agreement_version,
      krIndex: desc.okr.next_kr,
    };
    try {
      const old = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        old &&
        old.deviceProfile === deviceProfile &&
        old.grantId === ctx.grantId &&
        old.agreementVersion === saved.agreementVersion &&
        old.krIndex === saved.krIndex
      ) {
        if (
          (old.capabilityId !== undefined && !id.test(old.capabilityId)) ||
          (old.deliveryAttempted !== undefined &&
            typeof old.deliveryAttempted !== "boolean")
        )
          throw new Error();
        saved = old;
      }
    } catch {
      throw Object.assign(new Error(), { code: "journal_unavailable" });
    }
    if (restored.executionId) {
      const run = await ctx.chain.sdk.nodeExecution.getExecution(
        restored.executionId,
      );
      ctx.assertLive();
      saved.capabilityId = run.capability_id;
      // Unknown historical delivery is not inferred to be safe to send. A
      // fresh local preparation records false before any Host request.
      saved.deliveryAttempted ??= true;
    } else {
      const prior = await ctx.control.query();
      ctx.assertLive();
      setControlOutcome((old) => retainReceipt(old, prior ?? null));
      if (prior?.status === "confirmed")
        saved.capabilityId = await ctx.control.confirmed(prior);
      if (saved.capabilityId) await ctx.control.use(saved.capabilityId);
    }
    ctx.assertLive();
    save(saved);
  }
  async function prepareControl() {
    const ctx = context.current;
    if (!ctx?.control)
      throw Object.assign(new Error(), { code: "state_changed" });
    const quoted = await ctx.control.prepare();
    ctx.assertLive();
    if ("status" in quoted) await receivedControl(quoted);
    else setFee({ kind: "control", quote: quoted });
  }
  async function receivedControl(result: SelfPayTransactionOutcome) {
    const ctx = context.current;
    if (!ctx?.control || !locator)
      throw Object.assign(new Error(), { code: "state_changed" });
    ctx.assertLive();
    setControlOutcome((old) => retainReceipt(old, result));
    if (result.status === "confirmed") {
      const capabilityId = await ctx.control.confirmed(result);
      ctx.assertLive();
      save({ ...locator, capabilityId });
    }
    onChanged();
  }
  async function prepareRun() {
    const ctx = context.current;
    if (!ctx?.control || !locator?.capabilityId)
      throw Object.assign(new Error(), { code: "state_changed" });
    await ctx.control.use(locator.capabilityId);
    ctx.assertLive();
    const priorReceipt = ctx.runner.lastSubmission;
    const result = await ctx.runner.step({
      okrId,
      capabilityId: locator.capabilityId,
      createIfMissing: true,
      prepareOnly: true,
    });
    ctx.assertLive();
    setFee(null);
    feeAnswer.current = null;
    setState(result);
    setRunOutcome(ctx.runner.lastSubmission ?? null);
    const currentReceipt = ctx.runner.lastSubmission;
    if (
      currentReceipt &&
      currentReceipt !== priorReceipt &&
      currentReceipt.digest === result.transactionDigest
    )
      save({ ...locator, deliveryAttempted: false });
    else if (result.executionId)
      save({
        ...locator,
        deliveryAttempted: locator.deliveryAttempted ?? true,
      });
    onChanged();
  }
  function answerFee(accepted: boolean) {
    if (fee?.kind !== "run" || feeAnswer.current?.quote !== fee.quote) return;
    feeAnswer.current.resolve(accepted);
    feeAnswer.current = null;
    setFee(null);
  }
  async function submitControl() {
    const ctx = context.current;
    if (!ctx?.control || fee?.kind !== "control")
      throw Object.assign(new Error(), { code: "state_changed" });
    const result = await ctx.control.submit(fee.quote);
    ctx.assertLive();
    setFee(null);
    await receivedControl(result);
  }
  async function send() {
    const ctx = context.current;
    if (
      !ctx ||
      !locator?.capabilityId ||
      locator.deliveryAttempted !== false ||
      state?.status !== "queued" ||
      !state.executionId
    )
      throw Object.assign(new Error(), { code: "state_changed" });
    save({ ...locator, deliveryAttempted: true });
    deliveryJournal.current ??= new IndexedDbOkrDeliveryJournal();
    if (
      !chainDelivery &&
      !(await deliveryJournal.current.claim(
        okrDeliveryKey(
          profile.network,
          await ctx.chain.checkNetwork(),
          ctx.signer.device.address,
          state.executionId,
        ),
      ))
    )
      throw Object.assign(new Error(), { code: "original_run_needs_review" });
    ctx.assertLive();
    const result = await ctx.runner.step(
      {
        okrId,
        capabilityId: locator.capabilityId,
        releaseQueued: true,
        expectedExecutionId: state.executionId,
        expectedAgreementVersion: locator.agreementVersion,
        expectedKrIndex: locator.krIndex,
      },
      chainDelivery ? "chain" : "coordinator",
    );
    ctx.assertLive();
    if (chainDelivery)
      setChainOutcome(ctx.runner.lastChainDeliverySubmission ?? null);
    if (result.reason === "chain_delivery_fee_declined")
      save({ ...locator, deliveryAttempted: false });
    setState(result);
    onChanged();
  }
  async function query() {
    const ctx = await load();
    const original = await ctx.runner.query(okrId);
    ctx.assertLive();
    setRunOutcome((old) => retainReceipt(old, original ?? null));
    if (state?.executionId) {
      const delivery = await ctx.runner.queryChainDelivery(state.executionId);
      ctx.assertLive();
      setChainOutcome((old) => retainReceipt(old, delivery ?? null));
    }
    if (ctx.control) {
      const cap = await ctx.control.query();
      ctx.assertLive();
      setControlOutcome((old) => retainReceipt(old, cap ?? null));
    }
    await read();
  }
  const kr = description?.plan.krs[Number(description.okr.next_kr)];
  return (
    <>
      <button className="secondary" onClick={begin}>
        {t("执行与继续", "Execute & continue")}
      </button>
      <dialog
        ref={dialog}
        className="okr-create-dialog handover-dialog"
        aria-label={t("OKR 执行与继续", "OKR execution and continuation")}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <header className="dialog-heading">
          <div>
            <span className="eyebrow">{t("OKR 执行", "OKR execution")}</span>
            <h2>
              {t(
                "确认当前 KR，明确继续",
                "Review the current KR and continue explicitly",
              )}
            </h2>
          </div>
          <button className="secondary" onClick={close}>
            {t("关闭", "Close")}
          </button>
        </header>
        <p>
          {t(
            "读取原请求 → 确认单次权限与费用 → 准备原命令 → 明确发送到 Host。切换页面或重新打开不会启动执行。",
            "Read the original request → confirm one-use authority and fees → prepare the command → explicitly send to the Host. Reopening does not start execution.",
          )}
        </p>
        <label>
          {t("当前设备配置", "Current device profile")}
          <input
            value={deviceProfile}
            disabled={busy || !!context.current || !!fee}
            onChange={(e) => setDeviceProfile(e.target.value)}
          />
        </label>
        <div className="button-row">
          <button disabled={busy || !!fee} onClick={() => void perform(read)}>
            {t("读取计划与原执行", "Read plan & original execution")}
          </button>
          <button
            className="secondary"
            disabled={busy || !!fee}
            onClick={() => void perform(query)}
          >
            {t("查询原交易与状态", "Query original transactions & state")}
          </button>
        </div>
        {error && (
          <p role="alert">
            {error === "native_unavailable"
              ? t(
                  "请在 FractalMind 原生 App 中解锁设备并继续。",
                  "Unlock your device in the native FractalMind App to continue.",
                )
              : error === "invalid_grant"
                ? t(
                    "当前设备没有此组织所需的读取、执行与审批权限。",
                    "This device needs read, operate and approve access to this organization.",
                  )
                : t(
                    "当前状态无法继续，请查询原请求或重新读取计划。",
                    "Cannot continue from the current state. Query the original request or read the plan again.",
                  )}{" "}
            <small>{error}</small>
          </p>
        )}
        {description && (
          <section>
            <h3>{description.spec.objective}</h3>
            <p>{description.spec.successCriteria}</p>
            {kr && (
              <h4>
                KR {Number(description.okr.next_kr) + 1} ·{" "}
                {description.spec.krs[Number(description.okr.next_kr)].title}
              </h4>
            )}
            <p>
              {t("约定版本", "Agreement version")}:{" "}
              {description.okr.agreement_version} ·{" "}
              {t("执行最晚到期", "Execution expires by")}:{" "}
              {new Date(Number(description.okr.expires_at_ms)).toLocaleString()}
            </p>
            <p>
              {t("单次权限工具上限", "One-use authority tool limit")}:{" "}
              {description.policy.max_calls}
            </p>
            <p>
              {t("禁止动作", "Prohibited actions")}:{" "}
              {description.spec.constraints.prohibitedActions.join(", ")}
            </p>
            <p>
              {t("总工具预算", "Total tool budget")}:{" "}
              {description.okr.budget_limit} ·{" "}
              {t("本 KR 工具上限", "This KR tool limit")}: {kr?.maxCalls ?? "—"}
            </p>
            {Object.entries(description.plan.paths).map(([tool, dirs]) => (
              <p key={tool}>
                <strong>{tool}</strong>: {dirs.join(", ")}
              </p>
            ))}
            {kr?.files.map((file) => (
              <details key={file.path}>
                <summary>{file.path}</summary>
                <pre>{file.content}</pre>
              </details>
            ))}
            <p className="long-id">
              {t("固定受管理实例", "Fixed managed instance")}:{" "}
              {description.okr.managed_agent}
            </p>
          </section>
        )}
        {description?.okr.state === 1 &&
          Number(description.okr.next_kr) + 1 < description.plan.krs.length && (
            <section className="notice">
              <h3>{t("提前授权后续 KR", "Authorize later KRs in advance")}</h3>
              <p>
                {t(
                  "逐条确认权限、命令准备与链上投递费用。Host 开启链上接收后，人工验证当前 KR 才会执行下一条；App 关闭不撤销已发布命令。每条命令最长有效 5 分钟，到期后须处理原 Run 并重新授权。",
                  "Confirm each authority, preparation and delivery fee. A Host with chain reception enabled waits for Human verification before executing the next KR. Closing the App does not revoke published commands. Each command lasts at most five minutes; expired original Runs must be settled before new authorization.",
                )}
              </p>
              {description.plan.krs
                .slice(Number(description.okr.next_kr) + 1)
                .map((later, i) => (
                  <details key={i}>
                    <summary>
                      KR {Number(description.okr.next_kr) + i + 2} ·{" "}
                      {t("工具上限", "Tool limit")}: {later.maxCalls}
                    </summary>
                    {later.files.map((file) => (
                      <div key={file.path}>
                        <strong>{file.path}</strong>
                        <pre>{file.content}</pre>
                      </div>
                    ))}
                  </details>
                ))}
              <label>
                <input
                  type="checkbox"
                  checked={scheduleConsent}
                  disabled={busy || !!fee}
                  onChange={(e) => setScheduleConsent(e.target.checked)}
                />
                {t(
                  "我确认上述后续计划与当前边界，允许 Host 在独立验收后继续",
                  "I confirm these later plans and current boundaries, and allow Host continuation after independent verification",
                )}
              </label>
              <button
                disabled={busy || !!fee || !scheduleConsent}
                onClick={() => void perform(scheduleLaterKrs)}
              >
                {t(
                  "确认后续 KR 的权限与费用",
                  "Review later KR authority and fees",
                )}
              </button>
            </section>
          )}
        {scheduledRows.length > 0 && (
          <section aria-live="polite">
            <h3>{t("后续 KR 原请求", "Original later KR requests")}</h3>
            {scheduledRows.map((row) => (
              <div key={`${row.krIndex}:${row.stage}`}>
                <p>
                  KR {Number(row.krIndex) + 1} ·{" "}
                  {row.stage === "control"
                    ? t("权限", "Authority")
                    : row.stage === "run"
                      ? t("执行准备", "Preparation")
                      : t("链上投递", "Chain delivery")}{" "}
                  ·{" "}
                  {row.status === "confirmed"
                    ? t("已确认", "Confirmed")
                    : row.status === "chain_found"
                      ? t("原 Run 已在链上", "Original Run exists on chain")
                      : row.status === "unknown"
                        ? t(
                            "原交易回执暂不可读",
                            "Original transaction receipt is currently unavailable",
                          )
                        : row.status === "not_published"
                          ? t(
                              "未发现链上投递记录",
                              "No chain delivery record found",
                            )
                          : row.status === "published"
                            ? t("已在链上", "Already published")
                            : row.status === "queued"
                              ? t("原 Run 已排队", "Original Run queued")
                              : row.status === "declined"
                                ? t(
                                    "未提交，保留已准备的原 Run",
                                    "Not submitted; prepared original Runs are retained",
                                  )
                                : t(
                                    "查询原请求确认状态",
                                    "Query the original request for its status",
                                  )}
                </p>
                {row.runState !== undefined && (
                  <p>
                    {t(
                      "链上原 Run 当前状态",
                      "Current original Run state on chain",
                    )}
                    :{" "}
                    {t(
                      [
                        "已排队",
                        "运行中",
                        "执行成功",
                        "执行失败",
                        "执行结果未知",
                        "已取消",
                      ][row.runState] ?? "未知",
                      [
                        "Queued",
                        "Running",
                        "Succeeded",
                        "Failed",
                        "Outcome unknown",
                        "Cancelled",
                      ][row.runState] ?? "Unknown",
                    )}{" "}
                    ·{" "}
                    {row.deliveryPresent
                      ? t("命令已发布", "Command published")
                      : t("未发现投递记录", "No delivery record found")}
                  </p>
                )}
                {row.status === "unknown" && (
                  <p>
                    {t(
                      "回执不可读不代表任务未执行。以上链上状态独立核对；此次查询不会收费或重发。",
                      "An unavailable receipt does not mean the task did not execute. Chain state is checked separately; this query never charges or resends.",
                    )}
                  </p>
                )}
                {row.executionId && (
                  <p className="long-id">Run: {row.executionId}</p>
                )}
                {row.digest && (
                  <details>
                    <summary>
                      {t("原交易摘要", "Original transaction digest")}
                    </summary>
                    <code className="long-id">{row.digest}</code>
                  </details>
                )}
                <button
                  className="secondary"
                  disabled={busy || !!fee}
                  onClick={() => void perform(() => queryScheduledRow(row))}
                >
                  {t("查询这条原请求", "Query this original request")}
                </button>
              </div>
            ))}
          </section>
        )}
        {state && (
          <section>
            <h3>{t(...labels[state.status])}</h3>
            {state.executionId && (
              <p className="long-id">Run: {state.executionId}</p>
            )}
            {locator?.deliveryAttempted && state.status === "queued" && (
              <p>
                {t(
                  "已有投递尝试或历史不明，先查询原请求；不会自动重发。",
                  "Delivery was attempted or its history is unknown. Query the original request; it will not be resent automatically.",
                )}
              </p>
            )}
            {state.status === "queued" &&
              locator?.deliveryAttempted === false && (
                <p>
                  {t(
                    "原命令已准备；尚未向 Host 发起投递。",
                    "The original command is prepared. No Host delivery has been attempted.",
                  )}
                </p>
              )}
            {state.status === "awaiting_verification" && (
              <p>
                {t(
                  "Agent 的测量不等于人工验证，下一 KR 等待独立确认。",
                  "Agent measurement does not count as Human verification. The next KR awaits independent confirmation.",
                )}
              </p>
            )}
            {state.reason &&
              (state.reason === "chain_delivery_fee_declined" ? (
                <p>
                  {t(
                    "你取消了投递费用确认，原命令尚未发布到队列。可重新确认费用或查看原 Run。",
                    "You declined the delivery fee. The original command was not published to the queue. Review its Run or explicitly confirm a new quote.",
                  )}
                </p>
              ) : (
                <details>
                  <summary>{t("状态详情", "State details")}</summary>
                  <code>{state.reason}</code>
                </details>
              ))}
          </section>
        )}
        {description && state?.status === "idle" && (
          <div className="button-row">
            {!locator?.capabilityId && (
              <button
                disabled={busy || !!fee || !!controlOutcome}
                onClick={() => void perform(prepareControl)}
              >
                {t("准备单次执行权限费用", "Prepare one-use execution fee")}
              </button>
            )}
            {locator?.capabilityId && (
              <button
                disabled={busy || !!fee}
                onClick={() => void perform(prepareRun)}
              >
                {t("准备本 KR 的命令费用", "Prepare this KR command fee")}
              </button>
            )}
          </div>
        )}
        {state?.status === "queued" && locator?.deliveryAttempted === false && (
          <section>
            <label>
              <input
                type="checkbox"
                checked={chainDelivery}
                disabled={busy || !!fee}
                onChange={(event) => setChainDelivery(event.target.checked)}
              />
              {t(
                "允许 Host 从链上接收这条命令",
                "Allow Host to receive this command from Sui",
              )}
            </label>
            {chainDelivery && (
              <p>
                {t(
                  "需要额外确认一次投递存储费用。Host 开启链上接收后，可在 App 关闭时执行这条原命令；权限、工具预算和最晚到期保持原约定。下一 KR 与人工验收仍需独立确认。",
                  "Confirm a separate delivery storage fee. A Host with chain reception enabled can execute this original command after the App closes, within its original authority, tool budget and expiry. The next KR and Human acceptance still require separate confirmation.",
                )}
              </p>
            )}
            <button disabled={busy || !!fee} onClick={() => void perform(send)}>
              {chainDelivery
                ? t("确认链上投递费用", "Review chain delivery fee")
                : t("发送原命令到 Host", "Send original command to Host")}
            </button>
          </section>
        )}
        {fee && (
          <section className="notice">
            <h3>
              {fee.kind === "control" ||
              fee.quote.requestId.startsWith("okr-control:")
                ? t("确认单次权限费用", "Confirm one-use authority fee")
                : fee.quote.requestId.startsWith("chain-delivery:")
                  ? t(
                      "确认原命令链上投递费用",
                      "Confirm original command chain delivery fee",
                    )
                  : t(
                      "确认票据与执行准备费用",
                      "Confirm ticket & execution preparation fee",
                    )}
            </h3>
            <p>
              {profile.network} · {t("余额", "Balance")}:{" "}
              {sui(fee.quote.balance)}
            </p>
            <p>
              {t("预计费用", "Estimated fee")}: {sui(fee.quote.estimatedGas)} ·{" "}
              {t("费用上限", "Fee limit")}: {sui(fee.quote.gasBudget)}
            </p>
            <p className="long-id">
              {t("付款地址", "Payer")}: {fee.quote.sender}
            </p>
            <p>
              {t("报价有效至", "Quote valid until")}:{" "}
              {new Date(fee.quote.expiresAtMs).toLocaleTimeString()}
            </p>
            <button
              disabled={
                now >= fee.quote.expiresAtMs || (fee.kind === "control" && busy)
              }
              onClick={() =>
                fee.kind === "run"
                  ? answerFee(true)
                  : void perform(submitControl)
              }
            >
              {t("确认费用并签名提交", "Confirm fee, sign & submit")}
            </button>
            <button
              className="secondary"
              disabled={fee.kind === "control" && busy}
              onClick={() =>
                fee.kind === "run" ? answerFee(false) : setFee(null)
              }
            >
              {t("取消本次报价", "Cancel this quote")}
            </button>
          </section>
        )}
        {[controlOutcome, runOutcome, chainOutcome].map(
          (result, index) =>
            result && (
              <section key={index}>
                <p>
                  {index === 0
                    ? t("单次执行权限", "One-use execution authority")
                    : index === 1
                      ? t("原命令准备交易", "Original command preparation")
                      : t(
                          "原命令链上投递交易",
                          "Original command chain delivery",
                        )}
                  :{" "}
                  {result.status === "confirmed"
                    ? t("交易已确认", "Transaction confirmed")
                    : result.status === "failed"
                      ? t("交易明确失败", "Transaction failed")
                      : t(
                          "结果未知，查询原摘要",
                          "Outcome unknown; query the original digest",
                        )}
                </p>
                <details>
                  <summary>{t("交易详情", "Transaction details")}</summary>
                  <code className="long-id">{result.digest}</code>
                  {result.actualGas && (
                    <p>
                      {t("实际费用", "Actual fee")}: {sui(result.actualGas)}
                    </p>
                  )}
                </details>
              </section>
            ),
        )}
      </dialog>
    </>
  );
}
