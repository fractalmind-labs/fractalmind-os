#!/usr/bin/env bash
set -euo pipefail

CODEX_BIN="${CODEX_BIN:-/Applications/Codex.app/Contents/Resources/codex}"
STATE_DB="${CODEX_STATE_DB:-}"
THREAD_ID=""
AGENT=""
CWD_FILTER=""
MESSAGE=""
MESSAGE_FILE=""
WS_URL="${CODEX_APP_SERVER_WS_URL:-}"
WS_URL_EXPLICIT="0"
if [[ -n "$WS_URL" ]]; then
  WS_URL_EXPLICIT="1"
fi
SOCK="${CODEX_APP_SERVER_SOCK:-}"
CDP_ENDPOINT="${CODEX_APP_CDP_ENDPOINT:-}"
CDP_SELECTOR="${CODEX_APP_CDP_SELECTOR:-}"
HOST_ID="${CODEX_APP_HOST_ID:-local}"
CONVERSATION_ID="${CODEX_APP_CONVERSATION_ID:-}"
TRANSPORT="${CODEX_APP_SERVER_TRANSPORT:-auto}"
MODE="auto"
EXPECTED_TURN_ID=""
INCLUDE_ARCHIVED="0"
DRY_RUN="0"
JSON_OUTPUT="0"
TIMEOUT_MS="${CODEX_APP_SERVER_TIMEOUT_MS:-20000}"

usage() {
  cat <<'EOF'
Usage: send-codex-app-agent-message.sh (--thread-id ID | --agent NAME [--cwd TEXT]) --message TEXT [options]

Sends a user message to a Codex App agent/thread returned by list-codex-app-agents.sh.
Prefer --thread-id copied from the list output. Name-based targeting must resolve to exactly one thread.

Targeting:
  --thread-id ID          Exact thread id from list-codex-app-agents.sh.
  --agent NAME            Exact agent display name, agent nickname, or title.
  --cwd TEXT              Optional cwd substring to disambiguate --agent.
  --state-db PATH         Override Codex state sqlite path.
  --include-archived      Allow archived threads while resolving the target.

Message:
  --message TEXT          Message text to deliver.
  --message-file PATH     Read message text from a file. Use "-" for stdin.

Transport:
  --ws-url URL            App-server WebSocket URL, for example ws://127.0.0.1:17890.
  --transport auto|ws|cdp
  --cdp-endpoint URL      CDP HTTP endpoint, for example http://127.0.0.1:9222.
  --cdp-selector TEXT     Optional CDP target selector matched against page title or URL.
  --host-id ID            Codex App host id for CDP renderer bridge. Defaults to local.
  --conversation-id ID    Codex App conversation id for CDP bridge. Defaults to --thread-id.
  --timeout-ms N          Per-request timeout in milliseconds.

Turn behavior:
  --steer                 Send to the active turn with turn/steer. Requires an active turn.
  --expected-turn-id ID   Active turn id precondition for --steer. If omitted, the script
                          reads the thread and uses the single in-progress turn.
  --start                 Force turn/start for idle or notLoaded threads.

Other:
  --dry-run               Resolve target and verify app-server/CDP readback without sending.
  --json                  Emit JSON report.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --thread-id)
      THREAD_ID="${2:-}"
      shift 2
      ;;
    --agent|--name)
      AGENT="${2:-}"
      shift 2
      ;;
    --cwd)
      CWD_FILTER="${2:-}"
      shift 2
      ;;
    --state-db)
      STATE_DB="${2:-}"
      shift 2
      ;;
    --include-archived)
      INCLUDE_ARCHIVED="1"
      shift
      ;;
    --message)
      MESSAGE="${2:-}"
      shift 2
      ;;
    --message-file)
      MESSAGE_FILE="${2:-}"
      shift 2
      ;;
    --ws-url)
      WS_URL="${2:-}"
      WS_URL_EXPLICIT="1"
      shift 2
      ;;
    --transport)
      TRANSPORT="${2:-}"
      shift 2
      ;;
    --sock)
      SOCK="${2:-}"
      shift 2
      ;;
    --cdp-endpoint)
      CDP_ENDPOINT="${2:-}"
      shift 2
      ;;
    --cdp-selector)
      CDP_SELECTOR="${2:-}"
      shift 2
      ;;
    --host-id)
      HOST_ID="${2:-}"
      shift 2
      ;;
    --conversation-id)
      CONVERSATION_ID="${2:-}"
      shift 2
      ;;
    --steer)
      MODE="steer"
      shift
      ;;
    --start)
      MODE="start"
      shift
      ;;
    --expected-turn-id)
      EXPECTED_TURN_ID="${2:-}"
      shift 2
      ;;
    --timeout-ms)
      TIMEOUT_MS="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="1"
      shift
      ;;
    --json)
      JSON_OUTPUT="1"
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

case "$TRANSPORT" in
  auto|ws|cdp) ;;
  *)
    echo "--transport must be one of: auto, ws, cdp" >&2
    exit 2
    ;;
esac

if [[ -n "$SOCK" ]]; then
  echo "--sock/codex app-server proxy is not supported. Use the current Codex App CDP endpoint or pass an explicit --ws-url." >&2
  exit 2
fi

if ! [[ "$TIMEOUT_MS" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_MS" -lt 1000 ]]; then
  echo "--timeout-ms must be an integer >= 1000" >&2
  exit 2
fi

if [[ -z "$THREAD_ID" && -z "$AGENT" ]]; then
  echo "target required: pass --thread-id from list-codex-app-agents.sh, or --agent with optional --cwd" >&2
  exit 2
fi

if [[ -n "$MESSAGE" && -n "$MESSAGE_FILE" ]]; then
  echo "pass only one of --message or --message-file" >&2
  exit 2
fi

if [[ -n "$MESSAGE_FILE" ]]; then
  if [[ "$MESSAGE_FILE" == "-" ]]; then
    MESSAGE="$(cat)"
  else
    MESSAGE="$(cat "$MESSAGE_FILE")"
  fi
fi

if [[ -z "$MESSAGE" ]]; then
  echo "message required: pass --message or --message-file" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required for app-server or CDP delivery" >&2
  exit 2
fi

if [[ -z "$STATE_DB" ]]; then
  STATE_DB="$(ls -t "$HOME"/.codex/state_*.sqlite 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$STATE_DB" || ! -f "$STATE_DB" ]]; then
  echo "No Codex state database found. Set CODEX_STATE_DB or pass --state-db." >&2
  exit 1
fi

if [[ -z "$CDP_ENDPOINT" && "$TRANSPORT" != "ws" ]]; then
  devtools_file="$HOME/Library/Application Support/Codex/DevToolsActivePort"
  if [[ -f "$devtools_file" ]]; then
    cdp_port="$(sed -n '1p' "$devtools_file" 2>/dev/null || true)"
    [[ -n "$cdp_port" ]] && CDP_ENDPOINT="http://127.0.0.1:${cdp_port}"
  elif command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "http://127.0.0.1:9222/json/list" >/dev/null 2>&1; then
    CDP_ENDPOINT="http://127.0.0.1:9222"
  fi
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
targets_json="$tmpdir/targets.json"
message_path="$tmpdir/message.txt"
printf '%s' "$MESSAGE" > "$message_path"

resolved_from_sidebar="0"
if [[ -n "$AGENT" && -n "$CDP_ENDPOINT" && "$TRANSPORT" != "ws" ]]; then
  if CDP_ENDPOINT="$CDP_ENDPOINT" CDP_SELECTOR="$CDP_SELECTOR" AGENT="$AGENT" CWD_FILTER="$CWD_FILTER" TIMEOUT_MS="$TIMEOUT_MS" node > "$targets_json" <<'NODE'
const endpoint = (process.env.CDP_ENDPOINT || "").replace(/\/+$/, "");
const selector = process.env.CDP_SELECTOR || "";
const agent = process.env.AGENT || "";
const cwdFilter = process.env.CWD_FILTER || "";
const timeoutMs = Number(process.env.TIMEOUT_MS || 20000);

async function selectCdpTarget() {
  if (!endpoint || typeof WebSocket !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${endpoint}/json/list`, { signal: controller.signal });
    if (!response.ok) return null;
    const targets = await response.json();
    for (const candidate of targets) {
      if (!candidate.webSocketDebuggerUrl) continue;
      if (!selector && ["page", "webview", "other"].includes(candidate.type)) return candidate;
      if (selector && (`${candidate.title || ""}\n${candidate.url || ""}`).includes(selector)) return candidate;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function cdpEvaluate(wsDebuggerUrl, expression) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(wsDebuggerUrl);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch {}
        reject(new Error("Timed out reading Codex App sidebar through CDP"));
      }
    }, timeoutMs);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
    ws.addEventListener("message", (event) => {
      let response;
      try {
        response = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (response.id !== 1) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (response.error || response.result?.exceptionDetails) {
        reject(new Error("CDP sidebar read failed"));
        return;
      }
      resolve(response.result?.result?.value || []);
    });
    ws.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("CDP websocket failed while reading sidebar"));
      }
    });
  });
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

async function main() {
  const target = await selectCdpTarget();
  if (!target) {
    process.stdout.write("[]");
    return;
  }

  const rows = await cdpEvaluate(target.webSocketDebuggerUrl, `(() => {
  const result = [];
  const sidebarRows = Array.from(document.querySelectorAll("[data-app-action-sidebar-thread-row]"));
  for (const row of sidebarRows) {
    const rawId = row.getAttribute("data-app-action-sidebar-thread-id") || "";
    const id = rawId.replace(/^local:/, "");
    const title = row.getAttribute("data-app-action-sidebar-thread-title") || "";
    if (!id || !title) continue;
    const labels = [];
    for (let el = row; el && labels.length < 20; el = el.parentElement) {
      for (const attr of ["aria-label", "data-project-name", "data-cwd", "title"]) {
        const value = el.getAttribute && el.getAttribute(attr);
        if (value && !labels.includes(value)) labels.push(value);
      }
    }
    const match_text = [title, rawId, ...labels].join("\\n");
    result.push({
      id,
      agent: title,
      title,
      agent_nickname: title,
      role: null,
      cwd: labels.find((label) => label !== title && !label.startsWith("local:")) || null,
      model: null,
      reasoning_effort: null,
      source: "sidebar-visible",
      updated_at: null,
      archived: 0,
      active: row.getAttribute("data-app-action-sidebar-thread-active") === "true",
      match_text,
    });
  }
  return result;
})()`);

  const exactName = rows.filter((row) => normalize(row.agent) === normalize(agent) || normalize(row.title) === normalize(agent));
  let matches = exactName;
  if (cwdFilter) {
    const cwdNeedle = normalize(cwdFilter);
    const cwdMatches = exactName.filter((row) => normalize(row.match_text).includes(cwdNeedle));
    matches = cwdMatches.length > 0 ? cwdMatches : (exactName.length === 1 ? exactName : []);
  }
  process.stdout.write(JSON.stringify(matches));
}

main().catch(() => {
  process.stdout.write("[]");
});
NODE
  then
    sidebar_count="$(node - "$targets_json" <<'NODE'
const fs = require("node:fs");
const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8") || "[]");
console.log(rows.length);
NODE
)"
    if [[ "$sidebar_count" != "0" ]]; then
      resolved_from_sidebar="1"
    fi
  fi
fi

if [[ "$resolved_from_sidebar" != "1" ]]; then
  sqlite3 -json "$STATE_DB" > "$targets_json" <<SQL
.parameter init
.parameter set :thread_id "$THREAD_ID"
.parameter set :agent "$AGENT"
.parameter set :cwd_filter "$CWD_FILTER"
.parameter set :include_archived $INCLUDE_ARCHIVED
select
  id,
  case
    when nullif(agent_nickname, '') is not null then agent_nickname
    else title
  end as agent,
  title,
  nullif(agent_nickname, '') as agent_nickname,
  nullif(agent_role, '') as role,
  cwd,
  model,
  reasoning_effort,
  source,
  datetime(updated_at, 'unixepoch') as updated_at,
  archived
from threads
where (:include_archived = 1 or archived = 0)
  and (:thread_id = '' or id = :thread_id)
  and (
    :agent = ''
    or (case
          when nullif(agent_nickname, '') is not null then agent_nickname
          else title
        end) = :agent
    or agent_nickname = :agent
  )
  and (:cwd_filter = '' or cwd like '%' || :cwd_filter || '%')
order by updated_at desc;
SQL
fi

target_count="$(node - "$targets_json" <<'NODE'
const fs = require("node:fs");
const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8") || "[]");
console.log(rows.length);
NODE
)"

if [[ "$target_count" == "0" ]]; then
  echo "No matching Codex App thread found in $STATE_DB." >&2
  exit 1
fi

if [[ "$target_count" != "1" ]]; then
  echo "Target is ambiguous; refine with --thread-id or --cwd. Candidates:" >&2
  node - "$targets_json" >&2 <<'NODE'
const fs = require("node:fs");
const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8") || "[]");
for (const row of rows.slice(0, 20)) {
  console.error(`${row.id}\t${row.agent || row.title}\t${row.cwd}\t${row.updated_at}`);
}
NODE
  exit 1
fi

target_json="$tmpdir/target.json"
node - "$targets_json" > "$target_json" <<'NODE'
const fs = require("node:fs");
const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8") || "[]");
process.stdout.write(JSON.stringify(rows[0]));
NODE

if [[ -z "$WS_URL" && "$TRANSPORT" == "ws" ]]; then
  discovered_ws_urls=()
  while IFS= read -r discovered_ws_url; do
    [[ -n "$discovered_ws_url" ]] && discovered_ws_urls+=("$discovered_ws_url")
  done < <(
    ps -axo command= \
      | sed -nE 's#.*--listen[ =](ws://127\.0\.0\.1:[0-9]+).*#\1#p' \
      | sort -u
  )
  if [[ "${#discovered_ws_urls[@]}" -eq 1 ]]; then
    WS_URL="${discovered_ws_urls[0]}"
  elif [[ "${#discovered_ws_urls[@]}" -gt 1 && "$TRANSPORT" == "ws" ]]; then
    echo "Multiple Codex app-server WebSocket listeners found; pass --ws-url explicitly:" >&2
    printf '  %s\n' "${discovered_ws_urls[@]}" >&2
    exit 1
  fi
fi

if [[ -z "$CONVERSATION_ID" ]]; then
  CONVERSATION_ID="$THREAD_ID"
fi

if [[ -z "$WS_URL" && "$TRANSPORT" == "auto" && -z "$CDP_ENDPOINT" ]]; then
  echo "No current Codex App CDP endpoint or explicit --ws-url found." >&2
  echo "This script does not start codex app-server automatically. Enable Codex App CDP, then retry:" >&2
  echo "  bash .codex/skills/use-codex-app/scripts/install-codex-cdp-monitor.sh --install" >&2
  exit 1
fi

if [[ "$TRANSPORT" == "auto" && "$WS_URL_EXPLICIT" != "1" && -n "$CDP_ENDPOINT" ]]; then
  TRANSPORT="cdp"
fi

node_report="$(
  TARGET_JSON="$target_json" \
  MESSAGE_PATH="$message_path" \
  CODEX_BIN="$CODEX_BIN" \
  WS_URL="$WS_URL" \
  SOCK="$SOCK" \
  CDP_ENDPOINT="$CDP_ENDPOINT" \
  CDP_SELECTOR="$CDP_SELECTOR" \
  HOST_ID="$HOST_ID" \
  CONVERSATION_ID="$CONVERSATION_ID" \
  TRANSPORT="$TRANSPORT" \
  MODE="$MODE" \
  EXPECTED_TURN_ID="$EXPECTED_TURN_ID" \
  DRY_RUN="$DRY_RUN" \
  TIMEOUT_MS="$TIMEOUT_MS" \
  node <<'NODE'
const fs = require("node:fs");

const target = JSON.parse(fs.readFileSync(process.env.TARGET_JSON, "utf8"));
const message = fs.readFileSync(process.env.MESSAGE_PATH, "utf8");
const timeoutMs = Number(process.env.TIMEOUT_MS || 20000);
const requestedTransport = process.env.TRANSPORT || "auto";
const wsUrl = process.env.WS_URL || "";
const sock = process.env.SOCK || "";
const cdpEndpoint = (process.env.CDP_ENDPOINT || "").replace(/\/+$/, "");
const cdpSelector = process.env.CDP_SELECTOR || "";
const hostId = process.env.HOST_ID || "local";
const conversationId = process.env.CONVERSATION_ID || target.id;
const dryRun = process.env.DRY_RUN === "1";
let mode = process.env.MODE || "auto";
let expectedTurnId = process.env.EXPECTED_TURN_ID || "";

class RpcClient {
  constructor(kind, sendRaw, closeFn) {
    this.kind = kind;
    this.sendRaw = sendRaw;
    this.closeFn = closeFn;
    this.nextId = 1;
    this.pending = new Map();
  }

  request(method, params) {
    const id = this.nextId++;
    const payload = { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.sendRaw(JSON.stringify(payload));
    });
  }

  handle(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(msg, "id")) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.error) {
      const detail = msg.error.data ? ` ${JSON.stringify(msg.error.data)}` : "";
      pending.reject(new Error(`${pending.method} failed: ${msg.error.message}${detail}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  rejectAll(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  close() {
    this.closeFn?.();
  }
}

async function connectWs(url) {
  if (typeof WebSocket !== "function") {
    throw new Error("This Node.js runtime does not expose global WebSocket; use Node 22+.");
  }
  return await new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timed out connecting to ${url}`));
      }
    }, timeoutMs);
    const client = new RpcClient("ws", (line) => ws.send(line), () => ws.close());
    ws.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(client);
    });
    ws.addEventListener("message", (event) => client.handle(String(event.data)));
    ws.addEventListener("error", () => {
      const error = new Error(`WebSocket connection failed: ${url}`);
      client.rejectAll(error);
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    ws.addEventListener("close", () => client.rejectAll(new Error(`WebSocket closed: ${url}`)));
  });
}

async function connect() {
  if ((requestedTransport === "auto" || requestedTransport === "ws") && wsUrl) {
    return await connectWs(wsUrl);
  }
  if (requestedTransport === "ws") {
    throw new Error("No --ws-url was provided and no single local app-server --listen ws://127.0.0.1:PORT process was discovered.");
  }
  throw new Error("No current Codex App CDP endpoint or explicit --ws-url found. This script does not start codex app-server automatically.");
}

async function selectCdpTarget(endpoint, selector) {
  if (!endpoint) throw new Error("CDP endpoint is required for --transport cdp.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${endpoint}/json/list`, { signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`query CDP targets: HTTP ${response.status}: ${body.slice(0, 300).trim()}`);
    }
    const targets = await response.json();
    for (const candidate of targets) {
      if (!candidate.webSocketDebuggerUrl) continue;
      if (!selector && ["page", "webview", "other"].includes(candidate.type)) return candidate;
      if (selector && (`${candidate.title || ""}\n${candidate.url || ""}`).includes(selector)) return candidate;
    }
    throw new Error(`no Codex App CDP target matched ${JSON.stringify(selector)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function cdpEvaluate(wsDebuggerUrl, expression) {
  if (typeof WebSocket !== "function") {
    throw new Error("This Node.js runtime does not expose global WebSocket; use Node 22+.");
  }
  return await new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(wsDebuggerUrl);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch {}
        reject(new Error("Timed out waiting for CDP Runtime.evaluate"));
      }
    }, timeoutMs);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
      }));
    });
    ws.addEventListener("message", (event) => {
      let response;
      try {
        response = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (response.id !== 1) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (response.error) {
        reject(new Error(`CDP Runtime.evaluate failed: ${response.error.message}`));
        return;
      }
      if (response.result?.exceptionDetails) {
        reject(new Error(`Codex App delivery script failed: ${response.result.exceptionDetails.text || "exception"}`));
        return;
      }
      resolve(response.result?.result?.value);
    });
    ws.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`connect CDP websocket failed: ${wsDebuggerUrl}`));
      }
    });
  });
}

function buildCdpDeliveryScript({ dryRunOnly }) {
  const payload = {
    hostId,
    conversationId,
    prompt: message,
    dryRun: dryRunOnly,
  };
  return `(async () => {
  const payload = ${JSON.stringify(payload)};
  const conversationId = payload.conversationId || (() => {
    const match = window.location.pathname.match(/\\/local\\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  })();
  if (!conversationId) {
    throw new Error("No target Codex App conversation id was provided and no /local/<conversationId> route is active.");
  }

  const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
  let signalsUrl = resources.find((name) => /app-server-manager-signals-[^/]+\\.js$/.test(name));
  if (!signalsUrl) {
    const scripts = Array.from(document.querySelectorAll("script[src]")).map((script) => script.src);
    const candidates = [...scripts, ...resources].filter((src) => /\\/assets\\/[^/]+\\.js$/.test(src));
    for (const candidate of candidates) {
      try {
        const source = await fetch(candidate).then((response) => response.text());
        const match = source.match(/["'](\\.\\/app-server-manager-signals-[^"']+\\.js)["']/);
        if (match) {
          signalsUrl = new URL(match[1], candidate).href;
          break;
        }
      } catch (_) {}
    }
  }
  if (!signalsUrl) {
    throw new Error("Unable to locate Codex App app-server-manager-signals bundle.");
  }

  const signals = await import(signalsUrl);
  const sendRequest = typeof signals.Kn === "function" ? signals.Kn : (typeof signals.rn === "function" ? signals.rn : null);
  if (typeof sendRequest !== "function") {
    throw new Error("Codex App app-server request bridge is unavailable.");
  }

  if (payload.dryRun) {
    return { ok: true, dryRun: true, conversationId, signalsUrl, bridge: "start-turn-for-host" };
  }

  const input = [{ type: "text", text: payload.prompt, text_elements: [] }];
  const result = await sendRequest("start-turn-for-host", {
    hostId: payload.hostId || "local",
    conversationId,
    params: { input }
  });
  return { ok: true, dryRun: false, conversationId, signalsUrl, result };
})()`;
}

async function deliverViaCdp() {
  if (mode === "steer") {
    throw new Error("--transport cdp uses Codex App start-turn-for-host and does not support --steer; use an explicit app-server --ws-url for turn/steer.");
  }
  const targetPage = await selectCdpTarget(cdpEndpoint, cdpSelector);
  const value = await cdpEvaluate(targetPage.webSocketDebuggerUrl, buildCdpDeliveryScript({ dryRunOnly: dryRun }));
  return {
    ok: true,
    dry_run: dryRun,
    transport: "cdp",
    cdp_endpoint: cdpEndpoint,
    cdp_target: {
      type: targetPage.type || null,
      title: targetPage.title || null,
      url: targetPage.url || null,
    },
    target: {
      threadId: target.id,
      agent: target.agent || target.title || null,
      title: target.title || null,
      cwd: target.cwd || null,
      source: target.source || null,
      updated_at: target.updated_at || null,
    },
    before_status: "not_checked_by_cdp",
    resumed: false,
    method: "start-turn-for-host",
    turn_id: null,
    conversation_id: value?.conversationId || conversationId,
    message_bytes: Buffer.byteLength(message, "utf8"),
    bridge: value?.bridge || "start-turn-for-host",
  };
}

function statusType(thread) {
  return thread?.status?.type || "unknown";
}

function latestInProgressTurn(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const active = turns.filter((turn) => turn.status === "inProgress");
  if (active.length !== 1) {
    return { error: `Expected exactly one in-progress turn, found ${active.length}.` };
  }
  return { turn: active[0] };
}

async function main() {
  if (requestedTransport === "cdp" || (requestedTransport === "auto" && !wsUrl)) {
    if (!cdpEndpoint && requestedTransport === "cdp") {
      throw new Error("No --cdp-endpoint was provided.");
    }
    if (cdpEndpoint) {
      console.log(JSON.stringify(await deliverViaCdp()));
      return;
    }
  }

  const client = await connect();
  try {
    await client.request("initialize", {
      clientInfo: { name: "use-codex-app-send-message", version: "0.1.0" },
      capabilities: { experimentalApi: true, optOutNotificationMethods: [] },
    });

    let read = await client.request("thread/read", { threadId: target.id, includeTurns: false });
    let thread = read.thread;
    let beforeStatus = statusType(thread);
    let resumed = false;
    let method = null;
    let params = null;
    let response = null;

    if (mode === "auto") {
      mode = beforeStatus === "active" ? "refuse-active" : "start";
    }

    if (mode === "refuse-active") {
      const activeRead = await client.request("thread/read", { threadId: target.id, includeTurns: true });
      const active = latestInProgressTurn(activeRead.thread);
      throw new Error(`Target thread is active. Re-run with --steer${active.turn ? ` --expected-turn-id ${active.turn.id}` : ""} if this message is intended for the current active turn.`);
    }

    if (mode === "steer") {
      const activeRead = await client.request("thread/read", { threadId: target.id, includeTurns: true });
      thread = activeRead.thread;
      beforeStatus = statusType(thread);
      if (beforeStatus !== "active") {
        throw new Error(`--steer requires an active thread, but target status is ${beforeStatus}.`);
      }
      if (!expectedTurnId) {
        const active = latestInProgressTurn(thread);
        if (active.error) throw new Error(active.error);
        expectedTurnId = active.turn.id;
      }
      method = "turn/steer";
      params = {
        threadId: target.id,
        expectedTurnId,
        input: [{ type: "text", text: message, text_elements: [] }],
      };
    } else if (mode === "start") {
      if (beforeStatus === "active") {
        throw new Error("Target thread is active. Use --steer for same-turn input, or interrupt it manually before starting a new turn.");
      }
      if (beforeStatus === "notLoaded" && !dryRun) {
        const resumedResponse = await client.request("thread/resume", { threadId: target.id });
        thread = resumedResponse.thread;
        resumed = true;
      }
      method = "turn/start";
      params = {
        threadId: target.id,
        input: [{ type: "text", text: message, text_elements: [] }],
      };
    } else {
      throw new Error(`Unsupported mode: ${mode}`);
    }

    if (!dryRun) {
      response = await client.request(method, params);
    }

    const report = {
      ok: true,
      dry_run: dryRun,
      transport: client.kind,
      ws_url: client.kind === "ws" ? wsUrl : null,
      cdp_endpoint: null,
      cdp_target: null,
      target: {
        threadId: target.id,
        agent: target.agent || target.title || null,
        title: target.title || null,
        cwd: target.cwd || null,
        source: target.source || null,
        updated_at: target.updated_at || null,
      },
      before_status: beforeStatus,
      resumed,
      method,
      turn_id: response?.turn?.id || response?.turnId || expectedTurnId || null,
      conversation_id: target.id,
      message_bytes: Buffer.byteLength(message, "utf8"),
    };
    console.log(JSON.stringify(report));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE
)"

if [[ "$JSON_OUTPUT" == "1" ]]; then
  printf '%s\n' "$node_report"
else
  node - "$node_report" <<'NODE'
const report = JSON.parse(process.argv[2]);
console.log(`transport=${report.transport}${report.ws_url ? ` (${report.ws_url})` : ""}`);
console.log(`target=${report.target.threadId} agent=${report.target.agent || ""}`);
console.log(`cwd=${report.target.cwd || ""}`);
console.log(`previous_status=${report.before_status} resumed=${report.resumed}`);
console.log(`method=${report.method} turn_id=${report.turn_id || ""}`);
console.log(report.dry_run ? "dry_run=ok (message not sent)" : "delivery=ok");
NODE
fi
