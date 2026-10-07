import { useEffect, useMemo, useRef, useState } from "react";
import {
  AgentError,
  AgentNative,
  defaultHome,
  sessionName,
  validAgentName,
  type CreatedAgent,
  type HomeState,
  type Launcher,
  type RomCatalog,
} from "./agents";

type Translate = (zh: string, en: string) => string;
const native = new AgentNative();

const HOME_STATE: Record<HomeState, [string, string, string]> = {
  new: ["ok", "将新建目录", "Will be created"],
  empty: ["ok", "空目录", "Empty folder"],
  agent_home: ["wait", "已有 Agent 的 Home", "An Agent’s Home"],
  not_empty: ["danger", "不为空", "Not empty"],
  invalid: ["danger", "路径无效", "Invalid path"],
};
export function agentFailure(e: unknown, t: Translate) {
  const code = e instanceof AgentError ? e.code : "";
  const detail = e instanceof AgentError && e.detail ? `（${e.detail}）` : "";
  switch (code) {
    case "AgentNameInUse":
      return t(
        "这台电脑上已有同名 Agent 会话，请换一个名称。",
        "An Agent session with this name already runs here; choose another name.",
      );
    case "InvalidAgentName":
      return t(
        "名称用小写字母、数字和连字符，2–31 位，字母开头。",
        "Use 2–31 lowercase letters, digits or hyphens, starting with a letter.",
      );
    case "HomeNotUsable":
    case "InvalidHome":
      return t(
        "Home 目录需要是空目录或新目录。",
        "The Home must be an empty or new folder.",
      );
    case "AgentAssetsMissing":
      return t(
        "这个版本的 App 没有附带 ROM。请安装完整的桌面版。",
        "This App build has no bundled ROMs. Install the full desktop App.",
      );
    case "UnknownLauncher":
      return t(
        "没有找到所选的启动器或配置。",
        "The chosen launcher or profile was not found.",
      );
    case "PythonUnavailable":
      return t(
        "需要 python3 来运行 agent-manager。",
        "python3 is required to run agent-manager.",
      );
    case "HeartbeatSyncFailed":
      return t(
        `心跳计划没有安装${detail}。请在系统弹窗中允许后重试。`,
        `The heartbeat was not installed${detail}. Allow it in the system prompt, then retry.`,
      );
    case "AgentStartFailed":
    case "CommandTimeout":
      return t(
        `文件已写好，但没有启动成功${detail}。可以重试启动。`,
        `The files are written but starting failed${detail}. Retry the start.`,
      );
    default:
      return t(`本次未完成${detail}。`, `Not completed${detail}.`);
  }
}

/** New Agent: a name, a Home directory and a ROM (#67). */
export default function AgentCreate({
  t,
  onClose,
  onRegister,
}: {
  t: Translate;
  onClose: () => void;
  onRegister: (session: string) => void;
}) {
  const [catalog, setCatalog] = useState<RomCatalog | null>(null),
    [launchers, setLaunchers] = useState<Launcher[] | null>(null),
    [name, setName] = useState(""),
    [home, setHome] = useState(""),
    [homeTouched, setHomeTouched] = useState(false),
    [homeState, setHomeState] = useState<HomeState | null>(null),
    [romId, setRomId] = useState(""),
    [optional, setOptional] = useState<string[]>([]),
    [launcherId, setLauncherId] = useState(""),
    [profileId, setProfileId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [created, setCreated] = useState<CreatedAgent | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const [c, l] = await Promise.all([
          native.catalog(),
          native.launchers(),
        ]);
        if (!mounted.current) return;
        setCatalog(c);
        setLaunchers(l);
        if (l[0]) {
          setLauncherId(l[0].id);
          setProfileId(l[0].profiles[0]?.id ?? "");
        }
      } catch (e) {
        if (mounted.current) setError(agentFailure(e, t));
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);
  const homeValue = homeTouched ? home : defaultHome(name);
  useEffect(() => {
    setHomeState(null);
    if (!homeValue) return;
    const timer = setTimeout(() => {
      native
        .checkHome(homeValue)
        .then((r) => mounted.current && setHomeState(r.state))
        .catch(() => mounted.current && setHomeState("invalid"));
    }, 250);
    return () => clearTimeout(timer);
  }, [homeValue]);
  const rom = catalog?.roms.find((r) => r.id === romId) ?? null;
  const launcher = launchers?.find((l) => l.id === launcherId) ?? null;
  const profile = launcher?.profiles.find((p) => p.id === profileId) ?? null;
  const issues = useMemo(() => {
    const list: string[] = [];
    if (name && !validAgentName(name))
      list.push(
        t(
          "名称用小写字母、数字和连字符，2–31 位，字母开头",
          "Use 2–31 lowercase letters, digits or hyphens, starting with a letter",
        ),
      );
    if (homeState === "agent_home")
      list.push(
        t(
          "这是已有 Agent 的 Home：请用“从主机导入”",
          "This is an existing Agent’s Home: import it instead",
        ),
      );
    if (homeState === "not_empty")
      list.push(
        t(
          "目录不为空：请选择空目录或新目录",
          "The folder is not empty: choose an empty or new folder",
        ),
      );
    if (homeState === "invalid")
      list.push(
        t(
          "Home 路径无效（用 ~/… 或绝对路径）",
          "Invalid Home path (use ~/… or an absolute path)",
        ),
      );
    if (launchers && !launchers.length)
      list.push(
        t(
          "这台电脑上没有找到 Codex CLI 或 Claude Code",
          "Neither Codex CLI nor Claude Code was found on this computer",
        ),
      );
    return list;
  }, [name, homeState, launchers]);
  const ready =
    validAgentName(name) &&
    (homeState === "new" || homeState === "empty") &&
    !!rom &&
    !!launcher &&
    !!profile &&
    !busy;
  async function create() {
    if (!ready || !rom || !launcher || !profile) return;
    setBusy(true);
    setError(null);
    try {
      const result = await native.create({
        name,
        home: homeValue,
        romId: rom.id,
        optionalSkills: optional,
        launcher: launcher.id,
        profileId: profile.id,
      });
      if (!mounted.current) return;
      setCreated(result);
      if (result.startError)
        setError(
          agentFailure(
            new AgentError(
              ...(result.startError.split(": ") as [string, string]),
            ),
            t,
          ),
        );
    } catch (e) {
      if (mounted.current) setError(agentFailure(e, t));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function retryStart() {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await native.start(created.home);
      if (mounted.current)
        setCreated({ ...created, ...outcome, started: true, startError: null });
    } catch (e) {
      if (mounted.current) setError(agentFailure(e, t));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  if (created)
    return (
      <div className="col agent-create">
        <div className="col">
          {[
            [
              t("写入 ROM 文件", "Write the ROM files"),
              `${created.files.length}`,
              true,
            ],
            [
              t(
                "安装技能到 .agents/skills",
                "Install skills into .agents/skills",
              ),
              created.skills.join(", "),
              true,
            ],
            [
              t(
                "写入 AGENTS.md（名称、启动方式、心跳、ROM）",
                "Write AGENTS.md (name, launch, heartbeat, ROM)",
              ),
              "",
              true,
            ],
            [
              t("在 tmux 中启动", "Start in tmux"),
              created.session,
              created.started,
            ],
            ...(created.heartbeat
              ? [
                  [
                    t(
                      "安装心跳计划（本 Home 自己的 crontab 段）",
                      "Install the heartbeat (this Home’s own crontab block)",
                    ),
                    "",
                    created.heartbeatInstalled,
                  ] as const,
                ]
              : []),
          ].map(([label, extra, done]) => (
            <div className="row" key={String(label)}>
              <span className={`st ${done ? "ok" : "warn"}`} aria-hidden="true">
                {done ? "✓" : "!"}
              </span>
              <span>
                {label}{" "}
                {extra && <span className="tiny muted mono">{extra}</span>}
              </span>
            </div>
          ))}
        </div>
        {created.missingSkills.length > 0 && (
          <div className="note warn">
            <div>
              {t(
                `以下技能没有可用来源，未安装（安装不完整）：${created.missingSkills.join("、")}`,
                `No source for these skills; not installed (incomplete install): ${created.missingSkills.join(", ")}`,
              )}
            </div>
          </div>
        )}
        {created.started &&
          created.heartbeat &&
          !created.heartbeatInstalled && (
            <div className="note warn">
              <div>
                {t(
                  "心跳计划还没有安装。macOS 会询问是否允许 FractalMind 管理这台电脑（用于写入 crontab），请在弹窗中允许，然后点“重试安装心跳”。Agent 已经在运行，只是不会按计划自动醒来。",
                  "The heartbeat is not installed yet. macOS asks whether FractalMind may administer this computer (to write the crontab); allow it in the prompt, then choose “Retry the heartbeat”. The Agent is running; it just won’t wake on schedule.",
                )}
              </div>
            </div>
          )}
        {created.started && (
          <div className="calm" role="status">
            <span>
              {t(
                `${name} 已在这台电脑上运行，Home ${created.home}。下一步：在“从主机导入”中把它登记到组织（一笔交易）。`,
                `${name} is running on this computer, Home ${created.home}. Next: register it with the organization under “Import from a host” (one transaction).`,
              )}
            </span>
          </div>
        )}
        {error && (
          <p role="alert" className="note warn">
            {error}
          </p>
        )}
        <div className="actions">
          <button onClick={onClose}>{t("完成", "Done")}</button>
          {(!created.started ||
            (created.heartbeat && !created.heartbeatInstalled)) && (
            <button disabled={busy} onClick={() => void retryStart()}>
              {created.started
                ? t("重试安装心跳", "Retry the heartbeat")
                : t("重试启动", "Retry start")}
            </button>
          )}
          {created.started && (
            <button
              className="primary"
              onClick={() => onRegister(created.session)}
            >
              {t("登记到组织", "Register with the organization")}
            </button>
          )}
        </div>
      </div>
    );

  return (
    <div className="col agent-create">
      <p className="muted small">
        {t(
          "Agent 就是一个 Home 目录：ROM 写入 Agent OS 文件与技能，AGENTS.md 记录名称与启动方式，agent-manager 在 tmux 中运行它。",
          "An Agent is a Home directory: the ROM writes the Agent OS files and skills, AGENTS.md records its name and launch, and agent-manager runs it in tmux.",
        )}
      </p>
      <div className="field">
        <label htmlFor="agent-name">
          {t("名称", "Name")}{" "}
          <span className="tiny muted">{t("必填", "required")}</span>
        </label>
        <input
          id="agent-name"
          className="input mono"
          maxLength={31}
          placeholder="writer"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value.trim())}
        />
        <div className="tiny muted">
          {name
            ? t(
                `tmux 会话 ${sessionName(name)} · AGENTS.md 中 namespace: ${name}`,
                `tmux session ${sessionName(name)} · namespace: ${name} in AGENTS.md`,
              )
            : t(
                "小写字母、数字和连字符；用作 namespace 与 tmux 会话名",
                "Lowercase letters, digits and hyphens; used as the namespace and tmux session name",
              )}
        </div>
      </div>
      <div className="field">
        <label htmlFor="agent-home">
          Home {t("目录", "directory")}{" "}
          <span className="tiny muted">{t("必填", "required")}</span>
        </label>
        <div className="row">
          <input
            id="agent-home"
            className="input mono grow"
            placeholder="~/agents/writer"
            value={homeValue}
            disabled={busy}
            onChange={(e) => {
              setHomeTouched(true);
              setHome(e.target.value);
            }}
          />
          {homeState && (
            <span className={`chip ${HOME_STATE[homeState][0]}`}>
              {t(HOME_STATE[homeState][1], HOME_STATE[homeState][2])}
            </span>
          )}
        </div>
        <div className="tiny muted">
          {t(
            "空目录或新目录。已有 Agent 的 Home 请用“从主机导入”。",
            "An empty or new folder. For an existing Agent’s Home, import it instead.",
          )}
        </div>
      </div>
      <div className="field">
        <label>
          ROM{" "}
          <span className="tiny muted">
            {t(
              "必填 · 来自 roms/agent-os-roms",
              "required · from roms/agent-os-roms",
            )}
          </span>
        </label>
        <div className="col">
          {catalog?.roms.map((r) => (
            <button
              key={r.id}
              type="button"
              className="opt"
              aria-pressed={romId === r.id}
              disabled={busy}
              onClick={() => {
                setRomId(r.id);
                setOptional([]);
              }}
            >
              <span className="grow">
                <span className="row wrap gap-sm">
                  <span className="strong mono">{r.id}</span>
                  <span className="tiny muted">
                    {r.family} · v{r.version}
                  </span>
                  <span
                    className={`chip ${r.compat === "fully-compatible" ? "ok" : "wait"}`}
                  >
                    {r.compat === "fully-compatible"
                      ? t("完全兼容", "Fully compatible")
                      : t("草案兼容", "Draft compatible")}
                  </span>
                </span>
                <span className="small muted" style={{ display: "block" }}>
                  {r.description}
                </span>
              </span>
            </button>
          )) ?? (
            <p className="muted small">{t("读取 ROM…", "Reading ROMs…")}</p>
          )}
        </div>
      </div>
      {rom && (
        <div className="card soft tight">
          <div className="label">{t("将写入 Home", "Will write to Home")}</div>
          <div className="row wrap gap-sm">
            {rom.files.map((f) => (
              <code className="chip outline" key={f}>
                {f}
              </code>
            ))}
          </div>
          <div className="label mt-8">{t("必装技能", "Required skills")}</div>
          <div className="small">
            {[
              { name: catalog!.runtimeSkill, available: true, description: "" },
              ...rom.included.filter((s) => s.name !== catalog!.runtimeSkill),
            ].map((s) => (
              <span key={s.name}>
                <code>{s.name}</code>
                {!s.available && (
                  <span className="chip warn">
                    {t("无可用来源", "No source")}
                  </span>
                )}{" "}
              </span>
            ))}
            {!rom.included.some((s) => s.name === catalog!.runtimeSkill) && (
              <span className="tiny muted">
                {t(
                  "（agent-manager 是运行所需，总会安装）",
                  "(agent-manager runs the Agent and is always installed)",
                )}
              </span>
            )}
          </div>
          {rom.optional.length > 0 && (
            <>
              <div className="label mt-8">
                {t("可选技能", "Optional skills")}
              </div>
              <div className="row wrap">
                {rom.optional.map((s) => (
                  <label className="check" key={s.name} title={s.description}>
                    <input
                      type="checkbox"
                      disabled={busy || !s.available}
                      checked={optional.includes(s.name)}
                      onChange={(e) =>
                        setOptional((cur) =>
                          e.target.checked
                            ? [...cur, s.name]
                            : cur.filter((x) => x !== s.name),
                        )
                      }
                    />
                    <code>{s.name}</code>
                  </label>
                ))}
              </div>
            </>
          )}
          {rom.compat !== "fully-compatible" && (
            <div className="note warn mt-8">
              <div>
                {t(
                  "草案兼容：部分文件或技能可能需要你手动补齐。",
                  "Draft compatible: some files or skills may need manual completion.",
                )}
              </div>
            </div>
          )}
        </div>
      )}
      <div className="field">
        <label>
          {t("启动方式", "Launch")}{" "}
          <span className="tiny muted">
            {t("决定模型", "decides the model")}
          </span>
        </label>
        <div className="row wrap">
          <select
            className="select"
            aria-label={t("启动器", "Launcher")}
            value={launcherId}
            disabled={busy || !launchers?.length}
            onChange={(e) => {
              setLauncherId(e.target.value);
              setProfileId(
                launchers?.find((l) => l.id === e.target.value)?.profiles[0]
                  ?.id ?? "",
              );
            }}
          >
            {launchers?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Profile"
            value={profileId}
            disabled={busy || !launcher}
            onChange={(e) => setProfileId(e.target.value)}
          >
            {launcher?.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} · {p.model ?? t("账号默认模型", "account default")}
              </option>
            ))}
          </select>
        </div>
        <div className="tiny muted">
          {t(
            "这台电脑上已安装的启动器与配置；模型、账号与密钥由启动器自己的配置管理，App 只读取 Codex 配置里的模型名。",
            "Launchers and profiles installed on this computer; models, accounts and keys stay in each launcher’s own configuration. The App reads only the model name from a Codex profile.",
          )}
        </div>
      </div>
      <dl className="kv">
        <dt>{t("主机", "Host")}</dt>
        <dd>{t("这台电脑", "This computer")}</dd>
        <dt>{t("常驻权限", "Standing permission")}</dt>
        <dd>
          {t(
            "默认无：没有 OKR 时只对话；之后可调整",
            "None by default: it only chats without an OKR; adjust later",
          )}
        </dd>
        <dt>{t("费用", "Fee")}</dt>
        <dd>
          {t(
            "创建在本机完成，不上链；登记到组织时再签一笔交易。",
            "Creation happens on this computer without a transaction; registering with the organization signs one.",
          )}
        </dd>
      </dl>
      {issues.map((x) => (
        <div className="row small" style={{ color: "var(--danger)" }} key={x}>
          ✕ {x}
        </div>
      ))}
      {error && (
        <p role="alert" className="note warn">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="small muted">
          {t("正在写入文件并启动…", "Writing files and starting…")}
        </p>
      )}
      <div className="actions">
        <button onClick={onClose} disabled={busy}>
          {t("取消", "Cancel")}
        </button>
        <button
          className="primary"
          disabled={!ready}
          onClick={() => void create()}
        >
          {t("确认并创建", "Confirm and create")}
        </button>
      </div>
    </div>
  );
}
