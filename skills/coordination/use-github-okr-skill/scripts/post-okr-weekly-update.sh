#!/usr/bin/env bash
set -euo pipefail

REPO=""
ISSUE=""
DATE_VALUE="$(date +%F)"
CURRENT=""
TARGET=""
HEALTH=""
CONFIDENCE=""
PROGRESS=""
RISKS="none"
NEXT=""
EVIDENCE=""
DRY_RUN="0"

usage() {
  cat <<'EOF'
Usage: post-okr-weekly-update.sh --issue N [--repo OWNER/REPO] --current VALUE --target VALUE --health Green|Yellow|Red --confidence 0.60 --progress TEXT --next TEXT [--risks TEXT] [--evidence URL] [--date YYYY-MM-DD] [--dry-run]

Posts a standardized weekly OKR update comment to a KR issue.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --issue) ISSUE="${2:-}"; shift 2 ;;
    --date) DATE_VALUE="${2:-}"; shift 2 ;;
    --current) CURRENT="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --health) HEALTH="${2:-}"; shift 2 ;;
    --confidence) CONFIDENCE="${2:-}"; shift 2 ;;
    --progress) PROGRESS="${2:-}"; shift 2 ;;
    --risks) RISKS="${2:-}"; shift 2 ;;
    --next) NEXT="${2:-}"; shift 2 ;;
    --evidence) EVIDENCE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$ISSUE" || -z "$CURRENT" || -z "$TARGET" || -z "$HEALTH" || -z "$CONFIDENCE" || -z "$PROGRESS" || -z "$NEXT" ]]; then
  echo "--issue, --current, --target, --health, --confidence, --progress, and --next are required" >&2
  exit 2
fi
case "$HEALTH" in Green|Yellow|Red) ;; *) echo "--health must be Green, Yellow, or Red" >&2; exit 2 ;; esac
if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

comment="$(mktemp)"
trap 'rm -f "$comment"' EXIT
{
  echo "## Weekly OKR update - ${DATE_VALUE}"
  echo
  echo "Current: ${CURRENT}"
  echo "Target: ${TARGET}"
  echo "Health: ${HEALTH}"
  echo "Confidence: ${CONFIDENCE}"
  echo
  echo "Progress:"
  echo "- ${PROGRESS}"
  echo
  echo "Risks:"
  echo "- ${RISKS}"
  echo
  echo "Next:"
  echo "- ${NEXT}"
  echo
  echo "Evidence:"
  if [[ -n "$EVIDENCE" ]]; then
    echo "- ${EVIDENCE}"
  else
    echo "- none"
  fi
} > "$comment"

if [[ "$DRY_RUN" == "1" ]]; then
  cat "$comment"
else
  gh issue comment "$ISSUE" --repo "$REPO" --body-file "$comment"
fi
