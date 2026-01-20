#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "$repo_root" ]] || fail "Not inside a git repository."

pwd_physical="$(pwd -P)"
[[ "$pwd_physical" == "$repo_root" ]] || fail "Run from repo root: cd \"$repo_root\""

need_cmd git
need_cmd python3
need_cmd tmux

agent_manager=".claude/skills/agent-manager/scripts/main.py"
[[ -f "$agent_manager" ]] || fail "Missing $agent_manager"

python3 "$agent_manager" list >/dev/null 2>&1 || fail "agent-manager health check failed: python3 $agent_manager list"

shopt -s nullglob
agents=(agents/EMP_*.md)
(( ${#agents[@]} > 0 )) || fail "No agent configs found at agents/EMP_*.md"

declare -A launchers=()
for agent_file in "${agents[@]}"; do
  launcher="$(awk -F': *' '/^launcher:/{print $2; exit}' "$agent_file" || true)"
  [[ -n "$launcher" ]] || fail "$agent_file: missing 'launcher:'"
  launchers["$launcher"]=1
done

for launcher in "${!launchers[@]}"; do
  if [[ "$launcher" == /* ]]; then
    [[ -x "$launcher" ]] || fail "launcher path not executable: $launcher"
  else
    command -v "$launcher" >/dev/null 2>&1 || fail "launcher not found on PATH: $launcher"
  fi
done

echo "OK: preflight passed"

