import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  HANDOVER_REVIEW_WINDOW_MS,
  TransactionPreflightError,
  type HandoverProposal,
  type NativeFileOkrPlan,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { HandoverSetup } from "./handover-setup";
import { HandoverReview, type HandoverReviewInput } from "./handover-review";
import { HandoverApproval } from "./handover-approval";
import { validateHandoverPlan, type OkrSpecification } from "./handover-plan";
import { PrivateRecords, type RecordPointer } from "./private-records";
import {
  NativeDeviceSigner,
  preferredDeviceProfile,
  scopedNativeInvoke,
  type NativeInvoke,
} from "./native-device";
import type { Agent, ConnectionProfile, OkrSnapshot } from "./domain";

type Attempt = {
  id: string;
  deviceProfile: string;
  grantId: string;
  capabilityId?: string;
  deliveryAttempted?: boolean;
};
type Fee = {
  kind: "capability" | "review" | "approval" | "stop";
  quote: SelfPayFeeQuote;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = /^0x[0-9a-f]{64}$/;
function sui(value: string) {
  const n = BigInt(value),
    sign = n < 0n ? "−" : "",
    absolute = n < 0n ? -n : n;
  return `${sign}${absolute / 1000000000n}.${
    String(absolute % 1000000000n)
      .padStart(9, "0")
      .replace(/0+$/, "") || "0"
  } SUI`;
}

/** v2 inclusion flow. Plans/quotes/decrypted bodies stay in memory. Only
 * disposable public correlation IDs and a delivery-attempt marker are local;
 * the signed review, Run and approved agreement are authoritative on Sui. */
export default function HandoverFlow({
  profile,
  organizationId,
  managed,
  okrs,
  onChanged,
  onContinue,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  managed: Agent;
  okrs: OkrSnapshot[] | null;
  onChanged: () => void;
  onContinue?: (okrId: string) => void;
  t: (zh: string, en: string) => string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile),
    [attempt, setAttempt] = useState<Attempt | null>(null);
  const [okrId, setOkrId] = useState(""),
    [spec, setSpec] = useState<OkrSpecification | null>(null);
  const [paths, setPaths] = useState(""),
    [krs, setKrs] = useState<NativeFileOkrPlan["krs"]>([]),
    [reviewed, setReviewed] = useState(false);
  const [input, setInput] = useState<HandoverReviewInput | null>(null),
    [runId, setRunId] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<{
    state: number;
    stopRequested: boolean;
  } | null>(null);
  const [fee, setFee] = useState<Fee | null>(null),
    [outcomes, setOutcomes] = useState<
      Partial<Record<Fee["kind"], SelfPayTransactionOutcome>>
    >({});
  const [hostAccepted, setHostAccepted] = useState(false),
    [discovered, setDiscovered] = useState<RecordPointer[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const dialog = useRef<HTMLDialogElement>(null),
    mounted = useRef(true),
    epoch = useRef(0),
    flight = useRef(false),
    opened = useRef(false),
    actionToken = useRef(0),
    submissionAttempted = useRef(false);
  const journal = useRef<IndexedDbTransactionJournal | null>(null);
  const context = useRef<{
    chain: ChainReadSession;
    signer: NativeDeviceSigner;
    invoke: NativeInvoke;
    attempt: Attempt;
    setup: HandoverSetup;
    review: HandoverReview;
    approval?: HandoverApproval;
    assertLive: () => void;
  } | null>(null);
  const key = `fractalmind.app.handover-attempt.v1:${JSON.stringify([profile.network, profile.chainIdentifier, profile.humanId, organizationId, managed.id])}`;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const hide = () => {
      if (document.hidden) close();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      mounted.current = false;
      epoch.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      void journal.current?.close();
    };
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  function clearPrivate() {
    setSpec(null);
    setKrs([]);
    setPaths("");
    setInput(null);
    setReviewed(false);
    setFee(null);
    setHostAccepted(false);
    setDiscovered(null);
    setRunId(null);
    setReviewState(null);
  }
  function close() {
    opened.current = false;
    epoch.current++;
    context.current = null;
    clearPrivate();
    setOpen(false);
    dialog.current?.close();
  }
  function begin() {
    opened.current = true;
    submissionAttempted.current = false;
    setError(null);
    setOutcomes({});
    setOkrId("");
    clearPrivate();
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (saved) {
        if (
          !uuid.test(saved.id) ||
          !id.test(saved.grantId) ||
          !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(saved.deviceProfile) ||
          (saved.capabilityId !== undefined && !id.test(saved.capabilityId)) ||
          (saved.deliveryAttempted !== undefined &&
            typeof saved.deliveryAttempted !== "boolean")
        )
          throw new Error();
        setAttempt(saved);
        setDeviceProfile(saved.deviceProfile);
      } else setAttempt(null);
    } catch {
      setError("journal_unavailable");
    }
    setOpen(true);
  }
  function save(value: Attempt) {
    assertAction();
    // A cache failure must precede signing/dispatch, not silently remove recovery.
    localStorage.setItem(key, JSON.stringify(value));
    setAttempt(value);
    if (context.current) context.current.attempt = value;
  }
  async function perform(action: () => Promise<void>) {
    if (flight.current) return;
    const token = epoch.current;
    actionToken.current = token;
    flight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (
        e instanceof TransactionPreflightError &&
        e.cause &&
        typeof e.cause === "object" &&
        "code" in e.cause
      )
        e = e.cause;
      if (mounted.current && token === epoch.current)
        setError(
          e && typeof e === "object" && "code" in e
            ? String(e.code)
            : "operation_failed",
        );
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function assertAction() {
    if (
      !mounted.current ||
      !opened.current ||
      actionToken.current !== epoch.current
    )
      throw Object.assign(new Error(), { code: "state_changed" });
  }
  async function load(value = attempt, persist = true) {
    assertAction();
    if (context.current && (!value || context.current.attempt.id === value.id))
      return context.current;
    if (!isTauri())
      throw Object.assign(new Error(), { code: "native_unavailable" });
    const token = epoch.current;
    const assertLive = () => {
      if (!mounted.current || !opened.current || epoch.current !== token)
        throw Object.assign(new Error(), { code: "state_changed" });
    };
    const transport = scopedNativeInvoke(
      (command, args) => invoke(command, args),
      assertLive,
    );
    const signer = await NativeDeviceSigner.load(
        transport,
        value?.deviceProfile ?? deviceProfile,
      ),
      chain = new ChainReadSession(profile);
    let grantId = value?.grantId;
    if (!grantId) {
      const identity = await chain.human();
      const grants = identity.grants.value?.filter(
        (g) =>
          g.device === signer.device.address &&
          !g.revoked &&
          g.generation === identity.human.generation &&
          [1, 2, 3, 4].every((a) => g.actions.includes(a)) &&
          (g.org_scope === null || g.org_scope === organizationId) &&
          BigInt(g.expires_at_ms) > identity.clockMs,
      );
      const scoped = grants?.filter((g) => g.org_scope === organizationId),
        usable = scoped?.length ? scoped : grants;
      if (usable?.length !== 1)
        throw Object.assign(new Error(), { code: "invalid_grant" });
      grantId = usable[0].id;
    }
    assertLive();
    value ??= { id: crypto.randomUUID(), deviceProfile, grantId };
    journal.current ??= new IndexedDbTransactionJournal();
    const delivery: typeof fetch = async (url, init) => {
      assertLive();
      return fetch(url, init);
    };
    context.current = {
      chain,
      signer,
      invoke: transport,
      attempt: value,
      assertLive,
      setup: new HandoverSetup(
        chain,
        signer,
        grantId,
        organizationId,
        managed.id,
        value.id,
        transport,
        journal.current,
        assertLive,
      ),
      review: new HandoverReview(
        chain,
        signer,
        grantId,
        organizationId,
        value.id,
        transport,
        journal.current,
        delivery,
        assertLive,
      ),
    };
    if (persist) save(value);
    return context.current;
  }
  function plan(): NativeFileOkrPlan {
    const dirs = paths
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    return {
      format: 1,
      paths: { "file.read": dirs, "file.write": dirs },
      krs: structuredClone(krs),
    };
  }
  function checkPlan() {
    if (!spec || !id.test(okrId))
      throw Object.assign(new Error(), { code: "invalid_input" });
    const candidate = plan();
    const proposal: HandoverProposal = {
      version: "1",
      managed_agent_id: managed.id,
      managed_version: managed.version,
      okr_id: okrId,
      okr_version: "1",
      spec_revision: "1",
      workspace_hash: managed.workspace_hash
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
      paths: candidate.paths,
      budget_asset: "TOOL_CALLS",
      budget_limit: spec.constraints.budget.limit,
      max_calls: candidate.krs.reduce(
        (m, k) => (BigInt(k.maxCalls) > BigInt(m) ? k.maxCalls : m),
        "0",
      ),
      expires_at_ms: Number(spec.deadlineMs),
      review_expires_at_ms: Date.now() + HANDOVER_REVIEW_WINDOW_MS,
      nonce: "00".repeat(32),
    };
    validateHandoverPlan(spec, candidate, proposal);
    setReviewed(true);
    return candidate;
  }
  async function loadSpecification() {
    const ctx = await load();
    const value = await ctx.setup.specification(okrId);
    ctx.assertLive();
    setSpec(value.spec);
    setPaths(value.spec.constraints.allowedPaths[0] ?? "");
    setReviewed(false);
    if (
      value.spec.krs.some(
        (k) =>
          !["files", "文件"].includes(k.unit) ||
          k.baseline !== "0" ||
          k.precision !== 0 ||
          BigInt(k.target) < 1n ||
          BigInt(k.target) > 3n,
      )
    ) {
      setKrs([]);
      throw Object.assign(new Error(), { code: "unsupported_metric" });
    }
    setKrs(
      value.spec.krs.map((k) => ({
        maxCalls: String(Number(k.target) * 3),
        files: Array.from({ length: Number(k.target) }, () => ({
          path: "",
          content: "",
        })),
      })),
    );
  }
  async function receive(
    kind: Fee["kind"],
    outcome: SelfPayTransactionOutcome,
  ) {
    assertAction();
    setFee(null);
    setOutcomes((rows) => ({ ...rows, [kind]: outcome }));
    if (outcome.status === "confirmed") {
      const ctx = await load();
      if (kind === "capability" && !ctx.attempt.capabilityId) {
        const capabilityId = await ctx.setup.confirmed(outcome);
        ctx.assertLive();
        save({ ...ctx.attempt, capabilityId });
      }
      if (kind === "review" || kind === "stop") await restore();
      onChanged();
    }
  }
  async function prepareCapability() {
    checkPlan();
    const ctx = await load();
    const quote = await ctx.setup.prepare();
    ctx.assertLive();
    if ("status" in quote) await receive("capability", quote);
    else setFee({ kind: "capability", quote });
  }
  async function prepareReview() {
    const ctx = await load();
    if (!ctx.attempt.capabilityId)
      throw Object.assign(new Error(), { code: "invalid_source" });
    // Original journal/ticket takes precedence over creating any fresh signature.
    const prior = await ctx.review.query();
    ctx.assertLive();
    if (prior) {
      await receive("review", prior);
      return;
    }
    const original = await ctx.review.restore();
    ctx.assertLive();
    if (original.ticket) {
      await restore();
      return;
    }
    const value =
      input ??
      (await ctx.setup.createReview(
        okrId,
        ctx.attempt.capabilityId,
        checkPlan(),
        spec!,
      ));
    ctx.assertLive();
    setInput(value);
    const quote = await ctx.review.prepare(value);
    ctx.assertLive();
    if ("status" in quote) await receive("review", quote);
    else setFee({ kind: "review", quote });
  }
  async function restore(value?: Attempt) {
    const ctx = await load(value, !value);
    const original = await ctx.review.restore();
    ctx.assertLive();
    if (!original.ticket || !original.run)
      throw Object.assign(new Error(), { code: "ticket_not_observed" });
    if (original.ticket.input.managedAgentId !== managed.id)
      throw Object.assign(new Error(), { code: "another_instance" });
    if (value)
      save({
        ...value,
        capabilityId: original.ticket.input.command.capability.id,
        deliveryAttempted: true,
      });
    setInput(original.ticket.input);
    setRunId(original.run.id);
    setReviewState({
      state: original.run.state,
      stopRequested: original.run.stop_requested,
    });
    setHostAccepted(false);
    setOkrId(
      (
        original.ticket.input.command.payload
          .handover_review as HandoverProposal
      ).okr_id,
    );
    setKrs(original.ticket.input.nativeFilePlan.krs);
    setPaths(
      original.ticket.input.nativeFilePlan.paths["file.read"]?.join("\n") ?? "",
    );
    setReviewed(true);
    if (original.originalOutcome)
      setOutcomes((rows) => ({ ...rows, review: original.originalOutcome }));
    ctx.approval = new HandoverApproval(
      ctx.chain,
      ctx.signer,
      ctx.attempt.grantId,
      organizationId,
      original.run.id,
      ctx.invoke,
      journal.current!,
      ctx.assertLive,
    );
    const approved = await ctx.approval.query();
    ctx.assertLive();
    if (approved) setOutcomes((rows) => ({ ...rows, approval: approved }));
  }
  async function sendReview() {
    const ctx = await load();
    if (ctx.attempt.deliveryAttempted)
      throw Object.assign(new Error(), { code: "delivery_already_attempted" });
    // Conservative persistent transport marker. Even a lost response can never
    // cause refresh/reopen to automatically deliver this command a second time.
    save({ ...ctx.attempt, deliveryAttempted: true });
    await ctx.review.send(true);
  }
  async function readResponse() {
    const ctx = await load();
    const result = await ctx.review.readAcceptance();
    const target = result.acceptance.proposal;
    const current = await ctx.setup.specification(target.okr_id);
    if (
      current.okr.version !== target.okr_version ||
      current.okr.spec_revision !== target.spec_revision
    )
      throw Object.assign(new Error(), { code: "state_changed" });
    ctx.assertLive();
    setSpec(current.spec);
    setReviewState({
      state: result.run.state,
      stopRequested: result.run.stop_requested,
    });
    setHostAccepted(true);
  }
  async function prepareApproval() {
    const ctx = await load();
    if (!ctx.approval || !input)
      throw Object.assign(new Error(), { code: "invalid_source" });
    const quote = await ctx.approval.prepare({
      command: input.command,
      nativeFilePlan: input.nativeFilePlan,
    });
    ctx.assertLive();
    if ("status" in quote) await receive("approval", quote);
    else setFee({ kind: "approval", quote });
  }
  async function prepareStop() {
    const ctx = await load();
    const quote = await ctx.review.prepareStop(true);
    ctx.assertLive();
    if ("status" in quote) await receive("stop", quote);
    else setFee({ kind: "stop", quote });
  }
  async function submitFee() {
    if (!fee) return;
    if (fee.kind === "stop") {
      const ctx = await load();
      await receive("stop", await ctx.review.submitStop(fee.quote));
      return;
    }
    const ctx = await load(),
      controller =
        fee.kind === "capability"
          ? ctx.setup
          : fee.kind === "review"
            ? ctx.review
            : ctx.approval;
    if (!controller)
      throw Object.assign(new Error(), { code: "invalid_source" });
    if (fee.kind === "review") submissionAttempted.current = true;
    await receive(fee.kind, await controller.submit(fee.quote));
  }
  async function query(kind: Fee["kind"]) {
    if (kind === "stop") {
      const ctx = await load(),
        found = await ctx.review.queryStop();
      if (!found) throw Object.assign(new Error(), { code: "not_recorded" });
      await receive("stop", found);
      return;
    }
    const ctx = await load(),
      controller =
        kind === "capability"
          ? ctx.setup
          : kind === "review"
            ? ctx.review
            : ctx.approval;
    const found = await controller?.query();
    if (!found) throw Object.assign(new Error(), { code: "not_recorded" });
    await receive(kind, found);
  }
  async function discover() {
    const ctx = await load();
    const pointers = await new PrivateRecords(
      ctx.chain,
      ctx.signer,
      ctx.attempt.grantId,
      organizationId,
      ctx.invoke,
    ).list();
    ctx.assertLive();
    setDiscovered(
      pointers.filter(
        (p) =>
          p.kind === 5 && /^handover-review-[0-9a-f-]{36}$/.test(p.logicalId),
      ),
    );
  }
  const messages: Record<string, [string, string]> = {
    native_unavailable: [
      "请在 FractalMind 原生 App 中使用设备密钥。网页不会签发权限或提交交易。",
      "Use your device key in the native FractalMind App. The web page cannot issue permissions or submit transactions.",
    ],
    invalid_grant: [
      "当前设备需要此组织的读取、执行、审批和主机管理权限。",
      "This device needs read, operate, approve and host-management permissions for this organization.",
    ],
    not_initialized: [
      "此设备尚未创建或配对身份。",
      "Create or pair an identity on this device first.",
    ],
    needs_funds: [
      "付款设备余额不足。向费用确认中的当前网络地址充值 SUI 后，重新请求报价。",
      "The payer needs funds. Add SUI on the current network, then request a new quote.",
    ],
    plan_mismatch: [
      "计划与 KR 指标、允许路径或预算不一致，请检查文件目标和工具次数。",
      "The plan does not match the KR metrics, allowed paths or budget. Check file targets and tool calls.",
    ],
    unsupported_constraint: [
      "当前执行器无法保证某项禁止动作，请保留约束并选择能够执行它的方案。",
      "The executor cannot enforce one of these constraints. Keep the constraint and choose a compatible execution plan.",
    ],
    unsupported_metric: [
      "当前执行器支持 1–3 个文件计数 KR，每个目标为 1–3 个文件、基线为 0。",
      "This executor supports 1–3 file-count KRs, each targeting 1–3 files with baseline 0.",
    ],
    review_expired: [
      "本次审阅已过期。先检查原交易和执行记录，再明确发起新审阅。",
      "This review expired. Check its original transactions and execution records before starting another review.",
    ],
    command_expired: [
      "原审阅命令已过期，请检查原执行记录。",
      "The original review command expired. Check its execution record.",
    ],
    state_changed: [
      "设备、Host、实例或 OKR 已变化。原报价不能继续使用，请重新核验。",
      "The device, Host, instance or OKR changed. Verify again before preparing another quote.",
    ],
    invalid_source: [
      "当前来源核验未通过，或实例有未结清的控制执行。请检查权限与执行记录。",
      "Current source checks failed, or the instance has unsettled control executions. Check permissions and execution records.",
    ],
    invalid_quote: [
      "此报价不可用，请重新核验原请求。",
      "This quote is unavailable. Check the original request again.",
    ],
    invalid_review: [
      "Host 接受证明尚未可用，或已过期／与原请求不匹配。请检查原执行记录。",
      "Host acceptance is unavailable, expired or does not match the original request. Check its execution record.",
    ],
    ticket_not_observed: [
      "暂未读取到原票据，不能据此判断请求未发生。请查询原交易。",
      "The ticket has not been observed. This does not prove the request never happened. Query the original transaction.",
    ],
    another_instance: [
      "这份审阅属于其他实例，请在对应实例中恢复。",
      "This review belongs to another instance. Restore it from that instance.",
    ],
    delivery_already_attempted: [
      "此请求已经尝试投递。请查询原执行与 Host 回应。",
      "Delivery was already attempted. Query the original execution and Host response.",
    ],
    sync_pending: [
      "交易已确认，链上对象尚未全部可见。只查询原请求。",
      "The transaction confirmed, but some objects are not visible yet. Query the original request.",
    ],
    not_recorded: [
      "未读到本设备原摘要记录；这不证明链上没有票据。可从链上查找审阅。",
      "No original local digest was found. This does not prove the ticket is absent. Find reviews on Sui.",
    ],
    journal_unavailable: [
      "本设备无法保存原请求记录，请先恢复本地存储。",
      "This device cannot retain the original request. Restore local storage first.",
    ],
    operation_failed: [
      "操作暂未完成。请查询原交易或原执行，确认结果后继续。",
      "The operation has not completed. Check the original transaction or execution before continuing.",
    ],
  };
  const stageLabel = (kind: Fee["kind"]) =>
    kind === "capability"
      ? t("单次观察权限", "Single-use observation")
      : kind === "review"
        ? t("保存审阅请求", "Save review request")
        : kind === "stop"
          ? t("停止原审阅", "Stop original review")
          : t("确认执行约定", "Approve agreement");
  const candidateOkrs = okrs?.filter((v) => [0, 2].includes(v.okr.state)) ?? [];
  const proposal = input?.command.payload.handover_review as
    | HandoverProposal
    | undefined;
  const expired = proposal && now >= proposal.review_expires_at_ms;
  const reviewSecondsLeft = proposal
    ? Math.max(
        0,
        Math.ceil(
          Math.min(
            HANDOVER_REVIEW_WINDOW_MS,
            proposal.review_expires_at_ms - now,
          ) / 1000,
        ),
      )
    : 0;
  const reviewLabels = [
    t("排队中", "Queued"),
    t("运行中", "Running"),
    t("已成功", "Succeeded"),
    t("已失败", "Failed"),
    t("待确认", "Needs confirmation"),
    t("已取消", "Cancelled"),
  ];
  const locked = busy || !!fee || !!input;
  return (
    <>
      <button
        className="secondary"
        onClick={begin}
        disabled={managed.revoked || managed.runtime !== "bounded-process-v1"}
      >
        {t("纳入 OKR", "Include in OKR")}
      </button>
      <button className="secondary" onClick={begin}>
        {t("查看原审阅", "View original reviews")}
      </button>
      {managed.runtime !== "bounded-process-v1" && (
        <p className="muted">
          {t(
            "此实例仅支持观察；需要受约束执行器才能纳入 OKR。",
            "This instance supports observation only. A bounded executor is required for OKR execution.",
          )}
        </p>
      )}
      {open && (
        <dialog
          ref={dialog}
          className="okr-create-dialog handover-dialog"
          aria-label={t("纳入 OKR", "Include in OKR")}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <header className="dialog-heading">
            <div>
              <h2>{t("纳入 OKR", "Include in OKR")}</h2>
              <p>{managed.instance_id}</p>
            </div>
            <button className="secondary" onClick={close}>
              {t("关闭", "Close")}
            </button>
          </header>
          <p>
            {t(
              "确认目标和边界 → Host 审阅 → 人工批准约定。批准后仍需要独立的继续操作。",
              "Confirm the goal and boundaries → Host review → Human approval. Continuing execution remains a separate action.",
            )}
          </p>
          {!isTauri() && (
            <p className="notice">{t(...messages.native_unavailable)}</p>
          )}
          {context.current && (
            <p className="long-id">
              {t("当前网络付款地址", "Payer address on this network")}:{" "}
              {profile.network} · {context.current.signer.device.address}
            </p>
          )}
          {error && (
            <p role="alert" className="notice">
              {t(...(messages[error] ?? messages.operation_failed))}
            </p>
          )}
          <label>
            {t("设备密钥配置", "Device key profile")}
            <input
              value={deviceProfile}
              disabled={busy || !!attempt}
              onChange={(e) => setDeviceProfile(e.target.value)}
            />
          </label>
          {attempt && (
            <div className="button-row">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void perform(() => query("capability"))}
              >
                {t(
                  "查询观察权限原交易",
                  "Query original observation transaction",
                )}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void perform(() => restore())}
              >
                {t("恢复原审阅", "Restore original review")}
              </button>
            </div>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void perform(discover)}
          >
            {t("从链上查找审阅", "Find reviews on Sui")}
          </button>
          {discovered && (
            <div>
              <p>
                {discovered.length
                  ? t(
                      "选择原请求，读取并核验其目标实例。",
                      "Select an original request to read and verify its instance.",
                    )
                  : t(
                      "本次目录未观察到审阅票据。",
                      "No review tickets were observed in this directory read.",
                    )}
              </p>
              {discovered.map((p) => (
                <button
                  className="secondary"
                  key={p.record_id}
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const ctx = await load();
                      const value = {
                        id: p.logicalId.slice("handover-review-".length),
                        deviceProfile: ctx.signer.device.profile,
                        grantId: ctx.attempt.grantId,
                      };
                      context.current = null;
                      setOutcomes({});
                      clearPrivate();
                      await restore(value);
                    })
                  }
                >
                  {t("审阅请求", "Review request")} · {p.logicalId.slice(-8)}
                </button>
              ))}
            </div>
          )}
          {!input && (
            <>
              <label>
                {t("选择 OKR", "Choose an OKR")}
                <select
                  value={okrId}
                  disabled={locked}
                  onChange={(e) => {
                    setOkrId(e.target.value);
                    setSpec(null);
                    setKrs([]);
                    setReviewed(false);
                  }}
                >
                  <option value="">
                    {t(
                      "选择草稿或已暂停的目标",
                      "Choose a draft or paused goal",
                    )}
                  </option>
                  {candidateOkrs.map((v) => (
                    <option key={v.okr.id} value={v.okr.id}>
                      {v.okr.logical_id} ·{" "}
                      {v.okr.state === 0
                        ? t("草稿", "Draft")
                        : t("已暂停", "Paused")}
                    </option>
                  ))}
                </select>
              </label>
              {!okrs && (
                <p className="notice">
                  {t(
                    "OKR 目录读取未成功，不能视为空列表。",
                    "The OKR directory could not be read; it is not an empty list.",
                  )}
                </p>
              )}
              <button
                className="secondary"
                disabled={locked || !okrId}
                onClick={() => void perform(loadSpecification)}
              >
                {t("读取并核验目标", "Read and verify goal")}
              </button>
            </>
          )}
          {!input && okrs && !candidateOkrs.length && (
            <p className="notice">
              {t(
                "当前没有可纳入的草稿或暂停目标。请先在 OKR 页面创建目标，或暂停需要重新审批的目标。",
                "There are no eligible draft or paused goals. Create a goal on the OKR page, or pause a goal that needs a new agreement.",
              )}
            </p>
          )}
          {spec && (
            <section>
              <h3>{spec.objective}</h3>
              <p>{spec.successCriteria}</p>
              <p>
                {t("总工具预算", "Total tool budget")}:{" "}
                {spec.constraints.budget.limit} · {t("目标期限", "Deadline")}:{" "}
                {new Date(Number(spec.deadlineMs)).toLocaleString()}
              </p>
              <p>
                {t("允许路径", "Allowed paths")}:{" "}
                {spec.constraints.allowedPaths.join(", ")}
              </p>
              <p>
                {t("禁止动作", "Prohibited actions")}:{" "}
                {spec.constraints.prohibitedActions.join(", ") || "—"}
              </p>
            </section>
          )}
          {(spec || input) && (
            <section>
              {!input ? (
                <label>
                  {t(
                    "本次允许读写的目录（每行一个）",
                    "Read/write directories for this plan (one per line)",
                  )}
                  <textarea
                    value={paths}
                    disabled={locked}
                    onChange={(e) => {
                      setPaths(e.target.value);
                      setReviewed(false);
                    }}
                  />
                </label>
              ) : (
                <div>
                  {Object.entries(input.nativeFilePlan.paths).map(
                    ([tool, directories]) => (
                      <p key={tool}>
                        {tool}: {directories.join(", ")}
                      </p>
                    ),
                  )}
                </div>
              )}
              {krs.map((kr, index) => (
                <fieldset key={index}>
                  <legend>
                    KR {index + 1} ·{" "}
                    {spec?.krs[index]?.title ??
                      t("原批准候选", "Original proposal")}
                  </legend>
                  <label>
                    {t("工具次数上限", "Tool-call limit")}
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={kr.maxCalls}
                      disabled={locked}
                      onChange={(e) => {
                        setKrs((rows) =>
                          rows.map((r, i) =>
                            i === index
                              ? { ...r, maxCalls: e.target.value }
                              : r,
                          ),
                        );
                        setReviewed(false);
                      }}
                    />
                  </label>
                  {kr.files.map((file, f) => (
                    <div key={f}>
                      <label>
                        {t("文件路径", "File path")}
                        <input
                          value={file.path}
                          disabled={locked}
                          placeholder="docs/result.md"
                          onChange={(e) => {
                            setKrs((rows) =>
                              rows.map((r, i) =>
                                i === index
                                  ? {
                                      ...r,
                                      files: r.files.map((v, j) =>
                                        j === f
                                          ? { ...v, path: e.target.value }
                                          : v,
                                      ),
                                    }
                                  : r,
                              ),
                            );
                            setReviewed(false);
                          }}
                        />
                      </label>
                      <label>
                        {t("目标文件内容", "Target file content")}
                        <textarea
                          value={file.content}
                          disabled={locked}
                          onChange={(e) => {
                            setKrs((rows) =>
                              rows.map((r, i) =>
                                i === index
                                  ? {
                                      ...r,
                                      files: r.files.map((v, j) =>
                                        j === f
                                          ? { ...v, content: e.target.value }
                                          : v,
                                      ),
                                    }
                                  : r,
                              ),
                            );
                            setReviewed(false);
                          }}
                        />
                      </label>
                    </div>
                  ))}
                </fieldset>
              ))}
              {!input && (
                <button
                  className="secondary"
                  disabled={locked || !krs.length}
                  onClick={() =>
                    void perform(async () => {
                      checkPlan();
                    })
                  }
                >
                  {t("检查计划与边界", "Check plan and boundaries")}
                </button>
              )}
              {reviewed && (
                <p>
                  {t(
                    "计划通过指标、路径、禁止动作及预算检查；仍需您确认内容能够达成目标。",
                    "The plan passed metric, path, prohibited-action and budget checks. Review whether its content achieves the goal.",
                  )}
                </p>
              )}
              {reviewed && !input && !attempt?.capabilityId && (
                <button
                  disabled={
                    busy ||
                    !!fee ||
                    outcomes.capability?.status === "unknown" ||
                    outcomes.capability?.status === "failed"
                  }
                  onClick={() => void perform(prepareCapability)}
                >
                  {t("准备单次观察权限费用", "Prepare observation fee")}
                </button>
              )}
              {attempt?.capabilityId && !runId && (
                <button
                  disabled={busy || !!fee || !!expired}
                  onClick={() => void perform(prepareReview)}
                >
                  {t("准备审阅请求费用", "Prepare review request fee")}
                </button>
              )}
            </section>
          )}
          {proposal && (
            <section>
              <p>
                {t("原提案工具预算", "Original proposal tool budget")}:{" "}
                {proposal.budget_limit} ·{" "}
                {t("单次工具上限", "Per-run tool limit")}: {proposal.max_calls}
              </p>
              <p>
                {t("执行授权最晚到期", "Execution authority expires by")}:{" "}
                {new Date(proposal.expires_at_ms).toLocaleString()}
              </p>
              <p className="notice" role="timer">
                {t("审阅有效至", "Review valid until")}{" "}
                {new Date(proposal.review_expires_at_ms).toLocaleTimeString()} ·{" "}
                {expired
                  ? t("已到期，请核对", "Check expiry")
                  : t("预计剩余", "Estimated time left")}{" "}
                {!expired &&
                  `${Math.floor(reviewSecondsLeft / 60)}:${String(reviewSecondsLeft % 60).padStart(2, "0")}`}
              </p>
              <p>
                {t(
                  "审阅窗口最长 5 分钟，从原请求生成开始。Host 接受后会临时保留此实例；请在到期前核对并批准。剩余时间按本机时钟估算，批准前会重新核对链上期限。刷新和重新读取不会延长期限。",
                  "The fixed review window is at most 5 minutes from the original request. After acceptance, the Host temporarily reserves this instance. Remaining time is estimated from this device’s clock; expiry is checked on Sui before approval. Refreshing or reading again does not extend it.",
                )}
              </p>
            </section>
          )}
          {input && !runId && !submissionAttempted.current && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setInput(null);
                setFee(null);
              }}
            >
              {t(
                "重新准备尚未提交的审阅",
                "Prepare the unsubmitted review again",
              )}
            </button>
          )}
          {runId && (
            <section>
              <h3>{t("原审阅请求已保存", "Original review saved")}</h3>
              <p>
                {t(
                  "发送仅请求 Host 检查边界和物理交接条件，不执行目标任务。",
                  "Sending asks the Host to check boundaries and physical handover conditions. It does not execute the goal.",
                )}
              </p>
              <div className="button-row">
                <button
                  disabled={
                    busy ||
                    !!fee ||
                    !!expired ||
                    !!reviewState?.stopRequested ||
                    (reviewState !== null && reviewState.state !== 0) ||
                    attempt?.deliveryAttempted ||
                    !!outcomes.approval
                  }
                  onClick={() => void perform(sendReview)}
                >
                  {t("发送给 Host 审阅", "Send to Host for review")}
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void perform(readResponse)}
                >
                  {t("读取并核验 Host 回应", "Read and verify Host response")}
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void perform(() => query("review"))}
                >
                  {t("查询原审阅交易", "Query original review transaction")}
                </button>
              </div>
              {attempt?.deliveryAttempted && (
                <p>
                  {t(
                    "已记录投递尝试；回应丢失时查询原请求。",
                    "Delivery attempt recorded. Query the original request if its response is lost.",
                  )}
                </p>
              )}
              {reviewState && (
                <p role="status">
                  {reviewState.state === 5
                    ? t("原审阅已取消。", "Original review cancelled.")
                    : [0, 1].includes(reviewState.state) &&
                        reviewState.stopRequested
                      ? t(
                          "停止请求已上链，等待 Host 确认取消。",
                          "Stop requested on Sui; awaiting Host acknowledgement.",
                        )
                      : [0, 1].includes(reviewState.state) &&
                          outcomes.stop?.status === "confirmed"
                        ? t(
                            "停止交易已确认，正在等待原运行的最新状态；请恢复原审阅。",
                            "Stop transaction confirmed. Awaiting the latest original Run state; restore the review.",
                          )
                        : t("原执行状态", "Original execution state") +
                          `: ${reviewLabels[reviewState.state]}`}
                </p>
              )}
              {reviewState &&
                [0, 1].includes(reviewState.state) &&
                !reviewState.stopRequested && (
                  <button
                    className="secondary"
                    disabled={busy || !!fee || !!outcomes.stop}
                    onClick={() => void perform(prepareStop)}
                  >
                    {t(
                      "停止原审阅 · 查看费用",
                      "Stop original review · review fee",
                    )}
                  </button>
                )}
              {outcomes.stop && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void perform(() => query("stop"))}
                >
                  {t("查询原停止交易", "Query original stop transaction")}
                </button>
              )}
              {hostAccepted && (
                <>
                  <p>
                    {t(
                      "Host 接受证明已核验。审批时将再次检查当前权限、规格、预算和未结执行。",
                      "Host acceptance verified. Approval checks current permissions, specification, budget and unsettled executions again.",
                    )}
                  </p>
                  <button
                    disabled={busy || !!fee || !!expired || !!outcomes.approval}
                    onClick={() => void perform(prepareApproval)}
                  >
                    {t(
                      "准备执行约定审批费用",
                      "Prepare agreement approval fee",
                    )}
                  </button>
                </>
              )}
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void perform(() => query("approval"))}
              >
                {t("查询原审批交易", "Query original approval transaction")}
              </button>
            </section>
          )}
          {fee && (
            <section className="notice">
              <h3>
                {stageLabel(fee.kind)} · {t("确认费用", "Confirm fee")}
              </h3>
              <p>
                {t("网络", "Network")}: {profile.network} ·{" "}
                {t("余额", "Balance")}: {sui(fee.quote.balance)}
              </p>
              <p>
                {t("预计费用", "Estimated fee")}: {sui(fee.quote.estimatedGas)}{" "}
                · {t("费用上限", "Fee limit")}: {sui(fee.quote.gasBudget)}
              </p>
              <p className="long-id">
                {t("付款地址", "Payer address")}: {fee.quote.sender}
              </p>
              <p>
                {t("报价有效至", "Quote valid until")}:{" "}
                {new Date(fee.quote.expiresAtMs).toLocaleTimeString()}
              </p>
              <button
                disabled={
                  busy ||
                  now >= fee.quote.expiresAtMs ||
                  ((fee.kind === "review" || fee.kind === "approval") &&
                    !!expired)
                }
                onClick={() => void perform(submitFee)}
              >
                {t("确认费用并签名提交", "Confirm fee, sign and submit")}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setFee(null)}
              >
                {t("取消本次报价", "Cancel quote")}
              </button>
            </section>
          )}
          {Object.entries(outcomes).map(([kind, outcome]) => (
            <section key={kind}>
              <p>
                {stageLabel(kind as Fee["kind"])}:{" "}
                {outcome!.status === "confirmed"
                  ? t("交易已确认", "Transaction confirmed")
                  : outcome!.status === "failed"
                    ? t("交易明确失败", "Transaction failed")
                    : t(
                        "结果未知，继续查询原摘要",
                        "Outcome unknown; query the original digest",
                      )}
              </p>
              <details>
                <summary>{t("交易详情", "Transaction details")}</summary>
                <code className="long-id">{outcome!.digest}</code>
                {outcome!.actualGas && (
                  <p>
                    {t("实际费用", "Actual fee")}: {sui(outcome!.actualGas)}
                  </p>
                )}
              </details>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void perform(() => query(kind as Fee["kind"]))}
              >
                {t("查询原交易", "Query original transaction")}
              </button>
            </section>
          ))}
          {outcomes.approval?.status === "confirmed" && (
            <section className="notice">
              <p>
                {t(
                  "执行约定已确认。本次审批未派发继续命令，当前运行状态请查看工作台。",
                  "The execution agreement is confirmed. This approval did not dispatch continuation. Check the workbench for current execution state.",
                )}
              </p>
              {onContinue && proposal && (
                <button
                  disabled={busy}
                  onClick={() => {
                    const id = proposal.okr_id;
                    close();
                    onContinue(id);
                  }}
                >
                  {t("前往工作台继续", "Continue from the workbench")}
                </button>
              )}
            </section>
          )}
        </dialog>
      )}
    </>
  );
}
