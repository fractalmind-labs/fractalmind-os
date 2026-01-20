#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/quality-gates.sh [--repo PATH] [--mode check|fix] [--list]

Defaults:
  --repo .
  --mode fix

Customization:
  - Set QUALITY_GATES to a newline-separated list of shell commands to run (in order).
    Example:
      export QUALITY_GATES=$'npm run -s lint\nnpm test'
EOF
}

repo="."
mode="fix"
list_only="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      repo="${2:-}"; shift 2;;
    --mode)
      mode="${2:-}"; shift 2;;
    --list)
      list_only="1"; shift;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2;;
  esac
done

case "$mode" in
  check|fix) ;;
  *) echo "Invalid --mode: $mode (expected check|fix)" >&2; exit 2;;
esac

if [[ ! -d "$repo" ]]; then
  echo "Repo path not found: $repo" >&2
  exit 2
fi

run_cmd() {
  local cmd="$1"
  echo "+ $cmd"
  if [[ "$list_only" == "1" ]]; then
    return 0
  fi
  bash -lc "$cmd"
}

in_git_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1
}

git_snapshot() {
  if in_git_repo; then
    git status --porcelain
  fi
}

gate_fail() {
  echo "FAILED: $*" >&2
  exit 1
}

has_make_target() {
  local target="$1"
  command -v make >/dev/null 2>&1 || return 1
  [[ -f Makefile || -f makefile || -f GNUmakefile ]] || return 1
  make -n "$target" >/dev/null 2>&1
}

detect_pkg_manager() {
  if [[ -f pnpm-lock.yaml ]] && command -v pnpm >/dev/null 2>&1; then
    echo "pnpm"
  elif [[ -f yarn.lock ]] && command -v yarn >/dev/null 2>&1; then
    echo "yarn"
  elif command -v npm >/dev/null 2>&1; then
    echo "npm"
  else
    echo ""
  fi
}

node_has_script() {
  local script="$1"
  [[ -f package.json ]] || return 1
  python3 - "$script" <<'PY'
import json, sys
path = "package.json"
script = sys.argv[1]
try:
  with open(path, "r", encoding="utf-8") as f:
    pkg = json.load(f)
except Exception:
  sys.exit(1)
scripts = pkg.get("scripts") or {}
sys.exit(0 if script in scripts else 1)
PY
}

run_node_script() {
  local script="$1"
  run_cmd "$(node_script_cmd "$script")"
}

node_script_cmd() {
  local script="$1"
  local pm
  pm="$(detect_pkg_manager)"
  [[ -n "$pm" ]] || gate_fail "Detected package.json but no package manager found (need one of: npm/pnpm/yarn)"

  case "$pm" in
    npm) echo "npm run -s $script" ;;
    pnpm) echo "pnpm run -s $script" ;;
    yarn) echo "yarn run -s $script" ;;
    *) gate_fail "Unknown package manager: $pm" ;;
  esac
}

run_with_git_clean_check() {
  local label="$1"
  local cmd="$2"

  local before after
  before="$(git_snapshot || true)"
  run_cmd "$cmd"
  after="$(git_snapshot || true)"

  if [[ "$mode" == "check" ]] && [[ "$before" != "$after" ]]; then
    gate_fail "$label changed files in --mode check. Re-run with --mode fix (or set QUALITY_GATES)."
  fi
}

(
  cd "$repo"

  if [[ -n "${QUALITY_GATES:-}" ]]; then
    echo "Using QUALITY_GATES overrides."
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      run_cmd "$line"
    done <<<"$QUALITY_GATES"
    echo "OK: quality gates passed"
    exit 0
  fi

  echo "Auto-detecting quality gates (mode: $mode)"

  ran_any="0"

  if has_make_target format || has_make_target fmt || has_make_target lint || has_make_target typecheck || has_make_target test || has_make_target build; then
    ran_any="1"
    has_make_target format && run_with_git_clean_check "make format" "make format"
    has_make_target fmt && run_with_git_clean_check "make fmt" "make fmt"
    has_make_target lint && run_cmd "make lint"
    has_make_target typecheck && run_cmd "make typecheck"
    has_make_target test && run_cmd "make test"
    has_make_target build && run_cmd "make build"
  fi

  if [[ "$ran_any" == "0" ]] && [[ -f package.json ]]; then
    ran_any="1"

    if [[ "$mode" == "check" ]] && node_has_script "format:check"; then
      run_cmd "$(node_script_cmd "format:check")"
    elif node_has_script "format"; then
      run_with_git_clean_check "$(node_script_cmd "format")" "$(node_script_cmd "format")"
    elif node_has_script "fmt"; then
      run_with_git_clean_check "$(node_script_cmd "fmt")" "$(node_script_cmd "fmt")"
    fi

    node_has_script "lint" && run_cmd "$(node_script_cmd "lint")"
    node_has_script "typecheck" && run_cmd "$(node_script_cmd "typecheck")"
    node_has_script "test" && run_cmd "$(node_script_cmd "test")"
    node_has_script "build" && run_cmd "$(node_script_cmd "build")"
  fi

  if [[ "$ran_any" == "0" ]] && [[ -f pyproject.toml || -f setup.cfg || -f requirements.txt ]]; then
    ran_any="1"

    if python3 -m ruff --version >/dev/null 2>&1; then
      if [[ "$mode" == "check" ]]; then
        run_cmd "python3 -m ruff format --check ."
      else
        run_cmd "python3 -m ruff format ."
      fi
      run_cmd "python3 -m ruff check ."
    fi

    if python3 -m mypy --version >/dev/null 2>&1; then
      run_cmd "python3 -m mypy ."
    fi

    if python3 -m pytest --version >/dev/null 2>&1; then
      run_cmd "python3 -m pytest"
    fi
  fi

  if [[ "$ran_any" == "0" ]] && [[ -f go.mod ]] && command -v go >/dev/null 2>&1; then
    ran_any="1"

    if command -v gofmt >/dev/null 2>&1; then
      echo "+ gofmt -l ."
      if [[ "$list_only" != "1" ]]; then
        unformatted="$(gofmt -l . || true)"
        if [[ -n "$unformatted" ]]; then
          echo "$unformatted" >&2
          gate_fail "gofmt found unformatted files"
        fi
      fi
    fi
    run_cmd "go vet ./..."
    run_cmd "go test ./..."
  fi

  if [[ "$ran_any" == "0" ]] && [[ -f Cargo.toml ]] && command -v cargo >/dev/null 2>&1; then
    ran_any="1"

    if [[ "$mode" == "check" ]]; then
      run_cmd "cargo fmt -- --check"
    else
      run_cmd "cargo fmt"
    fi
    run_cmd "cargo clippy -- -D warnings"
    run_cmd "cargo test"
    run_cmd "cargo build"
  fi

  if [[ "$ran_any" == "0" ]]; then
    echo "No known quality gates detected."
    echo "Tip: set QUALITY_GATES, or add Makefile targets (format/lint/typecheck/test/build), or package.json scripts."
    exit 0
  fi

  echo "OK: quality gates passed"
)
