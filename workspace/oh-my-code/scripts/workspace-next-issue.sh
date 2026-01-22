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
    gh search issues \
      --repo "$github_repo" \
      --state open \
      --limit 1 \
      --json number,title,url \
      --jq '.[0] | [.number,.url,.title] | @tsv' \
      --search '-label:team:* -label:status:awaiting-human-merge' \
      2>/dev/null || true
  )"

  if [[ -n "$issue" ]]; then
    printf '%s\t%s\t%s\n' "$repo_dir" "$github_repo" "$issue"
    exit 0
  fi
done < <(bash scripts/workspace-repos.sh "$workspace_dir" 2>/dev/null || true)

exit 1
