import { useEffect, useRef, useState } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import {
  NativeDeviceSigner,
  preferredDeviceProfile,
  NativeDeviceError,
  type NativeInvoke,
} from "./native-device";
import { DeviceIdentityVerifier } from "./device-identity";
import { ChainReadSession } from "./chain";
import type { ConnectionProfile, Grant } from "./domain";

type Verified = Awaited<ReturnType<DeviceIdentityVerifier["verify"]>>;
const transport: NativeInvoke = (command, args) => invoke(command, args);
/** A proof only establishes the current device grant. No action is silently
 * enabled, no private key is exposed, and no grant snapshot is cached as login. */
export default function DeviceAccess({
  profile,
  grants,
  t,
}: {
  profile: ConnectionProfile;
  grants?: Grant[] | null;
  t: (zh: string, en: string) => string;
}) {
  const [deviceProfile, setDeviceProfile] = useState(preferredDeviceProfile);
  const [signer, setSigner] = useState<NativeDeviceSigner | null>(null);
  const [grantId, setGrantId] = useState("");
  const [verified, setVerified] = useState<Verified | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"not_initialized" | "unknown" | null>(
    null,
  );
  const [now, setNow] = useState(Date.now());
  const epoch = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      epoch.current++;
    };
  }, []);
  const ready = isTauri();
  async function run(action: "load" | "initialize" | "verify") {
    const token = ++epoch.current;
    setBusy(true);
    setFailed(null);
    setVerified(null);
    try {
      if (action === "verify") {
        if (!signer) throw new Error("No native device");
        const result = await new DeviceIdentityVerifier(
          new ChainReadSession(profile),
          signer,
          grantId,
        ).verify();
        if (token === epoch.current) {
          setVerified(result);
          setNow(Date.now());
        }
      } else {
        const result =
          action === "load"
            ? await NativeDeviceSigner.load(transport, deviceProfile)
            : await NativeDeviceSigner.initialize(transport, deviceProfile);
        if (token === epoch.current) setSigner(result);
      }
    } catch (error) {
      if (token === epoch.current) {
        setFailed(
          error instanceof NativeDeviceError && error.code === "not_initialized"
            ? "not_initialized"
            : "unknown",
        );
        if (action !== "verify") setSigner(null);
      }
    } finally {
      if (token === epoch.current) setBusy(false);
    }
  }
  if (!ready)
    return (
      <div className="panel">
        <h3>{t("当前设备", "This device")}</h3>
        <p>
          {t(
            "网页预览只能读取公开记录。设备密钥与持钥验证需在 FractalMind 桌面 App 内使用。",
            "The web preview reads public records only. Device keys and possession verification require the FractalMind desktop App.",
          )}
        </p>
      </div>
    );
  const current =
    verified &&
    now - verified.checkedAtMs < 60_000 &&
    verified.clockMs + BigInt(Math.max(0, now - verified.checkedAtMs)) <
      BigInt(verified.expiresAtMs);
  return (
    <div className="panel">
      <h3>
        {t("当前设备与身份核验", "This device and identity verification")}
      </h3>
      <p>
        {t(
          "设备密钥保存在系统密钥库。新设备生成独立密钥后，仍需已有可信设备在链上授权。",
          "Device keys stay in the OS credential store. A new independent device still needs an on-chain grant from an existing trusted device.",
        )}
      </p>
      <label>
        {t("本机设备配置名", "Local device profile")}{" "}
        <input
          value={deviceProfile}
          disabled={busy}
          maxLength={64}
          onChange={(e) => {
            setDeviceProfile(e.target.value);
            setSigner(null);
            setVerified(null);
          }}
        />
      </label>
      <div className="actions">
        <button disabled={busy} onClick={() => void run("load")}>
          {t("加载已有设备", "Load existing device")}
        </button>
        <button disabled={busy} onClick={() => void run("initialize")}>
          {t("准备独立设备密钥", "Prepare independent device key")}
        </button>
      </div>
      {signer && (
        <>
          <p>{t("本机设备地址", "Local device address")}</p>
          <code className="long-id">{signer.device.address}</code>
          <label>
            {t("核验链上设备授权", "Verify an on-chain device grant")}
            <select
              value={grantId}
              disabled={busy}
              onChange={(e) => {
                setGrantId(e.target.value);
                setVerified(null);
              }}
            >
              <option value="">
                {t("选择此设备的授权", "Select a grant for this device")}
              </option>
              {(grants ?? [])
                .filter((grant) => grant.device === signer.device.address)
                .map((grant) => (
                  <option key={grant.id} value={grant.id}>
                    {grant.id}
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={busy || !grantId}
            onClick={() => void run("verify")}
          >
            {t(
              "证明持钥并读取当前授权",
              "Prove possession and read current grant",
            )}
          </button>
        </>
      )}
      {busy && (
        <p role="status">
          {t(
            "正在核验系统密钥与链上记录…",
            "Checking OS keys and chain records…",
          )}
        </p>
      )}
      {failed && (
        <p role="alert">
          {failed === "not_initialized"
            ? t(
                "此配置尚未准备设备密钥，请明确选择准备独立设备密钥。没有自动创建新身份。",
                "This profile has no device keys yet. Explicitly choose to prepare independent keys. No identity was automatically created.",
              )
            : t(
                "设备或授权未能核验。检查系统密钥库、网络及当前授权；没有自动生成替代身份。",
                "Device or grant could not be verified. Check the OS credential store, network and current grant. No replacement identity was automatically created.",
              )}
        </p>
      )}
      {verified && (
        <p role="status">
          {current
            ? t(
                "已核验此设备持钥与当前授权；每次操作仍需重新校验权限和费用。",
                "Device possession and current grant verified. Each operation still needs fresh authority and fee checks.",
              )
            : t(
                "上次核验已过期，请重新核验。",
                "The previous verification expired. Verify again.",
              )}
        </p>
      )}
    </div>
  );
}
