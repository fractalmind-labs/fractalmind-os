import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  AgentExecutionReadError,
  type FractalMindSDK,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadError, ChainReadSession } from "./chain";
import type { Agent, ConnectionProfile, Grant } from "./domain";
import {
  NativeDeviceSigner,
  preferredDeviceProfile,
  type NativeInvoke,
} from "./native-device";
import {
  NativeExecutionResults,
  type ExecutionResult,
} from "./execution-results";
const transport: NativeInvoke = (command, args) => invoke(command, args);

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
  grants,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  managed: Agent;
  grants: Grant[] | null | undefined;
  t: (zh: string, en: string) => string;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile);
  const [grantId, setGrantId] = useState("");
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [resultError, setResultError] = useState(false);
  const [resultBusy, setResultBusy] = useState(false);
  const resultEpoch = useRef(0),
    resultFlight = useRef(false),
    resultOpened = useRef(0);
  function clearResult() {
    resultEpoch.current++;
    resultOpened.current = 0;
    setResult(null);
    setResultError(false);
  }
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") clearResult();
    };
    const timer = setInterval(() => {
      if (resultOpened.current && Date.now() - resultOpened.current >= 60000)
        clearResult();
    }, 1000);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      resultEpoch.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  async function readResult(executionId: string) {
    if (resultFlight.current || !isTauri()) return;
    resultFlight.current = true;
    clearResult();
    const epoch = resultEpoch.current;
    setResultBusy(true);
    try {
      const signer = await NativeDeviceSigner.load(transport, deviceProfile);
      const reader = new NativeExecutionResults(
        new ChainReadSession(profile),
        signer,
        grantId,
        organizationId,
        transport,
      );
      const value = await reader.read(executionId, managed.id);
      if (live.current && epoch === resultEpoch.current) {
        setResult(value);
        resultOpened.current = Date.now();
      }
    } catch {
      if (live.current && epoch === resultEpoch.current) setResultError(true);
    } finally {
      resultFlight.current = false;
      if (live.current) setResultBusy(false);
    }
  }
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
    clearResult();
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
    <section className="agent-checkpoints" aria-busy={busy || resultBusy}>
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
              {isTauri() ? (
                <div>
                  <label>
                    {t("本机设备配置名", "Local device profile")}
                    <input
                      maxLength={64}
                      disabled={resultBusy}
                      value={deviceProfile}
                      onChange={(e) => {
                        clearResult();
                        setGrantId("");
                        setDeviceProfile(e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {t("读取结果的设备授权", "Device grant for result reading")}
                    <select
                      disabled={resultBusy}
                      value={grantId}
                      onChange={(e) => {
                        clearResult();
                        setGrantId(e.target.value);
                      }}
                    >
                      <option value="">
                        {t(
                          "选择授权；读取时重新核验",
                          "Select a grant; rechecked on read",
                        )}
                      </option>
                      {(grants ?? [])
                        .filter(
                          (g) =>
                            !g.revoked &&
                            (g.org_scope === null ||
                              g.org_scope === organizationId),
                        )
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.id}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              ) : (
                <p className="muted">
                  {t(
                    "在桌面 App 中可读取链上加密结果。",
                    "Read encrypted chain results in the desktop App.",
                  )}
                </p>
              )}
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
                      {run.result_record && isTauri() && (
                        <p>
                          <button
                            type="button"
                            disabled={resultBusy || !grantId || busy}
                            onClick={() => void readResult(run.id)}
                          >
                            {t(
                              "读取原执行结果",
                              "Read original execution result",
                            )}
                          </button>
                        </p>
                      )}
                    </li>
                  ),
                )}
              </ul>
              {resultBusy && (
                <p role="status">
                  {t(
                    "正在核验并读取原执行结果…",
                    "Verifying and reading the original execution result…",
                  )}
                </p>
              )}
              {resultError && (
                <p role="alert" className="warn">
                  {t(
                    "当前授权、原记录或解密结果无法核验，请重新读取。",
                    "Current authority, original record or decrypted result could not be verified. Read again.",
                  )}
                </p>
              )}
              {result && (
                <section
                  aria-label={t("原执行结果", "Original execution result")}
                >
                  <p className="long-id">
                    <code>{result.run.id}</code>
                  </p>
                  <p className="muted">
                    {t(
                      "正文仅保留在页面内存，60 秒后或切到后台隐藏。运行结果不代表人工验收或继续授权。",
                      "The body stays in page memory and hides after 60 seconds or when backgrounded. A runtime result is not Human acceptance or authorization to continue.",
                    )}
                  </p>
                  <p className="long-id">
                    {t("结果创建交易", "Result creation transaction")}:{" "}
                    <code>
                      {result.transactionDigest ??
                        t("摘要不可读", "Digest unavailable")}
                    </code>
                  </p>
                  <p>
                    {t(...states[result.run.state])} · {result.run.action}
                  </p>
                  <pre className="record-body">
                    {JSON.stringify(
                      result.response?.result ?? result.response?.error ?? null,
                      null,
                      2,
                    )}
                  </pre>
                  <details>
                    <summary>
                      {t("查看技术详情", "View technical details")}
                    </summary>
                    <pre className="record-body">
                      {JSON.stringify(result.response, null, 2)}
                    </pre>
                  </details>
                  <button type="button" onClick={clearResult}>
                    {t("隐藏结果", "Hide result")}
                  </button>
                </section>
              )}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
