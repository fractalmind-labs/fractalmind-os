import { useCallback, useEffect, useState } from "react";
import { CoordinatorClient, type Sentinel } from "./lib/coordinator";
import { SentinelList } from "./components/SentinelList";

interface Conn {
  url: string;
  token: string;
}

const STORE_KEY = "agent-console.conn";

// Users paste bare hosts ("host.example.com"); default them to https so the
// stored URL is always parseable. A stored unparseable URL used to throw in
// render (new URL) and black-screen the app on every launch.
function normalizeUrl(raw: string): string | null {
  let url = raw.trim().replace(/\/+$/, "");
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = "https://" + url;
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function loadConn(): Conn | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const c = raw ? (JSON.parse(raw) as Conn) : null;
    if (!c) return null;
    const url = normalizeUrl(c.url);
    if (!url) {
      localStorage.removeItem(STORE_KEY); // stored junk: drop it, show the form
      return null;
    }
    return { ...c, url };
  } catch {
    return null;
  }
}

export function App() {
  const [conn, setConn] = useState<Conn | null>(loadConn);
  const [client, setClient] = useState<CoordinatorClient | null>(null);
  const [sentinels, setSentinels] = useState<Sentinel[]>([]);
  const [status, setStatus] = useState<string>("");
  const [connected, setConnected] = useState(false);

  // Build the client whenever the connection changes.
  useEffect(() => {
    setClient(conn ? new CoordinatorClient(conn.url, conn.token) : null);
    setConnected(false);
  }, [conn]);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const { sentinels } = await client.listSentinels();
      setSentinels(sentinels);
      setConnected(true);
      setStatus(`${sentinels.length} node(s) · updated ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setConnected(false);
      setStatus("error: " + (e as Error).message);
    }
  }, [client]);

  // Poll the coordinator while connected.
  useEffect(() => {
    if (!client) return;
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [client, refresh]);

  if (!conn) return <ConnectForm onConnect={setConn} />;

  return (
    <div className="app">
      <header className="bar">
        <div>
          <strong>Agent Console</strong>{" "}
          <span className={connected ? "dot ok" : "dot bad"} />
          <span className="muted"> {hostOf(conn.url)}</span>
        </div>
        <div className="muted small">{status}</div>
        <div>
          <button onClick={refresh}>Refresh</button>{" "}
          <button
            onClick={() => {
              localStorage.removeItem(STORE_KEY);
              setConn(null);
            }}
          >
            Disconnect
          </button>
        </div>
      </header>
      {client && <SentinelList client={client} sentinels={sentinels} />}
    </div>
  );
}

function ConnectForm({ onConnect }: { onConnect: (c: Conn) => void }) {
  const [url, setUrl] = useState("http://localhost:8080");
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");

  return (
    <div className="connect">
      <h1>Agent Console</h1>
      <p className="muted">Connect to an envd coordinator to manage its agents.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const normalized = normalizeUrl(url);
          if (!normalized) {
            setErr("Invalid coordinator URL");
            return;
          }
          const c = { url: normalized, token: token.trim() };
          localStorage.setItem(STORE_KEY, JSON.stringify(c));
          onConnect(c);
        }}
      >
        <label>
          Coordinator URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://host:8080" />
        </label>
        <label>
          API token
          <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="bearer token" />
        </label>
        <button type="submit">Connect</button>
        {err && <p className="muted small">{err}</p>}
      </form>
    </div>
  );
}
