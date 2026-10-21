import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  TransactionPreflightError,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession, ChainReadError } from "./chain";
import {
  queryDeviceTransactionHistory,
  TransactionHistoryError,
  type DeviceTransactionHistory,
} from "./transaction-history";
import {
  archiveHostTransactionHistory,
  readHostTransactionHistory,
  type HostAttempt,
  type HistoricalHostAttempt,
} from "./host-transaction-history";
import { awaitTransactionVisible } from "./transaction-visibility";
import {
  NativeDeviceSigner,
  NativeDeviceError,
  preferredDeviceProfile,
  type NativeInvoke,
} from "./native-device";
import { DeviceIdentityError } from "./device-identity";
import {
  HostAdmission,
  HostAdmissionError,
  hostDirectory,
  hostEntries,
  coordinatorInput,
  type HostDirectory,
  type HostEntries,
  type HostOperation,
  type HostInvite,
} from "./host-admission";
import type { ConnectionProfile } from "./domain";
import {
  encodeHostJoinAccess,
  hostJoinFingerprint,
  quickInviteWithinLimits,
} from "./host-join-access";
type Attempt = HostAttempt;
const transport: NativeInvoke = (command, args) => invoke(command, args);
const kinds = ["binding", "invite", "revoke-invite", "revoke-member"];
const id = /^0x[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export default function HostAccess({
  profile,
  organizationId,
  t,
  onChanged,
  request,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  t: (zh: string, en: string) => string;
  onChanged: () => void;
  /** Opened from the Hosts page (#73): each new `n` opens the dialog on that
   * operation, unless an earlier attempt is still being reconciled. Without
   * it the component shows its own button. */
  request?: { kind: HostOperation["kind"]; target?: string; n: number } | null;
}) {
  const [open, setOpen] = useState(false),
    [directory, setDirectory] = useState<HostEntries | null>(null);
  const [management, setManagement] = useState<HostDirectory | null>(null);
  const [phase, setPhase] = useState("loading");
  const [operation, setOperation] = useState<HostOperation["kind"]>("invite"),
    [targetId, setTargetId] = useState("");
  const [endpoint, setEndpoint] = useState(""),
    [publicKey, setPublicKey] = useState(""),
    [bindingId, setBindingId] = useState("");
  const [ttlMinutes, setTtlMinutes] = useState<15 | 60 | 1440>(60),
    [membershipDays, setMembershipDays] = useState(30),
    [observationHours, setObservationHours] = useState(24);
  const [confirmed, setConfirmed] = useState(false),
    [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile);
  const [attempt, setAttempt] = useState<Attempt | null>(null),
    [quote, setQuote] = useState<SelfPayFeeQuote | null>(null);
  const [outcome, setOutcome] = useState<SelfPayTransactionOutcome | null>(
      null,
    ),
    [invite, setInvite] = useState<HostInvite | null>(null);
  const [access, setAccess] = useState<string | null>(null),
    [fingerprint, setFingerprint] = useState<string | null>(null),
    [advanced, setAdvanced] = useState(false),
    [copied, setCopied] = useState(false);
  const [code, setCode] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [now, setNow] = useState(Date.now());
  const [historicalResult, setHistoricalResult] =
      useState<DeviceTransactionHistory | null>(null),
    [history, setHistory] = useState<HistoricalHostAttempt[]>([]),
    [historyResults, setHistoryResults] = useState<
      Record<string, SelfPayTransactionOutcome>
    >({});
  const dialog = useRef<HTMLDialogElement>(null),
    flight = useRef(false),
    mounted = useRef(true);
  const session = useRef<HostAdmission | null>(null),
    journal = useRef<IndexedDbTransactionJournal | null>(null);
  const attemptKey = `fractalmind.app.host-attempt.v1:${JSON.stringify([profile.network, profile.chainIdentifier, profile.humanId, organizationId])}`;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      session.current?.dispose();
      void journal.current?.close();
    };
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  useEffect(() => {
    if (request && !open) start(request.kind, request.target);
  }, [request?.n]);
  const clockMs = directory
    ? directory.clockMs + BigInt(Math.max(0, now - directory.loadedAtMs))
    : BigInt(now);
  const inviteUsable =
    directory &&
    invite &&
    !invite.revoked &&
    invite.uses === 0 &&
    BigInt(invite.expires_at_ms) > clockMs;
  useEffect(() => {
    if (code && directory && !inviteUsable) setCode(null);
  }, [!!inviteUsable, code, directory]);
  // The access string bundles the public configuration with the one-use code;
  // it lives only as long as the code is usable in this window.
  useEffect(() => {
    setCopied(false);
    const chainIdentifier =
      directory?.chainIdentifier ?? profile.chainIdentifier;
    if (!code || !invite || !chainIdentifier) {
      setAccess(null);
      setFingerprint(null);
      return;
    }
    setAccess(
      encodeHostJoinAccess(profile, organizationId, chainIdentifier, code),
    );
    let live = true;
    void hostJoinFingerprint(organizationId, invite.coordinator_binding).then(
      (value) => live && setFingerprint(value),
    );
    return () => {
      live = false;
    };
  }, [code, invite?.id, directory?.chainIdentifier]);
  function issue(e: unknown) {
    setError(
      e instanceof ChainReadError ||
        e instanceof HostAdmissionError ||
        e instanceof TransactionHistoryError ||
        e instanceof NativeDeviceError ||
        e instanceof DeviceIdentityError ||
        e instanceof TransactionPreflightError
        ? e.code
        : "operation_failed",
    );
  }
  async function run(action: () => Promise<void>, nextPhase = "loading") {
    if (flight.current) return;
    flight.current = true;
    setPhase(nextPhase);
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (mounted.current) issue(e);
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function refresh(includeHistory = advanced || !!invite) {
    // A fresh entry check is enough for discovery. History is loaded only for
    // management; submission always rechecks current authority and its target.
    setDirectory(null);
    setManagement(null);
    const chain = new ChainReadSession(profile);
    const full = includeHistory
      ? await hostDirectory(chain, organizationId)
      : null;
    const value = full ?? (await hostEntries(chain, organizationId));
    if (!mounted.current) return;
    setDirectory(value);
    if (full) setManagement(full);
    const usable = value.bindings.filter((b) => !b.revoked);
    setBindingId((current) =>
      usable.some((b) => b.id === current) ? current : (usable[0]?.id ?? ""),
    );
    if (invite && full) {
      const current = full.invitations.find((i) => i.id === invite.id);
      setInvite(current ?? null);
      if (
        !current ||
        current.revoked ||
        current.uses !== 0 ||
        BigInt(current.expires_at_ms) <= value.clockMs
      )
        setCode(null);
    }
  }
  useEffect(() => {
    if (open && advanced && !management && !busy && !error)
      void run(() => refresh(true));
  }, [open, advanced, !!management, busy, error]);
  function start(kind?: HostOperation["kind"], target = "") {
    setOpen(true);
    setError(null);
    setDirectory(null);
    setManagement(null);
    void run(async () => {
      try {
        const stored = JSON.parse(localStorage.getItem(attemptKey) ?? "null");
        if (
          stored &&
          uuid.test(stored.id) &&
          id.test(stored.grantId) &&
          typeof stored.deviceProfile === "string" &&
          kinds.includes(stored.kind)
        ) {
          setAttempt(stored);
          setDeviceProfile(stored.deviceProfile);
          setOperation(stored.kind);
        } else if (kind) edit(kind, target);
        setAdvanced(!!kind && kind !== "invite");
      } catch (cause) {
        throw new TransactionPreflightError(
          "journal_unavailable",
          "Cannot read the current Host attempt.",
          { cause },
        );
      }
      setHistory(readHostTransactionHistory(localStorage, attemptKey));
      await refresh(!!kind && kind !== "invite");
    });
  }
  function transactionJournal() {
    try {
      return (journal.current ??= new IndexedDbTransactionJournal());
    } catch (cause) {
      throw new TransactionPreflightError(
        "journal_unavailable",
        "Cannot open the local transaction journal.",
        { cause },
      );
    }
  }
  async function load(value: Attempt) {
    if (session.current) return session.current;
    if (!isTauri()) throw new NativeDeviceError("native_unavailable");
    const device = await NativeDeviceSigner.load(
      transport,
      value.deviceProfile,
    );
    const deviceJournal = transactionJournal();
    session.current = new HostAdmission(
      new ChainReadSession(profile),
      device,
      value.grantId,
      organizationId,
      deviceJournal,
    );
    return session.current;
  }
  async function newAttempt(kind: HostOperation["kind"] = operation) {
    if (!isTauri()) throw new NativeDeviceError("native_unavailable");
    const device = await NativeDeviceSigner.load(transport, deviceProfile),
      chain = new ChainReadSession(profile);
    const human = await chain.human();
    const candidates = human.grants.value?.filter(
      (g) =>
        g.device === device.device.address &&
        !g.revoked &&
        g.generation === human.human.generation &&
        g.actions.includes(1) &&
        g.actions.includes(4) &&
        BigInt(g.expires_at_ms) > human.clockMs &&
        (g.org_scope === null || g.org_scope === organizationId),
    );
    const scoped = candidates?.filter((g) => g.org_scope === organizationId),
      usable = scoped?.length ? scoped : candidates;
    if (usable?.length !== 1) throw new DeviceIdentityError("invalid_grant");
    const value: Attempt = {
      id: crypto.randomUUID(),
      deviceProfile,
      grantId: usable[0].id,
      kind,
    };
    // Only technical correlation and public identifiers. Never the invite code,
    // entropy, public-key private counterpart or transaction payload.
    try {
      localStorage.setItem(attemptKey, JSON.stringify(value));
    } catch (cause) {
      throw new TransactionPreflightError(
        "journal_unavailable",
        "Cannot save the current Host attempt.",
        { cause },
      );
    }
    setAttempt(value);
    const deviceJournal = transactionJournal();
    session.current = new HostAdmission(
      chain,
      device,
      value.grantId,
      organizationId,
      deviceJournal,
    );
    return value;
  }
  function input(): HostOperation {
    if (operation === "binding")
      return { kind: operation, endpoint, publicKey };
    if (operation === "invite")
      return {
        kind: operation,
        bindingId,
        ttlMinutes,
        membershipDays,
        observationHours,
      };
    return { kind: operation, targetId };
  }
  async function receive(
    value: SelfPayTransactionOutcome,
    controller: HostAdmission,
    kind: HostOperation["kind"],
  ) {
    if (!mounted.current) return;
    setOutcome(value);
    setQuote(null);
    if (value.status !== "confirmed") return;
    setPhase("confirming");
    if (kind === "invite") {
      const result = await controller.createdInvite(value);
      if (mounted.current) {
        setDirectory(result.directory);
        setManagement(result.directory);
        setInvite(result.invite);
        setCode(result.code);
      }
    } else {
      if (!(await controller.awaitVisible(value)))
        throw new HostAdmissionError("sync_pending");
      await refresh();
    }
    onChanged();
  }
  async function prepare(quick?: HostOperation) {
    setPhase("device");
    const op = quick ?? input();
    const value = attempt ?? (await newAttempt(op.kind)),
      controller = await load(value);
    if (value.kind !== op.kind) throw new HostAdmissionError("invalid_input");
    // The one-click invitation's button is its confirmation.
    setPhase("authority");
    const result = await controller.prepare(
      op,
      value.id,
      quick ? true : confirmed,
    );
    if (!mounted.current) return;
    if ("status" in result) await receive(result, controller, value.kind);
    else if (quick && quickInviteWithinLimits(result)) {
      setPhase("submitting");
      await receive(await controller.submit(result), controller, value.kind);
    } else setQuote(result);
  }
  /** Defaults for a remote Host: 1-hour code, 90-day membership with matching
   * observation, and join Gas placed on the invitation key. */
  function quickInvite(): HostOperation {
    return {
      kind: "invite",
      bindingId,
      ttlMinutes: 60,
      membershipDays: 90,
      observationHours: 90 * 24,
      fundInvite: true,
    };
  }
  async function query() {
    if (!attempt) return;
    setHistoricalResult(null);
    const chain = new ChainReadSession(profile);
    const deviceJournal = transactionJournal();
    const result = await queryDeviceTransactionHistory(
      chain,
      organizationId,
      attempt.grantId,
      `host:${attempt.id}`,
      deviceJournal,
    );
    if (!mounted.current) return;
    if (result) {
      setHistoricalResult(result.historicalTerminal ? result : null);
      setOutcome(result.outcome);
      setQuote(null);
      setCode(null);
      setInvite(null);
      if (result.outcome.status === "confirmed") {
        if (!(await awaitTransactionVisible(chain, result.outcome)))
          throw new HostAdmissionError("sync_pending");
        await refresh();
        if (attempt.kind === "invite") setError("historical_invite_code");
        onChanged();
      }
    } else {
      setOutcome(null);
      setError("not_submitted");
    }
  }
  function edit(kind: HostOperation["kind"], target = "") {
    setOperation(kind);
    setTargetId(target);
    setConfirmed(false);
    setError(null);
  }
  function reset() {
    // Unknown outcomes remain attached to their original digest. An explicit
    // new attempt is allowed only before submission or after a known terminal.
    if (
      busy ||
      outcome?.status === "unknown" ||
      (attempt && !outcome && error !== "not_submitted")
    )
      return;
    localStorage.removeItem(attemptKey);
    clearCurrent();
  }
  function clearCurrent() {
    session.current?.dispose();
    session.current = null;
    setAttempt(null);
    setDeviceProfile(preferredDeviceProfile());
    setOutcome(null);
    setQuote(null);
    setCode(null);
    setInvite(null);
    setConfirmed(false);
    setError(null);
    setHistoricalResult(null);
  }
  async function startIndependent() {
    if (!attempt || !historicalResult?.historicalTerminal) return;
    // Recheck the original technical row and exact notFound response at the
    // explicit action. Unknown/pending/error paths cannot release the form.
    const deviceJournal = transactionJournal();
    const result = await queryDeviceTransactionHistory(
      new ChainReadSession(profile),
      organizationId,
      attempt.grantId,
      `host:${attempt.id}`,
      deviceJournal,
    );
    if (!mounted.current) return;
    if (!result?.historicalTerminal || result.outcome.status !== "unknown") {
      setHistoricalResult(null);
      if (result) setOutcome(result.outcome);
      throw new HostAdmissionError("state_changed");
    }
    const retained = archiveHostTransactionHistory(
      localStorage,
      attemptKey,
      attempt,
      result,
    );
    setHistory(retained);
    setHistoryResults((current) => ({
      ...current,
      [attempt.id]: result.outcome,
    }));
    clearCurrent();
  }
  async function queryHistory(value: HistoricalHostAttempt) {
    setHistoryResults((current) => {
      const next = { ...current };
      delete next[value.attempt.id];
      return next;
    });
    const deviceJournal = transactionJournal();
    const result = await queryDeviceTransactionHistory(
      new ChainReadSession(profile),
      organizationId,
      value.attempt.grantId,
      `host:${value.attempt.id}`,
      deviceJournal,
    );
    if (!mounted.current) return;
    if (!result || result.outcome.digest !== value.digest)
      throw new TransactionHistoryError("invalid_source");
    setHistoryResults((current) => ({
      ...current,
      [value.attempt.id]: result.outcome,
    }));
  }
  function cancelQuote() {
    if (quote) session.current?.cancel(quote);
    setQuote(null);
    setConfirmed(false);
    setError("not_submitted");
  }
  function close() {
    if (busy) return;
    dialog.current?.close();
    setOpen(false);
    setCode(null);
    setInvite(null);
    setQuote(null);
    setConfirmed(false);
    session.current?.dispose();
    session.current = null;
    setOutcome(null);
    setHistoricalResult(null);
  }
  const locked = busy || !!quote || !!outcome || !!attempt;
  const ready = isTauri();
  const phases: Record<string, [string, string]> = {
    loading: ["正在读取组织入口…", "Loading organization entries…"],
    device: [
      "正在检查本机设备和管理权限…",
      "Checking this device and its management grant…",
    ],
    authority: [
      "正在核验权限并估算费用…",
      "Verifying authority and estimating fees…",
    ],
    submitting: [
      "正在签名并提交，请留意系统授权提示…",
      "Signing and submitting; check for a system authorization prompt…",
    ],
    confirming: [
      "交易已确认，正在读取接入串…",
      "Transaction confirmed; reading the access string…",
    ],
    querying: [
      "正在查询上次操作的提交状态…",
      "Checking whether the previous operation was submitted…",
    ],
  };
  const messages: Record<string, [string, string]> = {
    historical_invite_code: [
      "原交易已确认。此历史查询不恢复一次性邀请码；请在当前公开邀请列表核对状态，遗失的未使用邀请可撤销。",
      "The original transaction is confirmed. This historical query cannot recover the one-use code. Review the public invitation list and revoke any unused invitation whose code was lost.",
    ],
    clipboard_unavailable: [
      "复制失败，请手动选中并复制接入串。",
      "Copy failed. Select and copy the access string manually.",
    ],
    locked: [
      "本机设备已锁定，请先解锁 App，再查询上次操作状态。",
      "This device is locked. Unlock the App, then check the previous operation.",
    ],
    rpc_unavailable: [
      "网络读取失败，请检查连接后重试；已有操作请先查询提交状态。",
      "Network read failed. Check the connection and retry; check any existing operation before starting another.",
    ],
    simulation_failed: [
      "交易预演未通过，尚未提交。请核对管理权限和余额。",
      "Transaction simulation failed; nothing was submitted. Check management authority and funds.",
    ],
    stale_quote: [
      "费用报价已过期，请取消后重新报价。",
      "The fee quote expired. Cancel it and request a fresh quote.",
    ],
    signature_not_obtained: [
      "未取得签名，尚未发送。请检查设备解锁或系统授权，再查询原交易。",
      "No signature was obtained. Check device unlock or system authorization, then query the original transaction.",
    ],
    journal_unavailable: [
      "无法读取本机交易记录，请先恢复本机存储；不要重复生成。",
      "Local transaction history is unavailable. Restore local storage before generating again.",
    ],
    needs_funds: [
      "管理设备的 SUI 不足，请先充值后重新报价。",
      "Fund the management device, then request a fresh quote.",
    ],
    invalid_grant: [
      "本机没有当前组织的主机管理权限。",
      "This device has no current host-management authority for this organization.",
    ],
    state_changed: [
      "授权或链上记录已改变，请查询原交易并重新核对。",
      "Authority or chain state changed. Query the original transaction and review again.",
    ],
    not_submitted: [
      "当前尝试尚未提交，可编辑后报价或明确开始新操作。",
      "This attempt has not been submitted. Review a quote or explicitly start a new operation.",
    ],
    sync_pending: [
      "交易已成功，查询节点仍在同步，请查询原交易。",
      "The transaction succeeded; ledger visibility is pending. Query the original transaction.",
    ],
    native_unavailable: [
      "原生设备密钥暂不可用，请检查系统凭据库授权。",
      "Native device keys are unavailable. Check system credential-store authorization.",
    ],
    invalid_input: [
      "请检查入口地址、公钥、有效期和选择的链上记录。",
      "Check the endpoint, public key, expiry and selected chain record.",
    ],
    invalid_source: [
      "链上来源校验失败，不能继续此操作。",
      "Chain provenance verification failed. This operation cannot proceed.",
    ],
    unavailable: [
      "记录已撤销、已消费或不属于当前组织。",
      "The record is revoked, consumed, or outside this organization.",
    ],
  };
  const status = (i: HostInvite) =>
    !directory
      ? t("待重新核验", "Awaiting fresh verification")
      : i.revoked
        ? t("已撤销", "Revoked")
        : i.uses
          ? t("已使用", "Consumed")
          : BigInt(i.expires_at_ms) <= clockMs
            ? t("已过期", "Expired")
            : t("未使用", "Unused");
  let coordinatorAddress = "";
  try {
    coordinatorAddress = coordinatorInput(endpoint, publicKey).address;
  } catch {}
  return (
    <>
      {request === undefined && (
        <button onClick={() => start()}>{t("接入主机", "Connect Host")}</button>
      )}
      {open && (
        <dialog
          ref={dialog}
          className="okr-create-dialog host-access"
          aria-labelledby="host-access-title"
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <header>
            <h2 id="host-access-title">{t("接入主机", "Connect Host")}</h2>
            <button
              disabled={busy}
              onClick={close}
              aria-label={t("关闭", "Close")}
            >
              ×
            </button>
          </header>
          <p className="muted">
            {t(
              "生成接入串，在新主机上粘贴即可。仅可使用一次，1 小时内有效。",
              "Create an access string and paste it on the new Host. Use once within 1 hour.",
            )}
          </p>
          {!ready && (
            <p className="warn">
              {t(
                "请在原生 App 中使用已授权的管理设备生成。",
                "Use an authorized management device in the native App to generate an access string.",
              )}
            </p>
          )}
          {busy && (
            <p role="status" className="host-progress" aria-live="polite">
              {t(...phases[phase])}
            </p>
          )}
          {error && (
            <p role="alert" className="warn">
              {messages[error]
                ? t(...messages[error])
                : `${t("操作未完成，请查询上次操作状态后重试", "Operation incomplete. Check the previous operation before retrying")} (${error})`}
            </p>
          )}
          {ready && !quote && !outcome && (
            <section
              className="host-quick"
              aria-label={t("生成接入串", "Create access string")}
            >
              <p className="muted">
                {t(
                  "本设备支付 0.05 SUI 给新主机作入组 Gas，外加少量链上手续费；手续费超过 0.01 SUI 时会先让你确认。新主机获得成员资格和有限观察权限，不含执行权限。",
                  "This device pays 0.05 SUI of join Gas for the new Host plus a small network fee; fees above 0.01 SUI ask you first. The Host gets membership and limited observation, not execution.",
                )}
              </p>
              <button
                className="host-primary primary"
                disabled={busy || (!attempt && !bindingId)}
                onClick={() => {
                  if (attempt) {
                    void run(query, "querying");
                    return;
                  }
                  edit("invite");
                  void run(() => prepare(quickInvite()), "device");
                }}
              >
                {busy
                  ? t("正在处理…", "Working…")
                  : attempt
                    ? t("查询上次操作", "Check previous operation")
                    : t("生成接入串", "Create access string")}
              </button>
              {!busy && !directory && (
                <button onClick={() => void run(() => refresh())}>
                  {t("重新加载", "Retry loading")}
                </button>
              )}
              {!busy && directory && !bindingId && (
                <p className="warn">
                  {t(
                    "尚无可用入口，请在高级设置中登记 Coordinator。",
                    "No usable entry. Register a Coordinator in Advanced settings.",
                  )}
                </p>
              )}
            </section>
          )}
          {access && inviteUsable && (
            <section className="panel" aria-labelledby="host-access-string">
              <h3 id="host-access-string">
                {t("接入串（只显示这一次）", "Access string (shown once)")}
              </h3>
              <textarea
                readOnly
                value={access}
                spellCheck={false}
                autoComplete="off"
                aria-label={t("Host 接入串", "Host access string")}
              />
              <div className="host-actions">
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(access)
                      .then(() => setCopied(true))
                      .catch(() => setError("clipboard_unavailable"))
                  }
                >
                  {copied ? t("已复制", "Copied") : t("复制", "Copy")}
                </button>
              </div>
              <p>
                {t("指纹", "Fingerprint")}:{" "}
                <strong className="host-fingerprint">
                  {fingerprint ?? "…"}
                </strong>
              </p>
              <ol>
                <li>
                  {t("在新主机上运行", "On the new Host, run")}{" "}
                  <code>fractalmind-envd join</code>
                  {t(
                    "，粘贴接入串（输入不显示）。",
                    " and paste the access string (input is hidden).",
                  )}
                </li>
                <li>
                  {t(
                    "主机显示的指纹与上面一致时输入 y 确认入组。",
                    "When the fingerprint the Host shows matches the one above, type y to join.",
                  )}
                </li>
                <li>
                  {t(
                    "macOS 请在该机的“终端”里运行：钥匙串在 SSH 会话中无法打开。",
                    "On macOS, run it in Terminal on that Mac: the Keychain cannot be opened over SSH.",
                  )}
                </li>
              </ol>
              <p className="muted">
                {t(
                  "接入串含一次性邀请，关闭窗口后无法找回；遗失时撤销未使用的邀请再重新生成。",
                  "The access string contains a one-use invitation and cannot be recovered after closing. If lost, revoke the unused invitation and create a new one.",
                )}
              </p>
            </section>
          )}
          {quote && (
            <section
              className="panel"
              aria-label={t("费用确认", "Fee confirmation")}
            >
              <h3>{t("确认链上交易费用", "Confirm transaction fee")}</h3>
              <p>
                {t(
                  "核对费用，确认后才会提交。",
                  "Review the fee and confirm before submission.",
                )}
              </p>
              <p>
                {t("付款地址", "Payer")}:{" "}
                <code className="long-id">{quote.sender}</code>
              </p>
              <p>
                {t("当前余额", "Balance")}: {quote.balance} MIST
              </p>
              <p>
                {t("预计费用", "Estimated Gas")}: {quote.estimatedGas} MIST ·{" "}
                {t("Gas 上限", "Gas limit")}: {quote.gasBudget} MIST
              </p>
              <p>
                {t("报价到期", "Quote expiry")}:{" "}
                {new Date(quote.expiresAtMs).toLocaleTimeString()}
              </p>
              <div className="host-actions">
                <button
                  disabled={busy || now >= quote.expiresAtMs}
                  onClick={() =>
                    void run(async () => {
                      setPhase("submitting");
                      if (session.current && attempt)
                        await receive(
                          await session.current.submit(quote),
                          session.current,
                          attempt.kind,
                        );
                    })
                  }
                >
                  {t("确认支付并提交", "Confirm payment & submit")}
                </button>
                <button disabled={busy} onClick={cancelQuote}>
                  {t("取消报价", "Cancel quote")}
                </button>
              </div>
            </section>
          )}
          {attempt && !busy && !quote && (
            <section className="panel">
              {!outcome && !quote && !busy && (
                <p>
                  {t(
                    "上次操作尚待核对。先查询是否已提交，再开始新操作。",
                    "A previous operation needs checking. Verify whether it was submitted before starting another.",
                  )}
                </p>
              )}
              <details>
                <summary>{t("交易详情", "Transaction details")}</summary>
                <code className="long-id">{attempt.id}</code>
              </details>
              {outcome && (
                <>
                  <p>
                    {t("交易结果", "Transaction result")}:{" "}
                    {outcome.status === "confirmed"
                      ? t("已成功", "Confirmed")
                      : outcome.status === "failed"
                        ? t("已失败", "Failed")
                        : t(
                            "结果未知，仅查询原交易",
                            "Unknown; query the original transaction",
                          )}
                    <br />
                    <code className="long-id">{outcome.digest}</code>
                  </p>
                  {outcome.actualGas !== undefined && (
                    <p>
                      {t("实际费用", "Actual Gas")}: {outcome.actualGas} MIST
                    </p>
                  )}
                </>
              )}
              <div className="host-actions">
                <button
                  disabled={busy}
                  onClick={() => void run(query, "querying")}
                >
                  {t("查询原交易", "Query original transaction")}
                </button>
                <button
                  disabled={
                    busy ||
                    outcome?.status === "unknown" ||
                    (!outcome && error !== "not_submitted")
                  }
                  onClick={reset}
                >
                  {t("开始新操作", "Start new operation")}
                </button>
              </div>
              {outcome?.status === "unknown" &&
                historicalResult?.historicalTerminal && (
                  <>
                    <p className="warn">
                      {t(
                        "技术日志此前记录",
                        "Previously recorded in the technical journal",
                      )}
                      :{" "}
                      {historicalResult.historicalTerminal.status ===
                      "confirmed"
                        ? t("已成功", "Confirmed")
                        : t("已失败", "Failed")}
                      .
                      {t(
                        "当前节点无法返回原始回执，当前查询仍为未知。可保留这条历史后明确开始独立新操作，不会重发原交易。",
                        "The current node cannot return the original receipt; this query remains unknown. Keep this history before explicitly starting an independent operation. The original transaction will not be resent.",
                      )}
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => void run(startIndependent)}
                    >
                      {t(
                        "保留历史并开始独立操作",
                        "Keep history & start independent operation",
                      )}
                    </button>
                  </>
                )}
            </section>
          )}
          <details
            className="panel"
            open={advanced}
            onToggle={(e) => setAdvanced(e.currentTarget.open)}
          >
            <summary>
              {t("高级设置与历史记录", "Advanced settings & history")}
            </summary>
            <p className="muted">
              {t("当前组织", "Organization")}:{" "}
              <code className="long-id">{organizationId}</code>
            </p>
            {directory && (
              <section className="panel">
                <h3>{t("组织入口", "Organization entries")}</h3>
                {directory.bindings.length === 0 && (
                  <p>
                    {t(
                      "尚无入口，请先登记 Coordinator 公钥与 HTTPS 地址。",
                      "No entry exists. Register the Coordinator public key and HTTPS origin first.",
                    )}
                  </p>
                )}
                {directory.bindings.map((b) => (
                  <p key={b.id}>
                    <strong>{b.endpoint}</strong> ·{" "}
                    {b.revoked
                      ? t("已撤销", "Revoked")
                      : t(
                          "链上绑定有效，在线未知",
                          "Bound on chain; connectivity unknown",
                        )}
                    <br />
                    <code className="long-id">{b.coordinator_address}</code>
                  </p>
                ))}
                <div className="host-actions">
                  <button disabled={locked} onClick={() => edit("binding")}>
                    {t("登记入口", "Register entry")}
                  </button>
                  <button
                    disabled={
                      locked || !directory.bindings.some((b) => !b.revoked)
                    }
                    onClick={() => edit("invite")}
                  >
                    {t("创建单次邀请", "Create one-use invite")}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void run(() => refresh(true))}
                  >
                    {t("刷新链上状态", "Refresh chain state")}
                  </button>
                </div>
              </section>
            )}
            {!outcome && (
              <fieldset
                disabled={
                  busy || !!quote || (!!attempt && error !== "not_submitted")
                }
              >
                <h3>
                  {operation === "binding"
                    ? t("登记组织入口", "Register organization entry")
                    : operation === "invite"
                      ? t("创建一次性邀请码", "Create a one-use invitation")
                      : operation === "revoke-invite"
                        ? t("撤销未消费邀请码", "Revoke unused invitation")
                        : t("撤销主机成员资格", "Revoke Host membership")}
                </h3>
                {operation === "binding" ? (
                  <>
                    <label>
                      {t("Coordinator HTTPS 地址", "Coordinator HTTPS origin")}
                      <input
                        value={endpoint}
                        onChange={(e) => {
                          setEndpoint(e.target.value);
                          setConfirmed(false);
                        }}
                        placeholder="https://coordinator.example.com"
                      />
                    </label>
                    <label>
                      {t(
                        "Coordinator Ed25519 公钥（64 位小写十六进制）",
                        "Coordinator Ed25519 public key (64 lowercase hex digits)",
                      )}
                      <input
                        value={publicKey}
                        onChange={(e) => {
                          setPublicKey(e.target.value);
                          setConfirmed(false);
                        }}
                        maxLength={64}
                      />
                    </label>
                    {coordinatorAddress && (
                      <p>
                        {t(
                          "由公钥确定的地址",
                          "Address derived from public key",
                        )}
                        : <code className="long-id">{coordinatorAddress}</code>
                      </p>
                    )}
                  </>
                ) : operation === "invite" ? (
                  <>
                    <label>
                      {t("组织入口", "Organization entry")}
                      <select
                        value={bindingId}
                        onChange={(e) => {
                          setBindingId(e.target.value);
                          setConfirmed(false);
                        }}
                      >
                        <option value="">
                          {t("选择已登记入口", "Choose a registered entry")}
                        </option>
                        {directory?.bindings
                          .filter((b) => !b.revoked)
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.endpoint} · {b.id.slice(0, 10)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="okr-form-grid">
                      <label>
                        {t("邀请码有效期", "Invite validity")}
                        <select
                          value={ttlMinutes}
                          onChange={(e) => {
                            setTtlMinutes(
                              Number(e.target.value) as 15 | 60 | 1440,
                            );
                            setConfirmed(false);
                          }}
                        >
                          {[15, 60, 1440].map((n) => (
                            <option key={n} value={n}>
                              {n === 15
                                ? t("15 分钟", "15 minutes")
                                : n === 60
                                  ? t("1 小时", "1 hour")
                                  : t("24 小时", "24 hours")}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t(
                          "入组后成员期限（天，1–90）",
                          "Membership after joining (days, 1–90)",
                        )}
                        <input
                          type="number"
                          min={1}
                          max={90}
                          value={membershipDays}
                          onChange={(e) => {
                            setMembershipDays(Number(e.target.value));
                            setConfirmed(false);
                          }}
                        />
                      </label>
                      <label>
                        {t(
                          "观察能力期限（小时）",
                          "Observation authority (hours)",
                        )}
                        <input
                          type="number"
                          min={1}
                          max={membershipDays * 24}
                          value={observationHours}
                          onChange={(e) => {
                            setObservationHours(Number(e.target.value));
                            setConfirmed(false);
                          }}
                        />
                      </label>
                    </div>
                    <p className="muted">
                      {t(
                        "当前邀请授予成员资格和最多 10000 次有限观察调用。执行 OKR、文件写入及桌面控制需要单独的具体授权。",
                        "This invitation grants membership and up to 10,000 bounded observation calls. OKR execution, file writes and desktop control require separate scoped authority.",
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <code className="long-id">{targetId}</code>
                    <p className="warn">
                      {operation === "revoke-member"
                        ? t(
                            "撤销后拒绝新的受保护请求；已有成员记录保留在链上。在途操作需单独介入。",
                            "Revocation rejects new protected requests. Historical membership remains on chain. In-flight work needs a separate intervention.",
                          )
                        : t(
                            "撤销后此邀请码不能再兑换。已入组的 Host 须撤销成员资格。",
                            "This invitation cannot be redeemed after revocation. An admitted Host requires membership revocation.",
                          )}
                    </p>
                  </>
                )}
                <label>
                  {t("已授权本机设备配置名", "Authorized local device profile")}
                  <input
                    value={deviceProfile}
                    maxLength={64}
                    disabled={!!attempt}
                    onChange={(e) => {
                      setDeviceProfile(e.target.value);
                      setConfirmed(false);
                    }}
                  />
                </label>
                <label className="host-confirm">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  {operation === "binding"
                    ? t(
                        "我已核对 Coordinator 公钥与地址。",
                        "I verified the Coordinator public key and address.",
                      )
                    : operation === "invite"
                      ? t(
                          "我确认上述权限，并只向待接入的 Host 提供邀请码。",
                          "I confirm the authority above and will share the invitation only with the joining Host.",
                        )
                      : t(
                          "我确认撤销所选链上记录。",
                          "I confirm revocation of the selected chain record.",
                        )}
                </label>
              </fieldset>
            )}
            {!outcome && (
              <button
                disabled={
                  !ready ||
                  busy ||
                  !confirmed ||
                  !!quote ||
                  (operation === "invite" && !bindingId)
                }
                onClick={() => void run(() => prepare())}
              >
                {t("核验管理权限并报价", "Verify management authority & quote")}
              </button>
            )}
            {history.length > 0 && (
              <details className="panel">
                <summary>
                  {t("历史 Host 操作", "Historical Host operations")} ·{" "}
                  {history.length}
                </summary>
                <p>
                  {t(
                    "这里只保留公开交易追踪；当前操作使用新的请求与明确授权。",
                    "These are public transaction references. Current operations use new requests and explicit authorization.",
                  )}
                </p>
                {history.map((value) => (
                  <section key={value.attempt.id}>
                    <p>
                      {value.attempt.kind} · <code>{value.attempt.id}</code>
                    </p>
                    <code className="long-id">{value.digest}</code>
                    <p>
                      {t(
                        "技术日志此前记录",
                        "Previously recorded in the technical journal",
                      )}
                      :{" "}
                      {value.previousStatus === "confirmed"
                        ? t("已成功", "Confirmed")
                        : t("已失败", "Failed")}{" "}
                      · {value.actualGas} MIST
                    </p>
                    <p>
                      {t("当前回执查询", "Current receipt query")}:{" "}
                      {historyResults[value.attempt.id]?.status ??
                        t("未查询", "Not queried")}
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => void run(() => queryHistory(value))}
                    >
                      {t("只读查询此原交易", "Query this original transaction")}
                    </button>
                  </section>
                ))}
              </details>
            )}
            {invite && !access && (
              <section className="panel">
                <h3>{t("Host 接入指导", "Host onboarding guide")}</h3>
                <p>
                  {t("链上邀请", "On-chain invitation")}:{" "}
                  <code className="long-id">{invite.id}</code> ·{" "}
                  {status(invite)}
                </p>
                {code && inviteUsable ? (
                  <>
                    <label>
                      {t(
                        "仅本次窗口可用的一次性邀请码",
                        "One-use invitation available only in this session",
                      )}
                      <textarea
                        readOnly
                        value={code}
                        spellCheck={false}
                        autoComplete="off"
                        aria-label={t(
                          "Host 一次性邀请码",
                          "One-use Host invitation",
                        )}
                      />
                    </label>
                    <p>
                      {t(
                        "关闭、刷新或重启后无法找回此码；链上只保存证明公钥。遗失后撤销未使用邀请，再生成新的。",
                        "Closing, reloading or restarting loses this code. Only the proof public key is on chain. Revoke an unused invitation before creating a replacement.",
                      )}
                    </p>
                  </>
                ) : (
                  <p className="warn">
                    {t(
                      "本窗口无可用邀请码。未使用邀请可以撤销后重新生成。",
                      "No usable invitation code is available in this session. Revoke an unused invitation and create a replacement.",
                    )}
                  </p>
                )}
              </section>
            )}
            {directory && (
              <details className="panel">
                <summary>
                  {t(
                    "手动接入指导（不使用接入串时）",
                    "Manual admission guide (without an access string)",
                  )}
                </summary>
                <ol>
                  <li>
                    {t(
                      "将以下公开连接项合并进新主机的 sentinel.yaml。这里不包含邀请码或私钥。",
                      "Merge these public connection fields into sentinel.yaml on the new Host. They contain no invitation or private key.",
                    )}
                    <pre>{`sui:\n  host_connection_enabled: true\n  network: ${JSON.stringify(profile.network)}\n  rpc: ${JSON.stringify(profile.rpcUrl)}\n  chain_identifier: ${JSON.stringify(directory?.chainIdentifier ?? profile.chainIdentifier ?? "")}\n  protocol_package_id: ${JSON.stringify(profile.packageId)}\n  protocol_original_package_id: ${JSON.stringify(profile.originalPackageId ?? profile.packageId)}\n  okr_package_id: ${JSON.stringify(profile.okrPackageId ?? profile.packageId)}\n  okr_original_package_id: ${JSON.stringify(profile.originalOkrPackageId ?? profile.okrPackageId ?? profile.originalPackageId ?? profile.packageId)}\n  direct_package_id: ${JSON.stringify(profile.directPackageId ?? profile.packageId)}\n  direct_original_package_id: ${JSON.stringify(profile.originalDirectPackageId ?? profile.directPackageId ?? profile.originalPackageId ?? profile.packageId)}\n  protocol_registry_id: ${JSON.stringify(profile.registryId)}\n  org_id: ${JSON.stringify(organizationId)}\n  host_join_gas_budget: 200000000`}</pre>
                  </li>
                  <li>
                    {t(
                      "在新主机安装 envd，明确初始化独立 Host 密钥。",
                      "Install envd on the new Host and explicitly initialize independent Host keys.",
                    )}
                    <pre>envd --config sentinel.yaml --init-host</pre>
                  </li>
                  <li>
                    {t(
                      "向输出的 Host 地址充值交易 Gas；它与管理设备使用不同地址。",
                      "Fund the Host address printed by initialization for transaction Gas. It differs from the management device address.",
                    )}
                  </li>
                  <li>
                    {t(
                      "运行接入命令，在终端隐藏输入邀请码。核对组织、Coordinator 公钥、有限观察权限和 Gas，再输入 JOIN 与完整组织 ID 确认。启动 envd 不会自动入组。",
                      "Run admission and enter the invitation through hidden terminal input. Verify the organization, Coordinator key, finite observation authority and Gas, then confirm with JOIN and the full organization ID. Starting envd does not automatically join.",
                    )}
                    <pre>envd --config sentinel.yaml --join-host</pre>
                  </li>
                  <li>
                    {t(
                      "结果未知时查询原交易，无需邀请码或私钥。接入成功表示链上成员资格。再启动 envd，按链上当前入口和公钥认证连接；主机在线、运行发现和 Agent 导入仍单独核验。",
                      "Query an uncertain original transaction without the invitation or private keys. Admission confirms on-chain membership. Then start envd to connect using the current chain endpoint and key; online state, discovery and Agent import are verified separately.",
                    )}
                    <pre>envd --config sentinel.yaml</pre>
                    <pre>
                      envd --config sentinel.yaml --host-join-status
                      --host-address 0xYOUR_HOST_ADDRESS
                    </pre>
                  </li>
                </ol>
              </details>
            )}
            {management && (
              <>
                <section className="panel">
                  <h3>{t("组织邀请", "Organization invitations")}</h3>
                  {!management.invitations.length && (
                    <p>{t("尚无邀请", "No invitations")}</p>
                  )}
                  {management.invitations.map((i) => (
                    <div key={i.id} className="host-row">
                      <code className="long-id">{i.id}</code>
                      <p>
                        {status(i)} ·{" "}
                        {new Date(Number(i.expires_at_ms)).toLocaleString()}
                      </p>
                      <button
                        disabled={locked || i.revoked || i.uses !== 0}
                        onClick={() => edit("revoke-invite", i.id)}
                      >
                        {t("撤销此邀请", "Revoke invitation")}
                      </button>
                    </div>
                  ))}
                </section>
                <section className="panel">
                  <h3>{t("主机成员", "Host memberships")}</h3>
                  {!management.memberships.length && (
                    <p>{t("尚无成员", "No memberships")}</p>
                  )}
                  {management.memberships.map((m) => (
                    <div key={m.id} className="host-row">
                      <strong>{m.name}</strong> ·{" "}
                      {m.revoked
                        ? t("已撤销", "Revoked")
                        : BigInt(m.expires_at_ms) <= clockMs
                          ? t("已过期", "Expired")
                          : t(
                              "资格有效，在线未知",
                              "Membership valid; connectivity unknown",
                            )}
                      <br />
                      <code className="long-id">{m.id}</code>
                      <button
                        disabled={locked || m.revoked}
                        onClick={() => edit("revoke-member", m.id)}
                      >
                        {t("撤销成员资格", "Revoke membership")}
                      </button>
                    </div>
                  ))}
                </section>
              </>
            )}
          </details>
        </dialog>
      )}
    </>
  );
}
