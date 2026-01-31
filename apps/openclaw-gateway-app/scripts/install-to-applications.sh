#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_SRC="$ROOT_DIR/OpenClaw.app"
APP_DST="/Applications/OpenClaw.app"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is for macOS (Darwin) only." >&2
  exit 1
fi

if [[ ! -d "$APP_SRC" ]]; then
  echo "Missing app bundle at: $APP_SRC" >&2
  exit 1
fi

echo "Installing $APP_SRC -> $APP_DST"
rm -rf "$APP_DST"
cp -R "$APP_SRC" "$APP_DST"
chmod +x "$APP_DST/Contents/MacOS/OpenClaw"

echo "Code signing (ad-hoc)"
codesign --force --deep --sign - "$APP_DST"

echo "Clearing quarantine flags"
xattr -cr "$APP_DST" || true

echo "Done."
echo "Next: System Settings → Privacy & Security → Full Disk Access → enable /Applications/OpenClaw.app"
