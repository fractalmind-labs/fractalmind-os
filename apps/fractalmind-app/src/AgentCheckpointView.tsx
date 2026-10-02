import { useEffect, useRef, useState } from "react";
import {
  AgentExecutionReadError,
  type FractalMindSDK,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadError, ChainReadSession } from "./chain";
import type { Agent, ConnectionProfile } from "./domain";

type History = Awaited<
  ReturnType<FractalMindSDK["nodeExecution"]["readAgentExecutions"]>
>;
const states: Array<[string, string]> = [
  ["排队中", "Queued"],
  ["链上记录：运行中", "Chain record: running"],
  ["已成功", "Succeeded"],
  ["已失败", "Failed"],
  ["结果未知", "Outcome unknown"],
  ["已取消", "Cancelled"],
];

/** Public chain history only. No Host claim, continuation grant, signing or
 * business cache. Parent keys this component by profile and authority revision. */
export default function AgentCheckpointView({
  profile,
  organizationId,
  managed,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  managed: Agent;
  t: (zh: string, en: string) => string;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true),
    flight = useRef(false);
  useEffect(() => {
    live.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live.current = false;
      clearInterval(timer);
    };
  }, []);
  async function read() {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError(null);
    setHistory(null);
    setReceivedAt(null);
    try {
      const session = new ChainReadSession(profile);
      await session.checkNetwork();
      const result = await session.sdk.nodeExecution.readAgentExecutions(
        organizationId,
        managed.id,
      );
      if (JSON.stringify(result.managed) !== JSON.stringify(managed))
        throw new AgentExecutionReadError("snapshot_changed");
      await session.checkNetwork();
      if (live.current) {
        setHistory(result);
        setReceivedAt(Date.now());
      }
    } catch (e) {
      if (live.current)
        setError(
          e instanceof AgentExecutionReadError || e instanceof ChainReadError
            ? e.code
            : "read_unavailable",
        );
    } finally {
      flight.current = false;
      if (live.current) setBusy(false);
    }
  }
  const stale = receivedAt !== null && now - receivedAt >= 60_000;
  return (
    <section className="agent-checkpoints" aria-busy={busy}>
      <h4>{t("接管前的执行检查", "Execution check before handover")}</h4>
      <p className="muted">
        {t(
          "核对该实例在不同权限和 OKR 下的执行与预算。链上记录不代表当前物理状态，也不会授权继续。",
          "Review this instance's executions and budgets across capabilities and OKRs. Chain records do not establish current physical state or authorize continuation.",
        )}
      </p>
      <button type="button" onClick={() => void read()} disabled={busy}>
        {busy
          ? t("核对中…", "Checking…")
          : t("检查旧执行", "Check previous executions")}
      </button>
      {error && (
        <p className="warn" role="alert">
          {error === "coverage_unavailable"
            ? t(
                "此实例缺少完整执行目录，不能将其视为没有旧任务。接管检查未通过。",
                "Complete execution coverage is unavailable. This cannot be treated as an empty history. Handover check did not pass.",
              )
            : error === "snapshot_changed"
              ? t(
                  "读取期间实例或执行发生变更，请刷新组织并重新检查。",
                  "The instance or execution changed during the read. Refresh the organization and check again.",
                )
              : t(
                  "执行来源或链连接无法核验，接管状态未知，请重新检查。",
                  "Execution provenance or chain connection could not be verified. Handover state is unknown. Check again.",
                )}
        </p>
      )}
      {history && (
        <div role="status">
          <p className={history.unsettledControl || stale ? "warn" : "muted"}>
            {stale
              ? t(
                  "检查已过期，请重新检查。",
                  "This check is stale. Check again.",
                )
              : history.unsettledControl
                ? t(
                    `接管受阻：${history.unsettledControl} 个控制执行尚未结清。`,
                    `Handover blocked: ${history.unsettledControl} control executions remain unsettled.`,
                  )
                : t(
                    "本次读取：没有未结控制执行；仍需核验 Host 物理状态、约束和你的授权。",
                    "At this read: no unsettled control executions. Host physical state, boundaries and your authorization still require verification.",
                  )}
          </p>
          <p className="muted">
            <small>
              {t("读取时间", "Read at")}:{" "}
              {new Date(receivedAt!).toLocaleTimeString()} ·{" "}
              {t("目录修订", "Directory revision")} {history.revision}
            </small>
          </p>
          {!history.executions.length ? (
            <p>
              {t(
                "完整目录中暂无执行记录。",
                "The complete directory contains no executions.",
              )}
            </p>
          ) : (
            <details>
              <summary>
                {t(
                  `查看 ${history.executions.length} 条执行记录`,
                  `View ${history.executions.length} executions`,
                )}
              </summary>
              <ul className="checkpoint-list">
                {history.executions.map(
                  ({ run, control, settled, spent, reserved }) => (
                    <li key={run.id}>
                      <strong>{t(...states[run.state])}</strong> · {run.action}{" "}
                      ·{" "}
                      {control ? t("控制", "Control") : t("只读", "Read only")}
                      <p className="long-id">
                        <small>
                          {t("执行", "Execution")}: <code>{run.id}</code>
                        </small>
                      </p>
                      <p>
                        {t("预算", "Budget")}: {t("已花费", "Spent")}{" "}
                        {spent.toString()} · {t("预留", "Reserved")}{" "}
                        {reserved.toString()} {run.budget_asset || "—"}
                      </p>
                      <small>
                        {settled
                          ? t(
                              "结果已确定，预算已结算。",
                              "Outcome known and budget settled.",
                            )
                          : control
                            ? t(
                                "排队、运行或结果未知时均阻止接管；到期不会自动释放预留预算。",
                                "Queued, running and unknown outcomes block handover. Expiry does not release the reservation.",
                              )
                            : t(
                                "只读执行仍保留在历史中，不计入未结控制数量。",
                                "Read-only execution remains in history and does not count as unsettled control.",
                              )}
                      </small>
                    </li>
                  ),
                )}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
