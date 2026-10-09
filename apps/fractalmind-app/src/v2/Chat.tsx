// App v2 (#75): chat with an agent-manager Agent on this computer (prototype
// direct-chat drawer). Messages are typed into its session by agent-manager;
// the reply is its terminal output. Local only: nothing goes on chain, and
// FractalMind does not constrain what the Agent does with the message.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ago, Btn, Icon, useLang, useT } from "./ui";
import type { AgentDefinition } from "../agents";

type Sent = { at: number; text: string; ok: boolean; error?: string };
const key = (home: string) => `fractalmind.v2.chat.${home}`;
function load(home: string): Sent[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(key(home)) ?? "[]");
    return Array.isArray(v) ? v.slice(-50) : [];
  } catch {
    return [];
  }
}

export function ChatDrawer({ name, def, onClose }: { name: string; def: AgentDefinition; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const agent = def.name || "main";
  const [sent, setSent] = useState<Sent[]>(() => load(def.home));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<{ at: number; text: string } | null>(null);
  const [outputError, setOutputError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      sessionStorage.setItem(key(def.home), JSON.stringify(sent.slice(-50)));
    } catch {
      /* optional */
    }
  }, [sent]);
  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const text = (await invoke("fm_agent_output", { home: def.home, agent, lines: 60 })) as string;
        if (live) {
          setOutput({ at: Date.now(), text });
          setOutputError(null);
        }
      } catch (e) {
        if (live) setOutputError(String(e));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [def.home, agent]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [sent.length, output?.text]);
  async function send() {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    try {
      await invoke("fm_agent_send", { home: def.home, agent, message });
      setSent((s) => [...s, { at: Date.now(), text: message, ok: true }]);
      setText("");
    } catch (e) {
      setSent((s) => [...s, { at: Date.now(), text: message, ok: false, error: String(e) }]);
    }
    setBusy(false);
  }
  return (
    <>
      <div className="drawer-scrim" onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={t(`与 ${name} 对话`, `Chat with ${name}`)}>
        <div className="drawer-h">
          <div className="row between">
            <span className="row">
              <span className="avatar sm round">{[...name][0]?.toUpperCase()}</span>
              <strong>{t(`与 ${name} 对话`, `Chat with ${name}`)}</strong>
            </span>
            <Btn kind="ghost" size="icon sm" icon="x" aria={t("关闭", "Close")} onClick={onClose} />
          </div>
          <div className="small muted mono ellipsis">{def.home}</div>
          <div className="note">
            <Icon name="info" />
            <div className="small">
              {t(
                "本机对话：消息经 agent-manager 输入到 Agent 的会话，下方是它终端的最近输出。不写链上记录，也不受常驻权限约束——它按自己的启动配置行事。",
                "Local chat: messages are typed into the Agent's session by agent-manager, and below is its recent terminal output. Nothing is recorded on chain and no standing permission applies — it acts on its own launch configuration.",
              )}
            </div>
          </div>
        </div>
        <div className="drawer-b" ref={body}>
          {sent.map((m, i) => (
            <div className="msg me" key={i}>
              <div className="bubble">{m.text}</div>
              <div className="meta">
                {t("你", "You")} · {ago(m.at, t, lang)} ·{" "}
                {m.ok ? (
                  <span className="chip outline">{t("已送达会话", "Typed into the session")}</span>
                ) : (
                  <span className="chip danger">
                    {t("未送达", "Not delivered")} {m.error ?? ""}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div className="msg agent" style={{ maxWidth: "100%" }}>
            <div className="meta">
              <Icon name="terminal" size="xs" /> {t("Agent 终端", "Agent terminal")}
              {output && ` · ${t("更新于", "updated")} ${ago(output.at, t, lang)}`}
            </div>
            {outputError ? (
              <div className="note warn">
                <Icon name="alert" />
                <div className="small">
                  {t("读不到 Agent 的终端：它可能没有在运行。", "Could not read the Agent's terminal: it may not be running.")} {outputError}
                </div>
              </div>
            ) : (
              <pre className="bubble mono" style={{ fontSize: 11.5, maxHeight: 420, overflow: "auto", margin: 0 }}>
                {output?.text.trimEnd() || t("读取中…", "Reading…")}
              </pre>
            )}
          </div>
        </div>
        <div className="drawer-f">
          <textarea
            className="textarea"
            rows={2}
            value={text}
            placeholder={t("输入消息…（⌘Enter 发送）", "Write a message… (⌘Enter to send)")}
            aria-label={t("消息", "Message")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="row between">
            <span className="tiny muted">{t("聊天不能提高预算或扩大权限。", "Chat cannot raise budgets or widen permissions.")}</span>
            <Btn label={busy ? t("发送中…", "Sending…") : t("发送", "Send")} icon="send" kind="primary" size="sm" disabled={busy || !text.trim()} onClick={() => void send()} />
          </div>
        </div>
      </aside>
    </>
  );
}
