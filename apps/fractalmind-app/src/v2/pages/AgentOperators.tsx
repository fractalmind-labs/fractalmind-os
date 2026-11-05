// The human-facing side of the Agent CLI pairing flow.  Agent authority is
// always reconstructed from localnet; this component stores only transient UI
// choices and quote state.
import { useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SelfPayFeeQuote, SelfPayTransactionOutcome } from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "../../chain";
import { NativeDeviceSigner } from "../../native-device";
import { AgentOperatorFlow, AgentOperatorFlowError, type AgentOperatorOperation } from "../../agent-operator-flow";
import {
  AGENT_OPERATOR_EXPIRY_CHOICES,
  allowedActionLabel,
  defaultAgentFundingMist,
  isNearExpiry,
  operatorActions,
} from "../../agent-operators";
import { type AgentOperatorDirectory, type AgentOperatorRow } from "../../agent-operator-chain";
import { useApp } from "../store";
import { Btn, Dialog, Icon, dateTime, shortId, sui, until, useLang, useT } from "../ui";
import { useAgentOperatorDirectory } from "../agent-operator-directory";

function actionText(actions: readonly number[], t: (zh: string, en: string) => string) {
  const kind = allowedActionLabel([...actions]);
  return kind === "read" ? t("只读", "Read-only") : kind === "read_operate" ? t("只读 · 推进", "Read + operate") : t("权限数据无效", "Invalid permission data");
}
function failureText(error: unknown, t: (zh: string, en: string) => string) {
  const code = error instanceof AgentOperatorFlowError ? error.code : "unavailable";
  return t(
    ({ invalid_input: "请检查填写内容。", invalid_source: "链上数据无法验证。", state_changed: "链上状态已变化，请刷新后重新操作。", unsupported_network: "此页面仅支持本地网络。", invalid_quote: "这份报价已失效，请重新获取。", unavailable: "暂时无法读取或签名，请检查本机与网络。" } as Record<string, string>)[code],
    ({ invalid_input: "Check the entered values.", invalid_source: "The on-chain data could not be verified.", state_changed: "The on-chain state changed. Refresh and try again.", unsupported_network: "This page is available on localnet only.", invalid_quote: "This quote is no longer valid. Get a new one.", unavailable: "Reading or signing is temporarily unavailable; check this device and the network." } as Record<string, string>)[code],
  );
}
function CopyAddress({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access is a convenience only; no authority is affected.
    }
  }
  return <span className="row" style={{ gap: 4 }}><code className="mono small">{shortId(value, 8)}</code><button className="btn ghost icon sm" aria-label={t("复制地址", "Copy address")} onClick={() => void copy()}><Icon name={copied ? "check" : "copy"} size="sm" /></button></span>;
}

function QuoteActions({
  quote, busy, onQuote, onSubmit, onCancel,
}: {
  quote: SelfPayFeeQuote | null;
  busy: boolean;
  onQuote: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return <div className="row wrap mt-12">
    {!quote ? <Btn kind="primary" label={t("获取费用报价", "Get fee quote")} icon="shield" disabled={busy} onClick={onQuote} /> : <>
      <span className="small muted">{t(`预计手续费：${sui(quote.estimatedGas)}`, `Estimated fee: ${sui(quote.estimatedGas)}`)}</span>
      <Btn kind="primary" label={t("签名并提交", "Sign and submit")} icon="check" disabled={busy} onClick={onSubmit} />
    </>}
    <Btn label={t("取消", "Cancel")} kind="ghost" disabled={busy} onClick={onCancel} />
  </div>;
}

function useFlow() {
  const app = useApp();
  const flow = useRef<AgentOperatorFlow | null>(null);
  return async () => {
    if (!app.profile || !app.deviceProfile || !isTauri()) throw new AgentOperatorFlowError("unsupported_network");
    if (flow.current) return flow.current;
    const signer = await NativeDeviceSigner.load((command, args) => invoke(command, args), app.deviceProfile);
    flow.current = new AgentOperatorFlow(new ChainReadSession(app.profile), signer);
    return flow.current;
  };
}

function currentDeviceAddress(app: ReturnType<typeof useApp>) {
  return app.device.session.state === "unlocked" ? app.device.session.device.address : "";
}
function suiMist(value: string) {
  const text = value.trim();
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text);
  if (!match) throw new AgentOperatorFlowError("invalid_input");
  return BigInt(match[1]) * 1_000_000_000n + BigInt((match[2] ?? "").padEnd(9, "0") || "0");
}

function RequestDialog({ request, onClose, done }: { request: AgentOperatorDirectory["pending"][number]; onClose: () => void; done: () => void }) {
  const app = useApp();
  const t = useT();
  const [operate, setOperate] = useState(false);
  const [days, setDays] = useState<7 | 30>(7);
  const [label, setLabel] = useState(request.request.device_name);
  const [fund, setFund] = useState(false);
  const [fundText, setFundText] = useState((Number(defaultAgentFundingMist(app.profile?.network ?? "localnet")) / 1e9).toString());
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null);
  const [receipt, setReceipt] = useState<SelfPayTransactionOutcome | null>(null);
  const [fundQuote, setFundQuote] = useState<SelfPayFeeQuote | null>(null);
  const [fundReceipt, setFundReceipt] = useState<SelfPayTransactionOutcome | null>(null);
  const [fundTargetGrantId, setFundTargetGrantId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const openFlow = useFlow();
  const grantId = app.identity?.grants.value?.find((grant) => grant.device === currentDeviceAddress(app) && grant.actions.includes(3))?.id ?? "";
  const approval: AgentOperatorOperation = { kind: "approve", requestId: request.request.id, grantId, operate, days, label };
  async function accepted(result: SelfPayTransactionOutcome, flow: AgentOperatorFlow) {
    setReceipt(result);
    if (result.status === "confirmed") {
      app.refresh(); done();
      if (fund) setFundTargetGrantId(await flow.approvedGrantId(result));
    }
  }
  async function quoteApproval() {
    try { setBusy(true); setError(null); const flow = await openFlow(); const result = await flow.prepare(approval); if ("status" in result) await accepted(result, flow); else setQuote(result); }
    catch (e) { setError(failureText(e, t)); } finally { setBusy(false); }
  }
  async function submitApproval() {
    if (!quote) return;
    try {
      setBusy(true); setError(null); const flow = await openFlow(); const result = await flow.submit(quote); setQuote(null); await accepted(result, flow);
    } catch (e) { setError(failureText(e, t)); } finally { setBusy(false); }
  }
  function funding() { if (!fundTargetGrantId) throw new AgentOperatorFlowError("invalid_input"); return { kind: "fund", targetGrantId: fundTargetGrantId, grantId, mist: suiMist(fundText) } satisfies AgentOperatorOperation; }
  async function quoteFunding() { try { setBusy(true); setError(null); const result = await (await openFlow()).prepare(funding()); if ("status" in result) setFundReceipt(result); else setFundQuote(result); } catch (e) { setError(failureText(e, t)); } finally { setBusy(false); } }
  async function submitFunding() { if (!fundQuote) return; try { setBusy(true); setError(null); const result = await (await openFlow()).submit(fundQuote); setFundReceipt(result); setFundQuote(null); if (result.status === "confirmed") { app.refresh(); done(); } } catch (e) { setError(failureText(e, t)); } finally { setBusy(false); } }
  const canSign = Boolean(grantId) && isTauri() && app.profile?.network === "localnet";
  const fundingStep = receipt?.status === "confirmed" && fund;
  return <Dialog title={t("批准 Agent 授权", "Approve Agent authorization")} sub={t("先在 Agent 终端核对这组配对码。", "First compare this code in the Agent terminal.")} onClose={onClose} footer={fundingStep ? <QuoteActions quote={fundQuote} busy={busy} onQuote={() => void quoteFunding()} onSubmit={() => void submitFunding()} onCancel={onClose} /> : <QuoteActions quote={quote} busy={busy} onQuote={() => void quoteApproval()} onSubmit={() => void submitApproval()} onCancel={onClose} />}>
    <div className="note info"><Icon name="shield" /><div>{t("Agent 永远不能审批、管理主机或改权限；这些仍需你在这台设备上签名。", "An Agent can never approve, manage hosts, or change permissions; you still sign those actions on this device.")}</div></div>
    <div className="operator-request-summary"><span className="strong">{request.request.device_name}</span><span className="chip outline">{request.code}</span></div>
    <label className="check"><input type="checkbox" checked disabled /> <span>{t("只读", "Read-only")}</span></label>
    <label className="check"><input type="checkbox" checked={operate} onChange={(e) => { setOperate(e.target.checked); setQuote(null); }} /> <span>{t("推进（起草 OKR、补证据、建任务、对话、暂停 Run）", "Operate (draft OKRs, add evidence, create tasks, chat, pause Runs)")}</span></label>
    <label>{t("到期时间", "Expires")}
      <select value={days} onChange={(e) => { setDays(Number(e.target.value) as 7 | 30); setQuote(null); }}><option value={7}>{t("7 天", "7 days")}</option><option value={30}>{t("30 天", "30 days")}</option></select>
    </label>
    <label>{t("授权名称", "Authorization label")}<input value={label} maxLength={128} onChange={(e) => { setLabel(e.target.value); setQuote(null); }} /></label>
    <label className="check"><input type="checkbox" checked={fund} onChange={(e) => { setFund(e.target.checked); }} /> <span>{t("同时转入手续费（授权后单独确认）", "Transfer fee funds too (confirm separately after approval)")}</span></label>
    {fund && <label>{t("金额（SUI）", "Amount (SUI)")}<input inputMode="decimal" value={fundText} onChange={(e) => setFundText(e.target.value)} /><span className="small muted">{t("这是第二笔独立交易，会显示自己的费用报价。", "This is a second, independent transaction with its own fee quote.")}</span></label>}
    {!canSign && <div className="note warn"><Icon name="lock" /><div>{t("请在已解锁的本地 FractalMind App 中批准。", "Approve from an unlocked local FractalMind App.")}</div></div>}
    {receipt && <div className={`note ${receipt.status === "confirmed" ? "ok" : "warn"}`}><Icon name={receipt.status === "confirmed" ? "check" : "help"} /><div>{receipt.status === "confirmed" ? t("授权已提交并确认。", "Authorization submitted and confirmed.") : t("提交结果仍待确认。", "The submission result is still pending confirmation.")}{fund && receipt.status === "confirmed" && <span className="operator-second-step">{fundTargetGrantId ? t("下一步：为手续费单独获取报价并确认转入。", "Next: get a separate quote and confirm the fee transfer.") : t("正在核对新授权的链上记录…", "Verifying the new authorization on-chain…")}</span>}</div></div>}
    {fundReceipt && <div className={`note ${fundReceipt.status === "confirmed" ? "ok" : "warn"}`}><Icon name={fundReceipt.status === "confirmed" ? "check" : "help"} /><div>{fundReceipt.status === "confirmed" ? t("手续费已单独转入。", "Fee funds transferred separately.") : t("转入结果仍待确认。", "The funding result is still pending confirmation.")}</div></div>}
    {error && <div className="note warn"><Icon name="help" /><div>{error}</div></div>}
  </Dialog>;
}

function OperatorDialog({
  kind, row, onClose, done,
}: { kind: "change" | "revoke"; row: AgentOperatorRow; onClose: () => void; done: () => void }) {
  const app = useApp(); const t = useT();
  const [operate, setOperate] = useState(row.grant.actions.includes(2));
  const [days, setDays] = useState<7 | 30>(7);
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const openFlow = useFlow();
  const grantId = app.identity?.grants.value?.find((grant) => grant.device === currentDeviceAddress(app) && grant.actions.includes(3))?.id ?? "";
  const operation: AgentOperatorOperation = kind === "revoke"
    ? { kind, targetGrantId: row.grant.id, grantId }
    : { kind, targetGrantId: row.grant.id, grantId, operate, days };
  async function prepare() { try { setBusy(true); setError(null); const result = await (await openFlow()).prepare(operation); if ("status" in result) { done(); onClose(); } else setQuote(result); } catch (e) { setError(failureText(e, t)); } finally { setBusy(false); } }
  async function submit() { if (!quote) return; try { setBusy(true); setError(null); const result = await (await openFlow()).submit(quote); if (result.status === "confirmed") { app.refresh(); done(); onClose(); } else setError(t("提交结果仍待确认。", "The submission result is still pending confirmation.")); } catch (e) { setError(failureText(e, t)); } finally { setBusy(false); } }
  return <Dialog title={kind === "revoke" ? t("撤销 Agent 授权", "Revoke Agent authorization") : t("调整 Agent 授权", "Adjust Agent authorization")} onClose={onClose} footer={<QuoteActions quote={quote} busy={busy} onQuote={() => void prepare()} onSubmit={() => void submit()} onCancel={onClose} />}>
    {kind === "revoke" ? <div className="note warn"><Icon name="alert" /><div>{t("撤销后它的下一次操作会被拒绝。", "After revocation, its next operation will be rejected.")}</div></div> : <>
      <label className="check"><input type="checkbox" checked disabled /> <span>{t("只读", "Read-only")}</span></label>
      <label className="check"><input type="checkbox" checked={operate} onChange={(e) => { setOperate(e.target.checked); setQuote(null); }} /> <span>{t("推进（起草 OKR、补证据、建任务、对话、暂停 Run）", "Operate (draft OKRs, add evidence, create tasks, chat, pause Runs)")}</span></label>
      <label>{t("新到期时间", "New expiry")}<select value={days} onChange={(e) => { setDays(Number(e.target.value) as 7 | 30); setQuote(null); }}><option value={7}>{t("7 天", "7 days")}</option><option value={30}>{t("30 天", "30 days")}</option></select></label>
    </>}
    {error && <div className="note warn"><Icon name="help" /><div>{error}</div></div>}
  </Dialog>;
}

function PendingCard({ request, open }: { request: AgentOperatorDirectory["pending"][number]; open: (kind: "approve" | "reject") => void }) {
  const t = useT(); const app = useApp();
  const allowed = isTauri() && app.profile?.network === "localnet" && Boolean(app.permission?.approve);
  return <article className="card operator-card">
    <div className="row between top"><div><div className="strong">{request.request.device_name}</div><div className="small muted">{request.request.platform}</div></div><span className="chip outline mono">{request.code}</span></div>
    <dl className="kv mt-12"><dt>{t("请求者", "Requester")}</dt><dd><CopyAddress value={request.request.device} /></dd><dt>{t("配对码", "Pairing code")}</dt><dd><code className="mono">{request.code}</code></dd><dt>{t("剩余时间", "Time left")}</dt><dd>{until(Number(request.request.expires_at_ms), t, Number(app.now))}</dd></dl>
    <p className="small muted mt-12">{t("核对 Agent 终端里显示的配对码一致后再批准。", "Compare the pairing code shown in the Agent terminal before approving.")}</p>
    <div className="row wrap mt-12"><Btn label={t("批准", "Approve")} icon="check" kind="primary" disabled={!allowed} why={t("需要本机的审批权限", "This device needs approval permission")} onClick={() => open("approve")} /><Btn label={t("拒绝", "Reject")} icon="x" kind="ghost" disabled={!allowed} why={t("需要本机的审批权限", "This device needs approval permission")} onClick={() => open("reject")} /></div>
  </article>;
}

function OperatorCard({ row, open }: { row: AgentOperatorRow; open: (kind: "change" | "revoke" | "fund") => void }) {
  const t = useT(); const lang = useLang(); const app = useApp();
  const allowed = isTauri() && app.profile?.network === "localnet" && Boolean(app.permission?.approve);
  return <article className="card operator-card">
    <div className="row between top"><div><div className="strong">{row.label}</div><div className="small muted"><CopyAddress value={row.grant.device} /></div></div><span className={`chip ${isNearExpiry(row.grant.expires_at_ms, app.now) ? "warn" : "outline"}`}>{isNearExpiry(row.grant.expires_at_ms, app.now) ? t("即将到期", "Expiring soon") : t("有效", "Active")}</span></div>
    <dl className="kv mt-12"><dt>{t("允许操作", "Allowed")}</dt><dd>{actionText(row.grant.actions, t)}</dd><dt>{t("到期", "Expires")}</dt><dd>{until(Number(row.grant.expires_at_ms), t, Number(app.now))}</dd><dt>{t("Agent SUI", "Agent SUI")}</dt><dd>{sui(row.balance)}</dd></dl>
    <div className="operator-activity mt-12"><div className="small strong">{t("最近链上交易", "Recent on-chain transactions")}</div>{row.activity.length ? <ul>{row.activity.map((item) => <li key={item.digest}><code>{shortId(item.digest, 8)}</code><span>{item.function}</span><span>{dateTime(item.at, lang)}</span></li>)}</ul> : <p className="small muted">{t("还没有可显示的交易。", "No transactions to show yet.")}</p>}</div>
    <div className="row wrap mt-12"><Btn label={t("续期 / 调整", "Renew / adjust")} icon="shield" disabled={!allowed} why={t("需要本机的审批权限", "This device needs approval permission")} onClick={() => open("change")} /><Btn label={t("转入手续费", "Transfer fee funds")} icon="plus" disabled={!allowed} why={t("需要本机的审批权限", "This device needs approval permission")} onClick={() => open("fund")} /><Btn label={t("撤销", "Revoke")} icon="x" kind="danger" disabled={!allowed} why={t("需要本机的审批权限", "This device needs approval permission")} onClick={() => open("revoke")} /></div>
  </article>;
}

export default function AgentOperators() {
  const app = useApp(); const t = useT();
  const { state, refresh } = useAgentOperatorDirectory();
  const [selected, setSelected] = useState<{ kind: "approve" | "reject"; request: AgentOperatorDirectory["pending"][number] } | { kind: "change" | "revoke" | "fund"; row: AgentOperatorRow } | null>(null);
  const directory = state.kind === "ready" ? state.directory : null;
  const pending = directory?.pending ?? [];
  const active = directory?.active ?? [];
  const inactive = directory?.inactive ?? [];
  return <section className="sec agent-operators" aria-label={t("Agent 操作员", "Agent operators")}>
    <div className="sec-h"><div><h2>{t("Agent 操作员", "Agent operators")}</h2><p className="small muted">{t("为 Agent CLI 授权、续期或撤销。授权始终来自链上记录。", "Authorize, renew, or revoke Agent CLI access. Authority always comes from the chain.")}</p></div><Btn label={t("刷新", "Refresh")} icon="refresh" size="sm" onClick={refresh} /></div>
    {!app.profile ? <div className="note info"><Icon name="help" /><div>{t("连接本地网络后可查看 Agent 操作员。", "Connect to localnet to view Agent operators.")}</div></div> : app.profile.network !== "localnet" ? <div className="note info"><Icon name="help" /><div>{t("此 Alpha 页面只在本地网络运行；不会在测试网或主网发起交易。", "This alpha page runs on localnet only; it will not initiate testnet or mainnet transactions.")}</div></div> : state.kind === "loading" ? <div className="note info"><Icon name="refresh" className="spin" /><div>{t("正在从链上读取 Agent 操作员…", "Reading Agent operators from the chain…")}</div></div> : state.kind === "error" ? <div className="note warn"><Icon name="help" /><div>{t("无法验证链上的 Agent 操作员记录。请刷新后重试。", "Could not verify Agent operator records on-chain. Refresh and try again.")}</div></div> : <>
      <section className="operator-section"><div className="sec-h"><h3>{t("待处理请求", "Pending requests")}</h3><span className="small muted">{pending.length}</span></div>{pending.length ? <div className="grid-2">{pending.map((request) => <PendingCard key={request.request.id} request={request} open={(kind) => setSelected({ kind, request })} />)}</div> : <p className="small muted">{t("没有待处理的 Agent 配对请求。", "No pending Agent pairing requests.")}</p>}</section>
      <section className="operator-section"><div className="sec-h"><h3>{t("当前操作员", "Active operators")}</h3><span className="small muted">{active.length}</span></div>{active.length ? <div className="grid-2">{active.map((row) => <OperatorCard key={row.grant.id} row={row} open={(kind) => setSelected({ kind, row })} />)}</div> : <p className="small muted">{t("还没有正在生效的 Agent 操作员。", "No active Agent operators yet.")}</p>}</section>
      {inactive.length > 0 && <details className="operator-inactive"><summary>{t("已撤销 / 已过期", "Revoked / expired")} <span className="small muted">{inactive.length}</span></summary><div className="grid-2 mt-12">{inactive.map((row) => <article className="card" key={row.grant.id}><div className="strong">{row.label}</div><div className="small muted">{actionText(row.grant.actions, t)} · {row.grant.revoked ? t("已撤销", "Revoked") : t("已过期", "Expired")}</div><CopyAddress value={row.grant.device} /></article>)}</div></details>}
    </>}
    {selected?.kind === "approve" && <RequestDialog request={selected.request} onClose={() => setSelected(null)} done={() => { refresh(); }} />}
    {selected?.kind === "reject" && <RejectDialog request={selected.request} onClose={() => setSelected(null)} done={() => { refresh(); }} />}
    {(selected?.kind === "change" || selected?.kind === "revoke") && <OperatorDialog kind={selected.kind} row={selected.row} onClose={() => setSelected(null)} done={() => { refresh(); }} />}
    {selected?.kind === "fund" && <FundDialog row={selected.row} onClose={() => setSelected(null)} done={() => { refresh(); }} />}
  </section>;
}

function RejectDialog({ request, onClose, done }: { request: AgentOperatorDirectory["pending"][number]; onClose: () => void; done: () => void }) {
  const app = useApp(); const t = useT(); const openFlow = useFlow();
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null); const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const grantId = app.identity?.grants.value?.find((grant) => grant.device === currentDeviceAddress(app) && grant.actions.includes(3))?.id ?? "";
  const operation: AgentOperatorOperation = { kind: "reject", requestId: request.request.id, grantId };
  async function prepare() { try { setBusy(true); setError(null); const result = await (await openFlow()).prepare(operation); if ("status" in result) { done(); onClose(); } else setQuote(result); } catch (e) { setError(failureText(e, t)); } finally { setBusy(false); } }
  async function submit() { if (!quote) return; try { setBusy(true); setError(null); const result = await (await openFlow()).submit(quote); if (result.status === "confirmed") { app.refresh(); done(); onClose(); } } catch (e) { setError(failureText(e, t)); } finally { setBusy(false); } }
  return <Dialog title={t("拒绝 Agent 配对请求", "Reject Agent pairing request")} onClose={onClose} footer={<QuoteActions quote={quote} busy={busy} onQuote={() => void prepare()} onSubmit={() => void submit()} onCancel={onClose} />}><p>{t(`拒绝「${request.request.device_name}」不会授予任何权限。`, `Rejecting “${request.request.device_name}” grants no permissions.`)}</p>{error && <div className="note warn"><Icon name="help" /><div>{error}</div></div>}</Dialog>;
}

function FundDialog({ row, onClose, done }: { row: AgentOperatorRow; onClose: () => void; done: () => void }) {
  const app = useApp(); const t = useT(); const openFlow = useFlow();
  const [amount, setAmount] = useState((Number(defaultAgentFundingMist(app.profile?.network ?? "localnet")) / 1e9).toString());
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null); const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const grantId = app.identity?.grants.value?.find((grant) => grant.device === currentDeviceAddress(app) && grant.actions.includes(3))?.id ?? "";
  function operation() { return { kind: "fund", targetGrantId: row.grant.id, grantId, mist: suiMist(amount) } satisfies AgentOperatorOperation; }
  async function prepare() { try { setBusy(true); setError(null); const result = await (await openFlow()).prepare(operation()); if ("status" in result) { done(); onClose(); } else setQuote(result); } catch (e) { setError(failureText(e, t)); } finally { setBusy(false); } }
  async function submit() { if (!quote) return; try { setBusy(true); setError(null); const result = await (await openFlow()).submit(quote); if (result.status === "confirmed") { app.refresh(); done(); onClose(); } else setError(t("转入结果仍待确认。", "The funding result is still pending confirmation.")); } catch (e) { setError(failureText(e, t)); } finally { setBusy(false); } }
  return <Dialog title={t("转入 Agent 手续费", "Transfer Agent fee funds")} sub={t("这是一笔独立转账，会显示自己的费用报价。", "This is a separate transfer with its own fee quote.")} onClose={onClose} footer={<QuoteActions quote={quote} busy={busy} onQuote={() => void prepare()} onSubmit={() => void submit()} onCancel={onClose} />}><div className="note info"><Icon name="shield" /><div>{t("只会把你填写的 SUI 转给这个 Agent；授权本身没有扩大。", "Only the SUI you enter is transferred to this Agent; its authorization does not expand.")}</div></div><p className="strong">{row.label}</p><CopyAddress value={row.grant.device} /><label>{t("金额（SUI）", "Amount (SUI)")}<input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setQuote(null); }} /></label>{error && <div className="note warn"><Icon name="help" /><div>{error}</div></div>}</Dialog>;
}
