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

Lists local Codex App evidence for currently available agents:
- Codex App and app-server processes
- CDP page targets when a DevTools endpoint is available
- non-archived Codex App threads from the state database
- active/busy Codex App batch agent jobs from the state database

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

  ps -axo pid=,ppid=,lstart=,command= \
    | awk '/\/Applications\/Codex\.app\/Contents\/MacOS\/Codex/ || /\/Applications\/Codex\.app\/Contents\/Resources\/codex app-server/ {print}' \
    > "$tmpdir/processes.txt" || true

  devtools_file="$HOME/Library/Application Support/Codex/DevToolsActivePort"
  if [[ -f "$devtools_file" ]]; then
    port="$(sed -n '1p' "$devtools_file" 2>/dev/null || true)"
    [[ -n "$port" ]] && printf '%s\n' "$port" >> "$tmpdir/ports.txt"
  fi
  printf '%s\n' "9222" >> "$tmpdir/ports.txt"

  sort -u "$tmpdir/ports.txt" | while IFS= read -r port; do
    if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "http://127.0.0.1:${port}/json/list" > "$tmpdir/cdp-${port}.json" 2>/dev/null; then
      node - "$tmpdir/cdp-${port}.json" "$port" >> "$tmpdir/cdp-targets.jsonl" <<'NODE'
const fs = require("node:fs");
const [path, port] = process.argv.slice(2);
for (const target of JSON.parse(fs.readFileSync(path, "utf8"))) {
  if (target.webSocketDebuggerUrl) {
    console.log(JSON.stringify({
      port,
      type: target.type || null,
      title: target.title || "",
      url: target.url || "",
    }));
  }
}
NODE
    fi
  done

  if [[ -n "$STATE_DB" && -f "$STATE_DB" ]]; then
    sqlite3 -json "$STATE_DB" > "$tmpdir/threads.json" <<SQL
.parameter init
.parameter set :cwd_filter "$CWD_FILTER"
.parameter set :include_archived $INCLUDE_ARCHIVED
.parameter set :limit $LIMIT
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
  and (:cwd_filter = '' or cwd like '%' || :cwd_filter || '%')
order by updated_at desc
limit :limit;
SQL

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
    printf '[]\n' > "$tmpdir/threads.json"
    printf '[]\n' > "$tmpdir/agent-jobs.json"
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
  threads: readJson("threads.json", []),
  agent_jobs: readJson("agent-jobs.json", []),
  send_command_template: "bash .codex/skills/use-codex-app/scripts/send-codex-app-agent-message.sh --thread-id <id> --message '<message>'"
}, null, 2));
NODE
  exit 0
fi

echo "== Codex App Processes =="
ps -axo pid=,ppid=,lstart=,command= \
  | awk '/\/Applications\/Codex\.app\/Contents\/MacOS\/Codex/ || /\/Applications\/Codex\.app\/Contents\/Resources\/codex app-server/ {print}' \
  | sed -n '1,80p' || true
echo

echo "== CDP Targets =="
ports=()
found_cdp="0"
devtools_file="$HOME/Library/Application Support/Codex/DevToolsActivePort"
if [[ -f "$devtools_file" ]]; then
  port="$(sed -n '1p' "$devtools_file" 2>/dev/null || true)"
  [[ -n "$port" ]] && ports+=("$port")
fi
ports+=("9222")

seen_ports=""
for port in "${ports[@]}"; do
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
done
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

echo "== Codex App Threads =="
sqlite3 -header -column "$STATE_DB" <<SQL
.parameter init
.parameter set :cwd_filter "$CWD_FILTER"
.parameter set :include_archived $INCLUDE_ARCHIVED
.parameter set :limit $LIMIT
select
  id,
  case
    when nullif(agent_nickname, '') is not null then agent_nickname
    else title
  end as agent,
  nullif(agent_role, '') as role,
  cwd,
  model,
  reasoning_effort,
  source,
  datetime(updated_at, 'unixepoch') as updated_at,
  archived
from threads
where (:include_archived = 1 or archived = 0)
  and (:cwd_filter = '' or cwd like '%' || :cwd_filter || '%')
order by updated_at desc
limit :limit;
SQL
echo
echo "Send to a listed agent:"
echo "  bash .codex/skills/use-codex-app/scripts/send-codex-app-agent-message.sh --thread-id <id> --message '<message>'"
echo

echo "== Agent Jobs =="
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
