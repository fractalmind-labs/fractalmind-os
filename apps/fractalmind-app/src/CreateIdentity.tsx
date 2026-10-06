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
import { NativeRecoverySigner, revealRecoveryCode } from "./native-onboarding";
import {
  IdentityCreation,
  normalizeDeployment,
  identityCreationFailure,
  validateCreationDeployment,
} from "./onboarding";
import type { ConnectionProfile } from "./domain";
import {
  builtInDeployment,
  faucetHost,
  requestTestFunds,
} from "./deployments";
import { NavIcon } from "./V2Views";
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
/** Each creation transaction has a 0.2 SUI Gas ceiling. */
const GAS_CEILING_MIST = 200_000_000n;
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
  const defaultDeployment = initial?.deployment ?? builtInDeployment;
  const [deploymentText, setDeploymentText] = useState(
    defaultDeployment ? JSON.stringify(defaultDeployment, null, 2) : "",
  );
  // A new device uses the App's default profile so later starts unlock it.
  const [profile, setProfile] = useState(initial?.profile ?? "primary");
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
  const [failedAttempts, setFailedAttempts] = useState<
    readonly SelfPayTransactionOutcome[]
  >([]);
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
  // An unfinished setup on this device resumes without re-entering anything.
  const resumed = useRef(false);
  useEffect(() => {
    if (!isTauri() || !initial || resumed.current) return;
    resumed.current = true;
    void action(() => start(true));
    // Once, on open.
  }, []);
  async function fund() {
    if (!session) return;
    const host = faucetHost(session.deployment.network);
    if (!host) return;
    await requestTestFunds(host, [
      session.recovery.material.recovery.address,
      session.device.device.address,
    ]);
    await read(session);
  }
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
    await validateCreationDeployment(
      new FractalMindSDK({ ...deployment, client }),
    );
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
    setFailedAttempts([]);
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
    setFailedAttempts(current.failedTransactions);
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
    setFailedAttempts(session.failedTransactions);
  }
  async function beginNewAttempt() {
    if (!session || outcome?.status !== "failed") return;
    await session.beginNewAttempt(stage, outcome.digest);
    if (!mounted.current) return;
    setOutcome(null);
    setQuote(null);
    setFailedAttempts(session.failedTransactions);
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
  const funded =
    !!balances &&
    BigInt(balances.recovery) >= GAS_CEILING_MIST &&
    BigInt(balances.device) >= GAS_CEILING_MIST;
  const hasOrganization = Boolean(found?.organizations.length);
  const step = !session
    ? 0
    : !savedCode
      ? 1
      : hasOrganization
        ? 5
        : stage === "organization"
          ? 4
          : funded || outcome
            ? 3
            : 2;
  const steps: Array<[string, string]> = [
    ["设备与恢复码", "Device & recovery code"],
    ["运行费", "Funds"],
    ["创建身份", "Create identity"],
    ["创建组织", "Create organization"],
    ["完成", "Done"],
  ];
  const faucet = session ? faucetHost(session.deployment.network) : null;
  const deploymentForm = (
    <>
      <label>
        {t("本机设备配置名", "Local device profile")}
        <input
          value={profile}
          disabled={busy || Boolean(session)}
          maxLength={64}
          onChange={(e) => setProfile(e.target.value)}
        />
      </label>
      <label>
        {t("网络与合约部署（公开 JSON）", "Network & contract deployment (public JSON)")}
        <textarea
          aria-label={t("公开部署资料 JSON", "Public deployment JSON")}
          value={deploymentText}
          disabled={busy || Boolean(session)}
          onChange={(e) => setDeploymentText(e.target.value)}
          placeholder={
            '{"network":"localnet","rpcUrl":"http://127.0.0.1:29000","packageId":"0x…","originalPackageId":"0x…","okrPackageId":"0x…","originalOkrPackageId":"0x…","directPackageId":"0x…","registryId":"0x…"}'
          }
        />
      </label>
    </>
  );
  return (
    <section
      className="panel create-identity"
      aria-label={t("创建我的身份", "Create my identity")}
    >
      <div className="steps-nav" aria-label={t("创建进度", "Setup progress")}>
        {steps.map(([zh, en], i) => (
          <span
            key={zh}
            className={i + 1 < Math.max(step, 1) ? "done" : i + 1 === Math.max(step, 1) ? "on" : ""}
            aria-current={i + 1 === Math.max(step, 1) ? "step" : undefined}
          >
            <b>{i + 1 < Math.max(step, 1) ? "✓" : i + 1}</b>
            {t(zh, en)}
          </span>
        ))}
      </div>

      {!session && (
        <>
          <p>
            {t(
              "这台设备还没有 FractalMind 身份。先在本机生成设备密钥和一份恢复码；私钥只保存在系统密钥库里。",
              "This device has no FractalMind identity yet. First generate device keys and one recovery code on this machine; private keys stay in the OS credential store.",
            )}
          </p>
          {builtInDeployment ? (
            <p className="small muted">
              {t("网络", "Network")}: {builtInDeployment.network} ·{" "}
              <code>{builtInDeployment.rpcUrl}</code>
            </p>
          ) : (
            deploymentForm
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={busy || !deploymentText}
              onClick={() => void action(() => start(false))}
            >
              {t("生成设备密钥与恢复码", "Generate device keys & recovery code")}
            </button>
            <button
              disabled={busy || !deploymentText}
              onClick={() => void action(() => start(true))}
            >
              {t("继续上次的设置", "Continue previous setup")}
            </button>
          </div>
          {builtInDeployment && (
            <details>
              <summary className="small muted">
                {t("高级：配置名或其他部署", "Advanced: profile or another deployment")}
              </summary>
              {deploymentForm}
            </details>
          )}
        </>
      )}

      {session && step === 1 && (
        <>
          {code ? (
            <div className="recovery-display">
              <strong>{t("保存这一份恢复码", "Save this recovery code")}</strong>
              <code className="long-id">{code}</code>
              <p>
                {t(
                  "只要这一份恢复码就能在所有设备丢失后找回身份。它只显示这一次；任何持有它的人都能恢复你的身份。",
                  "This one code recovers your identity if every device is lost. It is shown only once; anyone holding it can recover your identity.",
                )}
              </p>
            </div>
          ) : found ? (
            <p className="small muted">
              {t(
                "身份已经在链上创建；恢复码只在设置时显示。",
                "The identity is already on chain; the recovery code was shown during setup.",
              )}
            </p>
          ) : (
            <div className="recovery-display">
              <p className="small">
                {t(
                  "已找到本机未完成的设置，身份尚未上链。如果还没保存恢复码，现在可以再显示一次。",
                  "Found this device's unfinished setup; the identity is not on chain yet. If you have not saved the recovery code, show it again now.",
                )}
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const shown = await revealRecoveryCode(
                      transport,
                      session.device.device.profile,
                      session.deployment.network,
                    );
                    if (mounted.current) setCode(shown);
                  })
                }
              >
                {t("显示恢复码", "Show recovery code")}
              </button>
            </div>
          )}
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
        </>
      )}

      {session && step >= 2 && step <= 4 && (
        <div className="fee-quote">
          <div className="row between">
            <strong>{t("运行费", "Funds")}</strong>
            <span className={`chip ${funded ? "ok" : "warn"}`}>
              {funded ? t("已就绪", "Ready") : t("需要充值", "Needs funds")}
            </span>
          </div>
          <dl>
            <dt>{t("创建身份（恢复地址）", "Identity (recovery address)")}</dt>
            <dd>
              <code className="long-id">
                {session.recovery.material.recovery.address}
              </code>
              <br />
              {balances ? sui(balances.recovery) : t("余额未知", "Balance unknown")}
            </dd>
            <dt>{t("创建组织（本设备）", "Organization (this device)")}</dt>
            <dd>
              <code className="long-id">{session.device.device.address}</code>
              <br />
              {balances ? sui(balances.device) : t("余额未知", "Balance unknown")}
            </dd>
          </dl>
          <p className="small muted">
            {t(
              "每笔交易 Gas 上限 0.2 SUI，实际费用以报价和链上记录为准；没有自动扣费，每笔都需要你确认。",
              "Each transaction has a 0.2 SUI Gas ceiling; quotes and chain records show actual fees. Nothing is charged automatically; you confirm each one.",
            )}
          </p>
          <div className="actions">
            {faucet && !funded && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void action(fund)}
              >
                {t(
                  `从 ${session.deployment.network} 水龙头领取测试 SUI`,
                  `Get test SUI from the ${session.deployment.network} faucet`,
                )}
              </button>
            )}
            <button disabled={busy} onClick={() => void action(() => read(session))}>
              {t("刷新余额", "Refresh balance")}
            </button>
          </div>
        </div>
      )}

      {session && (step === 3 || step === 4) && (
        <>
          <h3>
            {stage === "identity"
              ? t("创建你的 Human 身份", "Create your Human identity")
              : t("创建你的个人组织", "Create your personal organization")}
          </h3>
          {stage === "organization" && (
            <>
              <p className="small muted" title={found?.profile.humanId}>
                {t("身份已在链上确认", "Identity confirmed on chain")} ·{" "}
                <code>{found?.profile.humanId.slice(0, 10)}…</code>
              </p>
              <label>
                {t(
                  "组织名称（公开上链）",
                  "Organization name (public on chain)",
                )}
                <input
                  value={name}
                  maxLength={128}
                  placeholder={t("例如：Ada 的个人组织", "e.g. Ada's organization")}
                  disabled={busy || Boolean(quote)}
                  onChange={(e) => {
                    setName(e.target.value);
                    setQuote(null);
                  }}
                />
              </label>
            </>
          )}
          {!quote && !outcome && (
            <div className="actions">
              <button
                className="primary"
                disabled={
                  busy ||
                  !savedCode ||
                  (stage === "identity" && !funded) ||
                  (stage === "organization" && !name.trim())
                }
                onClick={() => void action(prepare)}
              >
                {t("估算费用", "Estimate fee")}
              </button>
            </div>
          )}
        </>
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
          <p className="small">
            {quote.expiresAtMs > now
              ? t(
                  "确认后在本机签名并提交一次。",
                  "Confirm to sign on this device and submit once.",
                )
              : t("报价已过期，请重新估算。", "Quote expired. Estimate again.")}
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
              {t("取消", "Cancel")}
            </button>
          </div>
        </div>
      )}
      {outcome && !hasOrganization && (
        <div role="status" className="transaction-outcome">
          <strong>
            {outcome.status === "confirmed"
              ? t("链上已确认", "Confirmed on chain")
              : outcome.status === "failed"
                ? t("交易失败，保留原记录", "Transaction failed; original retained")
                : t("结果未知，查询原交易", "Outcome unknown; query original")}
          </strong>
          <p>
            <code className="long-id">{outcome.digest}</code>
          </p>
          {outcome.actualGas && (
            <p>
              {t("实际 Gas", "Actual Gas")}: {sui(outcome.actualGas)}
            </p>
          )}
          <div className="actions">
            {outcome.status === "failed" ? (
              <button disabled={busy} onClick={() => void action(beginNewAttempt)}>
                {t("开始新的尝试", "Start a new attempt")}
              </button>
            ) : (
              <button disabled={busy} onClick={() => void action(() => read(session!))}>
                {t("查询原交易", "Query original transaction")}
              </button>
            )}
          </div>
        </div>
      )}
      {failedAttempts.length > 0 && (
        <details>
          <summary className="small muted">
            {t("保留的失败记录", "Retained failed attempts")}
          </summary>
          {failedAttempts.map((attempt) => (
            <div key={attempt.digest}>
              <code className="long-id">{attempt.digest}</code>
              {attempt.actualGas && (
                <p>
                  {t("实际 Gas", "Actual Gas")}: {sui(attempt.actualGas)}
                </p>
              )}
            </div>
          ))}
        </details>
      )}

      {session && hasOrganization && (
        <div className="calm-done">
          <div className="calm">
            <NavIcon name="check" />
            <span>
              {t(
                "身份和个人组织已创建。",
                "Your identity and personal organization are ready.",
              )}
            </span>
          </div>
          <div className="actions">
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
              {t("进入我的组织", "Open my organization")}
            </button>
          </div>
        </div>
      )}
      {busy && (
        <p role="status" className="small muted">
          {t("正在处理…", "Working…")}
        </p>
      )}
      {error && (
        <p role="alert">
          {error === "deployment_type_origin_mismatch"
            ? t(
                "部署资料与链上合约来源不一致。请核对 Registry 和原始包 ID；升级部署需要填写 originalPackageId。已有身份和组织保持，可继续原创建流程。",
                "Deployment metadata does not match the chain type origins. Check Registry and original package IDs; an upgraded deployment needs originalPackageId. Existing identity and organization are retained; continue the original setup.",
              )
            : error === "organization_name_taken"
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
                  : error === "original_transaction_not_failed" ||
                      error === "creation_attempt_changed"
                    ? t(
                        "原尝试状态已变化，当前不能开始新尝试。请检查余额与原交易，再按最新结果继续。",
                        "The original attempt changed; a new attempt cannot start now. Check balance and the original transaction, then continue from its current result.",
                      )
                    : error === "creation_already_exists"
                      ? t(
                          "身份或组织状态已推进。请检查原交易并继续已创建的身份或组织。",
                          "Identity or organization creation has progressed. Check the original transaction and continue with the existing identity or organization.",
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
