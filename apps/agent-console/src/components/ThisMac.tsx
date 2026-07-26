import { useCallback, useEffect, useState } from "react";
import {
  checkLabel,
  getHostStatus,
  getMacosPermissions,
  helperInstallAvailable,
  hostVerified,
  installHost,
  openPermissionSettings,
  restartHost,
  rollbackHost,
  type Check,
  type HostOperationResult,
  type HostStatus,
  type MacosPermissions,
  type PermissionCheck,
} from "../lib/host";

export function ThisMac() {
  const [permissions, setPermissions] = useState<MacosPermissions | null>(null);
  const [host, setHost] = useState<HostStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [op, setOp] = useState<HostOperationResult | null>(null);

  const refresh = useCallback(async () => {
    const [nextPermissions, nextHost] = await Promise.all([getMacosPermissions(), getHostStatus()]);
    setPermissions(nextPermissions);
    setHost(nextHost);
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (name: string, fn: () => Promise<HostOperationResult>) => {
    setBusy(name);
    setOp(null);
    try {
      setOp(await fn());
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const verified = host && permissions ? hostVerified(host, permissions) : false;
  const installAvailable = host ? helperInstallAvailable(host) : false;

  return (
    <main className="surface">
      <section className="section">
        <div className="section-head">
          <div>
            <h2>This Mac</h2>
            <p className="muted small">
              Local Host setup for <strong>/Applications/FractalMind.app</strong> · bundle id{" "}
              <code>ai.fractalmind.app</code>
            </p>
          </div>
          <button onClick={refresh}>Refresh</button>
        </div>
        <div className={"status-strip " + (verified ? "ok" : "bad")}>
          {verified ? "Host setup verified" : "Host setup not fully verified"}
        </div>
      </section>

      <section className="section">
        <h3>Permissions</h3>
        <div className="grid two">
          {permissions ? (
            <>
              <PermissionRow check={permissions.screenRecording} kind="screen_recording" />
              <PermissionRow check={permissions.accessibility} kind="accessibility" />
            </>
          ) : (
            <div className="muted">Reading macOS permission state…</div>
          )}
        </div>
      </section>

      <section className="section">
        <h3>Host Helper</h3>
        {host ? (
          <>
            <div className="grid two">
              <CheckRow title="Bundled helper source" check={host.helperSource} />
              <CheckRow title="Installed exact helper" check={host.helperInstalled} />
              <CheckRow title="Worker service running" check={host.workerRunning} />
              <CheckRow title="Worker authenticated" check={host.workerAuthenticated} />
              <CheckRow title="Desktop health" check={host.desktopHealth} />
              <CheckRow title="ICE/media status" check={host.mediaStatus} />
              <CheckRow title="Orphan ffmpeg" check={host.orphanFfmpeg} />
            </div>
            <div className="cmd host-actions">
              <button onClick={() => run("install", installHost)} disabled={busy !== null || !installAvailable}>
                {busy === "install" ? "Installing…" : "Install Host"}
              </button>
              <button onClick={() => run("restart", restartHost)} disabled={busy !== null}>
                {busy === "restart" ? "Restarting…" : "Restart"}
              </button>
              <button onClick={() => run("rollback", rollbackHost)} disabled={busy !== null}>
                {busy === "rollback" ? "Rolling back…" : "Rollback"}
              </button>
            </div>
            {!installAvailable && (
              <p className="muted small">
                Install is intentionally disabled until the app bundle contains deterministic signed helper assets and
                a SHA256 manifest. The app will not download or execute an unverified helper.
              </p>
            )}
            {op && <pre className={"result " + (op.success ? "ok" : "bad")}>{op.code + ": " + op.message}</pre>}
            <PathList host={host} />
          </>
        ) : (
          <div className="muted">Reading host status…</div>
        )}
      </section>

      <section className="section">
        <h3>Runtime Boundary</h3>
        <p className="muted">
          Console control and Host operations are separate internally. This surface never stores coordinator tokens in
          helper files, never bypasses macOS TCC consent, and does not claim to fix envd Issue #79.
        </p>
      </section>
    </main>
  );
}

function PermissionRow({
  check,
  kind,
}: {
  check: PermissionCheck;
  kind: "screen_recording" | "accessibility";
}) {
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState("");
  return (
    <div className="card compact">
      <div className="card-head">
        <span className={"pill " + check.state}>{checkLabel(check.state)}</span>
        <strong>{check.label}</strong>
      </div>
      <p className="muted small">{check.message}</p>
      <code className="path">{check.settingsUrl}</code>
      <button
        onClick={async () => {
          setOpening(true);
          const next = await openPermissionSettings(kind);
          setResult(next.message);
          setOpening(false);
        }}
        disabled={opening || check.state === "unsupported"}
      >
        {opening ? "Opening…" : "Open System Settings"}
      </button>
      {result && <p className="muted small">{result}</p>}
    </div>
  );
}

function CheckRow({ title, check }: { title: string; check: Check }) {
  return (
    <div className="card compact">
      <div className="card-head">
        <span className={"pill " + check.state}>{checkLabel(check.state)}</span>
        <strong>{title}</strong>
      </div>
      <p className="muted small">{check.message}</p>
      {check.detail && <code className="path">{check.detail}</code>}
    </div>
  );
}

function PathList({ host }: { host: HostStatus }) {
  return (
    <div className="paths">
      <div>
        <span className="muted small">App</span>
        <code className="path">{host.paths.appInstallPath}</code>
      </div>
      <div>
        <span className="muted small">Helpers</span>
        <code className="path">{host.paths.helperDir}</code>
      </div>
      <div>
        <span className="muted small">LaunchAgent</span>
        <code className="path">{host.paths.launchAgentPath}</code>
      </div>
      <div>
        <span className="muted small">Rollback</span>
        <code className="path">{host.paths.rollbackDir}</code>
      </div>
    </div>
  );
}
