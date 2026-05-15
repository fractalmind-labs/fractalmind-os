#!/usr/bin/env bash
set -euo pipefail

LABEL="${CODEX_CDP_MONITOR_LABEL:-ai.fractalmind.codex-cdp-monitor}"
PORT="${CODEX_CDP_PORT:-9222}"
APP_PATH="${CODEX_APP_PATH:-/Applications/Codex.app}"
MODE="${CODEX_CDP_MONITOR_MODE:-relaunch}"
INTERVAL="${CODEX_CDP_MONITOR_INTERVAL:-60}"
RUN_AT_LOAD="${CODEX_CDP_MONITOR_RUN_AT_LOAD:-false}"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/${LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONITOR_SCRIPT="$SCRIPT_DIR/codex-cdp-monitor.sh"

usage() {
  cat <<'EOF'
Usage: install-codex-cdp-monitor.sh [--install] [--uninstall] [--status]
                                    [--port PORT] [--mode relaunch|new-instance]
                                    [--interval SECONDS] [--run-at-load]

Installs a per-user macOS LaunchAgent that checks the Codex App CDP endpoint every
60 seconds by default and starts Codex with --remote-debugging-port when CDP is down.

Options:
  --install              Install or update the LaunchAgent. Default action.
  --uninstall            Stop and remove the LaunchAgent.
  --status               Print LaunchAgent and CDP monitor status.
  --port PORT            CDP port. Default: 9222.
  --mode MODE            relaunch or new-instance. Default: relaunch.
  --interval SECONDS     LaunchAgent StartInterval. Default: 60.
  --run-at-load          Also run once immediately when the LaunchAgent is loaded.

Notes:
  relaunch mode is the most reliable way to make the active Codex App expose CDP,
  but it can close currently open Codex windows when the monitor repairs CDP.
  new-instance mode avoids quitting existing windows, but can leave multiple app
  instances running.
EOF
}

ACTION="install"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      ACTION="install"
      shift
      ;;
    --uninstall)
      ACTION="uninstall"
      shift
      ;;
    --status)
      ACTION="status"
      shift
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --interval)
      INTERVAL="${2:-}"
      shift 2
      ;;
    --run-at-load)
      RUN_AT_LOAD="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "--port must be numeric" >&2
  exit 2
fi

if ! [[ "$INTERVAL" =~ ^[0-9]+$ ]] || [[ "$INTERVAL" -lt 10 ]]; then
  echo "--interval must be an integer >= 10" >&2
  exit 2
fi

case "$MODE" in
  relaunch|new-instance) ;;
  *)
    echo "--mode must be relaunch or new-instance" >&2
    exit 2
    ;;
esac

launchctl_target="gui/$(id -u)"

unload_agent() {
  launchctl bootout "$launchctl_target" "$PLIST_PATH" >/dev/null 2>&1 || true
  launchctl disable "$launchctl_target/$LABEL" >/dev/null 2>&1 || true
  launchctl unload -w "$PLIST_PATH" >/dev/null 2>&1 || true
}

write_plist() {
  mkdir -p "$PLIST_DIR" "$HOME/.codex/log" "$HOME/.codex/tmp"
  cat >"$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${MONITOR_SCRIPT}</string>
    <string>--port</string>
    <string>${PORT}</string>
    <string>--app</string>
    <string>${APP_PATH}</string>
    <string>--mode</string>
    <string>${MODE}</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>RunAtLoad</key>
  <${RUN_AT_LOAD}/>
  <key>StandardOutPath</key>
  <string>${HOME}/.codex/log/codex-cdp-monitor.launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.codex/log/codex-cdp-monitor.launchd.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CODEX_CDP_MONITOR_LOG</key>
    <string>${HOME}/.codex/log/codex-cdp-monitor.log</string>
    <key>CODEX_CDP_MONITOR_STAMP</key>
    <string>${HOME}/.codex/tmp/codex-cdp-monitor.last-start</string>
  </dict>
</dict>
</plist>
EOF
}

print_status() {
  echo "label=${LABEL}"
  echo "plist=${PLIST_PATH}"
  if [[ -f "$PLIST_PATH" ]]; then
    echo "plist_installed=1"
  else
    echo "plist_installed=0"
  fi
  launchctl print "$launchctl_target/$LABEL" >/tmp/codex-cdp-monitor.launchctl.$$ 2>&1 &&
    sed -n '1,80p' /tmp/codex-cdp-monitor.launchctl.$$ ||
    {
      sed -n '1,40p' /tmp/codex-cdp-monitor.launchctl.$$
      launchctl list "$LABEL" 2>/dev/null || true
    }
  rm -f /tmp/codex-cdp-monitor.launchctl.$$
  "$MONITOR_SCRIPT" --port "$PORT" --app "$APP_PATH" --mode "$MODE" --status
}

load_agent() {
  bootstrap_log="$(mktemp -t codex-cdp-monitor-bootstrap.XXXXXX)"
  if launchctl bootstrap "$launchctl_target" "$PLIST_PATH" >"$bootstrap_log" 2>&1; then
    rm -f "$bootstrap_log"
    return 0
  fi

  if launchctl load -w "$PLIST_PATH" >"$bootstrap_log" 2>&1; then
    echo "launchctl bootstrap failed; loaded with legacy launchctl load -w fallback"
    rm -f "$bootstrap_log"
    return 0
  fi

  cat "$bootstrap_log" >&2
  rm -f "$bootstrap_log"
  return 1
}

case "$ACTION" in
  install)
    chmod +x "$MONITOR_SCRIPT"
    unload_agent
    write_plist
    load_agent
    launchctl enable "$launchctl_target/$LABEL" >/dev/null 2>&1 || true
    echo "Installed ${LABEL}"
    echo "Plist: ${PLIST_PATH}"
    echo "Interval: ${INTERVAL}s"
    echo "Mode: ${MODE}"
    "$MONITOR_SCRIPT" --port "$PORT" --app "$APP_PATH" --mode "$MODE" --status
    ;;
  uninstall)
    unload_agent
    rm -f "$PLIST_PATH"
    echo "Uninstalled ${LABEL}"
    ;;
  status)
    print_status
    ;;
esac
