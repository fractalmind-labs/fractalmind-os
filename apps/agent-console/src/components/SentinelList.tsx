import { useState } from "react";
import { CoordinatorClient, type CommandResult, type Sentinel, type ControlAction } from "../lib/coordinator";
import { RemoteDesktop } from "./RemoteDesktop";

// The remote commands the envd worker understands (see handleCommand).
const COMMANDS: ControlAction[] = ["inventory", "status", "logs", "start", "stop", "assign", "monitor", "health", "availability"];

export function SentinelList({
  client,
  sentinels,
}: {
  client: CoordinatorClient;
  sentinels: Sentinel[];
}) {
  // Desktop signaling is relayed through the coordinator, so opening a node's
  // desktop needs only its id — no URL, no token, no prompt.
  const [desktopNode, setDesktopNode] = useState<string | null>(null);

  if (desktopNode) {
    return (
      <RemoteDesktop client={client} nodeId={desktopNode} onClose={() => setDesktopNode(null)} />
    );
  }

  if (sentinels.length === 0) {
    return <div className="empty muted">No nodes registered on this coordinator yet.</div>;
  }
  return (
    <div className="list">
      {sentinels.map((s) => (
        <SentinelCard key={s.id} client={client} sentinel={s} onDesktop={() => setDesktopNode(s.id)} />
      ))}
    </div>
  );
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
  const [cmd, setCmd] = useState<ControlAction>("inventory");
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
      setResult(await client.sendCommand(s.id, cmd, agentId, args, s.host_id || s.id));
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
        <select value={cmd} onChange={(e) => setCmd(e.target.value as ControlAction)}>
          {COMMANDS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {cmd !== 'inventory' && cmd !== 'health' && (
          <input placeholder="agent id" value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        )}
        {(cmd === "assign" || cmd === "logs" || cmd === 'monitor') && (
          <input
            placeholder={cmd === "assign" ? "task" : "lines (default 100)"}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
        )}
        <button onClick={run} disabled={busy || !client.canSendCommands()} title={client.canSendCommands() ? 'Run authorized action' : 'Connect an authorized signing device'}>
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
