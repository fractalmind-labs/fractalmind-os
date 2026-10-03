import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  FractalMindSDK,
  IndexedDbTransactionJournal,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { NativeDeviceSigner, type NativeInvoke } from "./native-device";
import { NativeRecoverySigner } from "./native-onboarding";
import {
  IdentityCreation,
  normalizeDeployment,
  identityCreationFailure,
} from "./onboarding";
import type { ConnectionProfile } from "./domain";
type Translate = (zh: string, en: string) => string;
const CACHE = "fractalmind.app.onboarding-connection.v1";
const transport: NativeInvoke = (command, args) => invoke(command, args);
function saved() {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE) ?? "null");
    return value && typeof value.profile === "string"
      ? {
          profile: value.profile,
          deployment: normalizeDeployment(value.deployment),
        }
      : null;
  } catch {
    return null;
  }
}
function sui(mist: string) {
  const n = BigInt(mist);
  return `${n / 1000000000n}.${(n % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "") || "0"} SUI`;
}
/** V2 creation journey. Only public connection metadata is cached; keys and
 * business records are never copied to browser storage. Every write requires
 * its own fresh quote and explicit submit; resuming is read-only. */
export default function CreateIdentity({
  t,
  connect,
  onBusyChange,
}: {
  t: Translate;
  connect: (profile: ConnectionProfile) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [initial] = useState(saved);
  const [deploymentText, setDeploymentText] = useState(
    initial ? JSON.stringify(initial.deployment, null, 2) : "",
  );
  const [profile, setProfile] = useState(
    initial?.profile ?? `identity-${crypto.randomUUID().slice(0, 8)}`,
  );
  const [session, setSession] = useState<IdentityCreation | null>(null),
    [code, setCode] = useState(""),
    [savedCode, setSavedCode] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [now, setNow] = useState(Date.now());
  const [balances, setBalances] = useState<{
    recovery: string;
    device: string;
  } | null>(null);
  const [stage, setStage] = useState<"identity" | "organization">("identity");
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null),
    [outcome, setOutcome] = useState<SelfPayTransactionOutcome | null>(null);
  const [name, setName] = useState(""),
    [found, setFound] =
      useState<Awaited<ReturnType<IdentityCreation["locate"]>>>(null);
  const mounted = useRef(true),
    flight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      mounted.current = false;
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
          identityCreationFailure(e, session?.deployment.packageId ?? ""),
        );
    } finally {
      flight.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  async function start(load: boolean) {
    const deployment = normalizeDeployment(JSON.parse(deploymentText));
    const client = new SuiGrpcClient({
      baseUrl: deployment.rpcUrl,
      network: deployment.network,
    });
    const { chainIdentifier } = await client.core.getChainIdentifier();
    if (
      deployment.chainIdentifier &&
      deployment.chainIdentifier !== chainIdentifier
    )
      throw new Error();
    await new FractalMindSDK({
      ...deployment,
      client,
    }).identity.resolveRegistry();
    const journal = new IndexedDbTransactionJournal();
    // Explicit native generation occurs only after deployment checks succeed.
    const value = load
      ? {
          signer: await NativeRecoverySigner.load(
            transport,
            profile,
            deployment.network,
          ),
          recoveryCode: "",
        }
      : await NativeRecoverySigner.create(
          transport,
          profile,
          deployment.network,
        );
    if (!mounted.current) return;
    setCode(value.recoveryCode);
    const device = await NativeDeviceSigner.load(transport, profile);
    const current = new IdentityCreation(
      { ...deployment, chainIdentifier },
      value.signer,
      device,
      journal,
    );
    if (!mounted.current) return;
    setSession(current);
    setCode(value.recoveryCode);
    setSavedCode(false);
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
  async function read(current: IdentityCreation) {
    const identity = await current.locate();
    const prior = identity
      ? await current.queryOrganization()
      : await current.queryIdentity();
    const funds = await current.balances();
    if (!mounted.current) return;
    setFound(identity);
    setStage(identity ? "organization" : "identity");
    setOutcome(prior ?? null);
    setBalances(funds);
    setQuote(null);
  }
  async function prepare() {
    if (!session || !savedCode) return;
    setQuote(null);
    setOutcome(null);
    const result =
      stage === "identity"
        ? await session.prepareIdentity()
        : await session.prepareOrganization(name);
    if (!mounted.current) return;
    if ("status" in result) setOutcome(result);
    else setQuote(result);
  }
  async function submit() {
    if (!session || !quote || !savedCode) return;
    const current = quote;
    setQuote(null);
    const result =
      stage === "identity"
        ? await session.submitIdentity(current)
        : await session.submitOrganization(current);
    if (!mounted.current) return;
    setOutcome(result);
    if (result.status === "confirmed") {
      await session.awaitVisible(stage === "organization");
      await read(session);
    }
  }
  if (!isTauri())
    return (
      <div className="panel onboarding-status" role="status">
        <strong>
          {t(
            "请在 FractalMind 原生 App 创建身份",
            "Create identity in the native FractalMind App",
          )}
        </strong>
        <p>
          {t(
            "网页预览不生成或保存设备与恢复私钥。原生 App 创建流程使用系统密钥库和真实链上交易。",
            "The web preview does not generate or store device/recovery private keys. Native App creation uses the OS credential store and real chain transactions.",
          )}
        </p>
      </div>
    );
  return (
    <section
      className="panel create-identity"
      aria-label={t("创建我的身份", "Create my identity")}
    >
      <h3>{t("创建我的身份", "Create my identity")}</h3>
      <ol className="creation-steps">
        <li>{t("设备与恢复码", "Device & recovery")}</li>
        <li>{t("准备运行费", "Prepare funds")}</li>
        <li>{t("确认身份与组织", "Confirm Human & organization")}</li>
      </ol>
      {code && (
        <div className="recovery-display">
          <strong>{t("保存这一份恢复码", "Save this recovery code")}</strong>
          <code className="long-id">{code}</code>
          <p>
            {t(
              "只保存恢复码即可定位稳定身份。此页仅显示一次，离开或刷新后隐藏；任何持码者都能恢复身份。",
              "This one code locates your stable identity. Shown only in this session; leaving or refreshing hides it. Anyone holding it can recover your identity.",
            )}
          </p>
        </div>
      )}

      {!session ? (
        <>
          <label>
            {t("本机配置名", "Local profile")}
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
                "开发部署仅需 RPC、合约包和 ProtocolRegistry，不需要先有 Human ID。正式网络部署配置仍待发布。",
                "Development setup needs RPC, package and ProtocolRegistry, with no existing Human ID. Official deployment configuration is not published yet.",
              )}
            </p>
            <textarea
              aria-label={t("公开部署资料 JSON", "Public deployment JSON")}
              value={deploymentText}
              disabled={busy}
              onChange={(e) => setDeploymentText(e.target.value)}
              placeholder={
                '{"network":"localnet","rpcUrl":"http://127.0.0.1:29000","packageId":"0x…","okrPackageId":"0x…","directPackageId":"0x…","registryId":"0x…"}'
              }
            />
          </details>
          <div className="actions">
            <button
              disabled={busy || !deploymentText}
              onClick={() => void action(() => start(false))}
            >
              {t("准备设备与恢复码", "Prepare device & recovery")}
            </button>
            <button
              disabled={busy || !deploymentText}
              onClick={() => void action(() => start(true))}
            >
              {t("继续已有创建流程", "Continue existing setup")}
            </button>
          </div>
          <small>
            {t(
              "已有配置不会被覆盖；加载不自动创建或提交。",
              "Existing profiles are not overwritten; loading never creates or submits.",
            )}
          </small>
        </>
      ) : (
        <>
          <p>
            {t("网络", "Network")}: {session.deployment.network} ·{" "}
            <code>{session.deployment.chainIdentifier}</code>
          </p>
          <label className="checkline">
            <input
              type="checkbox"
              checked={savedCode}
              disabled={busy}
              onChange={(e) => {
                setSavedCode(e.target.checked);
                if (e.target.checked) setCode("");
                setQuote(null);
              }}
            />
            {t(
              "我已将恢复码保存在安全的地方",
              "I have saved the recovery code securely",
            )}
          </label>
          <h3>{t("准备运行费", "Prepare transaction funds")}</h3>
          <p>
            {t(
              "恢复地址支付创建 Human，独立设备支付创建组织；两笔分别确认，没有自动充值或代扣。",
              "The recovery address pays for Human creation; the independent device pays for the organization. Confirm separately; no automatic top-up or debit occurs.",
            )}
          </p>
          <dl>
            <dt>{t("身份创建充值地址", "Fund Human creation")}</dt>
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
            <dt>{t("设备运行费地址", "Device fee address")}</dt>
            <dd>
              <code className="long-id">{session.device.device.address}</code>
              <p>
                {balances
                  ? sui(balances.device)
                  : t("余额未知", "Balance unknown")}
              </p>
            </dd>
          </dl>
          <small>
            {t(
              "每笔 Gas 上限为 0.2 SUI，实际费用以模拟报价及链上记录为准；充值后重新检查，不会自动提交。",
              "Each Gas ceiling is 0.2 SUI; simulation and chain receipts show actual fees. Recheck after funding; no automatic submission.",
            )}
          </small>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => void action(() => read(session))}
            >
              {t("检查余额与原交易", "Check balance & original transaction")}
            </button>
          </div>
          {stage === "organization" && (
            <>
              <h3>{t("稳定 Human 已确认", "Stable Human confirmed")}</h3>
              <code className="long-id">{found?.profile.humanId}</code>
              <label>
                {t(
                  "个人组织名称（公开上链）",
                  "Personal organization name (public on chain)",
                )}
                <input
                  value={name}
                  maxLength={128}
                  disabled={busy || Boolean(quote)}
                  onChange={(e) => {
                    setName(e.target.value);
                    setQuote(null);
                  }}
                />
              </label>
            </>
          )}
          {!found?.organizations.length && (
            <button
              disabled={
                busy ||
                !savedCode ||
                Boolean(outcome) ||
                (stage === "organization" && !name.trim())
              }
              onClick={() => void action(prepare)}
            >
              {stage === "identity"
                ? t("估算创建身份费用", "Estimate Human creation fee")
                : t("估算创建组织费用", "Estimate organization fee")}
            </button>
          )}
          {quote && (
            <div className="fee-quote" role="status">
              <h3>{t("确认本次费用", "Confirm this fee")}</h3>
              <dl>
                <dt>{t("预计 Gas", "Estimated Gas")}</dt>
                <dd>{sui(quote.estimatedGas)}</dd>
                <dt>{t("Gas 上限", "Gas ceiling")}</dt>
                <dd>{sui(quote.gasBudget)}</dd>
                <dt>{t("交易摘要", "Digest")}</dt>
                <dd>
                  <code className="long-id">{quote.digest}</code>
                </dd>
              </dl>
              <p>
                {quote.expiresAtMs > now
                  ? t(
                      "确认后原生签名并提交一次。",
                      "Confirm to sign natively and submit once.",
                    )
                  : t(
                      "报价已过期，请重新估算。",
                      "Quote expired. Estimate again.",
                    )}
              </p>
              <div className="actions">
                <button
                  disabled={busy || !savedCode || quote.expiresAtMs <= now}
                  className="primary"
                  onClick={() => void action(submit)}
                >
                  {t("确认费用并提交", "Confirm fee & submit")}
                </button>
                <button disabled={busy} onClick={() => setQuote(null)}>
                  {t("取消本次报价", "Cancel quote")}
                </button>
              </div>
            </div>
          )}
          {outcome && (
            <div role="status" className="transaction-outcome">
              <strong>
                {outcome.status === "confirmed"
                  ? t("链上已确认", "Confirmed on chain")
                  : outcome.status === "failed"
                    ? t(
                        "交易失败，保留原记录",
                        "Transaction failed; original retained",
                      )
                    : t(
                        "结果未知，查询原交易",
                        "Outcome unknown; query original",
                      )}
              </strong>
              <p>
                <code className="long-id">{outcome.digest}</code>
              </p>
              {outcome.actualGas && (
                <p>
                  {t("实际 Gas", "Actual Gas")}: {sui(outcome.actualGas)}
                </p>
              )}
              <p>
                {t(
                  "检查只查询原交易，不重放；失败后的新尝试流程仍待接线。",
                  "Checking queries the original and does not replay. A new attempt after failure is not connected yet.",
                )}
              </p>
            </div>
          )}
          {Boolean(found?.organizations.length) && (
            <button
              disabled={busy}
              className="primary"
              onClick={() =>
                void action(async () => {
                  const identity = await session.locate();
                  if (!identity?.organizations.length) throw new Error();
                  if (mounted.current) {
                    setCode("");
                    try {
                      localStorage.setItem(
                        "fractalmind.app.device-connection.v1",
                        JSON.stringify({
                          profile: session.device.device.profile,
                          network: identity.profile.network,
                          chainIdentifier: identity.profile.chainIdentifier,
                          humanId: identity.profile.humanId,
                        }),
                      );
                    } catch {}
                    connect(identity.profile);
                  }
                })
              }
            >
              {t("查看我的组织", "View my organization")}
            </button>
          )}
        </>
      )}
      {busy && (
        <p role="status">
          {t(
            "正在核对原生密钥与链上状态…",
            "Checking native keys and chain state…",
          )}
        </p>
      )}
      {error && (
        <p role="alert">
          {error === "organization_name_taken"
            ? t(
                "组织名称已被使用。请输入其他名称，再估算并确认费用；你的身份仍然保留。",
                "This organization name is already taken. Choose another name, then estimate and confirm the fee. Your Human identity is retained.",
              )
            : error === "needs_funds"
              ? t(
                  "余额不足。向上面的地址充值后重新检查，不会自动提交。",
                  "Insufficient funds. Fund the addresses above and recheck; no automatic submission.",
                )
              : error === "stale_quote"
                ? t(
                    "报价或 Gas 已变化，请重新估算并确认。",
                    "Quote or Gas changed. Estimate and confirm again.",
                  )
                : t(
                    "本次未完成。检查部署、密钥库和原交易；已有配置可继续，不自动重建或重放。",
                    "Not completed. Check deployment, credential store and original transaction. Continue existing setup; no silent regeneration or replay.",
                  )}
        </p>
      )}
    </section>
  );
}
