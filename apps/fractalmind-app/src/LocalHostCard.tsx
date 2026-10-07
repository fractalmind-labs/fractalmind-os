import { useEffect, useRef, useState } from "react";
import type { ConnectionProfile } from "./domain";
import LocalHostSetup, {
  localHostFailure,
  openAdmission,
} from "./LocalHostSetup";
import {
  LocalHostNative,
  canHostLocally,
  localMembership,
  type LocalHostStatus,
} from "./local-host";

type Translate = (zh: string, en: string) => string;
const native = new LocalHostNative();

/** Hosts & compute: this computer's Host + Coordinator service (#64). */
export default function LocalHostCard({
  profile,
  organizationId,
  deviceProfile,
  t,
  onChanged,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  deviceProfile: string | null;
  t: Translate;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<LocalHostStatus | null>(null),
    [setup, setSetup] = useState(false),
    [confirmRevoke, setConfirmRevoke] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const upgraded = useRef(false);
  async function refresh() {
    if (!deviceProfile) return;
    let s = await native.status(deviceProfile);
    // After an App update the service still runs the old envd or definition;
    // reinstall it once, keeping it stopped if the person stopped it.
    if (
      !upgraded.current &&
      s.configured?.organizationId === organizationId &&
      s.envdAvailable &&
      !s.serviceCurrent &&
      (s.service === "running" || s.service === "starting")
    ) {
      upgraded.current = true;
      await native.service(deviceProfile, "install").catch(() => {});
      s = await native.status(deviceProfile);
    }
    if (mounted.current) setStatus(s);
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => {});
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [deviceProfile]);
  async function act(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await run();
      await refresh();
    } catch (e) {
      if (mounted.current) setError(localHostFailure(e, t));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  if (!canHostLocally() || !deviceProfile || !status?.supported) return null;
  const mine =
    status.configured?.organizationId === organizationId
      ? status.configured
      : null;
  if (setup || (!mine && !status.configured))
    return setup ? (
      <LocalHostSetup
        profile={profile}
        organizationId={organizationId}
        deviceProfile={deviceProfile}
        t={t}
        onDone={() => {
          setSetup(false);
          void refresh();
          onChanged();
        }}
        onSkip={() => setSetup(false)}
      />
    ) : (
      <div className="note info local-host-callout">
        <div>
          <strong>
            {t(
              "这台电脑还不是执行主机",
              "This computer is not an execution host yet",
            )}
          </strong>
          <p className="small">
            {t(
              "一次确认即可：本机运行 Host 与 Coordinator 后台服务，Agent 在这里执行你的 OKR。",
              "One confirmation: this computer runs the Host and Coordinator background service, and Agents run your OKRs here.",
            )}
          </p>
        </div>
        <button className="primary" onClick={() => setSetup(true)}>
          {t("设为执行主机", "Use this computer")}
        </button>
      </div>
    );
  if (!mine) return null;
  const running = status.service === "running";
  const chip =
    status.service === "running"
      ? status.listening
        ? ["ok", t("运行中", "Running")]
        : ["wait", t("启动中", "Starting")]
      : status.service === "starting"
        ? ["wait", t("启动中", "Starting")]
        : status.service === "stopped"
          ? ["warn", t("已停用", "Stopped")]
          : status.service === "not_installed"
            ? ["warn", t("服务未安装", "Service not installed")]
            : ["", t("状态未知", "Unknown")];
  return (
    <section
      className="panel local-host-card"
      aria-label={t("本机服务", "This computer's service")}
    >
      <div className="row wrap">
        <h3>{t("本机服务", "This computer's service")}</h3>
        <span className={`chip ${chip[0]}`}>{chip[1]}</span>
        <span className="chip brand">Host</span>
        <span className="chip brand">Coordinator</span>
      </div>
      <dl className="kv">
        <dt>{t("主机名称", "Host name")}</dt>
        <dd>{mine.hostName}</dd>
        <dt>{t("Coordinator 入口", "Coordinator endpoint")}</dt>
        <dd>
          <span className="mono">{mine.endpoint}</span> ·{" "}
          {t("仅本机可访问", "This computer only")}
        </dd>
        <dt>{t("进程", "Process")}</dt>
        <dd>{status.pid ? `PID ${status.pid}` : "—"}</dd>
        <dt>{t("日志", "Log")}</dt>
        <dd className="mono long-id">{status.logPath}</dd>
        <dt>{t("工作目录", "Workspace")}</dt>
        <dd className="mono long-id">{status.workspacePath}</dd>
      </dl>
      <p className="small muted">
        {t(
          "手机等其他设备暂时连不上仅本机的入口。开放到局域网或公网需要 HTTPS 入口与绑定更新，尚未在 App 中提供。",
          "Phones and other devices cannot reach a this-computer-only endpoint. Opening it to your LAN or the internet needs an HTTPS endpoint and a binding update, which the App does not offer yet.",
        )}
      </p>
      {confirmRevoke && (
        <div className="note warn" role="alert">
          <div>
            {t(
              "撤销后，本机不再是组织的执行主机：链上成员资格被撤销，后台服务停止并卸载，钥匙串中的主机密钥被删除。工作目录保留。",
              "After revoking, this computer is no longer an execution host: its on-chain membership is revoked, the background service is stopped and removed, and the host key is deleted from the keychain. The workspace folder is kept.",
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="note warn">
          {error}
        </p>
      )}
      <div className="actions">
        {running ? (
          <button
            disabled={busy}
            onClick={() =>
              void act(() => native.service(deviceProfile, "stop"))
            }
          >
            {t("停用", "Stop")}
          </button>
        ) : (
          <button
            disabled={busy}
            className="primary"
            onClick={() =>
              void act(() =>
                native.service(
                  deviceProfile,
                  status.service === "not_installed" ? "install" : "start",
                ),
              )
            }
          >
            {t("启用", "Start")}
          </button>
        )}
        {confirmRevoke ? (
          <>
            <button disabled={busy} onClick={() => setConfirmRevoke(false)}>
              {t("取消", "Cancel")}
            </button>
            <button
              disabled={busy}
              className="danger"
              onClick={() =>
                void act(async () => {
                  await revokeLocalHost(profile, deviceProfile, organizationId);
                  setConfirmRevoke(false);
                  onChanged();
                })
              }
            >
              {t("确认撤销并卸载", "Revoke and uninstall")}
            </button>
          </>
        ) : (
          <button disabled={busy} onClick={() => setConfirmRevoke(true)}>
            {t("撤销本机主机", "Revoke this host")}
          </button>
        )}
      </div>
    </section>
  );
}

/** Revokes this computer's membership on chain (device-signed), then removes
 * the service, keys and configuration. Uninstall runs only after the chain
 * no longer lists an active membership for this Host. */
async function revokeLocalHost(
  profile: ConnectionProfile,
  deviceProfile: string,
  organizationId: string,
) {
  const status = await native.status(deviceProfile);
  const record = status.configured;
  if (record?.organizationId === organizationId) {
    const keys = await native.keys(deviceProfile, profile.network);
    const admission = await openAdmission(
      profile,
      deviceProfile,
      organizationId,
    );
    const member = localMembership(
      await admission.directory(),
      keys,
      record.bindingId,
    );
    if (member) {
      const attempt = crypto.randomUUID();
      const quote = await admission.prepare(
        { kind: "revoke-member", targetId: member.id },
        attempt,
        true,
      );
      const outcome = "status" in quote ? quote : await admission.submit(quote);
      if (outcome.status !== "confirmed") throw new Error("revoke_failed");
      await admission.awaitVisible(outcome);
    }
    admission.dispose();
  }
  await native.uninstall(deviceProfile);
}
