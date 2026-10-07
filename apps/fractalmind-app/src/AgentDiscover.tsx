import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ChainReadSession } from "./chain";
import {
  CoordinatorReadClient,
  CoordinatorReadError,
} from "./coordinator-read";
import { DeviceIdentityError } from "./device-identity";
import { NativeDeviceError, NativeDeviceSigner } from "./native-device";
import type { ConnectionProfile, Membership } from "./domain";
import type { DiscoveredInstance } from "./agent-discovery";
import type { ImportTarget } from "./AgentImportFlow";
import { definitionName, type AgentDefinition } from "./agents";
import { LocalHostNative } from "./local-host";
const AgentImportFlow = lazy(() => import("./AgentImportFlow"));

type Translate = (zh: string, en: string) => string;
type Scan = {
  hostAddress: string;
  bindingId: string;
  at: number;
  online: boolean;
  instances: DiscoveredInstance[];
  state: "complete" | "unknown" | "unavailable" | "unsupported";
};
const ERRORS: Record<string, [string, string]> = {
  host_not_connected: [
    "这台主机没有连接到它的 Coordinator：状态未知，恢复连接后重新扫描。",
    "This host is not connected to its coordinator: status unknown. Scan again after it reconnects.",
  ],
  invalid_grant: [
    "本设备没有读取这个组织的授权。",
    "This device is not authorized to read this organization.",
  ],
  locked: [
    "设备已锁定，解锁后重新扫描。",
    "The device is locked. Unlock it and scan again.",
  ],
  device_read_rejected: [
    "主机拒绝了读取，请核对设备授权。",
    "The host rejected the read. Check this device’s grant.",
  ],
  binding_changed: [
    "主机的入口已变化，请重新扫描。",
    "The host’s endpoint changed. Scan again.",
  ],
  invalid_observation: [
    "返回内容无法验证，状态未知。",
    "The response could not be verified. Status unknown.",
  ],
};

class ScanError extends Error {
  constructor(readonly code: "host_not_connected") {
    super(code);
  }
}

/** The grant this device reads the organization with (read action). */
async function readGrant(
  chain: ChainReadSession,
  device: string,
  organizationId: string,
) {
  const human = await chain.human();
  const candidates = human.grants.value?.filter(
    (g) =>
      g.device === device &&
      !g.revoked &&
      g.generation === human.human.generation &&
      g.actions.includes(1) &&
      BigInt(g.expires_at_ms) > human.clockMs &&
      (g.org_scope === null || g.org_scope === organizationId),
  );
  const scoped = candidates?.filter((g) => g.org_scope === organizationId),
    usable = scoped?.length ? scoped : candidates;
  if (usable?.length !== 1) throw new DeviceIdentityError("invalid_grant");
  return usable[0].id;
}

/** Import Agents running on a host (J11, #67): pick a host, scan, and import
 * a session as observe-only. Every scan is a device-authenticated read of the
 * host's signed observation; nothing on the host is started or changed. */
export default function AgentDiscover({
  profile,
  organizationId,
  deviceProfile,
  memberships,
  importedInstances,
  authorityRevision,
  focusSession,
  onChanged,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  deviceProfile: string | null;
  memberships: Membership[];
  importedInstances: ReadonlySet<string>;
  authorityRevision: string;
  focusSession?: string | null;
  onChanged: () => void;
  t: Translate;
}) {
  const hosts = memberships.filter((m) => !m.revoked);
  const [hostAddress, setHostAddress] = useState(hosts[0]?.host_address ?? "");
  const [localAddress, setLocalAddress] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importTarget, setImportTarget] = useState<ImportTarget | null>(null);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  // Mark (and start on) this computer when it is one of the hosts.
  useEffect(() => {
    if (!isTauri() || !deviceProfile) return;
    const native = new LocalHostNative();
    void native
      .status(deviceProfile)
      .then(async (s) => {
        if (s.configured?.organizationId !== organizationId) return;
        const keys = await native.keys(deviceProfile, profile.network);
        if (!mounted.current) return;
        setLocalAddress(keys.host_address);
        if (hosts.some((h) => h.host_address === keys.host_address))
          setHostAddress(keys.host_address);
      })
      .catch(() => {});
  }, [deviceProfile, organizationId]);
  useEffect(() => {
    setScan(null);
    setImportTarget(null);
  }, [authorityRevision]);
  const autoScanned = useRef(false);
  useEffect(() => {
    if (
      focusSession &&
      localAddress &&
      hostAddress === localAddress &&
      !autoScanned.current
    ) {
      autoScanned.current = true;
      void run();
    }
  }, [focusSession, localAddress, hostAddress]);

  async function run() {
    const host = hosts.find((h) => h.host_address === hostAddress);
    if (!host || !deviceProfile || busy) return;
    setBusy(true);
    setError(null);
    setScan(null);
    try {
      const chain = new ChainReadSession(profile);
      const signer = await NativeDeviceSigner.load(
        (c, a) => invoke(c, a),
        deviceProfile,
      );
      const grantId = await readGrant(
        chain,
        signer.device.address,
        organizationId,
      );
      const rows = await new CoordinatorReadClient(
        chain,
        signer,
        grantId,
        organizationId,
      ).readHosts(host.coordinator_binding);
      const row = rows.find((r) => r.address === host.host_address);
      if (!row || row.state !== "verified")
        throw new ScanError("host_not_connected");
      const at = Date.now();
      const fresh = (d: typeof row.discovery) =>
        d &&
        d.state === "complete" &&
        d.freshUntilMs !== null &&
        at < d.freshUntilMs
          ? d
          : null;
      const tmux = fresh(row.discovery),
        nativeScan = fresh(row.nativeDiscovery ?? null);
      if (!mounted.current) return;
      setScan({
        hostAddress: host.host_address,
        bindingId: host.coordinator_binding,
        at,
        online: true,
        instances: [
          ...(tmux?.instances ?? []),
          ...(nativeScan?.instances ?? []),
        ].filter((i) => i.state !== "dead"),
        state:
          tmux || nativeScan
            ? "complete"
            : ((row.discovery?.state as Scan["state"]) ?? "unknown"),
      });
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof ScanError ||
            e instanceof CoordinatorReadError ||
            e instanceof NativeDeviceError ||
            e instanceof DeviceIdentityError
            ? e.code
            : "read_unavailable",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const stale = scan !== null && now - scan.at > 5 * 60_000;
  const ago = (ms: number) => {
    const s = Math.max(0, Math.round((now - ms) / 1000));
    return s < 60
      ? t("刚刚", "just now")
      : t(`${Math.round(s / 60)} 分钟前`, `${Math.round(s / 60)} min ago`);
  };

  return (
    <div className="col agent-discover">
      {!deviceProfile && (
        <div className="note warn">
          <div>
            {t("解锁设备后才能扫描主机。", "Unlock this device to scan hosts.")}
          </div>
        </div>
      )}
      <div className="col">
        {hosts.map((h) => (
          <button
            key={h.id}
            type="button"
            className="opt"
            aria-pressed={h.host_address === hostAddress}
            disabled={busy}
            onClick={() => {
              setHostAddress(h.host_address);
              setScan(null);
              setError(null);
            }}
          >
            <span className="grow">
              <span className="strong">{h.name}</span>
              {h.host_address === localAddress && (
                <>
                  {" "}
                  <span className="chip brand">
                    {t("这台电脑", "This computer")}
                  </span>
                </>
              )}
              <span className="small muted mono" style={{ display: "block" }}>
                {h.host_address.slice(0, 10)}…{h.host_address.slice(-4)}
              </span>
            </span>
            {scan?.hostAddress === h.host_address && (
              <span className="st ok">{t("在线", "Online")}</span>
            )}
          </button>
        ))}
        {!hosts.length && (
          <div className="note">
            <div>
              {t("组织里还没有主机。", "This organization has no hosts yet.")}
            </div>
          </div>
        )}
      </div>
      <button
        disabled={busy || !hostAddress || !deviceProfile}
        onClick={() => void run()}
      >
        {busy ? t("正在扫描…", "Scanning…") : t("扫描", "Scan")}
      </button>
      {error && (
        <div className="note warn" role="alert">
          <div>
            {t(
              ...(ERRORS[error] ?? [
                "扫描失败，当前状态未知，请检查连接后重试。",
                "Scan failed; status unknown. Check the connection and try again.",
              ]),
            )}
          </div>
        </div>
      )}
      {scan && (
        <>
          <div className="label">
            {t("发现的会话", "Sessions found")} · {t("观测于", "observed")}{" "}
            {ago(scan.at)}
            {stale && ` · ${t("已过时，请重新扫描", "stale; scan again")}`}
          </div>
          {scan.state !== "complete" ? (
            <div className="note warn">
              <div>
                {scan.state === "unsupported"
                  ? t(
                      "这台主机的扫描适配器尚不支持。",
                      "Discovery is not supported on this host.",
                    )
                  : t(
                      "主机没有完成扫描，状态未知。",
                      "The host did not complete a scan; status unknown.",
                    )}
              </div>
            </div>
          ) : scan.instances.length ? (
            scan.instances.map((instance) => {
              const imported = importedInstances.has(instance.instanceId);
              const focused = focusSession && instance.session === focusSession;
              return (
                <div
                  className={`card soft tight${focused ? " focus" : ""}`}
                  key={instance.instanceId || instance.pane}
                >
                  <div className="row between top">
                    <div className="grow">
                      <div className="row wrap gap-sm">
                        <strong>
                          {instance.agent
                            ? definitionName(instance.agent)
                            : instance.session}
                        </strong>
                        <span
                          className={`chip ${instance.runtime === "tmux-observe" ? "wait" : "outline"}`}
                        >
                          {instance.runtime === "tmux-observe"
                            ? t("tmux · 仅观察", "tmux · observe only")
                            : t("可接受约束", "Accepts constraints")}
                        </span>
                        <span
                          className={`chip ${instance.state === "observed" ? "ok" : "danger"}`}
                        >
                          {instance.state === "observed"
                            ? t("身份已核实", "Identity verified")
                            : t("身份未核实", "Identity unverified")}
                        </span>
                        {focused && (
                          <span className="chip brand">
                            {t("刚创建", "Just created")}
                          </span>
                        )}
                      </div>
                      <div className="tiny muted mt-4">
                        <span className="mono">{instance.session}</span> ·{" "}
                        <span className="mono">
                          {instance.workspace ||
                            t("工作区未知", "workspace unknown")}
                        </span>
                      </div>
                      {instance.agent && (
                        <Definition agent={instance.agent} t={t} />
                      )}
                    </div>
                    <div className="col" style={{ alignItems: "flex-end" }}>
                      {imported ? (
                        <span className="st ok">
                          ✓ {t("已导入", "Imported")}
                        </span>
                      ) : (
                        <button
                          className="primary sm"
                          disabled={instance.state !== "observed" || stale}
                          title={
                            instance.state !== "observed"
                              ? t(
                                  "身份未核实，不能导入",
                                  "Identity not verified; cannot import",
                                )
                              : undefined
                          }
                          onClick={() =>
                            setImportTarget({
                              selection: {
                                bindingId: scan.bindingId,
                                hostAddress: scan.hostAddress,
                                instanceId: instance.instanceId,
                                workspaceHash: instance.workspaceHash,
                              },
                              instance,
                            })
                          }
                        >
                          {t("导入为仅观察", "Import as observe-only")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="note">
              <div>
                {t(
                  "这台主机上没有发现会话。",
                  "No sessions found on this host.",
                )}
              </div>
            </div>
          )}
        </>
      )}
      <div className="note">
        <div>
          {t(
            "默认“导入为仅观察”：保留原进程、Home、定时任务与员工 Agent，不重新启动、不改写文件。同名不同主机不合并，同一实例不能重复导入。导入是一笔链上交易，确认前会显示费用。",
            "Default is “observe only”: the process, Home, schedules and employee Agents stay as they are; nothing is restarted or rewritten. Same names on different hosts are not merged; one instance imports once. Importing is one chain transaction; the fee is shown before you confirm.",
          )}
        </div>
      </div>
      <Suspense fallback={null}>
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
    </div>
  );
}

/** What the host read from the session's Home AGENTS.md. */
function Definition({ agent, t }: { agent: AgentDefinition; t: Translate }) {
  const launch = [
    agent.launcher,
    agent.profile ? `--profile ${agent.profile}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <dl className="kv mt-8 small">
      <dt>{t("定义", "Definition")}</dt>
      <dd>
        <span className="mono">{agent.home}/AGENTS.md</span>
        {agent.description && <> · {agent.description}</>}
      </dd>
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
