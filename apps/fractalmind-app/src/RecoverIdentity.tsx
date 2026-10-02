import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  FractalMindSDK,
  IndexedDbTransactionJournal,
  TransactionPreflightError,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import {
  NativeDeviceSigner,
  NativeDeviceError,
  profileCheck,
  type NativeInvoke,
} from "./native-device";
import {
  NativeImportedRecoverySigner,
  type RecoveryStage,
} from "./native-recovery";
import {
  IdentityRecovery,
  IdentityRecoveryError,
  type RecoveryInspection,
} from "./recovery";
import { normalizeDeployment } from "./onboarding";
import type { ConnectionProfile } from "./domain";
const CACHE = "fractalmind.app.recovery-connection.v1";
const transport: NativeInvoke = (command, args) => invoke(command, args);
function saved() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE) ?? "null");
    profileCheck(data.profile);
    return {
      profile: data.profile as string,
      deployment: normalizeDeployment(data.deployment),
    };
  } catch {
    return null;
  }
}
function sui(value: string) {
  const n = BigInt(value);
  return `${n / 1000000000n}.${(n % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "") || "0"} SUI`;
}
/** V2 recovery journey. Secrets are transient/native only. Quotation and explicit
 * submission are separate; a reload queries/reconstructs and never broadcasts. */
export default function RecoverIdentity({
  t,
  connect,
  onBusyChange,
}: {
  t: (zh: string, en: string) => string;
  connect: (profile: ConnectionProfile) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [initial] = useState(saved),
    [deploymentText, setDeploymentText] = useState(
      initial ? JSON.stringify(initial.deployment, null, 2) : "",
    );
  const [profile, setProfile] = useState(
    initial?.profile ?? `recovery-${crypto.randomUUID().slice(0, 8)}`,
  );
  const [inputCode, setInputCode] = useState(""),
    [replacementCode, setReplacementCode] = useState(""),
    [backupConfirmed, setBackupConfirmed] = useState(false);
  const [session, setSession] = useState<IdentityRecovery | null>(null),
    [inspection, setInspection] = useState<RecoveryInspection | null>(null),
    [stage, setStage] = useState<RecoveryStage | null>(null);
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null),
    [outcome, setOutcome] = useState<SelfPayTransactionOutcome | null>(null);
  const [balances, setBalances] = useState<{
      recovery: string;
      device: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [now, setNow] = useState(Date.now());
  const mounted = useRef(true),
    flight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  async function action(run: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await run();
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof IdentityRecoveryError ||
            e instanceof NativeDeviceError ||
            e instanceof TransactionPreflightError
            ? e.code
            : "native_or_chain_unavailable",
        );
    } finally {
      flight.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  async function read(current: IdentityRecovery) {
    const prior = await current.query();
    if (!mounted.current) return;
    setOutcome(prior ?? null);
    setQuote(null);
    // A failed authority read clears the previous proof instead of leaving an
    // enabled "open" action based on an obsolete inspected state.
    setInspection(null);
    setBalances(null);
    const state = await current.inspect();
    if (!mounted.current) return;
    setInspection(state);
    const prepared = await current.recovery.loadStage();
    if (!mounted.current) return;
    setStage(prepared);
    const funds = await current.balances();
    if (mounted.current) setBalances(funds);
  }
  async function start(load: boolean) {
    const deployment = normalizeDeployment(JSON.parse(deploymentText));
    profileCheck(profile);
    const client = new SuiGrpcClient({
      baseUrl: deployment.rpcUrl,
      network: deployment.network,
    });
    const { chainIdentifier } = await client.core.getChainIdentifier();
    if (
      deployment.chainIdentifier &&
      deployment.chainIdentifier !== chainIdentifier
    )
      throw new IdentityRecoveryError("invalid_source");
    await new FractalMindSDK({
      ...deployment,
      client,
    }).identity.resolveRegistry();
    const code = inputCode;
    setInputCode("");
    const recovery = load
      ? await NativeImportedRecoverySigner.load(
          transport,
          profile,
          deployment.network,
        )
      : await NativeImportedRecoverySigner.import(
          transport,
          profile,
          deployment.network,
          code,
        );
    const device = await NativeDeviceSigner.load(transport, profile);
    const current = new IdentityRecovery(
      { ...deployment, chainIdentifier },
      recovery,
      device,
      new IndexedDbTransactionJournal(),
    );
    if (!mounted.current) return;
    setSession(current);
    setReplacementCode("");
    setBackupConfirmed(false);
    setInspection(null);
    setStage(null);
    setQuote(null);
    setOutcome(null);
    try {
      localStorage.setItem(
        CACHE,
        JSON.stringify({ profile, deployment: current.deployment }),
      );
    } catch {}
    await read(current);
  }
  async function replacement() {
    if (!session) return;
    const value = await session.prepareReplacement();
    if (!mounted.current) return;
    setStage(value.stage);
    setReplacementCode(value.recoveryCode);
    setBackupConfirmed(false);
    setQuote(null);
  }
  async function estimate() {
    if (!session || !backupConfirmed) return;
    setQuote(null);
    const result = await session.prepare(backupConfirmed);
    if (!mounted.current) return;
    if ("status" in result) setOutcome(result);
    else setQuote(result);
  }
  async function submit() {
    if (!session || !quote || !backupConfirmed) return;
    const selected = quote;
    setQuote(null);
    const result = await session.submit(selected, backupConfirmed);
    if (!mounted.current) return;
    setOutcome(result);
    if (result.status === "confirmed") {
      const restored = await session.awaitRecovered();
      if (mounted.current) setInspection(restored);
      await read(session);
    }
  }
  async function open() {
    if (!session) return;
    setInspection(null);
    const state = await session.inspect();
    if (!mounted.current) return;
    if (state.phase !== "recovered")
      throw new IdentityRecoveryError("device_not_ready");
    try {
      localStorage.setItem(
        "fractalmind.app.device-connection.v1",
        JSON.stringify({
          profile: session.device.device.profile,
          network: state.profile.network,
          chainIdentifier: state.profile.chainIdentifier,
          humanId: state.humanId,
        }),
      );
    } catch {}
    connect(state.profile);
  }
  async function freshAttempt() {
    if (!session) return;
    const prior = await session.query();
    if (prior && prior.status !== "failed")
      throw new IdentityRecoveryError("original_transaction_exists");
    if (!mounted.current) return;
    setSession(null);
    setInspection(null);
    setStage(null);
    setQuote(null);
    setOutcome(null);
    setBalances(null);
    setReplacementCode("");
    setInputCode("");
    setBackupConfirmed(false);
    setProfile(`recovery-${crypto.randomUUID().slice(0, 8)}`);
    try {
      localStorage.removeItem(CACHE);
    } catch {}
  }
  if (!isTauri())
    return (
      <div className="panel onboarding-status" role="status">
        <strong>
          {t(
            "请在 FractalMind 原生 App 恢复身份",
            "Recover identity in the native FractalMind App",
          )}
        </strong>
        <p>
          {t(
            "网页预览不接收恢复码。原生 App 使用系统密钥库处理凭据，并通过 Sui 交易消费旧码和授权新设备。",
            "The web preview does not accept recovery codes. The native App handles credentials in the OS vault and uses Sui transactions to consume the old code and authorize a new device.",
          )}
        </p>
      </div>
    );
  return (
    <section
      className="panel create-identity recover-identity"
      aria-label={t("使用恢复码找回", "Recover with a code")}
    >
      <h3>{t("使用恢复码找回", "Recover with a code")}</h3>
      <ol className="creation-steps">
        <li>{t("找回稳定身份", "Locate stable identity")}</li>
        <li>{t("保存新的恢复码", "Save replacement code")}</li>
        <li>{t("确认费用与恢复", "Confirm fee & recovery")}</li>
      </ol>
      {!session ? (
        <>
          <label>
            {t("本机恢复配置名", "Local recovery profile")}
            <input
              value={profile}
              disabled={busy}
              maxLength={64}
              onChange={(e) => setProfile(e.target.value)}
            />
          </label>
          <details open={!deploymentText}>
            <summary>
              {t("网络与合约部署", "Network & contract deployment")}
            </summary>
            <p>
              {t(
                "只需要公开 RPC、合约包和 ProtocolRegistry，不需要输入 Human ID。正式部署配置仍待发布。",
                "Only public RPC, package and ProtocolRegistry are needed, with no input Human ID. Official deployment configuration is pending.",
              )}
            </p>
            <textarea
              aria-label={t(
                "公开恢复部署资料 JSON",
                "Public recovery deployment JSON",
              )}
              value={deploymentText}
              disabled={busy}
              onChange={(e) => setDeploymentText(e.target.value)}
              placeholder={
                '{"network":"localnet","rpcUrl":"http://127.0.0.1:29000","packageId":"0x…","registryId":"0x…"}'
              }
            />
          </details>
          <label>
            {t("原恢复码", "Original recovery code")}
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={100}
              value={inputCode}
              disabled={busy}
              onChange={(e) => setInputCode(e.target.value)}
            />
          </label>
          <p>
            {t(
              "原生处理恢复码，不将派生私钥送入页面。恢复成功后旧设备授权失效，旧码被消费。",
              "The native vault handles the code without exporting derived private keys to the page. Successful recovery invalidates old device authority and consumes the old code.",
            )}
          </p>
          <div className="actions">
            <button
              disabled={busy || !deploymentText || !inputCode}
              onClick={() => void action(() => start(false))}
            >
              {t("导入恢复码并查找身份", "Import code & locate identity")}
            </button>
            <button
              disabled={busy || !deploymentText}
              onClick={() => void action(() => start(true))}
            >
              {t("继续本机恢复流程", "Continue local recovery")}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            {t("网络", "Network")}: {session.deployment.network} ·{" "}
            <code>{session.deployment.chainIdentifier}</code>
          </p>
          <dl>
            <dt>
              {t(
                "原恢复地址（支付本次恢复 Gas）",
                "Original recovery address (pays this recovery Gas)",
              )}
            </dt>
            <dd>
              <code className="long-id">
                {session.recovery.material.recovery.address}
              </code>
              <p>
                {balances
                  ? sui(balances.recovery)
                  : t("余额未知", "Balance unknown")}
              </p>
            </dd>
            <dt>{t("新设备运行费地址", "New device fee address")}</dt>
            <dd>
              <code className="long-id">{session.device.device.address}</code>
              <p>
                {balances
                  ? sui(balances.device)
                  : t("余额未知", "Balance unknown")}
              </p>
            </dd>
          </dl>
          <p>
            {t(
              "恢复 Gas 上限 0.2 SUI。新设备后续交易需要自己的 SUI；不会自动转移旧钱包余额或充值。",
              "Recovery Gas ceiling is 0.2 SUI. Future device transactions need that device's own SUI; old wallet balances are not automatically moved or topped up.",
            )}
          </p>
          <button
            disabled={busy}
            onClick={() => void action(() => read(session))}
          >
            {t(
              "检查身份、余额与原交易",
              "Check identity, funds & original transaction",
            )}
          </button>
          {inspection && (
            <>
              <h3>
                {inspection.phase === "recovered"
                  ? t(
                      "身份已恢复并核验新设备",
                      "Identity recovered; new device verified",
                    )
                  : t("已定位稳定 Human", "Stable Human located")}
              </h3>
              <code className="long-id">{inspection.humanId}</code>
              <p>
                {t(
                  "身份代次 / 恢复版本",
                  "Identity generation / recovery version",
                )}
                : {inspection.generation} / {inspection.recoveryVersion}
              </p>
              <ul>
                {inspection.organizations.map((org) => (
                  <li key={org.objectId}>
                    <strong>{org.name}</strong> ·{" "}
                    {org.owned && org.active
                      ? t(
                          "我的活动组织：恢复时轮换未来密钥",
                          "My active organization: rotate future keys on recovery",
                        )
                      : t(
                          "保留原密钥：轮换需组织所有者或重新激活",
                          "Keep existing keys: rotation needs the owner or reactivation",
                        )}
                    <code className="long-id">{org.objectId}</code>
                  </li>
                ))}
              </ul>
              {!inspection.organizations.length && (
                <p>
                  {t(
                    "当前没有组织；身份仍可恢复。",
                    "There are no organizations yet; identity can still be recovered.",
                  )}
                </p>
              )}
            </>
          )}
          {replacementCode && (
            <div className="recovery-display">
              <strong>
                {t("保存新的恢复码", "Save the replacement recovery code")}
              </strong>
              <code className="long-id">{replacementCode}</code>
              <p>
                {t(
                  "仅本次显示。新码在恢复交易确认后生效，原码在此之前仍有效。任何持码者均能恢复身份。",
                  "Shown only in this session. The new code becomes valid after recovery confirms; the original code remains valid until then. Anyone holding it can recover identity.",
                )}
              </p>
            </div>
          )}
          {inspection?.phase === "ready" && !outcome && !stage && (
            <button disabled={busy} onClick={() => void action(replacement)}>
              {t(
                "准备新恢复码与组织密钥",
                "Prepare replacement code & organization keys",
              )}
            </button>
          )}
          {inspection?.phase === "ready" && stage && (
            <>
              {!replacementCode && !backupConfirmed && (
                <p>
                  {t(
                    "恢复凭据已准备。刷新后不会重显新码；若此前未保存，请先查询原交易，再用仍有效的原码开始新尝试。",
                    "Recovery credentials are prepared. Reloading does not reveal the new code; if it was not saved, query the original transaction before starting a fresh attempt with the still-valid original code.",
                  )}
                </p>
              )}
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={backupConfirmed}
                  disabled={busy}
                  onChange={(e) => {
                    setBackupConfirmed(e.target.checked);
                    if (e.target.checked) setReplacementCode("");
                    setQuote(null);
                  }}
                />
                {t(
                  "我已安全保存本次新的恢复码",
                  "I have securely saved this attempt's new recovery code",
                )}
              </label>
              <p>
                {t(
                  "历史密钥保留；组织未来密钥、恢复记录与新设备授权在同一笔交易中更新。",
                  "Historical keys are retained; future organization keys, recovery record and new device authority change in one transaction.",
                )}
              </p>
              <button
                disabled={busy || !backupConfirmed || Boolean(outcome)}
                onClick={() => void action(estimate)}
              >
                {t("估算恢复费用", "Estimate recovery fee")}
              </button>
            </>
          )}
          {quote && (
            <div className="fee-quote" role="status">
              <h3>{t("确认恢复与费用", "Confirm recovery & fee")}</h3>
              <dl>
                <dt>{t("预计 Gas", "Estimated Gas")}</dt>
                <dd>{sui(quote.estimatedGas)}</dd>
                <dt>{t("Gas 上限", "Gas ceiling")}</dt>
                <dd>{sui(quote.gasBudget)}</dd>
                <dt>{t("原交易摘要", "Original digest")}</dt>
                <dd>
                  <code className="long-id">{quote.digest}</code>
                </dd>
              </dl>
              <p>
                {t(
                  "确认前重新核验链上来源，原生签名并提交一次。",
                  "Sources are rechecked before native signing and a single submission.",
                )}
              </p>
              <div className="actions">
                <button
                  className="primary"
                  disabled={
                    busy || !backupConfirmed || quote.expiresAtMs <= now
                  }
                  onClick={() => void action(submit)}
                >
                  {quote.expiresAtMs <= now
                    ? t(
                        "报价已过期，请重新估算",
                        "Quote expired; estimate again",
                      )
                    : t("确认费用并恢复身份", "Confirm fee & recover identity")}
                </button>
                <button disabled={busy} onClick={() => setQuote(null)}>
                  {t("取消本次报价", "Cancel quote")}
                </button>
              </div>
            </div>
          )}
          {outcome && (
            <div className="fee-quote" role="status">
              <strong>
                {outcome.status === "confirmed"
                  ? t("原交易已确认", "Original transaction confirmed")
                  : outcome.status === "failed"
                    ? t(
                        "原交易失败，需明确开始新尝试",
                        "Original transaction failed; start a new attempt explicitly",
                      )
                    : t(
                        "原交易结果未知，只查询原摘要",
                        "Original outcome unknown; query only its digest",
                      )}
              </strong>
              <code className="long-id">{outcome.digest}</code>
              {outcome.actualGas !== undefined && (
                <p>
                  {t("实际 Gas", "Actual Gas")}: {sui(outcome.actualGas)}
                </p>
              )}
            </div>
          )}
          {inspection?.phase === "recovered" && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void action(open)}
            >
              {t("核验并进入我的组织", "Verify & open my organizations")}
            </button>
          )}
          {inspection?.phase !== "recovered" &&
            (!outcome || outcome.status === "failed") && (
              <button disabled={busy} onClick={() => void action(freshAttempt)}>
                {t(
                  "查询原交易后开始新尝试",
                  "Query original transaction & start fresh",
                )}
              </button>
            )}
        </>
      )}
      {error && (
        <p role="alert">
          {t(
            "恢复流程未能继续，未自动重建或重发。请检查恢复码、网络、来源或原交易。",
            "Recovery flow could not proceed; nothing is automatically regenerated or resent. Check the code, network, sources or original transaction.",
          )}{" "}
          <code>{error}</code>
        </p>
      )}
    </section>
  );
}
