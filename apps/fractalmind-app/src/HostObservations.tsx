import { useEffect, useRef, useState } from "react";
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
import { coordinatorHosts, type CoordinatorHost } from "./host-observations";
import type { ConnectionProfile } from "./domain";

/** Transient observations: no business cache, auto-connect, import or execution. */
export default function HostObservations({
  profile,
  organizationId,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  t: (zh: string, en: string) => string;
}) {
  const [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile);
  const [bindings, setBindings] = useState<HostBinding[] | null>(null);
  const [bindingId, setBindingId] = useState("");
  const [rows, setRows] = useState<CoordinatorHost[] | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false),
    mounted = useRef(true);
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
      <h2>{t("运行观测", "Runtime observations")}</h2>
      <p className="muted">
        {t(
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
              const value = await new CoordinatorReadClient(
                chain,
                signer,
                usable[0].id,
                organizationId,
              ).read(bindingId);
              const parsed = coordinatorHosts(value);
              if (mounted.current) {
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
              {rows.map((row) => (
                <article className="panel" key={row.address}>
                  <span className="badge">
                    {t("入口观测", "Entry point observation")}
                  </span>
                  <h3>{row.hostname || `Host ${row.address.slice(0, 10)}`}</h3>
                  <code className="long-id">{row.address}</code>
                  <dl>
                    <dt>{t("心跳时间", "Heartbeat time")}</dt>
                    <dd>
                      {row.heartbeatMs === null
                        ? t("尚未收到心跳", "No heartbeat received")
                        : new Date(row.heartbeatMs).toLocaleString()}
                    </dd>
                    <dt>{t("心跳新鲜度", "Heartbeat freshness")}</dt>
                    <dd>
                      {row.heartbeatMs === null ||
                      row.heartbeatMs > now ||
                      now - row.heartbeatMs >= 60_000
                        ? t("未知或陈旧", "Unknown or stale")
                        : t("最近一分钟", "Within the last minute")}
                    </dd>
                    <dt>{t("系统 / CPU", "System / CPU")}</dt>
                    <dd>
                      {row.system
                        ? `${row.system.os} / ${row.system.arch} · ${row.system.cpu}`
                        : t("未知", "Unknown")}
                    </dd>
                    <dt>{t("发现的实例数", "Observed instances")}</dt>
                    <dd>{row.agentCount}</dd>
                  </dl>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
      <p className="muted">
        {t(
          "这些观测由 Coordinator 签名；Host 独立签名尚未接入，因此不能作为主机在线或执行权限的最终凭据。观测只保留在当前页面内存中。",
          "These observations are signed by the Coordinator. Independent Host signatures are not connected yet, so they do not establish Host connectivity or execution authority. Observations remain in this page's memory only.",
        )}
      </p>
    </section>
  );
}
