#!/usr/bin/env bash
set -euo pipefail

PORT="${CODEX_CDP_PORT:-9222}"
APP_PATH="${CODEX_APP_PATH:-/Applications/Codex.app}"
MODE="${CODEX_CDP_MONITOR_MODE:-relaunch}"
COOLDOWN_SECONDS="${CODEX_CDP_MONITOR_COOLDOWN_SECONDS:-90}"
LOG_FILE="${CODEX_CDP_MONITOR_LOG:-$HOME/.codex/log/codex-cdp-monitor.log}"
STAMP_FILE="${CODEX_CDP_MONITOR_STAMP:-$HOME/.codex/tmp/codex-cdp-monitor.last-start}"

usage() {
  cat <<'EOF'
Usage: codex-cdp-monitor.sh [--port PORT] [--app PATH] [--mode relaunch|new-instance] [--status]

Checks whether the local Codex App Chrome DevTools Protocol endpoint is reachable.
If it is not reachable, starts Codex App with --remote-debugging-port=PORT.

Modes:
  relaunch      Gracefully quit existing Codex App processes, then start one CDP-enabled instance.
  new-instance  Start a CDP-enabled instance without quitting existing Codex App processes.

Environment:
  CODEX_CDP_PORT                       Default: 9222
  CODEX_APP_PATH                       Default: /Applications/Codex.app
  CODEX_CDP_MONITOR_MODE               Default: relaunch
  CODEX_CDP_MONITOR_COOLDOWN_SECONDS   Default: 90
  CODEX_CDP_MONITOR_LOG                Default: ~/.codex/log/codex-cdp-monitor.log
  CODEX_CDP_MONITOR_STAMP              Default: ~/.codex/tmp/codex-cdp-monitor.last-start
EOF
}

STATUS_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --app)
      APP_PATH="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --status)
      STATUS_ONLY=1
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

case "$MODE" in
  relaunch|new-instance) ;;
  *)
    echo "--mode must be relaunch or new-instance" >&2
    exit 2
    ;;
esac

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$STAMP_FILE")"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >>"$LOG_FILE"
}

cdp_up() {
  command -v curl >/dev/null 2>&1 &&
    curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1
}

codex_pids() {
  ps -axo pid=,command= |
    awk -v app="$APP_PATH/Contents/MacOS/Codex" 'index($0, app) {print $1}'
}

codex_cdp_pids() {
  ps -axo pid=,command= |
    awk -v app="$APP_PATH/Contents/MacOS/Codex" -v port="--remote-debugging-port=${PORT}" 'index($0, app) && index($0, port) {print $1}'
}

recent_start() {
  [[ -f "$STAMP_FILE" ]] || return 1
  now="$(date +%s)"
  last="$(cat "$STAMP_FILE" 2>/dev/null || echo 0)"
  [[ "$last" =~ ^[0-9]+$ ]] || return 1
  (( now - last < COOLDOWN_SECONDS ))
}

print_status() {
  if cdp_up; then
    echo "cdp=up port=${PORT}"
  else
    echo "cdp=down port=${PORT}"
  fi
  echo "app_path=${APP_PATH}"
  echo "mode=${MODE}"
  echo "codex_pids=$(codex_pids | xargs echo)"
  echo "codex_cdp_pids=$(codex_cdp_pids | xargs echo)"
  echo "log_file=${LOG_FILE}"
}

start_cdp_instance() {
  if [[ ! -d "$APP_PATH" ]]; then
    log "ERROR app path not found: $APP_PATH"
    echo "Codex app path not found: $APP_PATH" >&2
    exit 1
  fi

  echo "$(date +%s)" >"$STAMP_FILE"
  log "starting Codex App with CDP on port ${PORT}; mode=${MODE}"
  open -na "$APP_PATH" --args "--remote-debugging-port=${PORT}"
}

relaunch_with_cdp() {
  existing="$(codex_pids | xargs echo)"
  if [[ -n "$existing" ]]; then
    log "quitting existing Codex App pids before CDP relaunch: $existing"
    osascript -e 'tell application "Codex" to quit' >/dev/null 2>&1 || true
    for _ in {1..20}; do
      [[ -z "$(codex_pids | xargs echo)" ]] && break
      sleep 0.5
    done
  fi
  start_cdp_instance
}

if [[ "$STATUS_ONLY" == "1" ]]; then
  print_status
  exit 0
fi

if cdp_up; then
  log "CDP already reachable on port ${PORT}"
  exit 0
fi

if recent_start; then
  log "CDP down on port ${PORT}, but cooldown is active; skipping restart"
  exit 0
fi

case "$MODE" in
  relaunch)
    relaunch_with_cdp
    ;;
  new-instance)
    start_cdp_instance
    ;;
esac

for _ in {1..20}; do
  if cdp_up; then
    log "CDP reachable on port ${PORT} after start"
    exit 0
  fi
  sleep 0.5
done

log "WARN Codex App launched but CDP did not become reachable on port ${PORT}"
exit 1
