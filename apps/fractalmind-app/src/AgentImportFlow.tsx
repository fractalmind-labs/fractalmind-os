import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  TransactionPreflightError,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  AgentImport,
  AgentImportError,
  type AgentImportSelection,
  type AlreadyImported,
  type ManagedInstance,
} from "./agent-import";
import { ChainReadSession } from "./chain";
import {
  NativeDeviceSigner,
  NativeDeviceError,
  preferredDeviceProfile,
} from "./native-device";
import { DeviceIdentityError } from "./device-identity";
import { CoordinatorReadError } from "./coordinator-read";
import type { ConnectionProfile } from "./domain";
import type { DiscoveredInstance } from "./agent-discovery";
export type ImportTarget = {
  selection: AgentImportSelection;
  instance: DiscoveredInstance;
};
type Attempt = { id: string; deviceProfile: string; grantId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = /^0x[0-9a-f]{64}$/;

export default function AgentImportFlow({
  profile,
  organizationId,
  authorityRevision,
  target,
  onClose,
  onChanged,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  authorityRevision: string;
  target: ImportTarget | null;
  onClose: () => void;
  onChanged: () => void;
  t: (zh: string, en: string) => string;
}) {
  const [open, setOpen] = useState(false),
    [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile),
    [confirmed, setConfirmed] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null),
    [quote, setQuote] = useState<SelfPayFeeQuote | null>(null),
    [outcome, setOutcome] = useState<SelfPayTransactionOutcome | null>(null),
    [record, setRecord] = useState<ManagedInstance | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [unsubmitted, setUnsubmitted] = useState(false),
    [restored, setRestored] = useState(false),
    [payer, setPayer] = useState<string | null>(null),
    [now, setNow] = useState(Date.now());
  const dialog = useRef<HTMLDialogElement>(null),
    flight = useRef(false),
    mounted = useRef(true),
    session = useRef<AgentImport | null>(null),
    journal = useRef<IndexedDbTransactionJournal | null>(null),
    revision = useRef(authorityRevision);
  const latestRevision = useRef(authorityRevision);
  latestRevision.current = authorityRevision;
  const key = `fractalmind.app.agent-import-attempt.v1:${JSON.stringify([profile.network, profile.chainIdentifier, profile.humanId, organizationId])}`;
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
    if (revision.current !== authorityRevision) {
      revision.current = authorityRevision;
      if (quote) {
        session.current?.cancel(quote);
        setQuote(null);
        setError("state_changed");
      }
    }
  }, [authorityRevision]);
  useEffect(() => {
    if (target) {
      setOpen(true);
      setConfirmed(false);
    }
  }, [target]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      if (
        saved &&
        uuid.test(saved.id) &&
        id.test(saved.grantId) &&
        typeof saved.deviceProfile === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(saved.deviceProfile)
      ) {
        setAttempt({
          id: saved.id,
          grantId: saved.grantId,
          deviceProfile: saved.deviceProfile,
        });
        setDeviceProfile(saved.deviceProfile);
        setRestored(true);
      }
    } catch {
      setError("journal_unavailable");
    }
  }
  useEffect(() => {
    restore();
  }, [key]);
  async function run(action: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (
        e instanceof TransactionPreflightError &&
        e.cause instanceof AgentImportError
      )
        e = e.cause;
      if (mounted.current)
        setError(
          e instanceof AgentImportError ||
            e instanceof DeviceIdentityError ||
            e instanceof NativeDeviceError ||
            e instanceof CoordinatorReadError ||
            e instanceof TransactionPreflightError
            ? e.code
            : "operation_failed",
        );
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function load(value?: Attempt) {
    if (session.current) return session.current;
    if (!isTauri()) throw new NativeDeviceError("native_unavailable");
    const device = await NativeDeviceSigner.load(
        (command, args) => invoke(command, args),
        value?.deviceProfile ?? deviceProfile,
      ),
      chain = new ChainReadSession(profile);
    if (mounted.current) setPayer(device.device.address);
    let grantId = value?.grantId;
    if (!grantId) {
      const human = await chain.human(),
        candidates = human.grants.value?.filter(
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
      grantId = usable[0].id;
      value = { id: crypto.randomUUID(), deviceProfile, grantId };
      // Technical correlation only. Instance, workspace, Host payload and
      // derived product records remain in memory or Sui, never this cache.
      localStorage.setItem(key, JSON.stringify(value));
      setAttempt(value);
    }
    journal.current ??= new IndexedDbTransactionJournal();
    session.current = new AgentImport(
      chain,
      device,
      grantId,
      organizationId,
      journal.current,
    );
    return session.current;
  }
  async function receive(
    value: SelfPayTransactionOutcome | AlreadyImported,
    controller: AgentImport,
  ) {
    if (!mounted.current) return;
    setQuote(null);
    if (value.status === "already-imported") {
      setRecord(value.record);
      setUnsubmitted(true);
      onChanged();
      return;
    }
    setOutcome(value);
    setUnsubmitted(false);
    if (value.status === "confirmed") {
      const found = await controller.confirmed(value);
      if (mounted.current) setRecord(found);
      onChanged();
    }
  }
  function close() {
    if (busy) return;
    if (quote) session.current?.cancel(quote);
    setQuote(null);
    setOpen(false);
    setConfirmed(false);
    dialog.current?.close();
    onClose();
  }
  function reset() {
    if (busy || outcome?.status === "unknown" || (!outcome && !unsubmitted))
      return;
    localStorage.removeItem(key);
    session.current?.dispose();
    session.current = null;
    setAttempt(null);
    setQuote(null);
    setOutcome(null);
    setRecord(null);
    setConfirmed(false);
    setUnsubmitted(false);
    setRestored(false);
    setPayer(null);
    setError(null);
  }
  const messages: Record<string, [string, string]> = {
    needs_funds: [
      "本机设备的运行费不足。请向下方付款地址补充当前网络的 SUI，再重新报价。",
      "This device needs operating funds. Add SUI on the current network to the payer address below, then request a new quote.",
    ],
    discovery_unavailable: [
      "实例扫描已失效或改变，请重新发现并核对工作区。",
      "The scan expired or changed. Rediscover and review the workspace.",
    ],
    state_changed: [
      "权限、Host 或工作区已改变。原交易结果保留；重新发现后再授权。",
      "Authority, Host or workspace changed. Original transaction results remain; rediscover before authorizing again.",
    ],
    existing_conflict: [
      "此实例已有冲突或撤销的登记，需要单独核对并重新关联。",
      "This instance has a conflicting or revoked record. Review before rebinding.",
    ],
    invalid_grant: [
      "当前设备没有唯一有效的主机管理和读取授权。",
      "This device has no unique current Host-management and read grant.",
    ],
    sync_pending: [
      "交易已确认，链上记录尚未可见，请查询原交易。",
      "Transaction confirmed; the chain record is not yet visible. Query the original transaction.",
    ],
    not_submitted: [
      "尚无已提交交易，可以重新核对或开始新操作。",
      "No submitted transaction found. Review again or start a new operation.",
    ],
  };
  return (
    <>
      <button
        disabled={!isTauri()}
        onClick={() => {
          restore();
          setOpen(true);
        }}
      >
        {t("恢复导入交易", "Recover import transaction")}
      </button>
      {open && (
        <dialog
          className="host-dialog"
          ref={dialog}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <div className="dialog-head">
            <h2>{t("导入为仅观察", "Import for observation only")}</h2>
            <button disabled={busy} onClick={close}>
              {t("关闭", "Close")}
            </button>
          </div>
          <p>
            {t(
              "保留原进程和任务。链上确认后建立组织关联，tmux 不能获得约束执行或 OKR 接管权限。",
              "Keep the existing process and tasks. Confirmation creates an organization association on Sui; tmux receives no constrained execution or OKR handover authority.",
            )}
          </p>
          {restored && !unsubmitted && !outcome && !record && (
            <p className="warn">
              {t(
                "先查询上次导入结果，完成后再导入所选实例。",
                "Query the previous import first, then import the selected instance.",
              )}
            </p>
          )}
          {payer && (
            <p>
              {t("付款地址", "Payer")} · {profile.network}:{" "}
              <code className="long-id">{payer}</code>
            </p>
          )}
          {target && !outcome && !record && (
            <section className="panel">
              <h3 className="long-id">
                {target.instance.session} · {target.instance.pane}
              </h3>
              <p>
                {t("组织", "Organization")}:{" "}
                <code className="long-id">{organizationId}</code>
              </p>
              <p>
                Host:{" "}
                <code className="long-id">{target.selection.hostAddress}</code>
              </p>
              <p className="long-id">{target.selection.instanceId}</p>
              <p>
                {t("工作区", "Workspace")}: {target.instance.workspace}
              </p>
              <small className="long-id">
                {target.selection.workspaceHash}
              </small>
            </section>
          )}
          {!outcome && !record && (
            <fieldset disabled={busy || !!quote}>
              <label>
                {t("本机设备资料", "Local device profile")}
                <input
                  value={deviceProfile}
                  disabled={!!attempt}
                  maxLength={64}
                  onChange={(e) => setDeviceProfile(e.target.value)}
                />
              </label>
              <label className="host-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {t(
                  "我已核对 Host、运行实例和工作区，确认只导入为观察。",
                  "I reviewed the Host, instance and workspace and confirm observation-only import.",
                )}
              </label>
            </fieldset>
          )}
          {!outcome && !record && (
            <button
              disabled={
                busy ||
                !isTauri() ||
                !target ||
                !confirmed ||
                !!quote ||
                (restored && !unsubmitted)
              }
              onClick={() =>
                void run(async () => {
                  const startedRevision = authorityRevision;
                  const controller = await load(attempt ?? undefined);
                  const current =
                    attempt ?? JSON.parse(localStorage.getItem(key)!);
                  const result = await controller.prepare(
                    target!.selection,
                    current.id,
                    confirmed,
                  );
                  if (!mounted.current) return;
                  if ("status" in result) await receive(result, controller);
                  else {
                    if (latestRevision.current !== startedRevision) {
                      controller.cancel(result);
                      throw new AgentImportError("state_changed");
                    }
                    setQuote(result);
                    setUnsubmitted(true);
                  }
                })
              }
            >
              {t("核验实例并报价", "Verify instance & quote")}
            </button>
          )}
          {quote && (
            <section className="panel">
              <h3>{t("确认交易费用", "Confirm transaction fee")}</h3>
              <p>
                {t("付款地址", "Payer")}:{" "}
                <code className="long-id">{quote.sender}</code>
              </p>
              <p>
                {t("余额", "Balance")}: {quote.balance} MIST
              </p>
              <p>
                {t("预计费用", "Estimated Gas")}: {quote.estimatedGas} MIST ·{" "}
                {t("Gas 上限", "Gas limit")}: {quote.gasBudget} MIST
              </p>
              <p>
                {t("报价到期", "Quote expiry")}:{" "}
                {new Date(quote.expiresAtMs).toLocaleTimeString()}
              </p>
              <button
                disabled={busy || now >= quote.expiresAtMs}
                onClick={() =>
                  void run(async () => {
                    setUnsubmitted(false);
                    await receive(
                      await session.current!.submit(quote),
                      session.current!,
                    );
                  })
                }
              >
                {t("确认支付并导入", "Confirm payment & import")}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  session.current?.cancel(quote);
                  setQuote(null);
                }}
              >
                {t("取消报价", "Cancel quote")}
              </button>
            </section>
          )}
          {attempt && (
            <section className="panel">
              <p>
                {t("当前尝试", "Current attempt")}: <code>{attempt.id}</code>
              </p>
              {outcome && (
                <>
                  <p>
                    {t("交易结果", "Transaction result")}:{" "}
                    {outcome.status === "confirmed"
                      ? t("已确认", "Confirmed")
                      : outcome.status === "failed"
                        ? t("已失败", "Failed")
                        : t(
                            "结果未知，只查询原交易",
                            "Unknown; query original transaction",
                          )}
                  </p>
                  <code className="long-id">{outcome.digest}</code>
                  {outcome.actualGas !== undefined && (
                    <p>
                      {t("实际费用", "Actual Gas")}: {outcome.actualGas} MIST
                    </p>
                  )}
                </>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const controller = await load(attempt);
                    const result = await controller.query(attempt.id);
                    if (result) await receive(result, controller);
                    else {
                      setUnsubmitted(true);
                      setError("not_submitted");
                    }
                  })
                }
              >
                {t("查询原交易", "Query original transaction")}
              </button>
              <button
                disabled={
                  busy ||
                  outcome?.status === "unknown" ||
                  (!outcome && !unsubmitted)
                }
                onClick={reset}
              >
                {t("开始新操作", "Start new operation")}
              </button>
            </section>
          )}
          {record && (
            <section className="panel">
              <h3>{t("链上登记记录", "On-chain registration")}</h3>
              <code className="long-id">{record.id}</code>
              <p>
                Host: <code className="long-id">{record.host_address}</code>
              </p>
              <p className="long-id">{record.instance_id}</p>
              <p>
                {record.revoked
                  ? t("当前记录已撤销", "Current record revoked")
                  : t(
                      "已登记为仅观察；当前进程状态需重新发现",
                      "Registered for observation; rediscover to check current process state",
                    )}
              </p>
            </section>
          )}
          {busy && (
            <p role="status">
              {t("正在核验或提交…", "Verifying or submitting…")}
            </p>
          )}
          {error && (
            <p role="alert" className="warn">
              {messages[error]
                ? t(...messages[error])
                : `${t("操作未完成，请核对后重试", "Operation incomplete; review before retrying")} (${error})`}
            </p>
          )}
        </dialog>
      )}
    </>
  );
}
