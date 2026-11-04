import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  TransactionPreflightError,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "../chain";
import { clockNow } from "../domain";
import { NativeDeviceError, NativeDeviceSigner } from "../native-device";
import {
  OrganizationCreation,
  OrganizationCreateError,
  organizationRequestId,
  restrictedDevices,
  rootGrantForDevice,
  rootGrants,
  validateOrganization,
} from "../organization-create";
import { go } from "./router";
import { useApp } from "./store";
import { Btn, Dialog, Icon, shortId, sui, useT } from "./ui";

type Attempt = {
  format: 1;
  requestId: string;
  humanId: string;
  beforeOrganizationIds: string[];
};
type Phase = "form" | "checking" | "quoting" | "ready" | "signing" | "unknown" | "created";

function key(network: string, chainIdentifier: string | undefined, humanId: string, profile: string) {
  return `fractalmind.app.org-create.v1:${JSON.stringify([network, chainIdentifier ?? "", humanId, profile])}`;
}
function loadAttempt(storageKey: string): Attempt | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      (value as Attempt).format === 1 &&
      typeof (value as Attempt).requestId === "string" &&
      typeof (value as Attempt).humanId === "string" &&
      Array.isArray((value as Attempt).beforeOrganizationIds) &&
      (value as Attempt).beforeOrganizationIds.every((id) => typeof id === "string")
    )
      return value as Attempt;
  } catch {
    // A malformed locator must not be treated as a missing receipt.
  }
  return null;
}
function saveAttempt(storageKey: string, value: Attempt) {
  localStorage.setItem(storageKey, JSON.stringify(value));
}
function clearAttempt(storageKey: string) {
  localStorage.removeItem(storageKey);
}
function nonce() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function code(error: unknown) {
  if (error instanceof OrganizationCreateError || error instanceof TransactionPreflightError || error instanceof NativeDeviceError)
    return error.code;
  return "unavailable";
}

export function OrganizationCreateDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const t = useT();
  const identity = app.identity;
  const device = app.device.session.state === "unlocked" ? app.device.session.device : null;
  const deviceProfile = app.deviceProfile;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null);
  const [outcome, setOutcome] = useState<SelfPayTransactionOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [created, setCreated] = useState<{ name: string; restricted: string[] } | null>(null);
  const flow = useRef<OrganizationCreation | null>(null);
  const live = useRef(true);

  const now = identity ? clockNow(identity, app.wallMs) : 0n;
  const root = identity && device ? rootGrantForDevice(identity.grants.value, device.address, identity.human.generation, now) : null;
  const primaries = identity ? rootGrants(identity.grants.value, identity.human.generation, now) : [];
  const storageKey =
    app.profile && identity && deviceProfile
      ? key(app.profile.network, identity.chainIdentifier, identity.human.id, deviceProfile)
      : null;
  const validation = useMemo(
    () => validateOrganization({ name, description }, identity?.organizations ?? []),
    [name, description, identity?.organizations],
  );

  const text = (value: string) =>
    t(
      {
        not_root_device: "只有主设备能新建组织。",
        invalid_name: "请填写 1–64 个字符的组织名称。",
        invalid_description: "简介最多 280 个字符。",
        invalid_request_id: "设备配置名过长，不能安全保存这笔交易。",
        human_changed: "当前 Human 已变化；请重新打开此流程。",
        organization_not_visible: "交易已确认，但新组织尚未可读取；请稍后刷新原交易。",
        needs_funds: "本设备余额不足以支付这笔交易。",
        simulation_failed: "链上拒绝了这笔交易；请刷新后重新检查。",
        stale_quote: "报价已过期；请重新报价。",
        already_recorded: "这笔交易已记录；正在查询原交易。",
        locked: "设备已锁定；解锁后再试。",
        unavailable: "暂时无法读取或签名；请检查设备和网络。",
      }[value] ?? "暂时无法完成；请稍后重试。",
      {
        not_root_device: "Only a main device can create an organization.",
        invalid_name: "Enter an organization name of 1–64 characters.",
        invalid_description: "Description is limited to 280 characters.",
        invalid_request_id: "The device profile is too long to save this transaction safely.",
        human_changed: "The current Human changed; reopen this flow.",
        organization_not_visible: "The transaction is confirmed, but the new organization is not readable yet; refresh the original transaction shortly.",
        needs_funds: "This device does not have enough SUI for this transaction.",
        simulation_failed: "The chain rejected this transaction; refresh and review it again.",
        stale_quote: "The quote expired; obtain a new quote.",
        already_recorded: "This transaction is already recorded; checking the original transaction.",
        locked: "The device is locked; unlock it and try again.",
        unavailable: "Reading or signing is temporarily unavailable; check the device and network.",
      }[value] ?? "Could not complete this now; try again shortly.",
    );

  async function openFlow() {
    if (!app.profile || !device || !deviceProfile) throw new NativeDeviceError("locked");
    if (flow.current) return flow.current;
    const signer = await NativeDeviceSigner.load((command, args) => invoke(command, args), deviceProfile);
    if (signer.device.address !== device.address) throw new NativeDeviceError("invalid_response");
    flow.current = new OrganizationCreation(
      new ChainReadSession(app.profile),
      signer,
      new IndexedDbTransactionJournal(),
    );
    return flow.current;
  }

  async function reconcile(current: Attempt) {
    const currentFlow = await openFlow();
    const visible = await currentFlow.awaitCreated(current.beforeOrganizationIds);
    const organization = visible.identity.organizations.find((item) => item.objectId === visible.organizationId);
    if (!organization) throw new OrganizationCreateError("organization_not_visible");
    const unavailable = restrictedDevices(
      visible.identity.grants.value,
      visible.identity.human.generation,
      visible.identity.clockMs,
      visible.organizationId,
    ).map((grant) => grant.device);
    if (storageKey) clearAttempt(storageKey);
    app.selectOrganization(visible.organizationId);
    app.refresh();
    setCreated({ name: organization.name, restricted: unavailable });
    setPhase("created");
    go("workbench");
  }

  async function queryOriginal(current: Attempt) {
    setPhase("checking");
    setFailure(null);
    try {
      const result = await (await openFlow()).query(current.requestId);
      if (!result) throw new OrganizationCreateError("organization_not_visible");
      setOutcome(result);
      if (result.status === "confirmed") await reconcile(current);
      else if (result.status === "unknown") setPhase("unknown");
      else {
        if (storageKey) clearAttempt(storageKey);
        setAttempt(null);
        setFailure("simulation_failed");
        // A definite failed receipt is not an unknown submission. Keep its
        // error visible, but permit the user to explicitly begin a fresh,
        // newly-nonced request after reviewing it.
        setPhase("form");
      }
    } catch (error) {
      if (!live.current) return;
      setFailure(code(error));
      setPhase("unknown");
    }
  }

  useEffect(() => {
    live.current = true;
    if (!storageKey) return () => {
      live.current = false;
    };
    const stored = loadAttempt(storageKey);
    if (stored && stored.humanId === identity?.human.id) {
      setAttempt(stored);
      void queryOriginal(stored);
    }
    return () => {
      live.current = false;
    };
    // An attempt must only be reconciled for its exact device / Human scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  async function prepare() {
    if (!identity || !device || !deviceProfile || !storageKey) {
      setFailure("locked");
      return;
    }
    if (!validation.ok) {
      setFailure(validation.code);
      return;
    }
    try {
      const current: Attempt = {
        format: 1,
        requestId: organizationRequestId(deviceProfile, identity.human.id, nonce()),
        humanId: identity.human.id,
        beforeOrganizationIds: identity.organizations.map((organization) => organization.objectId),
      };
      // Persist the public request locator before any quote. A reload can only
      // query this exact original transaction; it cannot allocate a new one.
      saveAttempt(storageKey, current);
      setAttempt(current);
      setQuote(null);
      setFailure(null);
      setPhase("quoting");
      const result = await (await openFlow()).prepare({
        requestId: current.requestId,
        humanId: current.humanId,
        device: device.address,
        name,
        description,
      });
      if (!live.current) return;
      if ("status" in result) {
        setOutcome(result);
        if (result.status === "confirmed") await reconcile(current);
        else if (result.status === "unknown") setPhase("unknown");
        else {
          clearAttempt(storageKey);
          setAttempt(null);
          setFailure("simulation_failed");
          setPhase("form");
        }
        return;
      }
      setQuote(result);
      setPhase("ready");
    } catch (error) {
      if (!live.current) return;
      const value = code(error);
      // A preflight failure means nothing was submitted, so this fresh locator
      // must not block a later, explicit attempt.
      clearAttempt(storageKey);
      setAttempt(null);
      setFailure(value);
      setPhase("form");
    }
  }

  async function submit() {
    if (!quote || !attempt) return;
    setPhase("signing");
    setFailure(null);
    try {
      const result = await (await openFlow()).submit(quote);
      if (!live.current) return;
      setOutcome(result);
      setQuote(null);
      if (result.status === "confirmed") await reconcile(attempt);
      else if (result.status === "unknown") setPhase("unknown");
      else {
        if (storageKey) clearAttempt(storageKey);
        setAttempt(null);
        setFailure("simulation_failed");
        setPhase("form");
      }
    } catch (error) {
      if (!live.current) return;
      setFailure(code(error));
      setPhase("unknown");
    }
  }

  const deviceLabel = (address: string) =>
    address === device?.address
      ? t("本设备", "This device")
      : t(
          `另一台设备 · ${shortId(address, 10)}`,
          `Another device · ${shortId(address, 10)}`,
        );
  const busy = ["checking", "quoting", "signing", "unknown"].includes(phase);

  if (created)
    return (
      <Dialog title={t("组织已建好", "Organization created")} sub={created.name} size="sm" onClose={onClose} footer={<Btn kind="primary" label={t("连接主机", "Connect a host")} onClick={() => { onClose(); go("hosts"); }} />}>
        <p className="small">{t("已切换到新组织。下一步可以连接一台主机、写第一个 OKR。", "You are now in the new organization. Next: connect a host and write the first OKR.")}</p>
        {!!created.restricted.length && (
          <div className="note warn">
            <Icon name="alert" />
            <div>
              <strong>{t("这些设备还不能使用新组织", "These devices cannot use the new organization yet")}</strong>
              <div className="small mt-4">{created.restricted.map(deviceLabel).join(" · ")}</div>
              <Btn size="sm" className="mt-8" label={t("去授权设备", "Authorize devices")} onClick={() => { onClose(); go("identity"); }} />
            </div>
          </div>
        )}
      </Dialog>
    );

  if (!identity || !device || !root)
    return (
      <Dialog title={t("新建组织", "New organization")} size="sm" onClose={onClose} footer={<Btn label={t("知道了", "OK")} onClick={onClose} />}>
        <div className="note">
          <Icon name="info" />
          <div>
            {t("只有主设备能新建组织：这台设备的授权只限于某个组织。", "Only a main device can create an organization: this device is authorized for one organization only.")}
            {primaries.length > 0 && (
              <div className="small mt-8">
                {t("可用主设备：", "Available main devices: ")}{primaries.map((grant) => deviceLabel(grant.device)).join(" · ")}
                <br />
                {t("建好后，请在那台设备的“我的身份 › 设备”里给这台设备授权。", "After creating it, authorize this device under My identity › Devices on that main device.")}
              </div>
            )}
          </div>
        </div>
      </Dialog>
    );

  return (
    <Dialog
      title={t("新建组织", "New organization")}
      sub={t("为另一件事单独开一个组织：OKR、主机、Agent、记忆和权限都会和现有组织分开。", "A separate organization for something else: its OKRs, Hosts, Agents, memory and permissions stay separate from your other organizations.")}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Btn label={t("取消", "Cancel")} onClick={onClose} disabled={busy} />
          {phase === "unknown" ? (
            <Btn kind="primary" label={t("查询原交易", "Check original transaction")} onClick={() => attempt && void queryOriginal(attempt)} />
          ) : (
            <Btn
              kind="primary"
              disabled={!isTauri() || busy}
              why={!isTauri() ? t("需要在桌面 App 中操作", "Needs the desktop App") : undefined}
              label={
                phase === "quoting"
                  ? t("计算费用…", "Calculating fee…")
                  : phase === "signing"
                    ? t("签名创建中…", "Signing and creating…")
                    : phase === "ready"
                      ? t(`签名创建 · 预计 ${sui(quote!.estimatedGas)}`, `Sign and create · est. ${sui(quote!.estimatedGas)}`)
                      : t("签名创建", "Sign and create")
              }
              onClick={() => void (phase === "ready" ? submit() : prepare())}
            />
          )}
        </>
      }
    >
      {failure && <div className="note warn" role="alert"><Icon name="alert" /><div>{text(failure)}</div></div>}
      {outcome?.status === "unknown" && <div className="note warn"><Icon name="help" /><div>{t("结果未知：只会查询原交易，不会重放或再次提交。", "Result unknown: only the original transaction will be queried; it will not be replayed or submitted again.")}</div></div>}
      <div className="field">
        <label htmlFor="organization-name">{t("组织名称", "Name")}</label>
        <input id="organization-name" className="input" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder={t("例如：家里的事、Meeru Labs", "e.g. Family, Meeru Labs")} />
        {!validation.ok && name && <div className="err small">{text(validation.code)}</div>}
        {validation.ok && validation.duplicate && <div className="small muted">{t("你已经有一个同名的组织，可以创建，但切换时不容易分辨。", "You already have an organization with this name. It can be created, but will be hard to distinguish when switching.")}</div>}
      </div>
      <div className="field">
        <label htmlFor="organization-description">{t("简介（可选）", "Description (optional)")}</label>
        <textarea id="organization-description" className="input" rows={2} value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} />
      </div>
      <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
        <li>{t("新组织从空开始：没有 OKR、Agent、主机和记忆，你是唯一的管理员。", "It starts empty: no OKRs, Agents, Hosts or memory; you are its only administrator.")}</li>
        <li>{t("邀请他人加入将在后续版本（P3）开放。", "Inviting people will arrive in a later release (P3).")}</li>
        <li>{quote ? t(`预计手续费：${sui(quote.estimatedGas)}。`, `Estimated fee: ${sui(quote.estimatedGas)}.`) : t("费用会在签名前按当前自付费报价计算。", "The current self-pay quote is calculated before signing.")}</li>
      </ul>
    </Dialog>
  );
}
