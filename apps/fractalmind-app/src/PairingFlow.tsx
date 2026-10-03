import { useEffect, useRef, useState } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  TransactionPreflightError,
  type DeviceAction,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession, normalizeProfile } from "./chain";
import {
  NativeDeviceSigner,
  NativeDeviceError,
  preferredDeviceProfile,
  type NativeInvoke,
} from "./native-device";
import { DevicePairing, PairingError, type PairingPlatform } from "./pairing";
import type { ConnectionProfile, Grant } from "./domain";

type Translate = (zh: string, en: string) => string;
const transport: NativeInvoke = (command, args) => invoke(command, args);
const CACHE = "fractalmind.app.pairing-connection.v1";
function saved() {
  try {
    const x = JSON.parse(localStorage.getItem(CACHE) ?? "null");
    if (
      !x ||
      typeof x.deviceProfile !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(x.deviceProfile)
    )
      return null;
    return {
      deviceProfile: x.deviceProfile,
      profile: normalizeProfile(x.profile),
      organizationId: String(x.organizationId),
      requestId: typeof x.requestId === "string" ? x.requestId : "",
    };
  } catch {
    return null;
  }
}
function sui(value: string) {
  const n = BigInt(value);
  return `${n / 1000000000n}.${(n % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "") || "0"} SUI`;
}
/** V2 pairing journey. No private secrets or business snapshots are cached.
 * Approval and data sharing each have an explicit independent fee confirmation. */
export default function PairingFlow({
  t,
  profile: managedProfile,
  organizationId: managedOrg,
  connect,
  onBusyChange,
}: {
  t: Translate;
  profile?: ConnectionProfile;
  organizationId?: string;
  connect?: (profile: ConnectionProfile) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const managing = Boolean(managedProfile);
  const [initial] = useState(saved);
  const [profileText, setProfileText] = useState(
    initial ? JSON.stringify(initial.profile, null, 2) : "",
  );
  const [org, setOrg] = useState(managedOrg ?? initial?.organizationId ?? "");
  const [deviceProfile, setDeviceProfile] = useState(
    managing
      ? preferredDeviceProfile()
      : (initial?.deviceProfile ?? `pair-${crypto.randomUUID().slice(0, 8)}`),
  );
  const [name, setName] = useState(""),
    [platform, setPlatform] = useState<PairingPlatform>("macos");
  const [requestId, setRequestId] = useState(
    managing ? "" : (initial?.requestId ?? ""),
  );
  const [session, setSession] = useState<DevicePairing | null>(null),
    [state, setState] = useState<Awaited<
      ReturnType<DevicePairing["inspect"]>
    > | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]),
    [grantId, setGrantId] = useState("");
  const [actions, setActions] = useState<DeviceAction[]>(["read"]),
    [days, setDays] = useState(7);
  const [compared, setCompared] = useState(false),
    [shareConfirmed, setShareConfirmed] = useState(false);
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null),
    [outcome, setOutcome] = useState<SelfPayTransactionOutcome | null>(null);
  const [operation, setOperation] = useState<
    "create" | "approve" | "share" | "reject" | "cancel"
  >("create");
  const [balance, setBalance] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [now, setNow] = useState(Date.now());
  const mounted = useRef(true),
    flight = useRef(false);
  const confirmedReceipt = useRef<SelfPayTransactionOutcome | null>(null);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  function resetQuote() {
    setQuote(null);
    setCompared(false);
    setShareConfirmed(false);
  }
  async function run(fn: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof PairingError ||
            e instanceof NativeDeviceError ||
            e instanceof TransactionPreflightError
            ? e.code
            : "native_or_chain_unavailable",
        );
    } finally {
      flight.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }
  function cache(current: DevicePairing, pairingId = requestId) {
    if (managing) return;
    try {
      localStorage.setItem(
        CACHE,
        JSON.stringify({
          deviceProfile: current.device.device.profile,
          profile: current.chain.profile,
          organizationId: org,
          requestId: pairingId,
        }),
      );
    } catch {}
  }
  async function refresh(current = session, pairingId = requestId) {
    if (!current) return;
    setState(null);
    setBalance(null);
    setQuote(null);
    if (
      confirmedReceipt.current &&
      !(await current.awaitVisible(confirmedReceipt.current))
    )
      throw new PairingError("sync_pending");
    if (pairingId) {
      const value = await current.inspect(pairingId);
      if (value.request.organization_id !== org)
        throw new PairingError("invalid_source");
      if (!managing && value.request.device !== current.device.device.address)
        throw new PairingError("wrong_device");
      if (mounted.current) setState(value);
    }
    const funds = await current.chain.sdk.client.client.core.getBalance({
      owner: current.device.device.address,
      coinType: "0x2::sui::SUI",
    });
    if (mounted.current) setBalance(funds.balance.balance);
  }
  async function start(load: boolean) {
    confirmedReceipt.current = null;
    resetQuote();
    setState(null);
    setOutcome(null);
    const profile = managedProfile ?? normalizeProfile(JSON.parse(profileText));
    const chain = new ChainReadSession(profile),
      human = await chain.human();
    if (!human.human.organizations.includes(org))
      throw new PairingError("invalid_source");
    const device =
      load || managing
        ? await NativeDeviceSigner.load(transport, deviceProfile)
        : await NativeDeviceSigner.initialize(transport, deviceProfile);
    const current = new DevicePairing(
      new ChainReadSession({
        ...profile,
        chainIdentifier: human.chainIdentifier,
      }),
      device,
      new IndexedDbTransactionJournal(),
      transport,
    );
    if (!mounted.current) return;
    setSession(current);
    setGrants(human.grants.value ?? []);
    setGrantId("");
    cache(current);
    if (!managing) {
      const prior = await current.query("create");
      if (!mounted.current) return;
      setOperation("create");
      setOutcome(prior ?? null);
      if (prior?.status === "confirmed" && !requestId) {
        const pairingId = await current.requestFromResult(prior);
        setRequestId(pairingId);
        cache(current, pairingId);
        await refresh(current, pairingId);
        return;
      }
    }
    await refresh(current);
  }
  async function prepare(next: typeof operation) {
    if (!session) return;
    setQuote(null);
    setOperation(next);
    const result =
      next === "create"
        ? await session.prepareCreate(org, name, platform)
        : next === "approve"
          ? await session.prepareApproval(
              requestId,
              grantId,
              actions,
              days,
              compared,
            )
          : next === "share"
            ? await session.prepareDataSharing(
                requestId,
                grantId,
                shareConfirmed,
              )
            : await session.prepareResolution(
                requestId,
                next,
                managing ? grantId : undefined,
              );
    if (!mounted.current) return;
    if ("status" in result) setOutcome(result);
    else {
      setQuote(result);
      setOutcome(null);
    }
  }
  async function submit() {
    if (!session || !quote) return;
    const selected = quote;
    setQuote(null);
    const result = await session.submit(selected);
    if (!mounted.current) return;
    setOutcome(result);
    if (result.status === "confirmed") {
      confirmedReceipt.current = result;
      setState(null);
      const pairingId =
        operation === "create"
          ? await session.requestFromResult(result)
          : requestId;
      if (operation === "create") {
        setRequestId(pairingId);
        cache(session, pairingId);
      }
      await refresh(session, pairingId);
    }
  }
  async function query() {
    if (!session) return;
    const result = await session.query(
      operation,
      operation === "create" ? undefined : requestId,
    );
    if (!mounted.current) return;
    setOutcome(result ?? null);
    setQuote(null);
    if (result?.status === "confirmed") confirmedReceipt.current = result;
    if (
      result?.status === "confirmed" &&
      operation === "create" &&
      !requestId
    ) {
      const pairingId = await session.requestFromResult(result);
      setRequestId(pairingId);
      cache(session, pairingId);
      await refresh(session, pairingId);
    } else await refresh();
  }
  async function open() {
    if (!session || !connect) return;
    setState(null);
    const verified = await session.verifyRequester(requestId);
    if (!mounted.current) return;
    try {
      localStorage.setItem(
        "fractalmind.app.device-connection.v1",
        JSON.stringify({
          profile: session.device.device.profile,
          network: verified.profile.network,
          chainIdentifier: verified.profile.chainIdentifier,
          humanId: verified.profile.humanId,
        }),
      );
    } catch {}
    connect(verified.profile);
  }
  if (!isTauri())
    return (
      <div className="panel onboarding-status" role="status">
        <strong>
          {t(
            "请在 FractalMind 原生 App 配对设备",
            "Pair devices in the native FractalMind App",
          )}
        </strong>
        <p>
          {t(
            "网页预览不准备设备钥或授予权限。两端核对链上请求，批准权限与分享数据分别确认。",
            "The web preview does not prepare device keys or grant authority. Both ends compare the chain request; authority and data sharing are confirmed separately.",
          )}
        </p>
      </div>
    );
  const observedClock = state
    ? state.base.clockMs + BigInt(Math.max(0, now - state.base.loadedAtMs))
    : 0n;
  const requestExpired = Boolean(
    state && observedClock >= BigInt(state.request.expires_at_ms),
  );
  const invalidGrant = Boolean(
    state?.grant &&
      (state.grant.revoked ||
        state.grant.generation !== state.base.human.generation ||
        observedClock >= BigInt(state.grant.expires_at_ms)),
  );
  const pending =
    state?.request.status === 0 && !requestExpired && !state.superseded;
  const actionName =
    operation === "create"
      ? t("创建配对请求", "Create pairing request")
      : operation === "approve"
        ? t("批准设备权限", "Approve device authority")
        : operation === "share"
          ? t("分享组织数据密钥", "Share organization data keys")
          : operation === "reject"
            ? t("拒绝配对请求", "Reject pairing request")
            : t("取消配对请求", "Cancel pairing request");
  const blocked = outcome?.status === "unknown" || outcome?.status === "failed";
  return (
    <section
      className="panel create-identity"
      aria-label={t(
        managing ? "批准新设备" : "我已有身份",
        managing ? "Approve a new device" : "I already have an identity",
      )}
    >
      <h3>
        {t(
          managing ? "批准新设备" : "在这台设备使用已有身份",
          managing
            ? "Approve a new device"
            : "Use your identity on this device",
        )}
      </h3>
      <ol className="creation-steps">
        <li>{t("独立设备与请求", "Independent device & request")}</li>
        <li>{t("两端核对并授权", "Compare & authorize")}</li>
        <li>{t("单独分享加密数据", "Share encrypted data separately")}</li>
      </ol>
      {!session && (
        <>
          {!managing && (
            <>
              <label>
                {t(
                  "公开连接资料 JSON（包含 Human ID）",
                  "Public connection JSON (including Human ID)",
                )}
                <textarea
                  value={profileText}
                  disabled={busy}
                  onChange={(e) => setProfileText(e.target.value)}
                />
              </label>
              <p>
                {t(
                  "由已有设备提供公开部署资料；这些资料只定位身份，不授予权限。当前 Alpha 使用公开 JSON 和请求 ID，原生扫码仍待接入。",
                  "The existing device supplies public deployment metadata; it locates identity without granting authority. This Alpha uses public JSON and request IDs; native scanning is pending.",
                )}
              </p>
            </>
          )}
          <label>
            {t("本机设备配置名", "Local device profile")}
            <input
              value={deviceProfile}
              maxLength={64}
              disabled={busy}
              onChange={(e) => setDeviceProfile(e.target.value)}
            />
          </label>
          {!managing && (
            <label>
              {t("组织 ID", "Organization ID")}
              <input
                value={org}
                disabled={busy}
                onChange={(e) => setOrg(e.target.value)}
              />
            </label>
          )}
          <button
            disabled={busy || !org || (!managing && !profileText)}
            onClick={() => void run(() => start(true))}
          >
            {t(
              managing ? "加载管理设备并核验请求" : "继续本机配对流程",
              managing
                ? "Load management device & inspect request"
                : "Continue local pairing",
            )}
          </button>
          {!managing && (
            <button
              disabled={busy || !org || !profileText}
              onClick={() => void run(() => start(false))}
            >
              {t("准备独立设备密钥", "Prepare independent device key")}
            </button>
          )}
        </>
      )}
      {session && (
        <>
          <p>
            {t("本机运行费地址", "Local fee address")} ·{" "}
            {balance === null ? t("余额未知", "Balance unknown") : sui(balance)}
          </p>
          <code className="long-id">{session.device.device.address}</code>
          <p>
            {t(
              "配对请求由新设备支付 Gas；批准与分享由管理设备分别支付。每笔上限 0.2 SUI；不会自动充值或转账。",
              "The new device pays for the request; the management device pays separately for approval and sharing. Each transaction has a 0.2 SUI ceiling; no automatic funding or transfers.",
            )}
          </p>
          {!managing && !requestId && (
            <>
              <label>
                {t("设备名称（自报）", "Device name (reported)")}
                <input
                  value={name}
                  maxLength={128}
                  disabled={busy}
                  onChange={(e) => {
                    setName(e.target.value);
                    setQuote(null);
                  }}
                />
              </label>
              <label>
                {t("平台（自报）", "Platform (reported)")}
                <select
                  value={platform}
                  disabled={busy}
                  onChange={(e) => {
                    setPlatform(e.target.value as PairingPlatform);
                    setQuote(null);
                  }}
                >
                  {["macos", "windows", "ubuntu", "ios", "android"].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy || blocked || !name.trim()}
                onClick={() => void run(() => prepare("create"))}
              >
                {t("估算配对请求费用", "Estimate pairing request fee")}
              </button>
            </>
          )}
          <label>
            {t("配对请求 ID", "Pairing request ID")}
            <input
              value={requestId}
              disabled={
                busy ||
                outcome?.status === "unknown" ||
                (!managing && Boolean(state))
              }
              onChange={(e) => {
                setRequestId(e.target.value);
                setState(null);
                resetQuote();
                setOutcome(null);
              }}
            />
          </label>
          <button
            disabled={busy || !requestId}
            onClick={() => void run(() => refresh())}
          >
            {t("查询链上配对与余额", "Query chain pairing & balance")}
          </button>
          {managing && (
            <label>
              {t("此管理设备的授权", "Grant for this management device")}
              <select
                value={grantId}
                disabled={busy}
                onChange={(e) => {
                  setGrantId(e.target.value);
                  resetQuote();
                  setOutcome(null);
                }}
              >
                <option value="">{t("选择授权", "Select grant")}</option>
                {grants
                  .filter((g) => g.device === session.device.device.address)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.id}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {state && (
            <>
              <dl>
                <dt>Human</dt>
                <dd>
                  <code className="long-id">{state.request.human_id}</code>
                </dd>
                <dt>{t("授权组织", "Authorized organization")}</dt>
                <dd>
                  <code className="long-id">
                    {state.request.organization_id}
                  </code>
                </dd>
                <dt>
                  {t(
                    "请求设备（名称与平台自报）",
                    "Requesting device (name/platform reported)",
                  )}
                </dt>
                <dd>
                  {state.request.device_name} · {state.request.platform}
                  <code className="long-id">{state.request.device}</code>
                </dd>
                <dt>
                  {t("两端核对指纹", "Fingerprint to compare on both ends")}
                </dt>
                <dd>
                  <code className="long-id">{state.fingerprint}</code>
                </dd>
                <dt>{t("请求有效至", "Request valid until")}</dt>
                <dd>
                  {new Date(
                    Number(state.request.expires_at_ms),
                  ).toLocaleString()}
                </dd>
              </dl>
              <p role="status">
                {state.superseded || invalidGrant
                  ? t(
                      "配对或设备授权已失效",
                      "Pairing or device authority is invalid",
                    )
                  : state.request.status === 1
                    ? t(
                        "权限已批准；数据分享单独确认",
                        "Authority approved; data sharing confirmed separately",
                      )
                    : state.request.status === 2
                      ? t("请求已拒绝", "Request rejected")
                      : state.request.status === 3
                        ? t("请求已取消", "Request cancelled")
                        : requestExpired
                          ? t("请求已过期", "Request expired")
                          : t(
                              "待已有管理设备核对和批准",
                              "Awaiting comparison and approval by an existing management device",
                            )}
              </p>
              {managing && pending && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={compared}
                      disabled={busy}
                      onChange={(e) => {
                        setCompared(e.target.checked);
                        setQuote(null);
                      }}
                    />
                    {t(
                      "已在两台设备核对 Human、组织、设备地址与完整指纹",
                      "I compared Human, organization, device address and full fingerprint on both devices",
                    )}
                  </label>
                  <p>
                    {t(
                      "默认当前组织 7 天只读；普通配对不授予身份管理权。",
                      "Default: seven-day read access to this organization. Ordinary pairing grants no identity-management authority.",
                    )}
                  </p>
                  {(
                    ["operate", "approve", "manage_hosts"] as DeviceAction[]
                  ).map((a) => (
                    <label key={a}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={actions.includes(a)}
                        onChange={(e) => {
                          setActions(
                            e.target.checked
                              ? [...actions, a]
                              : actions.filter((x) => x !== a),
                          );
                          setQuote(null);
                        }}
                      />
                      {t(
                        a === "operate"
                          ? "执行"
                          : a === "approve"
                            ? "审批"
                            : "管理主机",
                        a === "operate"
                          ? "Operate"
                          : a === "approve"
                            ? "Approve"
                            : "Manage Hosts",
                      )}
                    </label>
                  ))}
                  <label>
                    {t("权限期限（天）", "Grant lifetime (days)")}
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={days}
                      disabled={busy}
                      onChange={(e) => {
                        setDays(Number(e.target.value));
                        setQuote(null);
                      }}
                    />
                  </label>
                  <button
                    disabled={busy || blocked || !grantId || !compared}
                    onClick={() => void run(() => prepare("approve"))}
                  >
                    {t("估算批准费用", "Estimate approval fee")}
                  </button>
                  <button
                    disabled={busy || blocked || !grantId}
                    onClick={() => void run(() => prepare("reject"))}
                  >
                    {t("拒绝请求 · 估算费用", "Reject request · estimate fee")}
                  </button>
                </>
              )}
              {!managing && pending && (
                <button
                  disabled={busy || blocked}
                  onClick={() => void run(() => prepare("cancel"))}
                >
                  {t("取消请求 · 估算费用", "Cancel request · estimate fee")}
                </button>
              )}
              {state.request.status === 1 &&
                !state.superseded &&
                !invalidGrant && (
                  <>
                    <p>
                      {state.data === "pending"
                        ? t(
                            "已授权，数据待同步：没有发布内容密钥。",
                            "Authorized; data pending: no content keys published.",
                          )
                        : t(
                            "密钥封装已发布；实际正文读取仍需当次授权与解密校验。",
                            "Key envelope published; each body read still requires fresh authority and authenticated decryption.",
                          )}
                    </p>
                    {managing && (
                      <>
                        <label>
                          <input
                            type="checkbox"
                            checked={shareConfirmed}
                            disabled={busy}
                            onChange={(e) => {
                              setShareConfirmed(e.target.checked);
                              setQuote(null);
                            }}
                          />
                          {t(
                            "确认向该设备分享此组织及历史内容的密钥（不分享恢复码）",
                            "Share this organization's content/history keys with this device (no recovery code)",
                          )}
                        </label>
                        <button
                          disabled={
                            busy || blocked || !grantId || !shareConfirmed
                          }
                          onClick={() => void run(() => prepare("share"))}
                        >
                          {t("估算数据分享费用", "Estimate data-sharing fee")}
                        </button>
                      </>
                    )}
                    {!managing && connect && (
                      <button disabled={busy} onClick={() => void run(open)}>
                        {t(
                          "重新核验设备并进入组织",
                          "Reverify device & open organization",
                        )}
                      </button>
                    )}
                  </>
                )}
            </>
          )}
          {quote && (
            <div className="fee-quote" role="status">
              <h4>
                {t("确认操作与费用", "Confirm action & fee")} · {actionName}
              </h4>
              <p>
                {t("预计 Gas", "Estimated Gas")}: {sui(quote.estimatedGas)} ·{" "}
                {t("上限", "Ceiling")}: {sui(quote.gasBudget)}
              </p>
              <code className="long-id">{quote.digest}</code>
              <button
                className="primary"
                disabled={busy || quote.expiresAtMs <= now}
                onClick={() => void run(submit)}
              >
                {quote.expiresAtMs <= now
                  ? t("报价已过期", "Quote expired")
                  : t("确认费用并提交一次", "Confirm fee & submit once")}
              </button>
              <button disabled={busy} onClick={() => setQuote(null)}>
                {t("取消报价", "Cancel quote")}
              </button>
            </div>
          )}
          {outcome && (
            <div className="fee-quote" role="status">
              <strong>
                {t("原交易状态", "Original transaction status")}:{" "}
                {outcome.status === "confirmed"
                  ? t("已确认", "Confirmed")
                  : outcome.status === "failed"
                    ? t("已失败", "Failed")
                    : t("结果未知", "Outcome unknown")}
              </strong>
              <code className="long-id">{outcome.digest}</code>
              {outcome.actualGas && (
                <p>
                  {t("实际 Gas", "Actual Gas")}: {sui(outcome.actualGas)}
                </p>
              )}
              <p>
                {t(
                  "结果未知只查询原摘要，不重新创建请求或授予更大权限。",
                  "Unknown outcomes only query the original digest; no new request or broader authority is issued.",
                )}
              </p>
              <button disabled={busy} onClick={() => void run(query)}>
                {t("查询原交易", "Query original transaction")}
              </button>
            </div>
          )}
        </>
      )}
      {busy && (
        <p role="status">
          {t("正在核对设备与链上状态…", "Checking device and chain state…")}
        </p>
      )}
      {error && (
        <p role="alert">
          {error === "needs_funds"
            ? t(
                "当前操作的支付设备需要 SUI；充值后需重新估算并确认。",
                "The paying device needs SUI; funding requires a fresh estimate and confirmation.",
              )
            : error === "sync_pending"
              ? t(
                  "交易已确认，查询端尚未同步到该对象版本。请查询原交易；不会重新提交。",
                  "The transaction is confirmed, but query objects have not caught up. Query the original transaction; it will not be resubmitted.",
                )
              : error === "invalid_envelope"
                ? t(
                    "密钥版本或组织分隔不满足分享条件。先核对独立组织密钥；不会分享其他组织的密钥。",
                    "Key version or organization isolation does not permit sharing. Check independent organization keys; other organizations' keys will not be shared.",
                  )
                : t(
                    "配对未能继续，请查询原交易并重新核对来源。",
                    "Pairing could not continue; query the original transaction and recheck sources.",
                  )}{" "}
          ({error})
        </p>
      )}
    </section>
  );
}
