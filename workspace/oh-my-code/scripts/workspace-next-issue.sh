#!/usr/bin/env bash
set -euo pipefail

workspace_dir="${1:-workspace}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh not found on PATH" >&2
  exit 2
fi

if [[ ! -d "$workspace_dir" ]]; then
  exit 1
fi

while IFS=$'\t' read -r repo_dir github_repo; do
  [[ -n "${repo_dir:-}" ]] || continue
  [[ -n "${github_repo:-}" ]] || continue
  [[ "$github_repo" != "(unknown)" ]] || continue

  issue="$(
    gh issue list \
      --repo "$github_repo" \
      --assignee @me \
      --state open \
      --limit 200 \
      --json number,title,url,labels 2>/dev/null \
      | python3 -c '
import json, sys

raw = sys.stdin.read().strip()
if not raw:
  raise SystemExit(0)

issues = json.loads(raw)

def is_actionable(issue: dict) -> bool:
  labels = [l.get("name", "") for l in (issue.get("labels") or [])]
  if any(name.startswith("team:") for name in labels):
    return False
  if "status:awaiting-human-merge" in labels:
    return False
  if "status:in-progress" in labels:
    return False
  if "status:blocked" in labels:
    return False
  return True

for issue in issues:
  if is_actionable(issue):
    print("{}\t{}\t{}".format(issue["number"], issue["url"], issue["title"]))
    break
'
  )"

  if [[ -n "$issue" ]]; then
    printf '%s\t%s\t%s\n' "$repo_dir" "$github_repo" "$issue"
    exit 0
  fi
done < <(bash scripts/workspace-repos.sh "$workspace_dir" 2>/dev/null || true)

exit 1
