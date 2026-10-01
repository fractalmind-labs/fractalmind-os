import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { NativeDeviceSigner, type NativeInvoke } from "./native-device";
import { PrivateRecords, type RecordPointer } from "./private-records";
import { ChainReadSession } from "./chain";
import type { ConnectionProfile, Grant } from "./domain";
const transport: NativeInvoke = (command, args) => invoke(command, args);
export default function PrivateRecordView({
  profile,
  organizationId,
  grants,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  grants: Grant[] | null | undefined;
  t: (zh: string, en: string) => string;
}) {
  const [deviceProfile, setDeviceProfile] = useState("primary"),
    [grantId, setGrantId] = useState("");
  const [rows, setRows] = useState<RecordPointer[] | null>(null),
    [body, setBody] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const epoch = useRef(0),
    flight = useRef(false),
    openedAt = useRef(0);
  useEffect(() => {
    const clear = () => {
      epoch.current++;
      setBody(null);
      setSelected(null);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") clear();
    };
    const timer = setInterval(() => {
      if (openedAt.current && Date.now() - openedAt.current >= 60_000) {
        openedAt.current = 0;
        clear();
      }
    }, 1000);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      epoch.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const reset = () => {
    epoch.current++;
    setRows(null);
    setBody(null);
    setSelected(null);
    setFailed(false);
  };
  async function run(pointer?: RecordPointer) {
    if (flight.current) return;
    flight.current = true;
    const token = ++epoch.current;
    setBusy(true);
    setFailed(false);
    setBody(null);
    setSelected(null);
    try {
      const signer = await NativeDeviceSigner.load(transport, deviceProfile);
      const records = new PrivateRecords(
        new ChainReadSession(profile),
        signer,
        grantId,
        organizationId,
        transport,
      );
      if (pointer) {
        const plaintext = await records.read(pointer);
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(
            plaintext,
          );
          if (token === epoch.current) {
            setBody(text);
            setSelected(pointer.record_id);
            openedAt.current = Date.now();
          }
        } finally {
          plaintext.fill(0);
        }
      } else {
        const data = await records.list();
        if (token === epoch.current) setRows(data);
      }
    } catch {
      if (token === epoch.current) {
        setFailed(true);
        if (!pointer) setRows(null);
      }
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  const ready = isTauri();
  return (
    <section className="panel private-records">
      <h3>{t("组织的加密正文", "Encrypted organization bodies")}</h3>
      <p className="muted">
        {t(
          "从链上读取当前记录；系统密钥库在原生侧解密。每次读取重新核验设备、组织角色和当前版本。正文只暂存于页面，60 秒后或切到后台时隐藏。",
          "Read current chain records; OS keys decrypt natively. Each read rechecks device, organization role and current revision. Bodies stay in page memory and hide after 60 seconds or when backgrounded.",
        )}
      </p>
      {!ready ? (
        <p>
          {t(
            "请在桌面 App 中读取加密正文。网页预览不提供恢复码或私钥输入。",
            "Read encrypted bodies in the desktop App. The web preview has no recovery code or private-key input.",
          )}
        </p>
      ) : (
        <>
          <label>
            {t("本机设备配置名", "Local device profile")}
            <input
              disabled={busy}
              maxLength={64}
              value={deviceProfile}
              onChange={(e) => {
                reset();
                setDeviceProfile(e.target.value);
                setGrantId("");
              }}
            />
          </label>
          <label>
            {t("链上设备授权", "On-chain device grant")}
            <select
              disabled={busy}
              value={grantId}
              onChange={(e) => {
                reset();
                setGrantId(e.target.value);
              }}
            >
              <option value="">
                {t(
                  "选择授权；读取时重新核验",
                  "Select a grant; rechecked on read",
                )}
              </option>
              {(grants ?? [])
                .filter(
                  (g) =>
                    !g.revoked &&
                    (g.org_scope === null || g.org_scope === organizationId),
                )
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.id}
                  </option>
                ))}
            </select>
          </label>
          <button disabled={busy || !grantId} onClick={() => void run()}>
            {t("读取加密记录目录", "Read encrypted record directory")}
          </button>
          {rows && (
            <>
              <p>
                {t("当前记录", "Current records")}: {rows.length}
              </p>
              <div className="record-list">
                {rows.map((row) => (
                  <button
                    disabled={busy}
                    key={row.record_id}
                    onClick={() => void run(row)}
                  >
                    {row.logicalId} · {t("类型", "Kind")} {row.kind} · v
                    {row.revision}
                  </button>
                ))}
              </div>
            </>
          )}
          {body !== null && (
            <div>
              <code className="long-id">{selected}</code>
              <pre className="record-body">
                {body || t("空正文", "Empty body")}
              </pre>
              <button
                onClick={() => {
                  setBody(null);
                  setSelected(null);
                  openedAt.current = 0;
                }}
              >
                {t("隐藏正文", "Hide body")}
              </button>
            </div>
          )}
          {busy && (
            <p role="status">
              {t(
                "读取链上授权与认证密文…",
                "Reading chain authority and authenticated ciphertext…",
              )}
            </p>
          )}
          {failed && (
            <p role="alert">
              {t(
                "未能读取正文。授权、记录或目录可能已变化，密文/密钥版本可能不匹配，或网络暂时不可用。未显示上次正文；请重新读取。",
                "Read failed. Authority, record or directory may have changed, ciphertext/key versions may mismatch, or the network may be unavailable. The previous body is hidden; read again.",
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
