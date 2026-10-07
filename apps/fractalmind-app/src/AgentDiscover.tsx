import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  TransactionPreflightError,
  type SelfPayFeeQuote,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import {
  CoordinatorReadClient,
  CoordinatorReadError,
} from "./coordinator-read";
import { DeviceIdentityError } from "./device-identity";
import { NativeDeviceError, NativeDeviceSigner } from "./native-device";
import type { ConnectionProfile, Membership } from "./domain";
import { agentDiscovery, type DiscoveredInstance } from "./agent-discovery";
import { definitionName, type AgentDefinition } from "./agents";
import { LocalHostNative } from "./local-host";
import {
  BatchImport,
  BatchImportError,
  importable,
  importRuntime,
} from "./agent-batch-import";

type Translate = (zh: string, en: string) => string;
type Scan = {
  hostAddress: string;
  bindingId: string;
  local: boolean;
  at: number;
  instances: DiscoveredInstance[];
  state: "complete" | "unknown" | "unavailable" | "unsupported";
};
class ScanError extends Error {
  constructor(readonly code: "host_not_connected") {
    super(code);
  }
}
const ERRORS: Record<string, [string, string]> = {
  host_not_connected: [
    "这台主机没有连接到它的 Coordinator：状态未知，恢复连接后重新扫描。",
    "This host is not connected to its coordinator: status unknown. Scan again after it reconnects.",
  ],
  invalid_grant: [
    "本设备没有管理主机的授权。",
    "This device is not authorized to manage hosts.",
  ],
  locked: [
    "设备已锁定，解锁后再试。",
    "The device is locked. Unlock it and try again.",
  ],
  needs_funds: [
    "本设备余额不足以支付这笔交易。",
    "This device cannot pay for this transaction.",
  ],
  instance_gone: [
    "有 Agent 已停止或换了 Home，列表已刷新，请重新勾选。",
    "An Agent stopped or changed its Home; the list was refreshed. Tick again.",
  ],
  host_not_member: [
    "这台主机已不是组织成员。",
    "This host is no longer a member of the organization.",
  ],
  simulation_failed: [
    "链上拒绝了这次导入：可能已被导入过，或合约还没有升级。刷新后再试。",
    "The chain rejected this import: it may already be imported, or the contract is not upgraded yet. Refresh and try again.",
  ],
};
const sui = (mist: string | bigint) => {
  const n = BigInt(mist);
  const whole = n / 1_000_000_000n;
  const frac = (n % 1_000_000_000n).toString().padStart(9, "0").slice(0, 4);
  return `${whole}.${frac} SUI`;
};

async function grantFor(
  chain: ChainReadSession,
  device: string,
  organizationId: string,
  actions: number[],
) {
  const human = await chain.human();
  const candidates = human.grants.value?.filter(
    (g) =>
      g.device === device &&
      !g.revoked &&
      g.generation === human.human.generation &&
      actions.every((a) => g.actions.includes(a)) &&
      BigInt(g.expires_at_ms) > human.clockMs &&
      (g.org_scope === null || g.org_scope === organizationId),
  );
  const scoped = candidates?.filter((g) => g.org_scope === organizationId),
    usable = scoped?.length ? scoped : candidates;
  if (usable?.length !== 1) throw new DeviceIdentityError("invalid_grant");
  return usable[0].id;
}

/** Import running Agents (J11, #70): this computer is read directly and
 * listed at once; remote hosts are scanned through their coordinator. Tick
 * several and import them in one transaction, with the fee on the button. */
export default function AgentDiscover({
  profile,
  organizationId,
  deviceProfile,
  memberships,
  importedInstances,
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
  const [selected, setSelected] = useState<string[]>([]);
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const mounted = useRef(true);
  const batch = useRef<BatchImport | null>(null);
  const quoteSeq = useRef(0);
  const native = useMemo(() => new LocalHostNative(), []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const fail = (e: unknown) =>
    setError(
      e instanceof ScanError ||
        e instanceof BatchImportError ||
        e instanceof CoordinatorReadError ||
        e instanceof NativeDeviceError ||
        e instanceof DeviceIdentityError ||
        e instanceof TransactionPreflightError
        ? e.code
        : "read_unavailable",
    );

  async function readLocal(address: string): Promise<Scan> {
    const raw = await native.discover(deviceProfile!);
    const d = await agentDiscovery(
      raw.discovery,
      raw.observedAtMs,
      raw.observedAtMs + 60_000,
    );
    const host = hosts.find((h) => h.host_address === address)!;
    return {
      hostAddress: address,
      bindingId: host.coordinator_binding,
      local: true,
      at: raw.observedAtMs,
      instances: d.instances.filter((i) => i.state !== "dead"),
      state: d.state === "complete" ? "complete" : "unavailable",
    };
  }
  // This computer: find its Host address, select it and list it right away.
  useEffect(() => {
    if (!isTauri() || !deviceProfile) return;
    void (async () => {
      try {
        const s = await native.status(deviceProfile);
        if (s.configured?.organizationId !== organizationId) return;
        const keys = await native.keys(deviceProfile, profile.network);
        if (
          !mounted.current ||
          !hosts.some((h) => h.host_address === keys.host_address)
        )
          return;
        setLocalAddress(keys.host_address);
        setHostAddress(keys.host_address);
        const local = await readLocal(keys.host_address);
        if (!mounted.current) return;
        setScan(local);
        if (focusSession) {
          const focused = local.instances.find(
            (i) => i.session === focusSession && importable(i),
          );
          if (focused && !importedInstances.has(focused.instanceId))
            setSelected([focused.instanceId]);
        }
      } catch (e) {
        if (mounted.current) fail(e);
      }
    })();
  }, [deviceProfile, organizationId]);

  async function refresh() {
    const host = hosts.find((h) => h.host_address === hostAddress);
    if (!host || !deviceProfile || busy) return;
    setBusy(true);
    setError(null);
    setScan(null);
    setSelected([]);
    setDone(null);
    try {
      if (hostAddress === localAddress) {
        const local = await readLocal(hostAddress);
        if (mounted.current) setScan(local);
        return;
      }
      const chain = new ChainReadSession(profile);
      const signer = await NativeDeviceSigner.load(
        (c, a) => invoke(c, a),
        deviceProfile,
      );
      const grantId = await grantFor(
        chain,
        signer.device.address,
        organizationId,
        [1],
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
        local: false,
        at,
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
      if (mounted.current) fail(e);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function importer() {
    if (batch.current) return batch.current;
    const chain = new ChainReadSession(profile);
    const signer = await NativeDeviceSigner.load(
      (c, a) => invoke(c, a),
      deviceProfile!,
    );
    const grantId = await grantFor(
      chain,
      signer.device.address,
      organizationId,
      [1, 4],
    );
    batch.current = new BatchImport(
      chain,
      signer,
      grantId,
      organizationId,
      new IndexedDbTransactionJournal(),
      async () => {
        const local = localAddress ? await readLocal(localAddress) : null;
        return local?.instances ?? [];
      },
    );
    return batch.current;
  }
  const targets = () =>
    (scan?.instances ?? [])
      .filter((i) => selected.includes(i.instanceId))
      .map((instance) => ({
        hostAddress: scan!.hostAddress,
        bindingId: scan!.bindingId,
        instance,
        local: scan!.local,
      }));
  // Quote as soon as the selection settles, so the button shows the fee.
  useEffect(() => {
    setQuote(null);
    if (!selected.length || !scan || !deviceProfile) return;
    const seq = ++quoteSeq.current;
    const timer = setTimeout(async () => {
      setQuoting(true);
      setError(null);
      try {
        const q = await (
          await importer()
        ).quote(targets(), `agent-batch:${crypto.randomUUID()}`);
        if (mounted.current && seq === quoteSeq.current) setQuote(q);
      } catch (e) {
        if (mounted.current && seq === quoteSeq.current) fail(e);
      } finally {
        if (mounted.current && seq === quoteSeq.current) setQuoting(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [selected.join(","), scan?.at]);

  async function importSelected() {
    if (!quote || busy) return;
    setBusy(true);
    setError(null);
    try {
      let q = quote;
      // A quote lives a minute; quietly refresh it if it lapsed.
      if (q.expiresAtMs <= Date.now() + 5_000)
        q = await (
          await importer()
        ).quote(targets(), `agent-batch:${crypto.randomUUID()}`);
      const outcome = await (await importer()).submit(q);
      if (!mounted.current) return;
      if (outcome.status === "confirmed") {
        setDone(selected.length);
        setSelected([]);
        onChanged();
      } else
        setError(
          outcome.status === "failed"
            ? "simulation_failed"
            : "read_unavailable",
        );
    } catch (e) {
      if (!mounted.current) return;
      fail(e);
      if (e instanceof BatchImportError && e.code === "instance_gone")
        void refresh();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const local = hostAddress === localAddress;
  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
  return (
    <div className="col agent-discover">
      {!deviceProfile && (
        <div className="note warn">
          <div>
            {t("解锁设备后才能导入。", "Unlock this device to import.")}
          </div>
        </div>
      )}
      <div className="row gap-sm">
        <label
          className="small muted"
          htmlFor="disc-host"
          style={{ whiteSpace: "nowrap" }}
        >
          {t("主机", "Host")}
        </label>
        <select
          id="disc-host"
          className="select"
          value={hostAddress}
          disabled={busy}
          onChange={(e) => {
            setHostAddress(e.target.value);
            setScan(null);
            setSelected([]);
            setError(null);
            setDone(null);
          }}
        >
          {hosts.map((h) => (
            <option key={h.id} value={h.host_address}>
              {h.name}
              {h.host_address === localAddress
                ? t("（这台电脑）", " (this computer)")
                : ""}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !hostAddress || !deviceProfile}
          onClick={() => void refresh()}
        >
          {scan ? t("刷新", "Refresh") : t("扫描", "Scan")}
        </button>
      </div>
      {error && (
        <div className="note warn" role="alert">
          <div>
            {t(
              ...(ERRORS[error] ?? [
                "没有完成，请稍后重试。",
                "Not completed; try again shortly.",
              ]),
            )}
          </div>
        </div>
      )}
      {done !== null && (
        <div className="calm" role="status">
          <span>
            {t(`已导入 ${done} 个 Agent。`, `Imported ${done} Agent(s).`)}
          </span>
        </div>
      )}
      {scan &&
        (scan.state !== "complete" ? (
          <div className="note warn">
            <div>
              {t(
                "主机没有完成扫描，状态未知。",
                "The host did not complete a scan; status unknown.",
              )}
            </div>
          </div>
        ) : scan.instances.length ? (
          <>
            <div className="label">
              {local
                ? t("这台电脑上正在运行", "Running on this computer")
                : t("发现的会话", "Sessions found")}
            </div>
            {scan.instances.map((instance) => {
              const imported = importedInstances.has(instance.instanceId);
              const can = !imported && importable(instance);
              const { runtime } = importRuntime(instance);
              return (
                <label
                  className="card soft tight row top gap-sm"
                  key={instance.instanceId || instance.pane}
                  style={{ cursor: can ? "pointer" : "default" }}
                >
                  <input
                    type="checkbox"
                    disabled={!can || busy}
                    checked={selected.includes(instance.instanceId)}
                    onChange={(e) =>
                      toggle(instance.instanceId, e.target.checked)
                    }
                  />
                  <span className="grow">
                    <span className="row wrap gap-sm">
                      <strong>
                        {instance.agent
                          ? definitionName(instance.agent)
                          : instance.session}
                      </strong>
                      <span className="tiny muted mono">
                        {instance.session}
                      </span>
                      <span
                        className={`chip ${runtime === "agent-manager-v1" ? "ok" : "wait"}`}
                      >
                        {runtime === "agent-manager-v1"
                          ? t("可接 OKR", "Can take OKRs")
                          : runtime === "bounded-process-v1"
                            ? t("文件 Agent", "File Agent")
                            : t("仅观察", "Observe only")}
                      </span>
                      {imported && (
                        <span className="st ok">
                          ✓ {t("已导入", "Imported")}
                        </span>
                      )}
                      {!imported && instance.state !== "observed" && (
                        <span className="st danger">
                          {t("身份未核实", "Identity unverified")}
                        </span>
                      )}
                    </span>
                    <span
                      className="small muted"
                      style={{ display: "block", marginTop: 4 }}
                    >
                      {instance.agent ? (
                        <DefinitionLine agent={instance.agent} t={t} />
                      ) : (
                        <span className="mono">{instance.workspace}</span>
                      )}
                    </span>
                  </span>
                </label>
              );
            })}
            <div className="note">
              <div>
                <div className="strong">
                  {t("导入后可以接 OKR", "Imported Agents can take OKRs")}
                </div>
                <div className="small">
                  {t(
                    "FractalMind 会：投递目标（写入 Home 的 OKR.md 并通过 agent-manager 发送）、到期或手动停止、记录进度与证据（标为“Agent 声明”，由你验收）。",
                    "FractalMind will deliver the goal (OKR.md in its Home and agent-manager), stop it on deadline or request, and record progress and evidence (marked Agent claimed, for your acceptance).",
                  )}
                </div>
                <div className="small">
                  {t(
                    "不能强制：工具调用与模型花费由它自己的启动配置决定。导入不重启、不改写文件；不是 agent-manager Home 的会话只能观察。",
                    "Cannot enforce: tool use and model spending follow its own launch configuration. Importing restarts nothing and rewrites no files; sessions that are not agent-manager Homes are observe-only.",
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="note">
            <div>
              {t("这台主机上没有发现会话。", "No sessions found on this host.")}
            </div>
          </div>
        ))}
      <div className="actions">
        <button
          className="primary"
          disabled={!quote || busy || quoting}
          onClick={() => void importSelected()}
        >
          {!selected.length
            ? t("导入所选", "Import selected")
            : quoting || !quote
              ? t(
                  `导入所选（${selected.length}）· 计算费用…`,
                  `Import ${selected.length} · estimating…`,
                )
              : busy
                ? t("正在导入…", "Importing…")
                : t(
                    `导入所选（${selected.length}）· 预计 ${sui(quote.estimatedGas)}`,
                    `Import ${selected.length} · est. ${sui(quote.estimatedGas)}`,
                  )}
        </button>
      </div>
    </div>
  );
}

function DefinitionLine({
  agent,
  t,
}: {
  agent: AgentDefinition;
  t: Translate;
}) {
  const launch = [
    agent.launcher,
    agent.profile ? `--profile ${agent.profile}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <span className="mono">{agent.home}</span> ·{" "}
      <span className="mono">
        {launch || t("未声明启动方式", "launch not declared")}
      </span>
      {agent.model && <> → {agent.model}</>} ·{" "}
      {agent.heartbeat ? (
        <span className="mono">{agent.heartbeat}</span>
      ) : (
        t("心跳未启用或外部调度", "heartbeat off or external")
      )}
      {agent.schedules > 0 &&
        ` · ${t(`${agent.schedules} 个定时任务`, `${agent.schedules} schedules`)}`}{" "}
      ·{" "}
      {agent.rom ? (
        <span className="chip outline mono">
          {agent.rom.name}@{agent.rom.version}
        </span>
      ) : (
        <span className="chip wait">{t("未记录 ROM", "No ROM recorded")}</span>
      )}{" "}
      · {t(`${agent.skills} 个技能`, `${agent.skills} skills`)}
      {agent.subAgents > 0 &&
        ` · ${t(`${agent.subAgents} 个员工 Agent 留在主机`, `${agent.subAgents} employee Agents stay on the host`)}`}
    </>
  );
}
