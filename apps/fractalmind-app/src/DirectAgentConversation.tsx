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
  NativeDirectAgent,
  boundedDirectRequest,
  modelReply,
  type DirectMessageView,
  type DirectOperation,
  type StandingInput,
} from "./direct-agent";
import type { ConnectionProfile, Agent } from "./domain";
import CreateOkr from "./CreateOkr";
import {
  readMessageOkrSource,
  type MessageOkrSource,
} from "./message-okr-source";

type Description = Awaited<ReturnType<NativeDirectAgent["describe"]>>;
type Fee = { quote: SelfPayFeeQuote; operation: DirectOperation };
const runLabels = [
  ["已准备，等待投递", "Prepared, awaiting delivery"],
  ["链上记录：运行中", "Chain record: running"],
  ["执行成功", "Execution succeeded"],
  ["执行失败", "Execution failed"],
  ["需要核实原执行", "Original execution needs confirmation"],
  ["已取消", "Cancelled"],
] as const;
const approvalLabels = [
  ["等待决定", "Awaiting decision"],
  ["本次已批准", "Approved for this request"],
  ["本次已拒绝", "Rejected for this request"],
  ["批准已用于原 Run", "Approval used by the original Run"],
] as const;
const reasonLabels: Record<string, [string, string]> = {
  action: ["动作未获常驻授权", "Action is outside standing authority"],
  boundary: ["请求改变了工作区边界", "Workspace boundary differs"],
  per_message_limit: ["超过单消息工具上限", "Per-message tool limit exceeded"],
  budget: ["常驻剩余额度不足", "Insufficient standing allowance"],
  okr_workspace: [
    "同工作区正在受 OKR 保护",
    "The workspace is protected by an OKR",
  ],
};
const opLabels: Record<DirectOperation["kind"], [string, string]> = {
  permission: ["确认常驻权限", "Confirm standing authority"],
  revoke: ["撤销常驻权限", "Revoke standing authority"],
  message: ["保存加密消息", "Save encrypted message"],
  approval: ["申请本次审批", "Request one-off approval"],
  decision: ["记录本次审批决定", "Record this approval decision"],
  capability: ["授予执行权限", "Grant execution authority"],
  run: ["准备原执行", "Prepare the original Run"],
  stop: ["请求停止原执行", "Request stop for the original Run"],
};
const sui = (value: string) => {
  const n = BigInt(value),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}${a / 1000000000n}.${
    String(a % 1000000000n)
      .padStart(9, "0")
      .replace(/0+$/, "") || "0"
  } SUI`;
};

/** V2 fixed-instance entry. Plaintext and actionable quotes are only in the
 * open window. Public request locators cannot confer authority or trigger a
 * delivery when the component is restored. */
export default function DirectAgentConversation({
  profile,
  organizationId,
  managed,
  onChanged,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  managed: Agent;
  onChanged: () => void;
  t: (zh: string, en: string) => string;
}) {
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile);
  const [description, setDescription] = useState<Description | null>(null),
    [selected, setSelected] = useState<DirectMessageView | null>(null);
  const [fee, setFee] = useState<Fee | null>(null),
    [receipt, setReceipt] = useState<SelfPayTransactionOutcome | null>(null);
  const [draftSource, setDraftSource] = useState<MessageOkrSource | null>(null);
  const [draftExpiresAtMs, setDraftExpiresAtMs] = useState<string>();
  const [requestId, setRequestId] = useState<string | null>(null),
    [capabilityId, setCapabilityId] = useState<string | null>(null);
  const [action, setAction] = useState<
      "ask" | "status" | "file.read" | "file.write"
    >("status"),
    [message, setMessage] = useState("");
  const [path, setPath] = useState("docs/RESULT.md"),
    [requestRoots, setRequestRoots] = useState("docs"),
    [content, setContent] = useState(""),
    [calls, setCalls] = useState("3");
  const [readAllowed, setReadAllowed] = useState(false),
    [writeAllowed, setWriteAllowed] = useState(false),
    [askAllowed, setAskAllowed] = useState(false);
  const [readRoots, setReadRoots] = useState("docs"),
    [writeRoots, setWriteRoots] = useState("docs");
  const [maxCalls, setMaxCalls] = useState("0"),
    [budget, setBudget] = useState("0"),
    [minutes, setMinutes] = useState("60");
  const [now, setNow] = useState(Date.now()),
    [relay, setRelay] = useState<"accepted" | "unknown" | "rejected" | null>(
      null,
    );
  const dialog = useRef<HTMLDialogElement>(null),
    active = useRef(false),
    mounted = useRef(true),
    epoch = useRef(0),
    flight = useRef(false);
  const journal = useRef<IndexedDbTransactionJournal | null>(null);
  const hydrated = useRef<string | null>(null);
  const context = useRef<{
    controller: NativeDirectAgent;
    chain: ChainReadSession;
    assertLive: () => void;
  } | null>(null);
  const key = `fractalmind.app.direct.v1:${JSON.stringify([profile.network, profile.chainIdentifier, profile.humanId, organizationId, managed.id])}`;
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const hide = () => {
      if (document.hidden) close();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      mounted.current = false;
      active.current = false;
      epoch.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hide);
      void journal.current?.close();
    };
  }, []);
  useEffect(() => {
    if (description && Number(description.authorityExpiresAtMs) <= now) close();
  }, [now, description?.authorityExpiresAtMs]);
  function close() {
    setDraftSource(null);
    active.current = false;
    epoch.current++;
    context.current = null;
    setDescription(null);
    setSelected(null);
    setFee(null);
    setMessage("");
    setContent("");
    setPath("docs/RESULT.md");
    setRequestRoots("docs");
    setReadAllowed(false);
    setWriteAllowed(false);
    setReadRoots("docs");
    setWriteRoots("docs");
    setMaxCalls("0");
    setBudget("0");
    setMinutes("60");
    hydrated.current = null;
    setCapabilityId(null);
    setRelay(null);
    setReceipt(null);
    setError(null);
    setOpened(false);
    dialog.current?.close();
  }
  function begin() {
    active.current = true;
    setOpened(true);
    dialog.current?.showModal();
    void perform(read);
  }
  async function perform(fn: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    const generation = epoch.current;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (mounted.current && active.current && epoch.current === generation) {
        setDescription(null);
        setSelected(null);
        setFee(null);
        setCapabilityId(null);
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
  function remember(value: {
    requestId: string;
    messageToken?: string;
    messageId?: string;
    deliveryAttempted?: boolean;
  }) {
    context.current?.assertLive();
    const text = JSON.stringify(value);
    localStorage.setItem(key, text);
    if (localStorage.getItem(key) !== text)
      throw Object.assign(new Error(), { code: "journal_unavailable" });
    setRequestId(value.requestId);
  }
  async function load() {
    if (context.current) return context.current;
    if (!isTauri())
      throw Object.assign(new Error(), { code: "native_unavailable" });
    const generation = epoch.current,
      assertLive = () => {
        if (!mounted.current || !active.current || generation !== epoch.current)
          throw Object.assign(new Error(), { code: "state_changed" });
      };
    const native = scopedNativeInvoke(
      (command, args) => invoke(command, args),
      assertLive,
    );
    const signer = await NativeDeviceSigner.load(native, deviceProfile),
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
    const controller = new NativeDirectAgent(
      chain,
      signer,
      eligible[0].id,
      organizationId,
      managed.id,
      native,
      journal.current,
      async (url, init) => {
        assertLive();
        return fetch(url, init);
      },
      assertLive,
    );
    context.current = { controller, chain, assertLive };
    const saved = localStorage.getItem(key);
    if (saved) {
      let locator;
      try {
        locator = JSON.parse(saved);
      } catch {
        throw Object.assign(new Error(), { code: "journal_unavailable" });
      }
      if (
        !locator ||
        typeof locator.requestId !== "string" ||
        !/^[A-Za-z0-9._:/@+\-]{1,128}$/.test(locator.requestId)
      )
        throw Object.assign(new Error(), { code: "journal_unavailable" });
      setRequestId(locator.requestId);
      // Resolve a retained original request before exposing another mutation.
      // A missing response is not permission to create a replacement message.
      const prior = await controller.query(locator.requestId);
      assertLive();
      setReceipt(prior ?? null);
    }
    return context.current;
  }
  async function read() {
    const ctx = await load(),
      result = await ctx.controller.describe();
    ctx.assertLive();
    setDescription(result);
    if (
      result.permission &&
      result.policy &&
      hydrated.current !== result.permission.version
    ) {
      hydrated.current = result.permission.version;
      setReadAllowed(result.policy.actions.includes("file.read"));
      setWriteAllowed(result.policy.actions.includes("file.write"));
      setAskAllowed(result.policy.actions.includes("ask"));
      setReadRoots(result.policy.paths["file.read"]?.join(", ") ?? "docs");
      setWriteRoots(result.policy.paths["file.write"]?.join(", ") ?? "docs");
      setMaxCalls(result.policy.maxCalls);
      setBudget(result.policy.budgetLimit);
    }
  }
  async function select(messageId: string) {
    const ctx = await load(),
      value = await ctx.controller.message(messageId);
    ctx.assertLive();
    setSelected(value);
    setCapabilityId(null);
    setRelay(null);
    // Discover the original capability receipt for this message; this is a
    // read and never recreates an unknown or failed issuance.
    const prior = await ctx.controller.query(`direct-capability:${messageId}`);
    ctx.assertLive();
    if (prior?.status === "confirmed") await useCapability(prior);
  }
  async function convertToOkr() {
    const ctx = await load();
    if (!selected) throw Object.assign(new Error(), { code: "state_changed" });
    const source = await readMessageOkrSource(
      ctx.controller,
      selected.message.id,
    );
    ctx.assertLive();
    close();
    setDraftSource(source);
    setDraftExpiresAtMs(description?.authorityExpiresAtMs);
  }
  async function useCapability(value: SelfPayTransactionOutcome) {
    const ctx = context.current;
    if (!ctx || !value.transaction) return;
    const capabilityType = await ctx.chain.sdk.client.coreType(
      "remote_authority",
      "RemoteCapability",
    );
    const matches = value.transaction.effects.changedObjects.filter(
      (o) =>
        o.idOperation === "Created" &&
        value.transaction!.objectTypes?.[o.objectId] === capabilityType,
    );
    if (matches.length !== 1)
      throw Object.assign(new Error(), { code: "invalid_source" });
    setCapabilityId(matches[0].objectId);
  }
  async function prepare(operation: DirectOperation) {
    const ctx = await load(),
      value = await ctx.controller.prepare(operation);
    ctx.assertLive();
    if ("status" in value) {
      setReceipt(value);
      setRequestId(value.requestId);
      return;
    }
    remember({
      requestId: value.requestId,
      ...(operation.kind === "message"
        ? { messageToken: operation.messageToken }
        : "messageId" in operation
          ? { messageId: operation.messageId }
          : {}),
    });
    setFee({ quote: value, operation });
    setReceipt(null);
  }
  async function submit() {
    const ctx = context.current;
    if (!ctx || !fee)
      throw Object.assign(new Error(), { code: "state_changed" });
    const operation = fee.operation,
      result = await ctx.controller.submit(fee.quote);
    ctx.assertLive();
    setFee(null);
    setReceipt(result);
    if (result.status === "confirmed") {
      await read();
      ctx.assertLive();
      if (operation.kind === "message") {
        const policy = await ctx.chain.sdk.directAgent.getPermissionForAgent(
            organizationId,
            managed.id,
          ),
          m = await ctx.chain.sdk.directAgent.findMessage(
            policy.id,
            operation.messageToken,
          );
        ctx.assertLive();
        if (m) await select(m.id);
        setMessage("");
        setContent("");
      } else if ("messageId" in operation) {
        const view = await ctx.controller.message(operation.messageId);
        ctx.assertLive();
        setSelected(view);
        if (operation.kind === "capability") await useCapability(result);
      }
      onChanged();
    }
  }
  async function query() {
    const ctx = await load();
    const saved = localStorage.getItem(key),
      original = requestId ?? (saved ? JSON.parse(saved).requestId : null);
    if (original) {
      const result = await ctx.controller.query(original);
      ctx.assertLive();
      setReceipt((old) =>
        result?.status === "unknown" &&
        old?.digest === result.digest &&
        old.status !== "unknown"
          ? old
          : (result ?? null),
      );
    }
    await read();
    if (selected) {
      const view = await ctx.controller.message(selected.message.id);
      ctx.assertLive();
      setSelected(view);
    } else if (saved) {
      const locator = JSON.parse(saved);
      if (locator.messageId) await select(locator.messageId);
      else if (locator.messageToken) {
        const p = await ctx.chain.sdk.directAgent.findPermissionForAgent(
          organizationId,
          managed.id,
        );
        const m = p
          ? await ctx.chain.sdk.directAgent.findMessage(
              p.id,
              locator.messageToken,
            )
          : null;
        ctx.assertLive();
        if (m) await select(m.id);
      }
    }
  }
  async function send() {
    const ctx = context.current;
    if (!ctx || !selected)
      throw Object.assign(new Error(), { code: "state_changed" });
    try {
      const result = (await ctx.controller.send(selected.message.id, async () =>
        remember({
          requestId: `direct-run:${selected.message.id}`,
          messageId: selected.message.id,
          deliveryAttempted: true,
        }),
      )) as { success?: boolean };
      ctx.assertLive();
      setRelay(result.success ? "accepted" : "rejected");
    } catch (e) {
      ctx.assertLive();
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        e.code === "command_outcome_unknown"
      )
        setRelay("unknown");
      else throw e;
    }
    const view = await ctx.controller.message(selected.message.id);
    ctx.assertLive();
    setSelected(view);
    onChanged();
  }
  function permissionOperation(): DirectOperation {
    const actions: StandingInput["actions"] = ["status"];
    if (askAllowed) actions.push("ask");
    if (readAllowed) actions.push("file.read");
    if (writeAllowed) actions.push("file.write");
    const roots = (text: string) =>
      text
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    if (!/^[1-9][0-9]{0,4}$/.test(minutes) || Number(minutes) > 10080)
      throw Object.assign(new Error(), { code: "invalid_input" });
    const expiry = Math.min(
      Date.now() + Number(minutes) * 60000,
      Number(description?.member.expires_at_ms),
    );
    return {
      kind: "permission",
      expectedVersion: description?.permission?.version ?? null,
      policy: {
        actions,
        paths: {
          "file.read": roots(readRoots),
          ...(writeAllowed ? { "file.write": roots(writeRoots) } : {}),
        },
        maxCalls,
        budgetLimit: budget,
        expiresAtMs: String(expiry),
      },
    };
  }
  function messageOperation(): DirectOperation {
    if (!description?.policy || !message.trim())
      throw Object.assign(new Error(), { code: "invalid_input" });
    const paths = structuredClone(description.policy.paths);
    if (action !== "status" && action !== "ask")
      paths[action] = requestRoots
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    const request = boundedDirectRequest({
      action,
      message,
      paths,
      maxCalls: calls,
      path,
      content,
    });
    return {
      kind: "message",
      messageToken: crypto.randomUUID(),
      action,
      request,
    };
  }
  const p = description?.permission,
    canOperate = description?.actions.includes("operate") ?? false,
    canApprove = description?.actions.includes("approve") ?? false;
  const answer =
    selected?.message.action === "ask" && selected.result?.response?.ok
      ? modelReply(selected.result.response.result)
      : null;
  const current =
    p &&
    !p.revoked &&
    Number(p.expires_at_ms) > now &&
    managed.control_confirmed &&
    !managed.revoked;
  const m = selected?.message,
    fresh =
      current &&
      m &&
      m.permission_version === p.version &&
      Number(m.expires_at_ms) > now;
  const working = busy || !!fee,
    unknown = receipt?.status === "unknown";
  return (
    <>
      <button className="secondary" onClick={begin}>
        {t("与 Agent 沟通", "Contact Agent")}
      </button>
      <dialog
        ref={dialog}
        className="okr-create-dialog handover-dialog direct-agent-dialog"
        aria-label={t(
          "Agent 沟通与常驻权限",
          "Agent communication & standing authority",
        )}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <header className="dialog-heading">
          <div>
            <span className="eyebrow">{t("固定实例", "Fixed instance")}</span>
            <h2>{t("与 Agent 沟通", "Contact Agent")}</h2>
          </div>
          <button className="secondary" onClick={close}>
            {t("关闭", "Close")}
          </button>
        </header>
        <p className="long-id">{managed.instance_id}</p>
        <small className="long-id">Host: {managed.host_address}</small>
        <p>
          {t(
            "消息保存、批准、执行准备和 Agent 回应是独立状态。模型问答需要 Host 配置提供方，提问不使用文件工具；操作时仍核验此实例的当前资格。",
            "Message storage, approval, Run preparation and Agent response are separate states. Model conversation requires the Host to configure a provider; questions use no file tools. This instance's authority is checked when acting.",
          )}
        </p>
        <details>
          <summary>{t("设备选择", "Device selection")}</summary>
          <label>
            {t("设备配置", "Device profile")}
            <input
              value={deviceProfile}
              disabled={busy || !!context.current}
              onChange={(e) => setDeviceProfile(e.target.value)}
            />
          </label>
        </details>
        <div className="button-row">
          <button disabled={working} onClick={() => void perform(read)}>
            {t("读取权限与消息", "Read authority & messages")}
          </button>
          <button
            className="secondary"
            disabled={working}
            onClick={() => void perform(query)}
          >
            {t("查询原请求与回执", "Query original request & receipt")}
          </button>
        </div>
        {error && (
          <p role="alert">
            {error === "native_unavailable"
              ? t(
                  "请在原生 FractalMind App 中解锁设备后继续。网页不能签名或读取加密消息。",
                  "Unlock a device in the native FractalMind App. The web view cannot sign or decrypt messages.",
                )
              : error === "invalid_grant"
                ? t(
                    "当前设备没有此组织的有效读取权限，或需要选择唯一设备授权。",
                    "This device needs current organization read access and one unambiguous grant.",
                  )
                : error === "approval_required"
                  ? t(
                      "此消息需要本次审批，批准后仍需明确准备和发送。",
                      "This message needs a one-off approval, followed by explicit preparation and delivery.",
                    )
                  : t(
                      "当前事实无法继续，请查询原请求。已有投递不会自动重发。",
                      "Cannot continue from the current facts. Query the original request; delivery is never automatically repeated.",
                    )}{" "}
            <small>{error}</small>
          </p>
        )}
        {opened && !isTauri() && (
          <p className="muted">
            {t(
              "你仍可关闭此窗口并查看公开的 Agent 与 OKR 记录。",
              "Close this window to view public Agent and OKR records.",
            )}
          </p>
        )}
        {description && (
          <div className="direct-layout">
            <aside>
              <section className="panel">
                <h3>{t("常驻权限", "Standing authority")}</h3>
                {p ? (
                  <>
                    <p>
                      {p.revoked
                        ? t("已撤销", "Revoked")
                        : Number(p.expires_at_ms) <= now
                          ? t("已到期", "Expired")
                          : t("已授予", "Granted")}{" "}
                      · v{p.version}
                    </p>
                    <p>
                      {t("单消息工具上限", "Tools per message")}: {p.max_calls}
                    </p>
                    <p>
                      {t("总工具额度", "Total tool allowance")}: {p.spent} +{" "}
                      {p.reserved} / {p.budget_limit}
                    </p>
                    <p>
                      {t(
                        "本次审批独立记账",
                        "One-off approvals, separate ledger",
                      )}
                      : {p.approved_spent} + {p.approved_reserved}
                    </p>
                    <p>
                      {t("有效至", "Expires")}:{" "}
                      {new Date(Number(p.expires_at_ms)).toLocaleString()}
                    </p>
                    <small>
                      {t(
                        "固定总额度，无自动每日重置；不占 OKR 预算。",
                        "Fixed total allowance; no automatic daily reset. Separate from OKR budgets.",
                      )}
                    </small>
                  </>
                ) : (
                  <p>
                    {t(
                      "还没有常驻权限。发送前先确认动作、边界、工具额度和期限。",
                      "No standing authority yet. Confirm actions, bounds, allowance and expiry before sending.",
                    )}
                  </p>
                )}
                {description.policy && (
                  <details>
                    <summary>
                      {t("查看已授权边界", "View granted bounds")}
                    </summary>
                    <pre>
                      {JSON.stringify(description.policy.paths, null, 2)}
                    </pre>
                  </details>
                )}
                {canApprove && (
                  <details>
                    <summary>
                      {p
                        ? t("调整或续期权限", "Edit or renew authority")
                        : t("设置常驻权限", "Set standing authority")}
                    </summary>
                    <fieldset disabled={working || !!unknown}>
                      <p>
                        {t(
                          "默认只授权零工具状态查询。扩大动作和额度需要你确认费用并签名。",
                          "Default: zero-tool status only. Expanded actions and allowance require fee confirmation and signature.",
                        )}
                      </p>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={askAllowed}
                          onChange={(e) => setAskAllowed(e.target.checked)}
                        />
                        {t(
                          "允许模型问答（0 工具）",
                          "Allow model questions (zero tools)",
                        )}
                      </label>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={readAllowed}
                          onChange={(e) => setReadAllowed(e.target.checked)}
                        />
                        {t("允许读取文件", "Allow file reads")}
                      </label>
                      <label>
                        {t(
                          "工作区读取边界，逗号分隔；需勾选才允许读取消息",
                          "Read bounds, comma separated; read messages require the checkbox",
                        )}
                        <input
                          value={readRoots}
                          onChange={(e) => setReadRoots(e.target.value)}
                        />
                      </label>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={writeAllowed}
                          onChange={(e) => setWriteAllowed(e.target.checked)}
                        />
                        {t("允许修改文件", "Allow file writes")}
                      </label>
                      {writeAllowed && (
                        <label>
                          {t(
                            "可写目录，逗号分隔",
                            "Write directories, comma separated",
                          )}
                          <input
                            value={writeRoots}
                            onChange={(e) => setWriteRoots(e.target.value)}
                          />
                        </label>
                      )}
                      <label>
                        {t("单消息最多调用工具", "Maximum tools per message")}
                        <input
                          type="number"
                          min="0"
                          max="1000"
                          value={maxCalls}
                          onChange={(e) => setMaxCalls(e.target.value)}
                        />
                      </label>
                      <label>
                        {t("总工具额度", "Total tool allowance")}
                        <input
                          type="number"
                          min="0"
                          value={budget}
                          onChange={(e) => setBudget(e.target.value)}
                        />
                      </label>
                      <label>
                        {t(
                          "有效分钟数，最长至 Host 到期",
                          "Minutes, capped at Host expiry",
                        )}
                        <input
                          type="number"
                          min="1"
                          max="10080"
                          value={minutes}
                          onChange={(e) => setMinutes(e.target.value)}
                        />
                      </label>
                      <button
                        onClick={() =>
                          void perform(() => prepare(permissionOperation()))
                        }
                      >
                        {t("预览权限与费用", "Review authority & fee")}
                      </button>
                    </fieldset>
                  </details>
                )}
                {canApprove && p && !p.revoked && (
                  <button
                    className="secondary"
                    disabled={working || !!unknown}
                    onClick={() =>
                      void perform(() =>
                        prepare({ kind: "revoke", expectedVersion: p.version }),
                      )
                    }
                  >
                    {t("撤销权限，先预览费用", "Revoke authority · review fee")}
                  </button>
                )}
              </section>
              <section className="panel">
                <h3>{t("链上消息", "Messages on Sui")}</h3>
                {!description.messages.length ? (
                  <p>{t("还没有消息", "No messages yet")}</p>
                ) : (
                  <ol className="direct-thread-list">
                    {description.messages.map((row) => (
                      <li key={row.id}>
                        <button
                          className={row.id === m?.id ? "" : "secondary"}
                          disabled={working}
                          onClick={() => void perform(() => select(row.id))}
                        >
                          {row.action} ·{" "}
                          {new Date(
                            Number(row.created_at_ms),
                          ).toLocaleTimeString()}
                        </button>
                        <small>
                          {t(
                            "消息已保存；投递状态待查询",
                            "Saved; query delivery state",
                          )}
                        </small>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </aside>
            <section>
              {selected && (
                <article className="panel direct-message-detail">
                  <h3>{t("原消息与执行", "Original message & execution")}</h3>
                  {canApprove && (
                    <button
                      className="secondary"
                      disabled={working || !!unknown}
                      onClick={() => void perform(convertToOkr)}
                    >
                      {t("转为 OKR 草稿", "Convert to OKR draft")}
                    </button>
                  )}
                  <p className="direct-message-text">
                    {selected.request.message}
                  </p>
                  <p>
                    {m!.action} · {t("工具上限", "Tool limit")}:{" "}
                    {m!.budget_amount}
                  </p>
                  <p>
                    {t("消息有效至", "Message expires")}:{" "}
                    {new Date(Number(m!.expires_at_ms)).toLocaleString()}
                  </p>
                  <details>
                    <summary>
                      {t("核对具体操作与边界", "Review exact task & bounds")}
                    </summary>
                    <pre>{selected.request.task ?? "—"}</pre>
                    <pre>
                      {JSON.stringify(selected.request.bounds, null, 2)}
                    </pre>
                  </details>
                  {selected.result ? (
                    <>
                      <h4>
                        {t(
                          runLabels[selected.result.run.state][0],
                          runLabels[selected.result.run.state][1],
                        )}
                      </h4>
                      <small className="long-id">
                        Run: {selected.result.run.id}
                      </small>
                      {selected.result.run.stop_requested && (
                        <p>
                          {t(
                            "停止请求已记录；以原 Run 确认状态为准。",
                            "Stop request recorded; the original Run determines completion.",
                          )}
                        </p>
                      )}
                      {selected.claim && (
                        <p>
                          {t("原预留额度", "Original allowance")}:{" "}
                          {selected.claim.reserved} · {t("已用", "Spent")}:{" "}
                          {selected.claim.spent} ·{" "}
                          {selected.claim.settled
                            ? t("已结算", "Settled")
                            : t("预留未释放", "Reservation retained")}
                        </p>
                      )}
                      {selected.result.response && (
                        <>
                          {answer && (
                            <article className="panel">
                              <h3>
                                {t(
                                  "模型回复 · 待你审阅",
                                  "Model reply · review required",
                                )}
                              </h3>
                              <p style={{ whiteSpace: "pre-wrap" }}>
                                {answer.text}
                              </p>
                              <small>
                                {answer.model} ·{" "}
                                {t(
                                  "输入 / 输出 token",
                                  "Input / output tokens",
                                )}
                                : {answer.inputTokens} / {answer.outputTokens}
                              </small>
                              <p className="muted">
                                {t(
                                  "回复是建议，不代表文件观测、执行授权或 OKR 验收。",
                                  "This is a suggestion, not a file observation, execution grant or OKR acceptance.",
                                )}
                              </p>
                            </article>
                          )}
                          <p>
                            {t(
                              "已读取并解密原 Host 回执",
                              "Original Host receipt read and decrypted",
                            )}
                          </p>
                          <pre>
                            {JSON.stringify(selected.result.response, null, 2)}
                          </pre>
                        </>
                      )}
                      {!selected.result.response && (
                        <p>
                          {t(
                            "尚无 Agent 回应，保存或投递确认不代表执行成功。",
                            "No Agent response yet. Storage or delivery confirmation is not execution success.",
                          )}
                        </p>
                      )}
                      {context.current?.controller.canSend(m!.id) &&
                        selected.result.run.state === 0 && (
                          <button
                            disabled={working || !!unknown || !fresh}
                            onClick={() => void perform(send)}
                          >
                            {t(
                              "确认发送原命令到 Host",
                              "Confirm delivery of original command",
                            )}
                          </button>
                        )}
                      {!context.current?.controller.canSend(m!.id) &&
                        selected.result.run.state === 0 && (
                          <p>
                            {t(
                              "查询原执行；重新打开不会自动发送或重发。",
                              "Query the original Run. Reopening never sends or resends it.",
                            )}
                          </p>
                        )}
                      {canOperate &&
                        [0, 1, 4].includes(selected.result.run.state) &&
                        !selected.result.run.stop_requested && (
                          <button
                            className="secondary"
                            disabled={working || !!unknown}
                            onClick={() =>
                              void perform(() =>
                                prepare({ kind: "stop", messageId: m!.id }),
                              )
                            }
                          >
                            {t(
                              "停止此原 Run，先预览费用",
                              "Stop this original Run · review fee",
                            )}
                          </button>
                        )}
                    </>
                  ) : (
                    <>
                      <p>
                        {t(
                          "消息已保存，尚未创建执行 Run",
                          "Message saved; no execution Run created",
                        )}
                      </p>
                      {selected.reasons.length > 0 && (
                        <ul>
                          {selected.reasons.map((reason) => (
                            <li key={reason}>{t(...reasonLabels[reason])}</li>
                          ))}
                        </ul>
                      )}
                      {selected.approval && (
                        <p>
                          {t(
                            approvalLabels[selected.approval.state][0],
                            approvalLabels[selected.approval.state][1],
                          )}
                        </p>
                      )}
                      {canOperate &&
                        fresh &&
                        !selected.approval &&
                        selected.reasons.length > 0 && (
                          <button
                            disabled={working || !!unknown}
                            onClick={() =>
                              void perform(() =>
                                prepare({ kind: "approval", messageId: m!.id }),
                              )
                            }
                          >
                            {t(
                              "申请本次审批，先预览费用",
                              "Request one-off approval · review fee",
                            )}
                          </button>
                        )}
                      {canApprove &&
                        fresh &&
                        selected.approval?.state === 0 && (
                          <div className="button-row">
                            <button
                              disabled={working || !!unknown}
                              onClick={() =>
                                void perform(() =>
                                  prepare({
                                    kind: "decision",
                                    messageId: m!.id,
                                    approve: true,
                                  }),
                                )
                              }
                            >
                              {t(
                                "仅批准此消息，先预览费用",
                                "Approve only this message · review fee",
                              )}
                            </button>
                            <button
                              className="secondary"
                              disabled={working || !!unknown}
                              onClick={() =>
                                void perform(() =>
                                  prepare({
                                    kind: "decision",
                                    messageId: m!.id,
                                    approve: false,
                                  }),
                                )
                              }
                            >
                              {t(
                                "拒绝此消息，先预览费用",
                                "Reject this message · review fee",
                              )}
                            </button>
                          </div>
                        )}
                      {canOperate &&
                        fresh &&
                        (selected.approval
                          ? selected.approval.state === 1
                          : selected.reasons.length === 0) && (
                          <button
                            disabled={working || !!unknown}
                            onClick={() =>
                              void perform(() =>
                                prepare(
                                  capabilityId
                                    ? {
                                        kind: "run",
                                        messageId: m!.id,
                                        capabilityId,
                                      }
                                    : { kind: "capability", messageId: m!.id },
                                ),
                              )
                            }
                          >
                            {capabilityId
                              ? t(
                                  "准备此消息的原执行费用",
                                  "Prepare the original execution fee",
                                )
                              : t(
                                  "准备执行权限费用",
                                  "Prepare execution authority fee",
                                )}
                          </button>
                        )}
                    </>
                  )}
                  {relay && (
                    <p role="status">
                      {relay === "accepted"
                        ? t(
                            "Host 返回投递回执，请查询原 Run 确认结果。",
                            "Host returned a delivery receipt. Query the original Run for its result.",
                          )
                        : relay === "unknown"
                          ? t(
                              "投递结果未知，只查询原 Run，不重发。",
                              "Delivery outcome unknown. Query the original Run; do not resend.",
                            )
                          : t(
                              "Host 拒绝此次投递，请查看原 Run 与权限。",
                              "Host rejected delivery. Review the original Run and authority.",
                            )}
                    </p>
                  )}
                </article>
              )}
              <section className="panel">
                <h3>{t("新消息", "New message")}</h3>
                <fieldset
                  disabled={working || !current || !canOperate || !!unknown}
                >
                  <label>
                    {t("请求类型", "Request type")}
                    <select
                      value={action}
                      onChange={(e) => {
                        const next = e.target.value as typeof action;
                        setAction(next);
                        setRequestRoots(
                          description.policy?.paths[next]?.join(", ") ?? "docs",
                        );
                      }}
                    >
                      <option value="status">
                        {t(
                          "查询实例状态（0 工具）",
                          "Instance status (zero tools)",
                        )}
                      </option>
                      <option value="file.read">
                        {t("读取文件", "Read a file")}
                      </option>
                      <option value="file.write">
                        {t("生成或修改文件", "Create or edit a file")}
                      </option>
                      <option value="ask">
                        {t(
                          "模型问答（Host 需配置模型，0 工具）",
                          "Model question (Host model required, zero tools)",
                        )}
                      </option>
                    </select>
                  </label>
                  <label>
                    {t("发送给 Agent 的说明", "Message to the Agent")}
                    <textarea
                      maxLength={4096}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                    />
                  </label>
                  {action === "ask" && (
                    <p className="muted">
                      {t(
                        "问题文字会发送给这台 Host 配置的模型。不会自动读取文件，回复和计划需你审阅；模型费用由该模型账号支付，另于链上 Gas。",
                        "Your question goes to this Host's configured model. No files are read automatically. Review replies and plans; model billing uses that model account and is separate from chain Gas.",
                      )}
                    </p>
                  )}
                  {action !== "status" && action !== "ask" && (
                    <>
                      <label>
                        {t(
                          "本次请求的目录边界，逗号分隔",
                          "Directories for this request, comma separated",
                        )}
                        <input
                          value={requestRoots}
                          onChange={(e) => setRequestRoots(e.target.value)}
                        />
                      </label>
                      <p className="muted">
                        {t(
                          "超出常驻动作、目录或额度时，只申请本次审批；不修改常驻权限。",
                          "Requests outside standing actions, directories or allowance need one-off approval; standing authority stays unchanged.",
                        )}
                      </p>
                      <label>
                        {t(
                          "工作区内相对路径",
                          "Relative path in the workspace",
                        )}
                        <input
                          value={path}
                          onChange={(e) => setPath(e.target.value)}
                        />
                      </label>
                      <label>
                        {t("本消息工具调用上限", "Tool limit for this message")}
                        <input
                          type="number"
                          min="1"
                          max="1000"
                          value={calls}
                          onChange={(e) => setCalls(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                  {action === "file.write" && (
                    <label>
                      {t("期望文件内容", "Expected file content")}
                      <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                      />
                    </label>
                  )}
                  <button
                    onClick={() =>
                      void perform(() => prepare(messageOperation()))
                    }
                  >
                    {t(
                      "保存加密消息，先预览费用",
                      "Save encrypted message · review fee",
                    )}
                  </button>
                </fieldset>
                {!canOperate && (
                  <p>
                    {t(
                      "此设备仅可读取；发送与执行需要 operate 权限。",
                      "This device can only read. Sending and execution require operate authority.",
                    )}
                  </p>
                )}
              </section>
            </section>
          </div>
        )}
        {fee && (
          <section className="notice">
            <h3>{t(...opLabels[fee.operation.kind])}</h3>
            {fee.operation.kind === "permission" && (
              <pre>{JSON.stringify(fee.operation.policy, null, 2)}</pre>
            )}
            {fee.operation.kind === "message" && (
              <>
                <p className="direct-message-text">
                  {fee.operation.request.message}
                </p>
                <pre>{fee.operation.request.task ?? "—"}</pre>
                <pre>
                  {JSON.stringify(fee.operation.request.bounds, null, 2)}
                </pre>
              </>
            )}
            {fee.operation.kind === "decision" && (
              <p>
                {fee.operation.approve
                  ? t(
                      "只批准原消息的操作与额度；不扩大常驻权限，也不立即执行。",
                      "Approve only this original message and allowance. Standing authority stays unchanged; execution is separate.",
                    )
                  : t(
                      "明确拒绝本次消息操作。",
                      "Explicitly reject this message's operation.",
                    )}
              </p>
            )}
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
              {t("报价有效至", "Quote expires")}:{" "}
              {new Date(fee.quote.expiresAtMs).toLocaleTimeString()}
            </p>
            <button
              disabled={busy || now >= fee.quote.expiresAtMs}
              onClick={() => void perform(submit)}
            >
              {t(
                "确认此操作与费用，签名提交",
                "Confirm operation & fee, sign and submit",
              )}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setFee(null)}
            >
              {t("取消报价", "Cancel quote")}
            </button>
          </section>
        )}
        {receipt && (
          <section>
            <p>
              {receipt.status === "confirmed"
                ? t(
                    "原交易已确认；执行状态请查看原 Run。",
                    "Original transaction confirmed. Read the original Run for execution state.",
                  )
                : receipt.status === "failed"
                  ? t(
                      "原交易明确失败；未自动创建新尝试。",
                      "Original transaction failed. No new attempt was created automatically.",
                    )
                  : t(
                      "原交易结果未知，查询原摘要。",
                      "Original transaction outcome unknown. Query the original digest.",
                    )}
            </p>
            <details>
              <summary>
                {t("原交易详情", "Original transaction details")}
              </summary>
              <code className="long-id">{receipt.digest}</code>
              {receipt.actualGas && (
                <p>
                  {t("实际费用", "Actual fee")}: {sui(receipt.actualGas)}
                </p>
              )}
            </details>
          </section>
        )}
      </dialog>
      {draftSource && (
        <CreateOkr
          key={draftSource.messageId}
          profile={profile}
          organizationId={organizationId}
          source={draftSource}
          initialDeviceProfile={deviceProfile}
          sourceExpiresAtMs={draftExpiresAtMs}
          t={t}
          onCreated={onChanged}
          onClosed={() => setDraftSource(null)}
        />
      )}
    </>
  );
}
