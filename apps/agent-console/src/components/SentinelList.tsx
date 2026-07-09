import { useState } from "react";
import { CoordinatorClient, type CommandResult, type Sentinel } from "../lib/coordinator";
import { RemoteDesktop } from "./RemoteDesktop";

// The remote commands the envd worker understands (see handleCommand).
const COMMANDS = ["status", "logs", "restart", "kill", "shell"] as const;

interface DesktopSession {
  url: string;
  token: string;
}

export function SentinelList({
  client,
  sentinels,
  defaultToken,
}: {
  client: CoordinatorClient;
  sentinels: Sentinel[];
  defaultToken: string;
}) {
  const [desktop, setDesktop] = useState<DesktopSession | null>(null);

  if (desktop) {
    return (
      <RemoteDesktop url={desktop.url} token={desktop.token} onClose={() => setDesktop(null)} />
    );
  }

  // Open the desktop viewer for a node. Priority for the endpoint:
  //   1. desktop_url advertised by the node itself (no prompt) — the goal state,
  //      set once on the worker instead of typed by every viewer;
  //   2. the URL/token this client last used for this node (remembered), so a
  //      manual entry is a one-time cost per node, not per session.
  const openDesktop = (s: Sentinel) => {
    const remembered = loadDesktop(s.id);
    if (s.desktop_url) {
      setDesktop({ url: s.desktop_url, token: remembered?.token ?? defaultToken });
      return;
    }
    const url = window.prompt(
      "Remote desktop URL (envd-desktop server)",
      remembered?.url ?? "https://",
    );
    if (!url) return;
    const token = window.prompt("Desktop token", remembered?.token ?? defaultToken) ?? "";
    saveDesktop(s.id, { url, token });
    setDesktop({ url, token });
  };

  if (sentinels.length === 0) {
    return <div className="empty muted">No nodes registered on this coordinator yet.</div>;
  }
  return (
    <div className="list">
      {sentinels.map((s) => (
        <SentinelCard key={s.id} client={client} sentinel={s} onDesktop={() => openDesktop(s)} />
      ))}
    </div>
  );
}

const DESKTOP_KEY = (id: string) => `agent-console.desktop.${id}`;

function loadDesktop(id: string): DesktopSession | null {
  try {
    const raw = localStorage.getItem(DESKTOP_KEY(id));
    return raw ? (JSON.parse(raw) as DesktopSession) : null;
  } catch {
    return null;
  }
}

function saveDesktop(id: string, s: DesktopSession) {
  try {
    localStorage.setItem(DESKTOP_KEY(id), JSON.stringify(s));
  } catch {
    /* storage unavailable: fall back to per-session entry */
  }
}

function ageSeconds(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 1000));
}

function SentinelCard({
  client,
  sentinel: s,
  onDesktop,
}: {
  client: CoordinatorClient;
  sentinel: Sentinel;
  onDesktop: () => void;
}) {
  const [cmd, setCmd] = useState<(typeof COMMANDS)[number]>("status");
  const [agentId, setAgentId] = useState("");
  const [args, setArgs] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [busy, setBusy] = useState(false);

  const hb = ageSeconds(s.last_heartbeat);
  const alive = hb !== null && hb < 90;

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await client.sendCommand(s.id, cmd, agentId, args));
    } catch (e) {
      setResult({ success: false, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <span className={alive ? "dot ok" : "dot bad"} />
        <strong>{s.hostname || s.id}</strong>
        <span className="muted small">
          v{s.version} · {s.agent_count} agent(s) · up {Math.round((s.uptime_seconds || 0) / 60)}m
          {hb !== null ? ` · hb ${hb}s ago` : " · no heartbeat"}
        </span>
      </div>
      {s.system && (
        <div className="muted small sys">
          {s.system.os} {s.system.arch}
          {s.system.cpu_percent != null ? ` · cpu ${s.system.cpu_percent}%` : ""}
          {s.system.mem_percent != null ? ` · mem ${s.system.mem_percent}%` : ""}
        </div>
      )}
      <div className="cmd">
        <select value={cmd} onChange={(e) => setCmd(e.target.value as (typeof COMMANDS)[number])}>
          {COMMANDS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {(cmd === "restart" || cmd === "kill" || cmd === "logs") && (
          <input placeholder="agent id" value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        )}
        {(cmd === "shell" || cmd === "logs") && (
          <input
            placeholder={cmd === "shell" ? "command" : "lines (default 100)"}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
        )}
        <button onClick={run} disabled={busy}>
          {busy ? "…" : "Run"}
        </button>
        <button onClick={onDesktop} title="Open WebRTC remote desktop">
          🖥 Desktop
        </button>
      </div>
      {result && (
        <pre className={"result " + (result.success ? "ok" : "bad")}>
          {result.error
            ? "error: " + result.error
            : result.output ?? result.logs ?? result.message ?? JSON.stringify(result.agents ?? result, null, 2)}
        </pre>
      )}
    </div>
  );
}
