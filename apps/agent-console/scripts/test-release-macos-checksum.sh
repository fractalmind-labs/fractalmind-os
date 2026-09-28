#!/usr/bin/env bash
set -euo pipefail

# This script lives at apps/agent-console/scripts/; the workflow it checks
# was moved to the repo root when agent-console was imported into fractalmind-os.
root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$root/../.." && pwd)"
release_workflow="$repo_root/.github/workflows/agent-console-release-assets.yml"
tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "$tmp_dir"' EXIT
snippet="$tmp_dir/checksum-writer.sh"
awk '
  /# BEGIN MACOS_CHECKSUM_WRITER/ { capture=1; next }
  /# END MACOS_CHECKSUM_WRITER/ { capture=0 }
  capture { sub(/^              /, ""); print }
' "$release_workflow" >"$snippet"
grep -Fq 'checksum="$(/usr/bin/shasum -a 256 <"$dmg_file")"' "$snippet"
grep -Fq "printf '\\\\%s  %s\\n'" "$snippet"
grep -Fq 'if [ "${#dmg_files[@]}" -ne 1 ]; then' "$release_workflow"
if grep -Fq '/usr/bin/sed' "$snippet"; then
  echo "checksum writer must not interpolate filenames into sed" >&2
  exit 1
fi

names=(
  'Agent Console.dmg'
  'Agent & Console.dmg'
  'Agent # Console.dmg'
  'Agent \ Console.dmg'
)

index=0
for name in "${names[@]}"; do
  index=$((index + 1))
  case_dir="$tmp_dir/$index"
  mkdir "$case_dir"
  source_file="$case_dir/$name"
  printf 'deterministic fixture %s\n' "$index" >"$source_file"

  dmg_file="$source_file"
  source "$snippet" >"$case_dir/SHA256SUMS-macos"
  public_name="${name// /.}"
  cp "$source_file" "$case_dir/$public_name"
  (cd "$case_dir" && /usr/bin/shasum -a 256 -c SHA256SUMS-macos >/dev/null)

  checksum="$(/usr/bin/shasum -a 256 <"$source_file")"
  digest="${checksum%%[[:space:]]*}"
  if [[ "$public_name" == *\\* ]]; then
    escaped_name="${public_name//\\/\\\\}"
    printf '\\%s  %s\n' "$digest" "$escaped_name" >"$case_dir/expected"
  else
    printf '%s  %s\n' "$digest" "$public_name" >"$case_dir/expected"
  fi
  cmp "$case_dir/expected" "$case_dir/SHA256SUMS-macos"
done

printf 'PASS macOS checksum filename fixtures=%s\n' "${#names[@]}"
