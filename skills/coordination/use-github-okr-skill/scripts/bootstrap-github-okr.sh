#!/usr/bin/env bash
set -euo pipefail

REPO=""
OWNER=""
CYCLE=""
DUE=""
EXAMPLE="0"
SKIP_PROJECT="0"

usage() {
  cat <<'EOF'
Usage: bootstrap-github-okr.sh --cycle TITLE [--repo OWNER/REPO] [--owner ORG] [--due YYYY-MM-DD] [--example] [--skip-project]

Creates or updates the GitHub OKR baseline:
- labels: okr, okr:objective, okr:key-result, optionally okr:example
- milestone named after the OKR cycle
- GitHub Project named after the OKR cycle, with OKR alignment fields

Outputs JSON with milestone and project details.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --owner) OWNER="${2:-}"; shift 2 ;;
    --cycle) CYCLE="${2:-}"; shift 2 ;;
    --due) DUE="${2:-}"; shift 2 ;;
    --example) EXAMPLE="1"; shift ;;
    --skip-project) SKIP_PROJECT="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$CYCLE" ]]; then
  echo "--cycle is required" >&2
  exit 2
fi

if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi
if [[ -z "$OWNER" ]]; then
  OWNER="${REPO%%/*}"
fi

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required" >&2
    exit 2
  fi
}
require gh
require jq

run_with_timeout() {
  local seconds="$1"
  shift
  "$@" &
  local pid="$!"
  local start
  start="$(date +%s)"
  while kill -0 "$pid" 2>/dev/null; do
    if (( "$(date +%s)" - start >= seconds )); then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return 124
    fi
    sleep 1
  done
  wait "$pid"
}

ensure_label() {
  local name="$1" color="$2" description="$3"
  gh label create "$name" --repo "$REPO" --color "$color" --description "$description" --force >/dev/null
}

ensure_label "okr" "5319E7" "OKR tracking item"
ensure_label "okr:objective" "1D76DB" "OKR Objective issue"
ensure_label "okr:key-result" "0E8A16" "OKR Key Result issue"
if [[ "$EXAMPLE" == "1" ]]; then
  ensure_label "okr:example" "BFD4F2" "Example OKR artifact, safe to remove after review"
fi

milestones_json="$(mktemp)"
trap 'rm -f "$milestones_json"' EXIT
gh api --method GET "repos/${REPO}/milestones" -f state=all --paginate > "$milestones_json"
milestone_number="$(jq -r --arg title "$CYCLE" '.[] | select(.title == $title) | .number' "$milestones_json" | head -n 1)"

if [[ -z "$milestone_number" ]]; then
  if [[ -n "$DUE" ]]; then
    milestone_number="$(gh api --method POST "repos/${REPO}/milestones" \
      -f title="$CYCLE" \
      -f due_on="${DUE}T23:59:59Z" \
      -f description="OKR cycle tracking Objective and Key Result issues." \
      --jq .number)"
  else
    milestone_number="$(gh api --method POST "repos/${REPO}/milestones" \
      -f title="$CYCLE" \
      -f description="OKR cycle tracking Objective and Key Result issues." \
      --jq .number)"
  fi
fi

project_number=""
project_url=""
if [[ "$SKIP_PROJECT" != "1" ]]; then
  project_number="$(gh project list --owner "$OWNER" --format json --limit 100 \
    | jq -r --arg title "$CYCLE" '.projects[] | select(.title == $title) | .number' \
    | head -n 1)"
  if [[ -z "$project_number" ]]; then
    project_number="$(gh project create --owner "$OWNER" --title "$CYCLE" --format json | jq -r .number)"
  fi
  project_url="https://github.com/orgs/${OWNER}/projects/${project_number}"

  ensure_field() {
    local name="$1" dtype="$2" options="${3:-}"
    if gh project field-list "$project_number" --owner "$OWNER" --format json --limit 100 \
      | jq -e --arg name "$name" '.fields[] | select(.name == $name)' >/dev/null; then
      return 0
    fi
    if [[ -n "$options" ]]; then
      if ! run_with_timeout 20 gh project field-create "$project_number" --owner "$OWNER" --name "$name" --data-type "$dtype" --single-select-options "$options" >/dev/null; then
        echo "warning: failed or timed out creating Project field: $name" >&2
      fi
    else
      if ! run_with_timeout 20 gh project field-create "$project_number" --owner "$OWNER" --name "$name" --data-type "$dtype" >/dev/null; then
        echo "warning: failed or timed out creating Project field: $name" >&2
      fi
    fi
  }

  ensure_field "Objective" "TEXT"
  ensure_field "KR" "TEXT"
  ensure_field "Company Objective" "TEXT"
  ensure_field "Parent KR" "TEXT"
  ensure_field "Team" "TEXT"
  ensure_field "OKR Type" "SINGLE_SELECT" "Objective,Key Result,Initiative,Task"
  ensure_field "Alignment" "SINGLE_SELECT" "Direct,Supporting,Dependency"
  ensure_field "Health" "SINGLE_SELECT" "Green,Yellow,Red"
  ensure_field "Confidence" "NUMBER"
  ensure_field "Target" "TEXT"
  ensure_field "Current" "TEXT"
fi

jq -n \
  --arg repo "$REPO" \
  --arg owner "$OWNER" \
  --arg cycle "$CYCLE" \
  --arg milestone_number "$milestone_number" \
  --arg milestone_url "https://github.com/${REPO}/milestone/${milestone_number}" \
  --arg project_number "$project_number" \
  --arg project_url "$project_url" \
  '{
    repo: $repo,
    owner: $owner,
    cycle: $cycle,
    milestone: {number: ($milestone_number | tonumber), url: $milestone_url},
    project: (if $project_number == "" then null else {number: ($project_number | tonumber), url: $project_url} end)
  }'
