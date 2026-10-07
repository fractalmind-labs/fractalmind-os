import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ChainReadSession } from "./chain";
import { CoordinatorReadClient, CoordinatorReadError } from "./coordinator-read";
import { DeviceIdentityError } from "./device-identity";
import { deviceGrant } from "./device-grant";
import { NativeDeviceError, NativeDeviceSigner } from "./native-device";
import { LocalHostNative } from "./local-host";
import { definitionName } from "./agents";
import { agentName, shortId } from "./display";
import { NavIcon } from "./V2Views";
import { age, fleetRows, type BindingRead, type FleetRow, type LocalService } from "./host-fleet";
import type { ConnectionProfile, OrganizationSnapshot } from "./domain";
import type { DiscoveredInstance } from "./agent-discovery";

const LocalHostCard = lazy(() => import("./LocalHostCard"));
type Translate = (zh: string, en: string) => string;
type Access = "binding" | "invite" | "revoke-member";
const REFRESH_MS = 30_000;
const native = new LocalHostNative();

/** This computer's Host address, when it is configured for this organization.
 * Reads the cached public keys; never the keychain. */
/** This computer's Host address and service state, when it is configured
 * for this organization. Reads cached public keys and the OS service state;
 * never the keychain. Polled, since the service can stop or start. */
function useLocalHost(deviceProfile: string | null, organizationId: string, network: string) {
  const [local, setLocal] = useState<LocalService | null>(null);
  useEffect(() => {
    setLocal(null);
    if (!isTauri() || !deviceProfile) return;
    let live = true,
      address: string | null = null;
    const poll = async () => {
      const s = await native.status(deviceProfile);
      if (s.configured?.organizationId !== organizationId) return live && setLocal(null);
      address ??= (await native.keys(deviceProfile, network)).host_address;
      if (live) setLocal({ address, service: s.service, listening: s.listening });
    };
    void poll().catch(() => {});
    const timer = setInterval(() => void poll().catch(() => {}), 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [deviceProfile, organizationId, network]);
  return local;
}

/** Signed Host observations from every active coordinator, read while the
 * page is open and the device is unlocked. Observations are not cached and
 * authorize nothing. */
function useObservations(
  profile: ConnectionProfile,
  organizationId: string,
  deviceProfile: string | null,
  bindingIds: string[],
  /** Only changes that matter to these reads: bindings and memberships. */
  revision: string,
) {
  const [reads, setReads] = useState<Map<string, BindingRead>>(new Map());
  const [busy, setBusy] = useState(false);
  const flight = useRef(false),
    again = useRef(false);
  const current = useRef(revision);
  current.current = revision;
  const args = useRef({ profile, organizationId, deviceProfile, bindingIds });
  args.current = { profile, organizationId, deviceProfile, bindingIds };
  const key = bindingIds.join(",");
  async function refresh() {
    const { profile, organizationId, deviceProfile, bindingIds } = args.current;
    if (!isTauri() || !deviceProfile || !bindingIds.length) return;
    if (flight.current) {
      // Run once more when the read in flight ends.
      again.current = true;
      return;
    }
    flight.current = true;
    setBusy(true);
    const started = current.current;
    try {
      const chain = new ChainReadSession(profile);
      let client: CoordinatorReadClient | null = null,
        failure: string | null = null;
      try {
        const signer = await NativeDeviceSigner.load((c, a) => invoke(c, a), deviceProfile);
        const grantId = await deviceGrant(chain, signer.device.address, organizationId, [1]);
        client = new CoordinatorReadClient(chain, signer, grantId, organizationId);
      } catch (e) {
        failure =
          e instanceof NativeDeviceError || e instanceof DeviceIdentityError ? e.code : "read_unavailable";
      }
      const entries = await Promise.all(
        bindingIds.map(async (id): Promise<[string, BindingRead]> => {
          if (!client) return [id, { state: "failed", at: Date.now(), error: failure! }];
          try {
            const rows = await client.readHosts(id);
            return [id, { state: "ok", at: Date.now(), rows }];
          } catch (e) {
            return [id, { state: "failed", at: Date.now(), error: e instanceof CoordinatorReadError ? e.code : "read_unavailable" }];
          }
        }),
      );
      // A binding or membership changed mid-read: read again instead.
      if (started === current.current)
        setReads((prev) => {
          const next = new Map(prev);
          // A failed read keeps the last good one visible; its time shows its age.
          for (const [id, r] of entries) if (r.state === "ok" || prev.get(id)?.state !== "ok") next.set(id, r);
          else next.set(id, { ...(prev.get(id) as Extract<BindingRead, { state: "ok" }>), lastError: { at: r.at, error: r.error } });
          return next;
        });
      else again.current = true;
    } finally {
      flight.current = false;
      setBusy(false);
      if (again.current) {
        again.current = false;
        void refresh();
      }
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [deviceProfile, key, revision, organizationId]);
  return { reads, busy, refresh };
}

export default function HostsPage({
  profile,
  snapshot,
  deviceProfile,
  authorityRevision,
  detail,
  onDetail,
  onAccess,
  onDiscover,
  onOpenOkr,
  okrTitle,
  onChanged,
  t,
}: {
  profile: ConnectionProfile;
  snapshot: OrganizationSnapshot;
  deviceProfile: string | null;
  authorityRevision: string;
  detail: string | null;
  onDetail: (address: string | null) => void;
  onAccess: (kind: Access, target?: string) => void;
  onDiscover: () => void;
  onOpenOkr: (id: string) => void;
  okrTitle: (id: string) => string;
  onChanged: () => void;
  t: Translate;
}) {
  const organizationId = snapshot.organization.objectId;
  const local = useLocalHost(deviceProfile, organizationId, profile.network);
  const bindingIds = useMemo(
    () => (snapshot.bindings.value ?? []).filter((b) => !b.revoked).map((b) => b.id),
    [snapshot.bindings.value],
  );
  const readRevision = JSON.stringify([
    authorityRevision ? 1 : 0,
    (snapshot.bindings.value ?? []).map((b) => [b.id, b.version, b.revoked]),
    (snapshot.hosts.value ?? []).map((h) => [h.address, h.current.value?.id, h.current.value?.version, h.current.value?.revoked]),
  ]);
  const { reads, busy, refresh } = useObservations(profile, organizationId, deviceProfile, bindingIds, readRevision);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const clockMs = snapshot.clockMs + BigInt(Math.max(0, now - snapshot.loadedAtMs));
  const rows = fleetRows(snapshot, reads, local, now, clockMs, busy && reads.size === 0);
  const all = [...reads.values()];
  const failure = all
    .map((r) => (r.state === "failed" ? { at: r.at, error: r.error } : (r.lastError ?? null)))
    .find(Boolean);
  const lastRead = Math.max(0, ...all.filter((r) => r.state === "ok").map((r) => r.at)) || null;
  const shared = { t, now, okrTitle, onOpenOkr };
  const host = detail ? rows.find((r) => r.address === detail) : null;
  if (detail)
    return host ? (
      <HostDetail
        {...shared}
        row={host}
        profile={profile}
        organizationId={organizationId}
        deviceProfile={deviceProfile}
        importedInstances={new Set((snapshot.agents.value ?? []).filter((a) => !a.revoked).map((a) => a.instance_id))}
        onBack={() => onDetail(null)}
        onAccess={onAccess}
        onDiscover={onDiscover}
        onChanged={onChanged}
      />
    ) : (
      <>
        <button className="back" onClick={() => onDetail(null)}>
          ‹ {t("主机与算力", "Hosts & compute")}
        </button>
        <div className="card">
          <div className="empty">
            <h3>{t("该主机不在当前组织", "This host is not in the current organization")}</h3>
          </div>
        </div>
      </>
    );
  return (
    <>
      {isTauri() && (
        <Suspense fallback={null}>
          <LocalHostCard
            profile={profile}
            organizationId={organizationId}
            deviceProfile={deviceProfile}
            t={t}
            onChanged={onChanged}
            setupOnly
          />
        </Suspense>
      )}
      <HostTable
        {...shared}
        rows={rows}
        failed={snapshot.hosts.value === null}
        observing={!!deviceProfile && isTauri()}
        busy={busy}
        observationError={failure?.error ?? null}
        lastRead={lastRead}
        onRefresh={() => void refresh()}
        onOpen={onDetail}
      />
    </>
  );
}

function liveState(row: FleetRow, t: Translate) {
  if (row.membership === "revoked")
    return <span className="st danger">{t("资格已撤销", "Membership revoked")}</span>;
  if (row.membership === "expired") return <span className="st danger">{t("资格已到期", "Membership expired")}</span>;
  if (row.membership === "none") return <span className="st muted">{t("无当前资格", "No current membership")}</span>;
  if (row.live === "online")
    return (
      <span
        className="st ok"
        title={
          row.liveSource === "local"
            ? t("本机服务正在运行；签名心跳读取后更新", "This computer's service is running; updated when a signed heartbeat is read")
            : t("来自已验证的签名心跳", "From a verified signed heartbeat")
        }
      >
        <span className="dot ok pulse" />
        {t("在线", "Online")}
      </span>
    );
  if (row.live === "stopped")
    return (
      <span className="st warn" title={t("这台电脑的服务状态", "This computer's service state")}>
        <span className="dot warn" />
        {t("服务已停用", "Service stopped")}
      </span>
    );
  if (row.live === "checking")
    return (
      <span className="st info">
        <span className="dot" />
        {t("读取中…", "Checking…")}
      </span>
    );
  if (row.live === "no_heartbeat")
    return (
      <span className="st warn">
        <span className="dot warn" />
        {t("无心跳", "No heartbeat")}
      </span>
    );
  return (
    <span className="st muted">
      <span className="dot" />
      {t("未知", "Unknown")}
    </span>
  );
}
const READ_ERRORS: Record<string, [string, string]> = {
  invalid_grant: ["本设备没有读取主机状态的授权。", "This device cannot read Host status."],
  locked: ["设备已锁定，解锁后显示在线状态。", "Unlock the device to see liveness."],
  not_initialized: ["本设备的密钥未初始化。", "This device's key is not initialized."],
  device_read_rejected: ["连接入口拒绝了这次读取。", "The connection entry rejected the read."],
  binding_changed: ["连接入口刚刚变化，正在重新读取。", "The connection entry just changed; reading again."],
  invalid_challenge: ["连接入口身份或读取期限验证失败。", "The entry's identity or read window failed verification."],
  invalid_observation: ["连接入口返回的心跳无法验证。", "The entry returned a heartbeat that could not be verified."],
  read_unavailable: ["读取主机状态失败（网络或链上读取超时），稍后自动重试。", "Reading Host status failed (network or chain read timeout); retrying shortly."],
};
const displayName = (row: FleetRow) => row.name ?? `Host ${shortId(row.address)}`;
const systemLine = (row: FleetRow) => (row.system ? `${row.system.os} · ${row.system.arch}` : null);

function HostTable({
  rows,
  failed,
  observing,
  busy,
  observationError,
  lastRead,
  onRefresh,
  onOpen,
  okrTitle,
  now,
  t,
}: {
  rows: FleetRow[];
  failed: boolean;
  observing: boolean;
  busy: boolean;
  observationError: string | null;
  lastRead: number | null;
  onRefresh: () => void;
  onOpen: (address: string) => void;
  okrTitle: (id: string) => string;
  now: number;
  t: Translate;
}) {
  const [filter, setFilter] = useState<"all" | "local" | "attention">("all");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "all" || (filter === "local" ? r.local : r.attention)) &&
      (!q || `${displayName(r)} ${systemLine(r) ?? ""}`.toLowerCase().includes(q)),
  );
  const seg = (k: typeof filter, zh: string, en: string) => (
    <button aria-pressed={filter === k} onClick={() => setFilter(k)}>
      {t(zh, en)}
    </button>
  );
  const online = rows.filter((r) => r.live === "online").length;
  const attention = rows.filter((r) => r.attention).length;
  const instances = rows.reduce((n, r) => n + r.agents.length, 0);
  const okrs = (r: FleetRow) =>
    r.okrs.length ? (
      r.okrs.map((o) => (
        <span className="chip outline" key={o.okr.id} title={okrTitle(o.okr.id)}>
          P{o.okr.priority} · {okrTitle(o.okr.id).slice(0, 10)}
          {okrTitle(o.okr.id).length > 10 ? "…" : ""}
        </span>
      ))
    ) : (
      <span className="muted small">—</span>
    );
  return (
    <>
      <div className="stats">
        <div className="stat kpi">
          <span className="kpi-v">{rows.length}</span>
          <span className="kpi-l">
            {t("台主机", "hosts")}
            {rows.some((r) => r.local) ? t(" · 含本机", " · incl. this computer") : ""}
          </span>
        </div>
        <div className="stat kpi">
          <span className="kpi-v" style={{ color: online ? "var(--ok)" : undefined }}>
            {observing && rows.length ? online : "—"}
          </span>
          <span className="kpi-l">{t("在线", "online")}</span>
        </div>
        <div className="stat kpi">
          <span className="kpi-v">{instances}</span>
          <span className="kpi-l">{t("个 Agent 实例", "Agent instances")}</span>
        </div>
        <div className="stat kpi">
          <span className="kpi-v" style={{ color: attention ? "var(--warn)" : undefined }}>
            {attention}
          </span>
          <span className="kpi-l">{t("需要关注", "need attention")}</span>
        </div>
      </div>
      <div className="filters mt-16">
        <div className="seg">
          {seg("all", "全部", "All")}
          {seg("local", "本机", "This computer")}
          {seg("attention", "需要关注", "Attention")}
        </div>
        <div className="search">
          <span className="i">
            <NavIcon name="search" />
          </span>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("名称或系统", "Name or OS")}
            aria-label={t("搜索主机", "Search hosts")}
          />
        </div>
        {observing && (
          <span className="row gap-sm">
            {lastRead && (
              <span className="tiny muted">
                {t("状态读取于", "Status read")} {age(lastRead, now, t)}
              </span>
            )}
            <button className="btn sm" disabled={busy} onClick={onRefresh}>
              <NavIcon name="refresh" />
              {busy ? t("读取中…", "Reading…") : t("刷新状态", "Refresh status")}
            </button>
          </span>
        )}
      </div>
      {failed ? (
        <div className="panel warn" role="status">
          {t("主机目录读取失败，当前数据未知；刷新重新查询。", "The Host directory could not be read; refresh to query again.")}
        </div>
      ) : (
        <>
          <div className="card flush host-table">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("主机", "Host")}</th>
                  <th>{t("系统", "OS")}</th>
                  <th>{t("状态", "Status")}</th>
                  <th>{t("心跳", "Heartbeat")}</th>
                  <th>{t("资源", "Resources")}</th>
                  <th>{t("实例", "Instances")}</th>
                  <th>{t("执行中的 OKR", "Running OKRs")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    className="click"
                    key={r.address}
                    tabIndex={0}
                    onClick={() => onOpen(r.address)}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(r.address)}
                  >
                    <td>
                      <div className="host-name">
                        <span className="host-ico">
                          <NavIcon name={r.local ? "laptop" : "server"} />
                        </span>
                        <div>
                          <div className="strong">
                            {displayName(r)}{" "}
                            {r.local && <span className="chip outline">{t("本机", "This computer")}</span>}
                          </div>
                          <div className="tiny muted mono">{shortId(r.address)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="small">
                      {r.system ? (
                        <>
                          {r.system.os}
                          <div className="tiny muted">{r.system.arch}</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{liveState(r, t)}</td>
                    <td className="small">{age(r.heartbeatMs, now, t)}</td>
                    <td className="small">
                      {r.system ? t(`${r.system.cpu} 核`, `${r.system.cpu} cores`) : <span className="muted">—</span>}
                    </td>
                    <td className="small">
                      {r.agents.length}
                      <div className="tiny muted ellipsis" style={{ maxWidth: 140 }}>
                        {r.agents.map(agentName).join(", ")}
                      </div>
                    </td>
                    <td>{okrs(r)}</td>
                  </tr>
                ))}
                {!shown.length && (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">
                        <h3>{q || filter !== "all" ? t("没有匹配的主机", "No matching hosts") : t("还没有主机", "No hosts yet")}</h3>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="host-cards">
            {shown.map((r) => (
              <article className="card tight click" key={r.address} role="link" tabIndex={0} onClick={() => onOpen(r.address)}>
                <div className="row between">
                  <div className="host-name">
                    <span className="host-ico">
                      <NavIcon name={r.local ? "laptop" : "server"} />
                    </span>
                    <div>
                      <div className="strong">{displayName(r)}</div>
                      <div className="tiny muted">{systemLine(r) ?? "—"}</div>
                    </div>
                  </div>
                  {liveState(r, t)}
                </div>
                <div className="row between small mt-8">
                  <span className="muted">
                    {t("心跳", "Heartbeat")} {age(r.heartbeatMs, now, t)}
                  </span>
                  <span>
                    {t(`${r.agents.length} 个实例`, `${r.agents.length} instances`)} ·{" "}
                    {t(`${r.okrs.length} 个 OKR`, `${r.okrs.length} OKRs`)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {observationError && (
        <div className="note warn mt-16" role="status">
          <NavIcon name="alert" />
          <div>
            {t(...(READ_ERRORS[observationError] ?? READ_ERRORS.read_unavailable))}
            {lastRead && t(" 下面显示的是上次读取的结果。", " The table shows the last successful read.")}
          </div>
        </div>
      )}
      <div className="note mt-16">
        <NavIcon name="info" />
        <div>
          {!observing
            ? t(
                "在线、心跳和系统信息来自主机的签名心跳，需要在 App 中解锁设备后读取；现在只显示链上资格、Agent 与 OKR。",
                "Liveness, heartbeat and system come from signed Host heartbeats, read after unlocking the device in the App. Only chain membership, Agents and OKRs are shown now.",
              )
            : t(
                "在线和系统信息来自主机签名心跳，每 30 秒读取一次；这台电脑在读到心跳前先显示本机服务状态。读不到时显示未知。资源目前只有 CPU 核数：主机还不上报使用率。主机名称不能充当身份凭证。",
                "Liveness and system come from signed heartbeats, read every 30 s; until one is read, this computer shows its own service state. Unknown when unread. Resources show CPU cores only: Hosts do not report usage yet. Host names are not credentials.",
              )}
        </div>
      </div>
    </>
  );
}

function HostDetail({
  row,
  profile,
  organizationId,
  deviceProfile,
  importedInstances,
  onBack,
  onAccess,
  onDiscover,
  onOpenOkr,
  onChanged,
  okrTitle,
  now,
  t,
}: {
  row: FleetRow;
  profile: ConnectionProfile;
  organizationId: string;
  deviceProfile: string | null;
  importedInstances: ReadonlySet<string>;
  onBack: () => void;
  onAccess: (kind: Access, target?: string) => void;
  onDiscover: () => void;
  onOpenOkr: (id: string) => void;
  onChanged: () => void;
  okrTitle: (id: string) => string;
  now: number;
  t: Translate;
}) {
  const [tab, setTab] = useState<"overview" | "instances" | "access">("overview");
  const tabs: [typeof tab, string, string][] = [
    ["overview", "概览", "Overview"],
    ["instances", "Agent 实例", "Agent instances"],
    ["access", "资格与授权", "Access"],
  ];
  const scan = (s: DiscoveredInstance[] | undefined, d: FleetRow["observation"]) =>
    d?.state === "verified" && d.freshUntilMs !== null && now < d.freshUntilMs ? (s ?? []) : null;
  const observed = row.observation
    ? scan(
        [...(row.observation.discovery?.instances ?? []), ...(row.observation.nativeDiscovery?.instances ?? [])].filter(
          (i) => i.state !== "dead",
        ),
        row.observation,
      )
    : null;
  const date = (ms: string | number) => new Date(Number(ms)).toLocaleString();
  return (
    <>
      <button className="back" onClick={onBack}>
        ‹ {t("主机与算力", "Hosts & compute")}
      </button>
      <div className="page-h">
        <div className="row gap-lg top">
          <span className="host-ico" style={{ width: 46, height: 46, borderRadius: 13 }}>
            <NavIcon name={row.local ? "laptop" : "server"} />
          </span>
          <div>
            <div className="row wrap">
              <h1>{displayName(row)}</h1>
              {liveState(row, t)}
              {row.local && <span className="chip outline">{t("本机", "This computer")}</span>}
            </div>
            <p className="small muted">
              {[
                systemLine(row),
                `${t("心跳", "heartbeat")} ${age(row.heartbeatMs, now, t)}`,
                row.binding?.endpoint,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, zh, en]) => (
          <button className="tab" role="tab" key={k} aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(zh, en)}
          </button>
        ))}
      </div>
      {tab === "overview" && (
        <>
          <div className="grid-2">
            <section className="card">
              <div className="card-h">
                <h2>{t("系统", "System")}</h2>
                <span className="small muted">
                  {t("心跳", "Heartbeat")} {age(row.heartbeatMs, now, t)}
                </span>
              </div>
              {row.system ? (
                <dl className="kv">
                  <dt>{t("系统", "OS")}</dt>
                  <dd>
                    {row.system.os} · {row.system.arch}
                  </dd>
                  <dt>CPU</dt>
                  <dd>{t(`${row.system.cpu} 核`, `${row.system.cpu} cores`)}</dd>
                  <dt>{t("上报主机名", "Reported hostname")}</dt>
                  <dd className="mono small">{row.observation?.observation?.hostname || "—"}</dd>
                </dl>
              ) : (
                <div className="note">
                  <NavIcon name="info" />
                  <div>
                    {t(
                      "还没有读到这台主机的签名心跳，系统信息未知。",
                      "No signed heartbeat has been read for this Host; system information is unknown.",
                    )}
                  </div>
                </div>
              )}
              <p className="tiny muted mt-12">
                {t(
                  "使用率（CPU/内存）主机尚未上报。",
                  "Hosts do not report CPU/memory usage yet.",
                )}
              </p>
            </section>
            <section className="card">
              <div className="card-h">
                <h2>{t("执行中的 OKR", "Running OKRs")}</h2>
              </div>
              {row.okrs.length ? (
                row.okrs.map((o) => (
                  <button className="item click" key={o.okr.id} onClick={() => onOpenOkr(o.okr.id)}>
                    <span className="prio">P{o.okr.priority}</span>
                    <span className="grow ellipsis">{okrTitle(o.okr.id)}</span>
                  </button>
                ))
              ) : (
                <div className="muted small">{t("当前没有分配到此主机的 OKR", "No OKRs assigned to this host")}</div>
              )}
            </section>
          </div>
          {row.local && isTauri() && (
            <Suspense fallback={null}>
              <div className="mt-16">
                <LocalHostCard
                  profile={profile}
                  organizationId={organizationId}
                  deviceProfile={deviceProfile}
                  t={t}
                  onChanged={onChanged}
                />
              </div>
            </Suspense>
          )}
        </>
      )}
      {tab === "instances" && (
        <section className="card">
          <div className="card-h">
            <h2>{t("Agent 实例", "Agent instances")}</h2>
            <button className="btn sm" onClick={onDiscover}>
              <NavIcon name="globe" />
              {t("发现已有 Agent", "Discover Agents")}
            </button>
          </div>
          {row.agents.length ? (
            row.agents.map((a) => {
              const seen = observed?.find((i) => i.instanceId === a.instance_id);
              return (
                <div className="item top" key={a.id}>
                  <span className="host-ico">
                    <NavIcon name="users" />
                  </span>
                  <div className="grow">
                    <div className="row wrap gap-sm">
                      <strong>{seen?.agent ? definitionName(seen.agent) : agentName(a)}</strong>
                      <span className={`chip ${a.control_confirmed ? "ok" : "wait"}`}>
                        {a.control_confirmed
                          ? a.runtime === "agent-manager-v1"
                            ? t("可接 OKR · agent-manager", "Takes OKRs · agent-manager")
                            : t("可控", "Controllable")
                          : t("仅观察", "Observe only")}
                      </span>
                    </div>
                    <div className="tiny muted mt-4">
                      {a.runtime} · {t("导入于", "imported")} {date(a.imported_at_ms)}
                      {seen && (
                        <>
                          {" "}
                          · <span className="mono">{seen.agent?.home ?? seen.workspace}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={`st ${observed ? (seen ? "ok" : "warn") : "muted"}`}>
                    {observed ? (seen ? t("运行中", "Running") : t("未观测到", "Not observed")) : t("未知", "Unknown")}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="empty">
              <p className="small">{t("此主机上还没有导入的 Agent", "No Agents imported on this host")}</p>
            </div>
          )}
          {observed && observed.some((i) => !importedInstances.has(i.instanceId)) && (
            <div className="note mt-12">
              <NavIcon name="info" />
              <div>
                {t(
                  `主机上还有 ${observed.filter((i) => !importedInstances.has(i.instanceId)).length} 个未导入的会话，可通过“发现已有 Agent”导入。`,
                  `${observed.filter((i) => !importedInstances.has(i.instanceId)).length} more sessions on this host are not imported; use Discover Agents.`,
                )}
              </div>
            </div>
          )}
        </section>
      )}
      {tab === "access" && (
        <div className="grid-2">
          <section className="card">
            <div className="card-h">
              <h2>{t("主机资格", "Host membership")}</h2>
              <span className={`chip ${row.membership === "valid" ? "ok" : "danger"}`}>
                {row.membership === "valid"
                  ? t("有效", "Active")
                  : row.membership === "revoked"
                    ? t("已撤销", "Revoked")
                    : row.membership === "expired"
                      ? t("已到期", "Expired")
                      : t("未知", "Unknown")}
              </span>
            </div>
            {row.member ? (
              <dl className="kv">
                <dt>{t("来源", "Via")}</dt>
                <dd>
                  {t("一次性邀请码", "One-time invitation")} · <span className="mono small">{shortId(row.member.source_invite)}</span>
                </dd>
                <dt>{t("加入于", "Joined")}</dt>
                <dd>{date(row.member.joined_at_ms)}</dd>
                <dt>{t("到期", "Expires")}</dt>
                <dd>{date(row.member.expires_at_ms)}</dd>
                <dt>{t("主机地址", "Host address")}</dt>
                <dd className="mono small">{shortId(row.address)}</dd>
                <dt>{t("历史记录", "History")}</dt>
                <dd>{t(`${row.history.length} 条`, `${row.history.length} records`)}</dd>
              </dl>
            ) : (
              <p className="muted small">
                {t("当前链上目录无成员记录；历史记录不授予当前权限。", "No current membership on chain. History grants no current authority.")}
              </p>
            )}
            <div className="tiny muted mt-12">
              {t(
                "资格、执行授权与连接是三件不同的事：链上入组成功不证明在线，在线也不代表仍有授权。",
                "Membership, execution grant and connection are separate facts: joining on chain proves no liveness, and being online proves no authority.",
              )}
            </div>
          </section>
          <section className="card">
            <div className="card-h">
              <h2>{t("连接入口", "Connection")}</h2>
            </div>
            <dl className="kv">
              <dt>{t("端点", "Endpoint")}</dt>
              <dd className="mono small">{row.binding?.endpoint ?? "—"}</dd>
              <dt>{t("链上绑定", "Chain binding")}</dt>
              <dd>{row.binding ? (row.binding.revoked ? t("已撤销", "Revoked") : t("有效", "Active")) : "—"}</dd>
              <dt>{t("当前连接", "Now")}</dt>
              <dd>{liveState(row, t)}</dd>
            </dl>
            <div className="card-f">
              <button className="btn sm" onClick={() => onAccess("binding")}>
                {t("管理连接", "Connections")}
              </button>
            </div>
          </section>
          <section className="card">
            <div className="card-h">
              <h2 style={{ color: "var(--danger)" }}>{t("撤销", "Revoke")}</h2>
            </div>
            <p className="small">
              {t(
                "撤销资格后，即使连接仍在，新的受保护操作也会被拒绝；已开始的操作另行确认停止。",
                "After revoking membership, new protected operations are refused even if the connection stays up; running work is stopped separately.",
              )}
              {row.local &&
                t(
                  " 本机请在概览的本机服务中撤销，会同时卸载后台服务。",
                  " For this computer, revoke from its service in Overview, which also uninstalls the background service.",
                )}
            </p>
            <div className="card-f">
              <button
                className="btn danger"
                disabled={!row.member || row.membership === "revoked"}
                onClick={() => row.member && onAccess("revoke-member", row.member.id)}
              >
                {t("撤销主机资格", "Revoke membership")}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
