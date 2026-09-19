#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

WORKSPACE_ROOT="$DEFAULT_WORKSPACE_ROOT"
TEAM_CHAT_REPO=""
TEAM_NAME="fractalmind-ai"
ALL_TEAMS=0
AGENT_IDS=""
DRY_RUN=0

is_safe_identifier() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9._-]+$ ]]
}

usage() {
  cat <<'EOF'
Usage:
  configure-team-chat-skill-local.sh [options]

Options:
  --workspace-root <path>      Workspace root (default: inferred from script path)
  --team-chat-repo <path>      team-chat-skill repo path (default: <workspace>/projects/fractalmind-ai/team-chat-skill)
  --team <name>                Patch one team file (default: fractalmind-ai)
  --all-teams                  Patch all teams/*.md skill lists
  --agents <id1,id2,...>       Patch specific agent files (e.g. EMP_0016,EMP_0017)
  --dry-run                    Print actions without writing files
  -h, --help                   Show this help

Examples:
  ./examples/configure-team-chat-skill-local.sh --team fractalmind-ai --agents EMP_0016,EMP_0017
  ./examples/configure-team-chat-skill-local.sh --all-teams
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace-root)
      WORKSPACE_ROOT="$2"
      shift 2
      ;;
    --team-chat-repo)
      TEAM_CHAT_REPO="$2"
      shift 2
      ;;
    --team)
      TEAM_NAME="$2"
      shift 2
      ;;
    --all-teams)
      ALL_TEAMS=1
      shift
      ;;
    --agents)
      AGENT_IDS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$TEAM_CHAT_REPO" ]]; then
  TEAM_CHAT_REPO="$WORKSPACE_ROOT/projects/fractalmind-ai/team-chat-skill"
fi

TEAM_CHAT_SKILL_SRC="$TEAM_CHAT_REPO/team-chat"
SKILL_DIR="$WORKSPACE_ROOT/.agent/skills"
SKILL_LINK="$SKILL_DIR/team-chat"

if [[ ! -d "$WORKSPACE_ROOT/teams" ]]; then
  echo "Workspace root seems invalid (missing teams/): $WORKSPACE_ROOT" >&2
  exit 1
fi

if [[ "$ALL_TEAMS" -eq 0 ]]; then
  if ! is_safe_identifier "$TEAM_NAME"; then
    echo "Invalid --team value: $TEAM_NAME" >&2
    echo "Allowed pattern: ^[A-Za-z0-9._-]+$" >&2
    exit 2
  fi
fi

AGENT_FILES=()
if [[ -n "$AGENT_IDS" ]]; then
  IFS=',' read -r -a AGENTS <<< "$AGENT_IDS"
  for id in "${AGENTS[@]}"; do
    trimmed="$(echo "$id" | xargs)"
    [[ -n "$trimmed" ]] || continue
    if ! is_safe_identifier "$trimmed"; then
      echo "Invalid agent id in --agents: $trimmed" >&2
      echo "Allowed pattern: ^[A-Za-z0-9._-]+$" >&2
      exit 2
    fi
    AGENT_FILES+=("$WORKSPACE_ROOT/agents/$trimmed.md")
  done
fi

if [[ ! -d "$TEAM_CHAT_SKILL_SRC" ]]; then
  echo "team-chat skill source not found: $TEAM_CHAT_SKILL_SRC" >&2
  exit 1
fi
if [[ ! -f "$TEAM_CHAT_SKILL_SRC/SKILL.md" ]]; then
  echo "team-chat SKILL.md missing: $TEAM_CHAT_SKILL_SRC/SKILL.md" >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  mkdir -p "$SKILL_DIR"
fi

echo "[1/3] Linking local skill"
TARGET_REL="$(python3 - <<'PY' "$SKILL_DIR" "$TEAM_CHAT_SKILL_SRC"
import os
import sys
print(os.path.relpath(sys.argv[2], sys.argv[1]))
PY
)"

if [[ -L "$SKILL_LINK" ]]; then
  EXISTING="$(readlink "$SKILL_LINK")"
  if [[ "$EXISTING" == "$TARGET_REL" ]]; then
    echo "- keep existing link: $SKILL_LINK -> $EXISTING"
  else
    echo "- update link: $SKILL_LINK -> $TARGET_REL"
    if [[ "$DRY_RUN" -eq 0 ]]; then
      ln -sfn "$TARGET_REL" "$SKILL_LINK"
    fi
  fi
elif [[ -e "$SKILL_LINK" ]]; then
  echo "Cannot create symlink; destination exists and is not a symlink: $SKILL_LINK" >&2
  exit 1
else
  echo "- create link: $SKILL_LINK -> $TARGET_REL"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    ln -s "$TARGET_REL" "$SKILL_LINK"
  elif [[ ! -d "$SKILL_DIR" ]]; then
    echo "  dry-run: would create directory $SKILL_DIR"
  fi
fi

echo "[2/3] Patching team skill lists"

TEAM_FILES=()
if [[ "$ALL_TEAMS" -eq 1 ]]; then
  while IFS= read -r file; do
    TEAM_FILES+=("$file")
  done < <(find "$WORKSPACE_ROOT/teams" -maxdepth 1 -type f -name '*.md' | sort)
else
  TEAM_FILES+=("$WORKSPACE_ROOT/teams/$TEAM_NAME.md")
fi

python3 - <<'PY' "$DRY_RUN" "team-chat" "${TEAM_FILES[@]}"
from __future__ import annotations
import re
import sys
from pathlib import Path


def ensure_skill(path: Path, skill: str, dry_run: bool) -> str:
    if not path.exists():
        return f"- missing team file: {path}"

    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return f"- skip (no frontmatter): {path}"

    end = text.find("\n---\n", 4)
    if end < 0:
        return f"- skip (invalid frontmatter): {path}"

    front = text[4:end]
    body = text[end + 5 :]
    lines = front.splitlines()

    idx = None
    for i, line in enumerate(lines):
        if line.strip() == "skills:":
            idx = i
            break

    if idx is None:
        return f"- skip (no skills section): {path}"

    j = idx + 1
    item_indent = "  "
    existing = []
    while j < len(lines):
        line = lines[j]
        if re.match(r"^\s*-\s+", line):
            m = re.match(r"^(\s*)-\s+(.+?)\s*$", line)
            if m:
                item_indent = m.group(1)
                existing.append(m.group(2).strip())
            j += 1
            continue
        break

    if skill in existing:
        return f"- already set: {path}"

    lines.insert(j, f"{item_indent}- {skill}")
    updated = "---\n" + "\n".join(lines) + "\n---\n" + body

    if dry_run:
        return f"- would update: {path}"

    path.write_text(updated, encoding="utf-8")
    return f"- updated: {path}"


dry_run = bool(int(sys.argv[1]))
skill = sys.argv[2]
paths = [Path(p) for p in sys.argv[3:]]
for path in paths:
    print(ensure_skill(path, skill, dry_run))
PY

echo "[3/3] Patching agent skill lists (optional)"
if [[ ${#AGENT_FILES[@]} -gt 0 ]]; then
  python3 - <<'PY' "$DRY_RUN" "team-chat" "${AGENT_FILES[@]}"
from __future__ import annotations
import re
import sys
from pathlib import Path


def ensure_skill(path: Path, skill: str, dry_run: bool) -> str:
    if not path.exists():
        return f"- missing agent file: {path}"

    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return f"- skip (no frontmatter): {path}"

    end = text.find("\n---\n", 4)
    if end < 0:
        return f"- skip (invalid frontmatter): {path}"

    front = text[4:end]
    body = text[end + 5 :]
    lines = front.splitlines()

    idx = None
    for i, line in enumerate(lines):
        if line.strip() == "skills:":
            idx = i
            break

    if idx is None:
        return f"- skip (no skills section): {path}"

    j = idx + 1
    item_indent = "  "
    existing = []
    while j < len(lines):
        line = lines[j]
        if re.match(r"^\s*-\s+", line):
            m = re.match(r"^(\s*)-\s+(.+?)\s*$", line)
            if m:
                item_indent = m.group(1)
                existing.append(m.group(2).strip())
            j += 1
            continue
        break

    if skill in existing:
        return f"- already set: {path}"

    lines.insert(j, f"{item_indent}- {skill}")
    updated = "---\n" + "\n".join(lines) + "\n---\n" + body

    if dry_run:
        return f"- would update: {path}"

    path.write_text(updated, encoding="utf-8")
    return f"- updated: {path}"


dry_run = bool(int(sys.argv[1]))
skill = sys.argv[2]
paths = [Path(p) for p in sys.argv[3:]]
for path in paths:
    print(ensure_skill(path, skill, dry_run))
PY
else
  echo "- no agent files requested"
fi

echo "Done."
