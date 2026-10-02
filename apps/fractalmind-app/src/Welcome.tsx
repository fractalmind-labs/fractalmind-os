import { lazy, Suspense, useId, useState } from "react";
import type { ReactNode } from "react";
import { normalizeProfile } from "./chain";
import type { ConnectionProfile } from "./domain";
import { BrandMark, NavIcon } from "./V2Views";

const CreateIdentity = lazy(() => import("./CreateIdentity"));
const RecoverIdentity = lazy(() => import("./RecoverIdentity"));
const PairingFlow = lazy(() => import("./PairingFlow"));

/** V2 view-welcome.js layout/mission. Real onboarding is enabled only when its
 * native + chain path exists; prototype simulation is never imported here. */
export default function Welcome({
  t,
  appearance,
  connect,
}: {
  t: (zh: string, en: string) => string;
  appearance: ReactNode;
  connect: (profile: ConnectionProfile) => void;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState(false);
  const [mode, setMode] = useState<"create" | "existing" | "recover" | null>(
    null,
  );
  const [creatingBusy, setCreatingBusy] = useState(false);
  const gradient = `welcome-${useId().replace(/:/g, "")}`;
  return (
    <div className="welcome-v2">
      <section className="w-hero">
        <svg className="art" viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#06b6d4" />
              <stop offset=".52" stopColor="#5b5bd6" />
              <stop offset="1" stopColor="#a855f7" />
            </linearGradient>
          </defs>
          <rect
            x="4"
            y="4"
            width="192"
            height="192"
            rx="44"
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth="2.5"
            opacity=".75"
          />
          <rect
            x="30"
            y="30"
            width="62"
            height="62"
            rx="14"
            fill={`url(#${gradient})`}
            opacity=".92"
          />
          <rect
            x="104"
            y="104"
            width="34"
            height="34"
            rx="8"
            fill={`url(#${gradient})`}
            opacity=".85"
          />
          <rect
            x="146"
            y="146"
            width="18"
            height="18"
            rx="4"
            fill={`url(#${gradient})`}
            opacity=".8"
          />
          <rect
            x="170"
            y="170"
            width="9"
            height="9"
            rx="2"
            fill={`url(#${gradient})`}
            opacity=".75"
          />
        </svg>
        <div className="w-story">
          <div className="brand">
            <BrandMark /> FractalMind
          </div>
          <span className="eyebrow">
            {t(
              "开放 · 可验证 · 无需许可",
              "Open · Verifiable · Permissionless",
            )}
          </span>
          <h1>
            {t("从一个人的组织开始", "Start with an organization of one")}
          </h1>
          <p>
            {t(
              "建立自己的组织，和 Agent 一起完成可验证的目标，再逐步加入更大的团队与开放网络。",
              "Create your own organization, deliver verifiable goals with Agents, then grow into larger teams and the open network.",
            )}
          </p>
          <p className="mission">
            {t(
              "我们通过分形、自相似的 Agent 组织，走向一个没有人能独占的 ASI。",
              "Through fractal, self-similar agent organizations, toward an ASI that no one owns.",
            )}
          </p>
        </div>
        <p className="fine">
          {t(
            "开发 Alpha · 私钥留在设备，持久产品状态保存在 Sui。",
            "Development Alpha · private keys stay on devices; persistent product state lives on Sui.",
          )}
        </p>
      </section>
      <main className="w-main">
        <div className="w-card">
          <div className="w-top">{appearance}</div>
          <div>
            <h2>{t("欢迎使用 FractalMind", "Welcome to FractalMind")}</h2>
            <p className="muted">
              {t(
                "选择开始方式。未登录时不显示任何组织私有内容。",
                "Choose how to start. Nothing private is shown while signed out.",
              )}
            </p>
          </div>
          <div className="welcome-options">
            {(
              [
                [
                  "create",
                  "user",
                  "创建我的身份",
                  "Create my identity",
                  "新建 Human 身份和个人组织，从空组织开始",
                  "A new Human identity and personal organization, starting empty",
                ],
                [
                  "existing",
                  "layers",
                  "我已有身份",
                  "I already have an identity",
                  "在这台设备上登录，由已有设备批准",
                  "Sign in on this device, approved by one you already use",
                ],
                [
                  "recover",
                  "shield",
                  "使用恢复码找回",
                  "Recover with a code",
                  "所有设备都丢失时，用一份恢复码找回身份",
                  "If every device is lost, one code recovers your identity",
                ],
              ] as const
            ).map(([key, icon, zh, en, dzh, den]) => (
              <button
                key={key}
                className="welcome-option"
                disabled={creatingBusy}
                onClick={() => setMode(key)}
                aria-pressed={mode === key}
              >
                <NavIcon name={icon} />
                <span>
                  <strong>{t(zh, en)}</strong>
                  <small>{t(dzh, den)}</small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
          {mode === "create" && (
            <Suspense
              fallback={
                <p>{t("加载身份创建…", "Loading identity creation…")}</p>
              }
            >
              <CreateIdentity
                t={t}
                connect={connect}
                onBusyChange={setCreatingBusy}
              />
            </Suspense>
          )}
          {mode === "recover" && (
            <Suspense
              fallback={
                <p>{t("加载身份恢复…", "Loading identity recovery…")}</p>
              }
            >
              <RecoverIdentity
                t={t}
                connect={connect}
                onBusyChange={setCreatingBusy}
              />
            </Suspense>
          )}
          {mode === "existing" && (
            <Suspense
              fallback={<p>{t("加载设备配对…", "Loading device pairing…")}</p>}
            >
              <PairingFlow
                t={t}
                connect={connect}
                onBusyChange={setCreatingBusy}
              />
            </Suspense>
          )}
          <p className="welcome-note">
            {t(
              "没有 FractalMind 云账号：身份、设备授权和组织记录在 Sui 上，私钥留在你的设备里。",
              "There is no FractalMind cloud account: identity, device grants and organizations live on Sui; private keys stay on your devices.",
            )}
          </p>
          <details className="panel connection-preview">
            <summary>
              {t(
                "开发预览：只读链上浏览",
                "Development preview: read-only chain browser",
              )}
            </summary>
            <p>
              {t(
                "公开连接资料用于读取真实链上记录，不会导入私钥、恢复码或组织权限。",
                "Public connection metadata reads actual chain records. It imports no private keys, recovery codes or organization authority.",
              )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (creatingBusy) return;
                try {
                  connect(normalizeProfile(JSON.parse(text)));
                  setError(false);
                } catch {
                  setError(true);
                }
              }}
            >
              <label>
                {t("公开连接资料 JSON", "Public connection profile JSON")}
                <textarea
                  disabled={creatingBusy}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-label={t(
                    "公开连接资料 JSON",
                    "Public connection profile JSON",
                  )}
                  placeholder={
                    '{"network":"localnet","rpcUrl":"http://127.0.0.1:29000","packageId":"0x…","registryId":"0x…","humanId":"0x…"}'
                  }
                />
              </label>
              {error && (
                <p role="alert">
                  {t(
                    "连接资料无效，请检查网络、RPC 和完整对象 ID。",
                    "Invalid profile. Check the network, RPC and full object IDs.",
                  )}
                </p>
              )}
              <button className="primary" type="submit" disabled={creatingBusy}>
                {t("读取真实链上数据", "Read live chain data")}
              </button>
            </form>
          </details>
        </div>
      </main>
    </div>
  );
}
