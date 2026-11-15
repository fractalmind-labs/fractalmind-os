// Development screenshot fixture. It has no connection, signer, storage, or
// transaction capability and is only selected from App.tsx under import.meta.env.DEV.
import { useEffect } from "react";
import { Dialog, Icon, LangProvider, LogoDefs, useT } from "./ui";

function MockPage({ state }: { state: string }) {
  const t = useT();
  const active = state === "active";
  return <div className="shell">
    <aside className="sidebar mock-sidebar">
      <div className="sb-brand"><span>FractalMind</span><span className="chip outline">Alpha</span></div>
      <div className="sb-org"><span className="avatar">F</span><span className="grow"><span className="t">FractalMind 本地组织</span><span className="s">{t("组织 · 管理员 · 本地网络", "Organization · Admin · Localnet")}</span></span></div>
      <nav className="col" style={{ gap: 2 }}><a className="sb-link"><Icon name="home" />{t("工作台", "Workbench")}</a><a className="sb-link"><Icon name="target" />OKR</a><a className="sb-link"><Icon name="server" />{t("主机与算力", "Hosts & compute")}</a><a className="sb-link on"><Icon name="users" />{t("成员与 Agent", "Members & Agents")}<span className="count">1</span></a></nav>
    </aside>
    <main className="main"><div className="page">
      <div className="page-h"><div><h1>{t("成员与 Agent", "Members & Agents")}</h1><p className="muted">{t("成员、运行实例与所在主机。", "Members, running instances, and their hosts.")}</p></div></div>
      <section className="sec agent-operators"><div className="sec-h"><div><h2>{t("Agent 操作员", "Agent operators")}</h2><p className="small muted">{t("为 Agent CLI 授权、续期或撤销。授权始终来自链上记录。", "Authorize, renew, or revoke Agent CLI access. Authority always comes from the chain.")}</p></div><button className="btn sm"><Icon name="refresh" />{t("刷新", "Refresh")}</button></div>
        {!active && <section className="operator-section"><div className="sec-h"><h3>{t("待处理请求", "Pending requests")}</h3><span className="small muted">1</span></div><div className="operator-grid"><article className="card operator-card"><div className="operator-card-header"><div><div className="strong">FractalMind Agent CLI</div><div className="small muted">macos</div></div><span className="chip outline mono">482 761</span></div><dl className="kv mt-12"><dt>{t("请求者", "Requester")}</dt><dd><code className="mono small">0x7c83e1…d921</code></dd><dt>{t("配对码", "Pairing code")}</dt><dd><code className="mono">482761</code></dd><dt>{t("剩余时间", "Time left")}</dt><dd>{t("剩 12 分钟", "12 min left")}</dd></dl><p className="small muted mt-12">{t("核对 Agent 终端里显示的配对码一致后再批准。", "Compare the pairing code shown in the Agent terminal before approving.")}</p><div className="row wrap mt-12"><button className="btn primary"><Icon name="check" />{t("批准", "Approve")}</button><button className="btn ghost"><Icon name="x" />{t("拒绝", "Reject")}</button></div></article></div></section>}
        <section className="operator-section"><div className="sec-h"><h3>{t("当前操作员", "Active operators")}</h3><span className="small muted">1</span></div><div className="operator-grid"><article className="card operator-card"><div className="operator-card-header"><div><div className="strong">Research helper</div><div className="small muted mono">0x7c83e1…d921</div></div><span className="chip warn">{t("即将到期", "Expiring soon")}</span></div><dl className="kv mt-12"><dt>{t("允许操作", "Allowed")}</dt><dd>{t("只读 · 推进", "Read + operate")}</dd><dt>{t("到期", "Expires")}</dt><dd><span className="chip warn">{t("即将到期 · 剩 2 天", "Expiring soon · 2 days left")}</span></dd><dt>{t("Agent SUI", "Agent SUI")}</dt><dd>0.2000 SUI</dd></dl><div className="operator-activity mt-12"><div className="small strong">{t("最近链上交易", "Recent on-chain transactions")}</div><ul><li><a className="mono" href="#transaction-6cqT8Q">6cq…T8Q</a><span>{t("起草 OKR", "Draft OKR")}</span><span>{t("刚刚", "just now")}</span></li><li><a className="mono" href="#transaction-G3kY2a">G3k…Y2a</a><span>{t("补充证据", "Add evidence")}</span><span>{t("2 小时前", "2 h ago")}</span></li></ul></div><div className="row wrap mt-12"><button className="btn"><Icon name="shield" />{t("续期 / 调整", "Renew / adjust")}</button><button className="btn danger"><Icon name="x" />{t("撤销", "Revoke")}</button></div></article></div></section>
      </section>
    </div></main>
    {state === "approve" && <Dialog title={t("批准 Agent 授权", "Approve Agent authorization")} sub={t("先在 Agent 终端核对这组配对码。", "First compare this code in the Agent terminal.")} onClose={() => {}} footer={<><button className="btn primary"><Icon name="shield" />{t("获取费用报价", "Get fee quote")}</button><button className="btn ghost">{t("取消", "Cancel")}</button></>}><div className="note info"><Icon name="shield" /><div>{t("Agent 永远不能审批、管理主机或改权限；这些仍需你在这台设备上签名。", "An Agent can never approve, manage hosts, or change permissions; you still sign those actions on this device.")}</div></div><div className="operator-request-summary"><span className="strong">FractalMind Agent CLI</span><span className="chip outline mono">482761</span></div><label className="check"><input type="checkbox" checked readOnly /> {t("只读", "Read-only")}</label><label className="check"><input type="checkbox" /> {t("推进（起草 OKR、补证据、建任务、对话、暂停 Run）", "Operate (draft OKRs, add evidence, create tasks, chat, pause Runs)")}</label><label>{t("到期时间", "Expires")}<select defaultValue="7"><option value="7">{t("7 天", "7 days")}</option><option value="30">{t("30 天", "30 days")}</option></select></label><label>{t("授权名称", "Authorization label")}<input defaultValue="FractalMind Agent CLI" /></label><label className="check"><input type="checkbox" /> {t("同时转入手续费（授权后单独确认）", "Transfer fee funds too (confirm separately after approval)")}</label></Dialog>}
    {state === "revoke" && <Dialog title={t("撤销 Agent 授权", "Revoke Agent authorization")} onClose={() => {}} footer={<><button className="btn danger"><Icon name="x" />{t("获取费用报价", "Get fee quote")}</button><button className="btn ghost">{t("取消", "Cancel")}</button></>}><div className="note warn"><Icon name="alert" /><div>{t("撤销后它的下一次操作会被拒绝。", "After revocation, its next operation will be rejected.")}</div></div><p>{t("Research helper 将立即失去当前组织的授权。", "Research helper will immediately lose authorization for this organization.")}</p></Dialog>}
  </div>;
}

export function AgentOperatorMock() {
  const query = new URLSearchParams(location.search);
  const language = query.get("lang") === "en" ? "en" : "zh";
  const theme = query.get("theme") === "dark" ? "dark" : "light";
  const state = query.get("state") ?? "pending";
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.lang = language === "zh" ? "zh-CN" : "en"; }, [language, theme]);
  return <LangProvider value={language}><LogoDefs /><MockPage state={state} /></LangProvider>;
}
