#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SENDER="$ROOT_DIR/scripts/send-codex-app-agent-message.sh"
LISTER="$ROOT_DIR/scripts/list-codex-app-agents.sh"

bash -n "$SENDER"
bash -n "$LISTER"

set +e
missing_reply_output="$($SENDER \
  --thread-id client-new-thread:test \
  --protocol-envelope \
  --title 'missing reply guard' \
  --message 'test' 2>&1)"
missing_reply_status=$?
set -e

if [[ "$missing_reply_status" -ne 2 ]]; then
  printf 'expected missing reply guard exit 2, got %s\n%s\n' "$missing_reply_status" "$missing_reply_output" >&2
  exit 1
fi
grep -Fq 'task protocol envelopes require' <<<"$missing_reply_output"

# The exact target must be applied both while resolving the sidebar and while
# selecting the renderer that performs delivery. This catches regressions where
# the first blank duplicate page is selected during the second phase.
grep -Fq 'CDP_TARGET_ID="$CDP_TARGET_ID"' "$SENDER"
grep -Fq 'const cdpTargetId = process.env.CDP_TARGET_ID || "";' "$SENDER"
grep -Fq 'if (cdpTargetId && candidate.id !== cdpTargetId) continue;' "$SENDER"
grep -Fq 'const targetId = process.env.CDP_TARGET_ID || "";' "$SENDER"

printf 'use-codex-app regression checks: PASS\n'
