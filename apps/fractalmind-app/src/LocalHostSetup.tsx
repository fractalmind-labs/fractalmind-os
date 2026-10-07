import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  TransactionPreflightError,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import type { ConnectionProfile } from "./domain";
import { HostAdmission, HostAdmissionError } from "./host-admission";
import {
  NativeDeviceSigner,
  NativeDeviceError,
  type NativeInvoke,
} from "./native-device";
import { DeviceIdentityError } from "./device-identity";
import {
  HOST_FUNDING_MIST,
  LocalHostError,
  LocalHostNative,
  MEMBERSHIP_DAYS,
  OBSERVATION_HOURS,
  localEndpoint,
  setupLocalHost,
  type LocalHostPublic,
  type LocalHostStatus,
  type SetupPhase,
  type SetupResult,
} from "./local-host";

type Translate = (zh: string, en: string) => string;
const transport: NativeInvoke = (command, args) => invoke(command, args);
const native = new LocalHostNative();
const STEPS: Array<[SetupPhase[], string, string]> = [
  [
    ["keys"],
    "在系统钥匙串初始化主机密钥（Host 与 Coordinator 共用）",
    "Create the host key in the system keychain (shared by Host and Coordinator)",
  ],
  [
    ["binding", "configure", "invite"],
    "创建 Coordinator 入口与一次性邀请（本设备签名）",
    "Create the coordinator endpoint and a one-time invitation (signed by this device)",
  ],
  [
    ["join"],
    "本机兑换邀请并入组（主机签名）",
    "Redeem the invitation on this computer and join (signed by the host)",
  ],
  [
    ["service"],
    "安装后台服务（登录后自动运行）",
    "Install the background service (runs at login)",
  ],
  [
    ["online"],
    "启动 Coordinator 并上线",
    "Start the coordinator and go online",
  ],
];
function sui(mist: bigint | string) {
  const n = BigInt(mist);
  return `${n / 1000000000n}.${(n % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "") || "0"} SUI`;
}
function serviceName(t: Translate) {
  const ua = navigator.userAgent;
  return /Windows/.test(ua)
    ? t("Windows 计划任务", "Windows scheduled task")
    : /Linux/.test(ua)
      ? "systemd user service"
      : "launchd LaunchAgent";
}

/** This device's management grant for the organization (manage_hosts). */
export async function openAdmission(
  profile: ConnectionProfile,
  deviceProfile: string,
  organizationId: string,
) {
  const device = await NativeDeviceSigner.load(transport, deviceProfile);
  const chain = new ChainReadSession(profile);
  const human = await chain.human();
  const candidates = human.grants.value?.filter(
    (g) =>
      g.device === device.device.address &&
      !g.revoked &&
      g.generation === human.human.generation &&
      g.actions.includes(1) &&
      g.actions.includes(4) &&
      BigInt(g.expires_at_ms) > human.clockMs &&
      (g.org_scope === null || g.org_scope === organizationId),
  );
  const scoped = candidates?.filter((g) => g.org_scope === organizationId),
    usable = scoped?.length ? scoped : candidates;
  if (usable?.length !== 1) throw new DeviceIdentityError("invalid_grant");
  return new HostAdmission(
    chain,
    device,
    usable[0].id,
    organizationId,
    new IndexedDbTransactionJournal(),
  );
}
export function localHostFailure(e: unknown, t: Translate) {
  const code: string =
    e instanceof TransactionPreflightError ||
    e instanceof LocalHostError ||
    e instanceof HostAdmissionError ||
    e instanceof NativeDeviceError ||
    e instanceof DeviceIdentityError
      ? e.code
      : "";
  switch (code) {
    case "envd_unavailable":
      return t(
        "这个版本的 App 没有附带主机服务。请安装完整的桌面版。",
        "This App build does not include the host service. Install the full desktop App.",
      );
    case "unsupported":
      return t(
        "这台设备不能作为执行主机。",
        "This device cannot run as an execution host.",
      );
    case "binding_failed":
    case "invite_failed":
    case "join_failed":
      return t(
        "链上交易失败，费用按实际扣除。可以检查余额后重试，原交易不会重放。",
        "The chain transaction failed; the actual fee was charged. Check the balance and retry; the original transaction is never replayed.",
      );
    case "join_unknown":
      return t(
        "入组交易结果未知。继续时会先查询原交易，不会重复广播。",
        "The join result is unknown. Continuing queries the original transaction first; nothing is broadcast twice.",
      );
    case "join_cancelled":
      return t(
        "邀请与本机配置不一致，主机拒绝签名。请重新设置。",
        "The invitation did not match this computer's configuration, so the host refused to sign. Set up again.",
      );
    case "service_failed":
      return t(
        "后台服务没有启动。查看日志后可以重试。",
        "The background service did not start. Check the log and retry.",
      );
    case "needs_funds":
      return t(
        "设备余额不足以支付 Gas 和主机的初始余额。",
        "This device's balance cannot cover Gas and the host's starting balance.",
      );
    case "invalid_grant":
      return t(
        "本设备没有管理主机的授权。",
        "This device is not authorized to manage hosts.",
      );
    case "locked":
      return t(
        "设备已锁定，解锁后继续。",
        "The device is locked. Unlock it to continue.",
      );
    default:
      return t(
        "本次未完成。可以继续，已完成的步骤不会重复。",
        "Not finished. You can continue; completed steps are not repeated.",
      );
  }
}

/** One confirmation sets up this computer as Host + Coordinator (#64). */
export default function LocalHostSetup({
  profile,
  organizationId,
  deviceProfile,
  t,
  onDone,
  onSkip,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  deviceProfile: string;
  t: Translate;
  onDone: (result: SetupResult | null) => void;
  onSkip?: () => void;
}) {
  const [status, setStatus] = useState<LocalHostStatus | null>(null),
    [keys, setKeys] = useState<LocalHostPublic | null>(null),
    [name, setName] = useState(""),
    [phase, setPhase] = useState<SetupPhase | null>(null),
    [result, setResult] = useState<SetupResult | null>(null),
    [error, setError] = useState<{ text: string; retry: boolean } | null>(null),
    [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const s = await native.status(deviceProfile);
        if (!mounted.current) return;
        setStatus(s);
        setName(s.configured?.hostName ?? s.defaultHostName);
        // Resuming a finished setup: the service already runs for this org.
        if (
          s.configured?.organizationId === organizationId &&
          s.service === "running"
        )
          return onDone(null);
        if (s.supported && s.envdAvailable)
          setKeys(await native.keys(deviceProfile, profile.network));
      } catch (e) {
        if (mounted.current)
          setError({ text: localHostFailure(e, t), retry: false });
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [deviceProfile, profile.network]);
  async function run(retryFailed = false) {
    if (busy || !status) return;
    setBusy(true);
    setError(null);
    try {
      const admission = await openAdmission(
        profile,
        deviceProfile,
        organizationId,
      );
      const port = status.configured?.port ?? status.suggestedPort;
      if (!port) throw new LocalHostError("service_failed", "no_port");
      const done = await setupLocalHost(
        {
          native,
          chain: admission.chain,
          admission,
          deviceProfile,
          organizationId,
          hostName: name.trim(),
          port,
          storage: localStorage,
          onPhase: (p) => mounted.current && setPhase(p),
        },
        { retryFailed },
      );
      if (!mounted.current) return;
      setResult(done);
      onDone(done);
    } catch (e) {
      if (mounted.current)
        setError({
          text: localHostFailure(e, t),
          retry:
            e instanceof LocalHostError &&
            ["binding_failed", "invite_failed", "join_failed"].includes(e.code),
        });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const endpoint =
    status?.configured?.endpoint ??
    localEndpoint(status?.suggestedPort ?? 7443);
  const unavailable = status && (!status.supported || !status.envdAvailable);
  const started = phase !== null;
  const current = STEPS.findIndex(
    ([phases]) => phase && phases.includes(phase),
  );
  const doneCount = result ? STEPS.length : Math.max(current, 0);
  return (
    <section
      className="panel local-host-setup"
      aria-label={t(
        "把这台电脑设为执行主机",
        "Use this computer as an execution host",
      )}
    >
      <h3>
        {result
          ? t("这台电脑已是执行主机", "This computer is an execution host")
          : started
            ? t(
                "正在把这台电脑设为执行主机",
                "Setting up this computer as an execution host",
              )
            : t(
                "把这台电脑设为执行主机",
                "Use this computer as an execution host",
              )}
      </h3>
      {!started && !result && (
        <>
          <p className="muted">
            {t(
              "推荐：Agent 在本机执行你的 OKR。之后可以在“主机与算力”里调整。",
              "Recommended: Agents run your OKRs on this computer. Adjust it later under Hosts & compute.",
            )}
          </p>
          {unavailable ? (
            <div className="note warn">
              <div>
                {status.supported
                  ? localHostFailure(new LocalHostError("envd_unavailable"), t)
                  : localHostFailure(new LocalHostError("unsupported"), t)}
              </div>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="local-host-name">
                  {t("主机名称（公开上链）", "Host name (public on chain)")}
                </label>
                <input
                  id="local-host-name"
                  className="input"
                  maxLength={64}
                  value={name}
                  disabled={busy || !!status?.configured}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <dl className="kv">
                <dt>{t("角色", "Roles")}</dt>
                <dd>
                  <span className="chip brand">Host</span>{" "}
                  <span className="chip brand">Coordinator</span>{" "}
                  <span className="tiny muted">
                    {t(
                      "同一个后台服务承担两个角色",
                      "One background service runs both",
                    )}
                  </span>
                </dd>
                <dt>{t("后台服务", "Background service")}</dt>
                <dd>
                  {serviceName(t)} ·{" "}
                  {t(
                    "登录后自动运行，关掉 App 后 Agent 继续执行；不需要管理员权限",
                    "Starts at login; Agents keep running after the App closes; no admin rights needed",
                  )}
                </dd>
                <dt>{t("主机地址", "Host address")}</dt>
                <dd className="mono long-id">{keys?.host_address ?? "…"}</dd>
                <dt>{t("Coordinator 入口", "Coordinator endpoint")}</dt>
                <dd>
                  <span className="mono">{endpoint}</span> ·{" "}
                  {t("仅本机可访问", "This computer only")}
                </dd>
                <dt>{t("授权期限", "Validity")}</dt>
                <dd>
                  {t(
                    `邀请 15 分钟内在本机兑换；主机成员资格 ${MEMBERSHIP_DAYS} 天，观察授权 ${OBSERVATION_HOURS / 24} 天`,
                    `The invitation is redeemed here within 15 minutes; host membership lasts ${MEMBERSHIP_DAYS} days and observation ${OBSERVATION_HOURS / 24} days`,
                  )}
                </dd>
                <dt>{t("费用", "Fees")}</dt>
                <dd>
                  {t(
                    "本设备签两笔交易，主机签一笔入组交易，Gas 与存储费合计通常约 0.03 SUI（每笔上限 0.2 SUI）；",
                    "This device signs two transactions and the host signs its join; Gas and storage usually total about 0.03 SUI (0.2 SUI ceiling each); ",
                  )}
                  {t(
                    `同时向主机地址转入 ${sui(HOST_FUNDING_MIST)}，供它支付入组和提交执行结果的 Gas。`,
                    `it also sends the host address ${sui(HOST_FUNDING_MIST)} for the Gas of its join and execution results.`,
                  )}
                </dd>
              </dl>
              <div className="note info">
                <div>
                  {t(
                    "本机同样经过一次性邀请的链上准入，不会因为是“自己的电脑”而跳过。邀请码只在 App 与本机服务之间传递，不显示也不保存。手机等其他设备暂时连不上仅本机的入口。",
                    "This computer still joins through a one-time on-chain invitation; being yours never skips admission. The invitation passes only between the App and the local service and is never shown or stored. Phones and other devices cannot reach a this-computer-only endpoint.",
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
      {(started || result) && (
        <div className="col">
          {STEPS.map(([, zh, en], i) => (
            <div className="row" key={zh}>
              <span
                className={`st ${i < doneCount ? "ok" : i === doneCount && busy ? "info" : "muted"}`}
                aria-hidden="true"
              >
                {i < doneCount ? "✓" : i === doneCount && busy ? "…" : "○"}
              </span>
              <span className={i === doneCount && busy ? "strong" : ""}>
                {t(zh, en)}
              </span>
            </div>
          ))}
        </div>
      )}
      {result && (
        <div className="calm" role="status">
          <span>
            {t(
              `Coordinator 入口 ${result.endpoint}（仅本机可访问）。主机地址 `,
              `Coordinator endpoint ${result.endpoint} (this computer only). Host address `,
            )}
            <span className="mono">
              {result.keys.host_address.slice(0, 10)}…
            </span>
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="note warn">
          {error.text}
        </p>
      )}
      <div className="actions">
        {!result && onSkip && (
          <button disabled={busy} onClick={onSkip}>
            {t("稍后", "Later")}
          </button>
        )}
        {!result && !unavailable && (
          <button
            className="primary"
            disabled={busy || !status || !keys || !name.trim()}
            onClick={() => void run(error?.retry ?? false)}
          >
            {error?.retry
              ? t("重试", "Retry")
              : started || error
                ? t("继续", "Continue")
                : t("确认并设置", "Confirm and set up")}
          </button>
        )}
      </div>
    </section>
  );
}
