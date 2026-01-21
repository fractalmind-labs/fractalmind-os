#!/usr/bin/env bash
set -euo pipefail

workspace_dir="${1:-workspace}"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
github_from_origin="$script_dir/github-repo-from-origin.sh"

if [[ ! -d "$workspace_dir" ]]; then
  exit 0
fi

shopt -s nullglob

for repo_path in "$workspace_dir"/*; do
  [[ -d "$repo_path" ]] || continue

  if ! git -C "$repo_path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    continue
  fi

  repo_name="$(basename "$repo_path")"
  github_repo="$(bash "$github_from_origin" "$repo_path" 2>/dev/null || true)"
  if [[ -z "$github_repo" ]]; then
    github_repo="(unknown)"
  fi

  printf '%s\t%s\n' "$repo_name" "$github_repo"
done
