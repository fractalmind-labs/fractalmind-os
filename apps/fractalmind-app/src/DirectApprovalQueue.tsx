import { useEffect, useRef, useState } from "react";
import { ChainReadSession } from "./chain";
import type { Agent, ConnectionProfile, OrganizationSnapshot } from "./domain";
import DirectAgentConversation from "./DirectAgentConversation";
import { actionLabel, agentName, hostName } from "./display";
import {
  directApprovalStatus,
  directApprovalNeedsAttention,
  readDirectApprovalQueue,
  type DirectApprovalQueue as Queue,
} from "./direct-approval-queue";

const labels = {
  pending: ["等待本次决定", "Awaiting one-off decision"],
  approved: ["本次已批准 · 尚未执行", "One-off approval · no Run yet"],
  rejected: ["本次已拒绝", "Rejected for this request"],
  consumed: ["批准已用于原 Run", "Approval used by the original Run"],
  superseded: [
    "权限已变化 · 原审批失效",
    "Authority changed · original approval invalid",
  ],
  expired: ["已到期 · 原审批失效", "Expired · original approval invalid"],
  reconcile: ["先核实原执行", "Reconcile the original Run"],
} as const;
const runLabels = [
  ["已准备，等待投递", "Prepared, awaiting delivery"],
  ["链上记录：运行中", "Chain record: running"],
  ["执行成功", "Execution succeeded"],
  ["执行失败", "Execution failed"],
  ["结果未知 · 不应重放", "Outcome unknown · do not replay"],
  ["已取消", "Cancelled"],
] as const;
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const date = (ms: string | number) => {
  const n = Number(ms);
  return n > 0 && n <= 8640000000000000
    ? new Date(n)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC")
    : "—";
};

export default function DirectApprovalQueue({
  profile,
  snapshot,
  now,
  reachable,
  onChanged,
  onAttention,
  t,
}: {
  profile: ConnectionProfile;
  snapshot: OrganizationSnapshot;
  now: bigint;
  reachable: boolean;
  onChanged: () => void;
  /** Requests that need the user's attention, or null while unknown. */
  onAttention?: (count: number | null) => void;
  t: (zh: string, en: string) => string;
}) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [conversation, setConversation] = useState<{
    managed: Agent;
    messageId: string;
    opening: number;
  } | null>(null);
  const opening = useRef(0);
  const epoch = useRef(0);
  const scope = JSON.stringify([
    profile,
    snapshot.organization.objectId,
    snapshot.agents,
  ]);
  const loadedScope = useRef(scope);
  useEffect(() => {
    const generation = ++epoch.current;
    if (loadedScope.current !== scope) {
      loadedScope.current = scope;
      setQueue(null);
    }
    setFailed(false);
    if (!reachable || !snapshot.agents.value) return;
    let loading = false;
    const read = async () => {
      if (loading) return;
      loading = true;
      setBusy(true);
      try {
        const result = await readDirectApprovalQueue(
          new ChainReadSession(profile),
          snapshot.organization.objectId,
          snapshot.agents.value!,
        );
        if (epoch.current === generation) {
          setQueue(result);
          setFailed(false);
        }
      } catch {
        if (epoch.current === generation) {
          setQueue(null);
          setFailed(true);
        }
      } finally {
        loading = false;
        if (epoch.current === generation) setBusy(false);
      }
    };
    void read();
    const timer = setInterval(() => {
      if (!document.hidden) void read();
    }, 30000);
    return () => {
      epoch.current++;
      clearInterval(timer);
    };
  }, [scope, reachable, refresh]);
  const unavailable = !reachable || !snapshot.agents.value || failed;
  const attention =
    queue?.rows.filter((row) => directApprovalNeedsAttention(row, now)) ?? [];
  const visibleRows = showAll ? (queue?.rows ?? []) : attention;
  const changed = () => {
    setRefresh((value) => value + 1);
    onChanged();
  };
  const reported = unavailable || !queue ? null : attention.length;
  useEffect(() => onAttention?.(reported), [reported, onAttention]);
  const hostOf = (managed: Agent) => {
    const member = snapshot.memberships.value?.find(
      (row) => row.id === managed.membership_id,
    );
    return member ? hostName(member) : short(managed.host_address);
  };
  return (
    <section
      className="direct-queue"
      aria-label={t("Agent 超出常驻权限的申请", "Agent requests beyond standing authority")}
    >
      <div className="direct-queue-bar">
        <span className="tiny muted">
          {t("Agent 超出常驻权限的单次申请", "One-off Agent requests beyond standing authority")}
          {queue &&
            ` · ${t("读取于", "read")} ${date(queue.loadedAtMs)}`}
        </span>
        <span className="row">
          {queue && queue.rows.length > 0 && (
            <span className="seg" role="group" aria-label={t("筛选", "Filter")}>
              <button aria-pressed={!showAll} onClick={() => setShowAll(false)}>
                {t("待处理", "Needs attention")} {attention.length}
              </button>
              <button aria-pressed={showAll} onClick={() => setShowAll(true)}>
                {t("全部", "All")} {queue.rows.length}
              </button>
            </span>
          )}
          <button
            className="btn ghost sm"
            disabled={busy || !reachable || !snapshot.agents.value}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {busy ? t("读取中…", "Reading…") : t("刷新", "Refresh")}
          </button>
        </span>
      </div>
      {unavailable ? (
        <div className="panel warn" role="status">
          {t(
            "审批数据未知，请恢复连接并重新查询。不能据此判断没有待审批。",
            "Approval data is unknown. Restore the connection and query again; this does not mean the queue is empty.",
          )}
        </div>
      ) : !queue ? (
        <div className="panel" role="status">
          {t("正在读取链上审批记录…", "Reading approval records from Sui…")}
        </div>
      ) : (
        <>
          {queue.unavailableAgents.length > 0 && (
            <div className="panel warn" role="status">
              {t(
                "部分实例的审批读取失败，列表不完整。刷新可重查原记录。",
                "Some instance approvals could not be read; this list is incomplete. Refresh to query the original records.",
              )}{" "}
              <ul>
                {queue.unavailableAgents.map((id) => (
                  <li key={id}>
                    <code className="long-id">{id}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="decision-grid">
            {visibleRows.map((row) => {
              const status = directApprovalStatus(row, now),
                run = row.run.value;
              return (
                <article
                  className={`panel decision-card ${["reconcile", "superseded", "expired"].includes(status) ? "blocked" : ""}`}
                  key={row.approval.id}
                >
                  <div className="d-top">
                    <span
                      className={`chip ${status === "pending" ? "warn" : ["reconcile", "superseded", "expired"].includes(status) ? "danger" : ""}`}
                    >
                      {t(labels[status][0], labels[status][1])}
                    </span>
                    <span>{hostOf(row.managed)}</span>
                  </div>
                  <h3>
                    {actionLabel(row.message.action, t)} ·{" "}
                    {t("单次申请", "One-off request")}
                  </h3>
                  <p className="tiny muted" title={row.managed.instance_id}>
                    {agentName(row.managed)}
                  </p>
                  <dl>
                    <dt>{t("来源", "Source")}</dt>
                    <dd>
                      {t("Agent 对话", "Agent conversation")} ·{" "}
                      <code title={row.message.id}>
                        {short(row.message.id)}
                      </code>
                    </dd>
                    <dt>{t("Host", "Host")}</dt>
                    <dd title={row.managed.host_address}>
                      {hostOf(row.managed)}
                    </dd>
                    <dt>{t("权限版本", "Authority version")}</dt>
                    <dd>
                      {t("申请", "Request")} v{row.message.permission_version} ·{" "}
                      {t("当前读取", "Read current")} v{row.permission.version}
                    </dd>
                    <dt>{t("工具上限", "Tool limit")}</dt>
                    <dd>
                      {row.message.budget_amount}{" "}
                      {t(
                        "次；交易费打开后预估",
                        "calls; transaction fee estimated after opening",
                      )}
                    </dd>
                    <dt>{t("范围", "Scope")}</dt>
                    <dd>
                      {t(
                        "仅限原消息的动作与目录；打开查看完整边界",
                        "Only the original message's action and directories; open to review all bounds",
                      )}
                    </dd>
                    <dt>{t("申请到期", "Request expires")}</dt>
                    <dd>{date(row.approval.expires_at_ms)}</dd>
                    <dt>{t("执行结果", "Execution result")}</dt>
                    <dd>
                      {row.run.failure
                        ? t(
                            "原 Run 暂不可读 · 不应重放",
                            "Original Run unavailable · do not replay",
                          )
                        : run
                          ? t(runLabels[run.state][0], runLabels[run.state][1])
                          : t("尚未创建 Run", "No Run created")}
                      {run?.stop_requested &&
                        ` · ${t("已请求停止", "Stop requested")}`}
                      {row.executionId && (
                        <div>
                          <code title={row.executionId}>
                            {short(row.executionId)}
                          </code>
                        </div>
                      )}
                      {run?.result_record && (
                        <div>
                          {t(
                            "加密结果已保存；打开核验",
                            "Encrypted result saved; open to verify",
                          )}
                        </div>
                      )}
                    </dd>
                  </dl>
                  <button
                    className={status === "pending" ? "primary" : "secondary"}
                    onClick={() =>
                      setConversation({
                        managed: row.managed,
                        messageId: row.message.id,
                        opening: ++opening.current,
                      })
                    }
                  >
                    {status === "pending"
                      ? t("查看请求并决定", "Review request & decide")
                      : t(
                          "查看原消息与结果",
                          "View original message & result",
                        )}
                  </button>
                  <details>
                    <summary>{t("链上来源标识", "Chain source IDs")}</summary>
                    <p>
                      {t("原消息", "Original message")}:{" "}
                      <code className="long-id">{row.message.id}</code>
                    </p>
                    <p>
                      {t("本次审批", "One-off approval")}:{" "}
                      <code className="long-id">{row.approval.id}</code>
                    </p>
                    <p>
                      {t("常驻权限", "Standing authority")}:{" "}
                      <code className="long-id">{row.permission.id}</code>
                    </p>
                    {row.executionId && (
                      <p>
                        Run: <code className="long-id">{row.executionId}</code>
                      </p>
                    )}
                  </details>
                </article>
              );
            })}
          </div>
        </>
      )}
      {conversation && (
        <DirectAgentConversation
          key={conversation.opening}
          profile={profile}
          organizationId={snapshot.organization.objectId}
          managed={
            snapshot.agents.value?.find(
              (agent) => agent.id === conversation.managed.id,
            ) ?? conversation.managed
          }
          initialMessageId={conversation.messageId}
          autoOpen
          onChanged={changed}
          t={t}
        />
      )}
    </section>
  );
}
