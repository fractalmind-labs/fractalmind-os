#!/usr/bin/env bash
set -euo pipefail

REPO=""
OWNER=""
PROJECT_NUMBER=""
MILESTONE=""
LABEL="okr"
LIMIT="200"

usage() {
  cat <<'EOF'
Usage: add-okr-issues-to-project.sh --project-number N --owner ORG [--repo OWNER/REPO] [--milestone TITLE] [--label okr] [--limit N]

Adds matching OKR issues to a GitHub Project. Existing items are ignored by GitHub.
Outputs JSON lines from gh project item-add.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --owner) OWNER="${2:-}"; shift 2 ;;
    --project-number) PROJECT_NUMBER="${2:-}"; shift 2 ;;
    --milestone) MILESTONE="${2:-}"; shift 2 ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    --limit) LIMIT="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$PROJECT_NUMBER" || -z "$OWNER" ]]; then
  echo "--project-number and --owner are required" >&2
  exit 2
fi
if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

args=(--repo "$REPO" --state all --label "$LABEL" --limit "$LIMIT" --json url,number,title)
if [[ -n "$MILESTONE" ]]; then
  args+=(--milestone "$MILESTONE")
fi

gh issue list "${args[@]}" \
  | jq -r '.[].url' \
  | while IFS= read -r issue_url; do
      [[ -n "$issue_url" ]] || continue
      gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$issue_url" --format json || true
    done
