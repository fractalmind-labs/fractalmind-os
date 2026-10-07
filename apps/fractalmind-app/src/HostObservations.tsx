import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ChainReadSession } from "./chain";
import {
  CoordinatorReadClient,
  CoordinatorReadError,
} from "./coordinator-read";
import { DeviceIdentityError } from "./device-identity";
import { hostDirectory, type HostBinding } from "./host-admission";
import {
  NativeDeviceSigner,
  NativeDeviceError,
  preferredDeviceProfile,
} from "./native-device";
import type { VerifiedHostObservation } from "./host-signatures";
import type { ConnectionProfile } from "./domain";
import type { ImportTarget } from "./AgentImportFlow";
import { definitionName, type AgentDefinition } from "./agents";
const AgentImportFlow = lazy(() => import("./AgentImportFlow"));

/** Transient observations: no business cache or automatic connection/execution.
 * Registration requires its own explicit, chain-backed confirmation flow. */
export default function HostObservations({
  profile,
  organizationId,
  authorityRevision,
  showDiscovery = false,
  onChanged = () => {},
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  authorityRevision: string;
  showDiscovery?: boolean;
  onChanged?: () => void;
  t: (zh: string, en: string) => string;
}) {
  const [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile);
  const [bindings, setBindings] = useState<HostBinding[] | null>(null);
  const [bindingId, setBindingId] = useState("");
  const [rows, setRows] = useState<VerifiedHostObservation[] | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importTarget, setImportTarget] = useState<ImportTarget | null>(null);
  const flight = useRef(false),
    mounted = useRef(true);
  const authority = useRef(authorityRevision);
  authority.current = authorityRevision;
  useEffect(() => {
    setRows(null);
    setReceivedAt(null);
    setImportTarget(null);
  }, [authorityRevision]);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  function clear() {
    setRows(null);
    setReceivedAt(null);
    setError(null);
  }
  async function run(action: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    clear();
    try {
      await action();
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof CoordinatorReadError ||
            e instanceof NativeDeviceError ||
            e instanceof DeviceIdentityError
            ? e.code
            : "read_unavailable",
        );
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const errors: Record<string, [string, string]> = {
    not_initialized: [
      "当前设备钥未初始化，请先创建身份或关联设备。",
      "This device key is not initialized. Create an identity or pair the device first.",
    ],
    native_unavailable: [
      "设备钥无法读取，请检查系统密钥库。",
      "The device key is unavailable. Check the system key store.",
    ],
    invalid_grant: [
      "找不到唯一有效的读取授权，请核对当前设备与组织。",
      "No unique current read grant is available. Check this device and organization.",
    ],
    device_read_rejected: [
      "读取被拒绝，请重新核对设备授权及组织。",
      "Read rejected. Check the device grant and organization again.",
    ],
    binding_changed: [
      "入口已变更，请重新读取链上入口。",
      "The entry point changed. Reload the on-chain entry points.",
    ],
    invalid_challenge: [
      "入口身份或读取期限验证失败，请重新读取。",
      "Entry point identity or read expiry verification failed. Read again.",
    ],
    invalid_observation: [
      "返回内容无法验证，运行状态未知。",
      "The response could not be verified. Runtime state is unknown.",
    ],
  };
  const native = isTauri();
  const stale = receivedAt !== null && now - receivedAt >= 60_000;
  return (
    <section className="panel host-observations">
      <h2>
        {showDiscovery
          ? t("发现已有 Agent", "Discover existing Agents")
          : t("运行观测", "Runtime observations")}
      </h2>
      <p className="muted">
        {showDiscovery
          ? t(
              "从组织入口读取 Host 最近的扫描，核对运行实例、工作区和连续性。扫描不会启动或改变已有任务。",
              "Read the Hosts' recent scans through an organization entry point. Review instances, workspaces and continuity. Discovery does not start or change existing tasks.",
            )
          : t(
              "读取组织入口观察到的主机与资源，查看心跳时间判断新鲜度。",
              "Read the Hosts and resources observed by an organization entry point. Check heartbeat times for freshness.",
            )}
      </p>
      {!native && (
        <p className="warn">
          {t(
            "浏览器仅支持链上目录查看；运行观测需安装 App 并使用已关联的设备钥。",
            "The browser can read the chain directory. Runtime observations require the installed App and a paired device key.",
          )}
        </p>
      )}
      <fieldset disabled={busy}>
        <label>
          {t("本机设备资料", "Local device profile")}
          <input
            value={deviceProfile}
            onChange={(e) => {
              setDeviceProfile(e.target.value);
              clear();
            }}
            autoComplete="off"
            maxLength={64}
          />
        </label>
        <div className="host-actions">
          <button
            onClick={() =>
              void run(async () => {
                setBindings(null);
                setBindingId("");
                const directory = await hostDirectory(
                  new ChainReadSession(profile),
                  organizationId,
                );
                if (!mounted.current) return;
                const active = directory.bindings.filter((b) => !b.revoked);
                setBindings(active);
                setBindingId(active[0]?.id ?? "");
              })
            }
          >
            {t("读取组织入口", "Load organization entry points")}
          </button>
        </div>
        {bindings !== null &&
          (bindings.length ? (
            <label>
              {t("组织入口", "Organization entry point")}
              <select
                value={bindingId}
                onChange={(e) => {
                  setBindingId(e.target.value);
                  clear();
                }}
              >
                {bindings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.endpoint} · {b.id.slice(0, 10)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>
              {t(
                "没有有效入口，请先在主机接入中登记 Coordinator。",
                "No active entry point. Register a Coordinator through Host onboarding first.",
              )}
            </p>
          ))}
        {bindingId && (
          <p className="long-id">
            <code>{bindingId}</code>
          </p>
        )}
        <button
          disabled={!native || !bindingId}
          onClick={() =>
            void run(async () => {
              const revision = authorityRevision;
              const signer = await NativeDeviceSigner.load(
                (command, args) => invoke(command, args),
                deviceProfile,
              );
              const chain = new ChainReadSession(profile),
                human = await chain.human();
              const candidates = human.grants.value?.filter(
                (g) =>
                  g.device === signer.device.address &&
                  !g.revoked &&
                  g.generation === human.human.generation &&
                  g.actions.includes(1) &&
                  BigInt(g.expires_at_ms) > human.clockMs &&
                  (g.org_scope === null || g.org_scope === organizationId),
              );
              const scoped = candidates?.filter(
                  (g) => g.org_scope === organizationId,
                ),
                usable = scoped?.length ? scoped : candidates;
              if (usable?.length !== 1)
                throw new DeviceIdentityError("invalid_grant");
              const parsed = await new CoordinatorReadClient(
                chain,
                signer,
                usable[0].id,
                organizationId,
              ).readHosts(bindingId);
              if (mounted.current && authority.current === revision) {
                setRows(parsed);
                setReceivedAt(Date.now());
              }
            })
          }
        >
          {busy
            ? t("正在校验并读取…", "Verifying and reading…")
            : t("验证设备并读取观测", "Verify device and read observations")}
        </button>
      </fieldset>
      {error && (
        <p className="warn" role="alert">
          {t(
            ...(errors[error] ?? [
              "读取失败，当前状态未知，请检查连接后重新读取。",
              "Read failed. Current state is unknown. Check the connection and read again.",
            ]),
          )}
        </p>
      )}
      <div aria-live="polite">
        {rows !== null && (
          <>
            <p>
              {t("已验证入口签名", "Entry point signature verified")} ·{" "}
              {stale
                ? t("旧观测，请重新读取", "Old observation; read again")
                : t("最近读取的观测", "Recently read observation")}{" "}
              · {new Date(receivedAt!).toLocaleTimeString()}
            </p>
            {!rows.length && (
              <p>
                {t(
                  "此入口没有报告连接中的主机；链上成员资格请查看下方目录。",
                  "This entry point reported no connected Hosts. See membership in the directory below.",
                )}
              </p>
            )}
            <div className="card-grid">
              {rows.map((result) => {
                const row = result.observation;
                const current =
                  result.state === "verified" &&
                  result.freshUntilMs !== null &&
                  now < result.freshUntilMs;
                const instanceCount = (
                  scan: VerifiedHostObservation["discovery"] | undefined,
                ) =>
                  current &&
                  scan?.state === "complete" &&
                  scan.freshUntilMs !== null &&
                  now < scan.freshUntilMs
                    ? scan.instances.length
                    : t("未知", "Unknown");
                return (
                  <article className="panel" key={result.address}>
                    <span className="badge">
                      {current
                        ? t("已验证 Host 签名", "Host signature verified")
                        : result.state === "expired" ||
                            result.state === "verified"
                          ? t("观测已过期", "Observation expired")
                          : t("Host 状态未知", "Host state unknown")}
                    </span>
                    <h3>
                      {(current && row?.hostname) ||
                        `Host ${result.address.slice(0, 10)}`}
                    </h3>
                    <code className="long-id">{result.address}</code>
                    <dl>
                      <dt>{t("心跳时间", "Heartbeat time")}</dt>
                      <dd>
                        {row?.heartbeatMs == null
                          ? t("无可信心跳", "No trusted heartbeat")
                          : new Date(row.heartbeatMs).toLocaleString()}
                      </dd>
                      <dt>{t("心跳新鲜度", "Heartbeat freshness")}</dt>
                      <dd>
                        {current
                          ? t(
                              "有效期内的 Host 签名观测",
                              "Host-signed observation within its validity window",
                            )
                          : t(
                              "未知或陈旧，请重新读取",
                              "Unknown or stale; read again",
                            )}
                      </dd>
                      <dt>{t("系统 / CPU", "System / CPU")}</dt>
                      <dd>
                        {current && row?.system
                          ? `${row.system.os} / ${row.system.arch} · ${row.system.cpu}`
                          : t("未知", "Unknown")}
                      </dd>
                      <dt>{t("tmux 实例数", "tmux instances")}</dt>
                      <dd>{instanceCount(result.discovery)}</dd>
                      <dt>{t("原生文件 Agent 数", "Native file instances")}</dt>
                      <dd>{instanceCount(result.nativeDiscovery)}</dd>
                    </dl>
                    {showDiscovery &&
                      [
                        { key: "tmux", discovery: result.discovery },
                        { key: "native", discovery: result.nativeDiscovery },
                      ].map(({ key, discovery }) => {
                        const fresh =
                          current &&
                          discovery?.freshUntilMs != null &&
                          now < discovery.freshUntilMs;
                        const complete =
                          fresh && discovery?.state === "complete";
                        return (
                          <section key={key}>
                            <h4>
                              {key === "native"
                                ? t("原生文件 Agent", "Native file Agents")
                                : t("tmux 实例扫描", "tmux instance scan")}
                            </h4>
                            <p>
                              {complete
                                ? t("Host 扫描已核验", "Host scan verified")
                                : fresh && discovery?.state === "unsupported"
                                  ? t(
                                      "此主机的扫描适配器尚不支持",
                                      "Discovery adapter unsupported on this Host",
                                    )
                                  : fresh && discovery?.state === "unavailable"
                                    ? t(
                                        "扫描失败，请检查 Host 后重新读取",
                                        "Scan unavailable. Check the Host and read again",
                                      )
                                    : t(
                                        "无有效扫描，实例状态未知",
                                        "No current scan. Instance state unknown",
                                      )}
                            </p>
                            {discovery?.observedAtMs != null && (
                              <p>
                                {t("扫描时间", "Scan time")} ·{" "}
                                {new Date(
                                  discovery.observedAtMs,
                                ).toLocaleString()}
                              </p>
                            )}
                            {complete && !discovery.instances.length && (
                              <p>
                                {t(
                                  "扫描完成：没有可发现的实例",
                                  "Scan complete: no discoverable instances",
                                )}
                              </p>
                            )}
                            {complete &&
                              discovery.instances.map((instance) => (
                                <article
                                  className="panel"
                                  key={instance.instanceId || instance.pane}
                                >
                                  <h4>
                                    {instance.agent
                                      ? definitionName(instance.agent)
                                      : instance.session}
                                    {instance.pane && (
                                      <small className="muted">
                                        {" "}
                                        · {instance.session} · {instance.pane}
                                      </small>
                                    )}
                                  </h4>
                                  {instance.agent && (
                                    <AgentDefinitionView
                                      agent={instance.agent}
                                      t={t}
                                    />
                                  )}
                                  <span className="badge">
                                    {instance.state === "observed"
                                      ? t(
                                          "实例连续性已观测 · 仅观察",
                                          "Instance continuity observed · observation only",
                                        )
                                      : instance.state === "dead"
                                        ? t("进程已结束", "Process ended")
                                        : t(
                                            "实例身份未核实",
                                            "Instance identity unverified",
                                          )}
                                  </span>
                                  {instance.instanceId && (
                                    <p className="long-id">
                                      <code>{instance.instanceId}</code>
                                    </p>
                                  )}
                                  <p>
                                    {t("工作区", "Workspace")}:{" "}
                                    {instance.workspace || t("未知", "Unknown")}
                                  </p>
                                  {instance.workspaceHash && (
                                    <p className="long-id">
                                      <small>
                                        {t(
                                          "工作区指纹",
                                          "Workspace fingerprint",
                                        )}
                                        : {instance.workspaceHash}
                                      </small>
                                    </p>
                                  )}
                                  <p>
                                    {t(
                                      instance.runtime === "bounded-process-v1"
                                        ? "适配器：原生文件 Agent，支持 1–3 个文件目标及有界读写。当前仅观察；执行需要交接和 ACTIVE OKR 授权。"
                                        : "适配器：tmux 仅观察；不支持约束执行或 OKR 接管。",
                                      instance.runtime === "bounded-process-v1"
                                        ? "Adapter: native file Agent, supporting 1–3 file goals and bounded read/write. Observation only; execution requires handover and ACTIVE OKR authorization."
                                        : "Adapter: tmux observation only; constrained execution and OKR handover unsupported.",
                                    )}
                                  </p>
                                  {instance.state === "observed" && (
                                    <button
                                      disabled={!native || busy}
                                      onClick={() =>
                                        setImportTarget({
                                          selection: {
                                            bindingId,
                                            hostAddress: result.address,
                                            instanceId: instance.instanceId,
                                            workspaceHash:
                                              instance.workspaceHash,
                                          },
                                          instance,
                                        })
                                      }
                                    >
                                      {t(
                                        "导入为仅观察",
                                        "Import for observation only",
                                      )}
                                    </button>
                                  )}
                                </article>
                              ))}
                          </section>
                        );
                      })}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
      {showDiscovery && (
        <Suspense fallback={<p>{t("加载导入流程…", "Loading import…")}</p>}>
          <AgentImportFlow
            profile={profile}
            organizationId={organizationId}
            authorityRevision={authorityRevision}
            target={importTarget}
            onClose={() => setImportTarget(null)}
            onChanged={onChanged}
            t={t}
          />
        </Suspense>
      )}
      <p className="muted">
        {t(
          "入口和 Host 签名分别核验，Host 资格以当前链上目录为准。签名心跳证明近期观测，不能授予执行权限或证明独立 Agent 身份。观测只保留在当前页面内存中，到期转为未知。",
          "Entry point and Host signatures are checked separately against the current chain directory. A signed heartbeat proves a recent observation; it grants no execution authority or independent Agent identity. Observations remain in this page's memory only and become unknown on expiry.",
        )}
      </p>
    </section>
  );
}

/** What the Host read from the session's Home AGENTS.md (#67). */
function AgentDefinitionView({
  agent,
  t,
}: {
  agent: AgentDefinition;
  t: (zh: string, en: string) => string;
}) {
  const launch = [
    agent.launcher,
    agent.profile ? `--profile ${agent.profile}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <dl className="kv small">
      <dt>Home</dt>
      <dd className="mono">{agent.home}</dd>
      {agent.description && (
        <>
          <dt>{t("说明", "Description")}</dt>
          <dd>{agent.description}</dd>
        </>
      )}
      <dt>{t("启动", "Launch")}</dt>
      <dd className="mono">{launch || t("未声明", "Not declared")}</dd>
      <dt>{t("模型", "Model")}</dt>
      <dd>
        {agent.model ?? t("未知", "Unknown")}{" "}
        <span className="tiny muted">
          {t("由启动配置决定", "from the launch profile")}
        </span>
      </dd>
      <dt>{t("心跳", "Heartbeat")}</dt>
      <dd>
        {agent.heartbeat ? (
          <span className="mono">{agent.heartbeat}</span>
        ) : (
          t("未启用或由外部调度", "Off or scheduled elsewhere")
        )}
        {agent.schedules > 0 &&
          ` · ${t(`${agent.schedules} 个定时任务`, `${agent.schedules} schedules`)}`}
      </dd>
      <dt>ROM</dt>
      <dd>
        {agent.rom ? (
          <span className="chip outline mono">
            {agent.rom.name}@{agent.rom.version}
          </span>
        ) : (
          <span className="chip wait">
            {t("未记录 ROM", "No ROM recorded")}
          </span>
        )}
      </dd>
      <dt>{t("技能", "Skills")}</dt>
      <dd>
        {agent.skills}
        {agent.subAgents > 0 &&
          ` · ${t(`${agent.subAgents} 个员工 Agent（不随之导入）`, `${agent.subAgents} employee Agents (not imported with it)`)}`}
      </dd>
    </dl>
  );
}
