#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:-}"
if [[ -z "$repo_dir" ]]; then
  echo "Usage: bash scripts/github-repo-from-origin.sh <repo-path>" >&2
  exit 2
fi

origin_url="$(git -C "$repo_dir" remote get-url origin 2>/dev/null || true)"
if [[ -z "$origin_url" ]]; then
  echo "No origin remote found for: $repo_dir" >&2
  exit 2
fi

normalize() {
  local url="$1"
  url="${url%.git}"
  echo "$url"
}

origin_url="$(normalize "$origin_url")"

extract_slug() {
  local url="$1"

  case "$url" in
    git@github.com:*)
      echo "${url#git@github.com:}"
      return 0
      ;;
    ssh://git@github.com/*)
      echo "${url#ssh://git@github.com/}"
      return 0
      ;;
    https://github.com/*|http://github.com/*)
      echo "${url#*://github.com/}"
      return 0
      ;;
    git://github.com/*)
      echo "${url#git://github.com/}"
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

slug="$(extract_slug "$origin_url" || true)"
if [[ -z "$slug" ]]; then
  echo "Origin is not a GitHub URL: $origin_url" >&2
  exit 2
fi

slug="${slug#/}"
slug="${slug%/}"

if [[ ! "$slug" =~ ^[^/]+/[^/]+$ ]]; then
  echo "Could not parse OWNER/REPO from origin: $origin_url" >&2
  exit 2
fi

echo "$slug"
