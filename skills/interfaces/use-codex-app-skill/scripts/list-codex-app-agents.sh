#!/usr/bin/env bash
set -euo pipefail

STATE_DB="${CODEX_STATE_DB:-}"
CWD_FILTER=""
LIMIT="50"
INCLUDE_ARCHIVED="0"
JSON_OUTPUT="0"

usage() {
  cat <<'EOF'
Usage: list-codex-app-agents.sh [--state-db PATH] [--cwd TEXT] [--limit N] [--include-archived] [--json]

Lists local Codex/ChatGPT App evidence for currently available agents:
- Codex or ChatGPT App and app-server processes
- CDP page targets when a DevTools endpoint is available
- sidebar-named Codex/ChatGPT App threads from the visible renderer
- non-archived Codex/ChatGPT App threads from the state database
- active/busy batch agent jobs from the state database when the current schema has them

Use the `id` column from `Codex App Threads` as the `--thread-id` target for:
  send-codex-app-agent-message.sh --thread-id ID --message TEXT

Environment:
  CODEX_STATE_DB  Override the Codex state sqlite path.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --state-db)
      STATE_DB="${2:-}"
      shift 2
      ;;
    --cwd)
      CWD_FILTER="${2:-}"
      shift 2
      ;;
    --limit)
      LIMIT="${2:-}"
      shift 2
      ;;
    --include-archived)
      INCLUDE_ARCHIVED="1"
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

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]] || [[ "$LIMIT" -lt 1 ]]; then
  echo "--limit must be a positive integer" >&2
  exit 2
fi

collect_processes() {
  ps -axo pid=,ppid=,lstart=,command= \
    | awk '
      /\/Applications\/Codex\.app\/Contents\/MacOS\/Codex/ ||
      /\/Applications\/ChatGPT\.app\/Contents\/MacOS\/ChatGPT/ ||
      /\/Applications\/Codex\.app\/Contents\/Resources\/codex app-server/ ||
      /\/Applications\/ChatGPT\.app\/Contents\/Resources\/codex app-server/ ||
      /\/Applications\/ChatGPT\.app\/Contents\/Resources\/.* app-server/ {print}
    ' || true
}

collect_cdp_ports() {
  for devtools_file in \
    "$HOME/Library/Application Support/Codex/DevToolsActivePort" \
    "$HOME/Library/Application Support/ChatGPT/DevToolsActivePort" \
    "$HOME/Library/Application Support/OpenAI/ChatGPT/DevToolsActivePort"
  do
    if [[ -f "$devtools_file" ]]; then
      sed -n '1p' "$devtools_file" 2>/dev/null || true
    fi
  done
  printf '%s\n' "9222"
}

sqlite_has_table() {
  local db="$1"
  local table="$2"
  [[ -n "$db" && -f "$db" ]] || return 1
  [[ "$(sqlite3 "$db" "select count(*) from sqlite_master where type='table' and name='$table';" 2>/dev/null || echo 0)" == "1" ]]
}

sqlite_has_column() {
  local db="$1"
  local table="$2"
  local column="$3"
  [[ -n "$db" && -f "$db" ]] || return 1
  sqlite3 "$db" "pragma table_info($table);" 2>/dev/null | awk -F'|' '{print $2}' | grep -Fxq "$column"
}

threads_select_sql() {
  local has_name="$1"
  local has_preview="$2"
  local has_agent_path="$3"
  local name_expr="null"
  local preview_expr="null"
  local agent_path_expr="null"

  [[ "$has_name" == "1" ]] && name_expr="nullif(name, '')"
  [[ "$has_preview" == "1" ]] && preview_expr="nullif(preview, '')"
  [[ "$has_agent_path" == "1" ]] && agent_path_expr="nullif(agent_path, '')"

  cat <<SQL
select
  id,
  coalesce(
    nullif(agent_nickname, ''),
    $name_expr,
    nullif(title, '')
  ) as agent,
  title,
  nullif(agent_nickname, '') as agent_nickname,
  nullif(agent_role, '') as role,
  $agent_path_expr as agent_path,
  $name_expr as name,
  $preview_expr as preview,
  cwd,
  model,
  reasoning_effort,
  source,
  datetime(coalesce(updated_at_ms / 1000, updated_at), 'unixepoch') as updated_at,
  archived
from threads
where (:include_archived = 1 or archived = 0)
  and (:cwd_filter = '' or cwd like '%' || :cwd_filter || '%')
order by coalesce(updated_at_ms, updated_at * 1000) desc
limit :limit;
SQL
}

extract_sidebar_targets_node() {
  cat <<'NODE'
const fs = require("node:fs");
const [path, port] = process.argv.slice(2);
const targets = JSON.parse(fs.readFileSync(path, "utf8"));
for (const target of targets) {
  if (target.webSocketDebuggerUrl) {
    console.log(JSON.stringify({
      port,
      type: target.type || null,
      title: target.title || "",
      url: target.url || "",
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    }));
  }
}
NODE
}

sidebar_eval_node() {
  cat <<'NODE'
const fs = require("node:fs");
const target = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const timeoutMs = Number(process.argv[3] || 8000);

async function cdpEvaluate(wsDebuggerUrl, expression) {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(wsDebuggerUrl);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch {}
        reject(new Error("Timed out reading app sidebar through CDP"));
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
      try { response = JSON.parse(String(event.data)); } catch { return; }
      if (response.id !== 1) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (response.error || response.result?.exceptionDetails) {
        reject(new Error("CDP sidebar read failed"));
      } else {
        resolve(response.result?.result?.value || []);
      }
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

const expression = `(() => {
  const result = [];
  const rows = Array.from(document.querySelectorAll("[data-app-action-sidebar-thread-row], [data-testid*='sidebar'] a, nav a[href*='/local/'], a[href*='/local/']"));
  const seen = new Set();
  for (const row of rows) {
    const rawId =
      row.getAttribute("data-app-action-sidebar-thread-id") ||
      row.getAttribute("data-thread-id") ||
      ((row.getAttribute("href") || "").match(/\\/local\\/([^/?#]+)/) || [])[1] ||
      "";
    const id = decodeURIComponent(rawId).replace(/^local:/, "");
    const title =
      row.getAttribute("data-app-action-sidebar-thread-title") ||
      row.getAttribute("aria-label") ||
      row.getAttribute("title") ||
      (row.textContent || "").trim();
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const labels = [];
    for (let el = row; el && labels.length < 30; el = el.parentElement) {
      for (const attr of ["aria-label", "data-project-name", "data-cwd", "title"]) {
        const value = el.getAttribute && el.getAttribute(attr);
        if (value && !labels.includes(value)) labels.push(value);
      }
    }
    result.push({
      id,
      agent: title,
      title,
      agent_nickname: title,
      role: row.getAttribute("data-agent-role") || null,
      cwd: labels.find((label) => label !== title && !label.startsWith("local:")) || null,
      source: "sidebar-visible",
      active: row.getAttribute("data-app-action-sidebar-thread-active") === "true" || row.getAttribute("aria-current") === "page",
      match_text: [title, rawId, ...labels].join("\\n"),
    });
  }
  return result;
})()`;

cdpEvaluate(target.webSocketDebuggerUrl, expression)
  .then((rows) => process.stdout.write(JSON.stringify(rows)))
  .catch(() => process.stdout.write("[]"));
NODE
}

if [[ -z "$STATE_DB" ]]; then
  STATE_DB="$(ls -t "$HOME"/.codex/state_*.sqlite 2>/dev/null | head -n 1 || true)"
fi

if [[ "$JSON_OUTPUT" == "1" ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "--json requires node for JSON assembly" >&2
    exit 2
  fi

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  collect_processes > "$tmpdir/processes.txt" || true

  collect_cdp_ports > "$tmpdir/ports.txt"

  sort -u "$tmpdir/ports.txt" | while IFS= read -r port; do
    if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "http://127.0.0.1:${port}/json/list" > "$tmpdir/cdp-${port}.json" 2>/dev/null; then
      node - "$tmpdir/cdp-${port}.json" "$port" >> "$tmpdir/cdp-targets.jsonl" <<<"$(extract_sidebar_targets_node)"
    fi
  done

  first_target_json="$(node - "$tmpdir/cdp-targets.jsonl" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
const lines = fs.existsSync(path) ? fs.readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean) : [];
const targets = lines.map((line) => JSON.parse(line));
const target = targets.find((item) => ["page", "webview", "other"].includes(item.type)) || targets[0];
process.stdout.write(target ? JSON.stringify(target) : "");
NODE
)"
  if [[ -n "$first_target_json" ]]; then
    printf '%s' "$first_target_json" > "$tmpdir/sidebar-target.json"
    node - "$tmpdir/sidebar-target.json" 8000 > "$tmpdir/sidebar-agents.json" <<<"$(sidebar_eval_node)" || printf '[]\n' > "$tmpdir/sidebar-agents.json"
  else
    printf '[]\n' > "$tmpdir/sidebar-agents.json"
  fi

  if [[ -n "$STATE_DB" && -f "$STATE_DB" ]]; then
    has_name="0"; sqlite_has_column "$STATE_DB" threads name && has_name="1"
    has_preview="0"; sqlite_has_column "$STATE_DB" threads preview && has_preview="1"
    has_agent_path="0"; sqlite_has_column "$STATE_DB" threads agent_path && has_agent_path="1"
    sqlite3 -json "$STATE_DB" > "$tmpdir/threads.json" <<SQL
.parameter init
.parameter set :cwd_filter "$CWD_FILTER"
.parameter set :include_archived $INCLUDE_ARCHIVED
.parameter set :limit $LIMIT
$(threads_select_sql "$has_name" "$has_preview" "$has_agent_path")
SQL

    if sqlite_has_table "$STATE_DB" agent_jobs && sqlite_has_table "$STATE_DB" agent_job_items; then
      sqlite3 -json "$STATE_DB" > "$tmpdir/agent-jobs.json" <<SQL
select
  j.id,
  j.name,
  j.status,
  count(i.item_id) as items,
  sum(case when i.status in ('queued', 'running', 'assigned') then 1 else 0 end) as active_items,
  datetime(j.updated_at, 'unixepoch') as updated_at,
  j.last_error
from agent_jobs j
left join agent_job_items i on i.job_id = j.id
where j.status not in ('completed', 'failed', 'cancelled')
group by j.id
order by j.updated_at desc
limit 20;
SQL
    else
      printf '[]\n' > "$tmpdir/agent-jobs.json"
    fi
  else
    printf '[]\n' > "$tmpdir/threads.json"
    printf '[]\n' > "$tmpdir/agent-jobs.json"
    printf '[]\n' > "$tmpdir/sidebar-agents.json"
  fi

  node - "$tmpdir" "$STATE_DB" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [tmpdir, stateDb] = process.argv.slice(2);
function readJson(file, fallback) {
  try {
    const text = fs.readFileSync(path.join(tmpdir, file), "utf8").trim();
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}
function readLines(file) {
  try {
    return fs.readFileSync(path.join(tmpdir, file), "utf8").split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}
const cdpTargets = readLines("cdp-targets.jsonl").map((line) => JSON.parse(line));
console.log(JSON.stringify({
  state_db: stateDb || null,
  processes: readLines("processes.txt"),
  cdp_targets: cdpTargets,
  sidebar_agents: readJson("sidebar-agents.json", []),
  threads: readJson("threads.json", []),
  agent_jobs: readJson("agent-jobs.json", []),
  send_command_template: "bash .codex/skills/use-codex-app/scripts/send-codex-app-agent-message.sh --thread-id <id> --message '<message>'"
}, null, 2));
NODE
  exit 0
fi

echo "== Codex App Processes =="
collect_processes | sed -n '1,80p' || true
echo

echo "== CDP Targets =="
found_cdp="0"

seen_ports=""
while IFS= read -r port; do
  [[ -n "$port" ]] || continue
  case " $seen_ports " in
    *" $port "*) continue ;;
  esac
  seen_ports="$seen_ports $port"
  if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "http://127.0.0.1:${port}/json/list" >/tmp/codex-cdp-targets.$$ 2>/dev/null; then
    found_cdp="1"
    echo "port=${port}"
    if command -v jq >/dev/null 2>&1; then
      jq -r '.[] | select(.webSocketDebuggerUrl != null) | [.type, .title, .url] | @tsv' /tmp/codex-cdp-targets.$$ || true
    else
      sed -n '1,20p' /tmp/codex-cdp-targets.$$
    fi
  fi
done < <(collect_cdp_ports)
rm -f /tmp/codex-cdp-targets.$$
if [[ "$found_cdp" != "1" ]]; then
  echo "No reachable CDP endpoint found. To keep CDP enabled, run:"
  echo "  bash .codex/skills/use-codex-app/scripts/install-codex-cdp-monitor.sh --install"
fi
echo

if [[ -z "$STATE_DB" || ! -f "$STATE_DB" ]]; then
  echo "== Codex App State DB =="
  echo "No state database found. Set CODEX_STATE_DB or pass --state-db."
  exit 0
fi

echo "== State DB =="
echo "$STATE_DB"
echo

echo "== Sidebar Named Agents =="
sidebar_tmp="$(mktemp)"
trap 'rm -f "$sidebar_tmp"' EXIT
first_sidebar_target=""
while IFS= read -r port; do
  [[ -n "$port" ]] || continue
  if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "http://127.0.0.1:${port}/json/list" >/tmp/codex-cdp-targets.$$ 2>/dev/null; then
    node - /tmp/codex-cdp-targets.$$ "$port" > "$sidebar_tmp.targets" <<<"$(extract_sidebar_targets_node)" || true
    first_sidebar_target="$(node - "$sidebar_tmp.targets" <<'NODE'
const fs = require("node:fs");
const lines = fs.existsSync(process.argv[2]) ? fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(Boolean) : [];
const targets = lines.map((line) => JSON.parse(line));
const target = targets.find((item) => ["page", "webview", "other"].includes(item.type)) || targets[0];
process.stdout.write(target ? JSON.stringify(target) : "");
NODE
)"
    if [[ -n "$first_sidebar_target" ]]; then
      printf '%s' "$first_sidebar_target" > "$sidebar_tmp.target"
      node - "$sidebar_tmp.target" 8000 > "$sidebar_tmp" <<<"$(sidebar_eval_node)" || printf '[]\n' > "$sidebar_tmp"
      break
    fi
  fi
done < <(collect_cdp_ports)
rm -f /tmp/codex-cdp-targets.$$ "$sidebar_tmp.targets" "$sidebar_tmp.target"
if [[ -s "$sidebar_tmp" ]] && [[ "$(cat "$sidebar_tmp")" != "[]" ]]; then
  node - "$sidebar_tmp" <<'NODE'
const fs = require("node:fs");
const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8") || "[]");
console.log("id                                    agent                           role      cwd                                                          active");
console.log("------------------------------------  ------------------------------  --------  -----------------------------------------------------------  ------");
for (const row of rows) {
  const cols = [
    String(row.id || "").padEnd(36),
    String(row.agent || row.title || "").slice(0, 30).padEnd(30),
    String(row.role || "").slice(0, 8).padEnd(8),
    String(row.cwd || "").slice(0, 59).padEnd(59),
    row.active ? "1" : "0",
  ];
  console.log(cols.join("  "));
}
NODE
else
  echo "No sidebar-named agents could be read through CDP."
fi
echo

echo "== Codex App Threads =="
has_name="0"; sqlite_has_column "$STATE_DB" threads name && has_name="1"
has_preview="0"; sqlite_has_column "$STATE_DB" threads preview && has_preview="1"
has_agent_path="0"; sqlite_has_column "$STATE_DB" threads agent_path && has_agent_path="1"
sqlite3 -header -column "$STATE_DB" <<SQL
.parameter init
.parameter set :cwd_filter "$CWD_FILTER"
.parameter set :include_archived $INCLUDE_ARCHIVED
.parameter set :limit $LIMIT
$(threads_select_sql "$has_name" "$has_preview" "$has_agent_path")
SQL
echo
echo "Send to a listed agent:"
echo "  bash .codex/skills/use-codex-app/scripts/send-codex-app-agent-message.sh --thread-id <id> --message '<message>'"
echo

echo "== Agent Jobs =="
if sqlite_has_table "$STATE_DB" agent_jobs && sqlite_has_table "$STATE_DB" agent_job_items; then
  sqlite3 -header -column "$STATE_DB" <<SQL
select
  j.id,
  j.name,
  j.status,
  count(i.item_id) as items,
  sum(case when i.status in ('queued', 'running', 'assigned') then 1 else 0 end) as active_items,
  datetime(j.updated_at, 'unixepoch') as updated_at,
  j.last_error
from agent_jobs j
left join agent_job_items i on i.job_id = j.id
where j.status not in ('completed', 'failed', 'cancelled')
group by j.id
order by j.updated_at desc
limit 20;
SQL
else
  echo "No agent_jobs tables found in this Codex/ChatGPT App state schema."
fi
