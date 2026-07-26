# FractalMind.app macOS Host QA

This checklist is the required supervised macOS exact-artifact probe for Issue #22
Phase A. It is not a recorded PASS until run on the target macOS host.

## Exact Artifacts

- App identity: `/Applications/FractalMind.app`
- Bundle identifier: `ai.fractalmind.app`
- LaunchAgent label: `ai.fractalmind.host`
- Helper source repo: `fractalmind-ai/fractalmind-envd`
- Helper source SHA: `46d03eb9aa3f02cde7b82a9bc1829661b7e498d7`
- Helper source line: PR #77 merge
- Build toolchain: `go version go1.25.6 linux/arm64`
- `envd` build command: `GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags='-buildid=' -o <out>/envd ./cmd/envd`
- `envd-desktop` build command: `cd desktop && GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags='-buildid=' -o <out>/envd-desktop ./cmd/envd-desktop`
- Bundled `envd` SHA256: `69567766184162e6966ab624c61c725634b5bd87a3996454ed351ac2558168b0`
- Bundled `envd-desktop` SHA256: `da4b6ec8040475766909b72be4452a78615990e0ce849cdb43d6d3066975721b`
- Historical deployed PR #77 desktop SHA256 rollback identity: `a5c1dff7a1b34ef8999cae70c26c8daac3f9113a60396c1f0d32cbd341340f9d`

Do not substitute PR #80 / beta.2 as the default helper set. That line was
rolled back after a real-host gate reached `ICE connected` with `frames_sent=0`
and `bytes_sent=0`.

## Package Readback

1. Install the exact ad-hoc build as `/Applications/FractalMind.app`.
2. Verify bundle identity:
   `defaults read /Applications/FractalMind.app/Contents/Info CFBundleIdentifier`
3. Expected result: `ai.fractalmind.app`.
4. Verify the UI still opens the Console surface and preserves existing
   `agent-console.conn` localStorage behavior.

## TCC Grant/Revoke

1. Open This Mac.
2. Use the Screen Recording button and confirm System Settings opens the Screen
   Recording pane.
3. Use the Accessibility button and confirm System Settings opens the
   Accessibility pane.
4. Grant both permissions manually to `FractalMind`.
5. Refresh This Mac and record native readback for both checks.
6. Revoke each permission, refresh, and record that the status returns to FAIL.

## Helper Install And Start

1. From This Mac, run Install Host.
2. Verify installed helper material:
   `shasum -a 256 "$HOME/Library/Application Support/FractalMind/Host/current/envd" "$HOME/Library/Application Support/FractalMind/Host/current/envd-desktop"`
3. Verify manifest source and version:
   `cat "$HOME/Library/Application Support/FractalMind/Host/current/manifest.json"`
4. Verify LaunchAgent identity:
   `plutil -p "$HOME/Library/LaunchAgents/ai.fractalmind.host.plist"`
5. Verify launch state:
   `launchctl print "gui/$(id -u)/ai.fractalmind.host"`
6. Expected result: helper source PASS, installed helper PASS, worker running PASS.

## Health And Media Probe

1. Confirm desktop health:
   `curl -fsS http://127.0.0.1:8090/healthz`
2. Connect a viewer through the normal Console/remote desktop flow.
3. Record the desktop `/status` media counters while the viewer is connected.
4. Required evidence before claiming runtime success: nonzero frame/media
   progress, nonzero bytes sent, and visible non-black frames in the browser.
5. Record orphan process state:
   `ps -axo pid=,ppid=,comm= | awk '$2 == 1 && $3 ~ /ffmpeg/ { print }'`
6. Expected result for orphan `ffmpeg`: zero lines.

## Restart And Rollback

1. Run Restart from This Mac and verify `launchctl kickstart -k` succeeds through
   the app operation result.
2. Tamper with a copy of current helper material on a disposable test account and
   verify Restart refuses to run when SHA256 verification fails.
3. Install an update over a verified current helper and confirm rollback material
   is retained before replacement with an app-written trust marker.
4. Simulate or observe a failed post-update health/readback and verify the app
   automatically restores the retained helper, relaunches, and records desktop
   health plus orphan `ffmpeg=0` readback.
5. Tamper with retained rollback material and verify Rollback refuses it.
6. Restore valid rollback material, run Rollback, and verify current helper
   manifest/SHA values match the retained version.
7. Recheck health and orphan `ffmpeg=0` after rollback.

## Residuals

- This checklist requires a real supervised macOS host; Linux CI cannot prove
  TCC identity, LaunchAgent execution, or browser-visible non-black media.
- The app is ad-hoc for Phase A. Developer ID signing, hardened runtime,
  notarization, and signed updates remain Phase B.
- Phase A checksum and trust-marker verification is not cryptographic provenance
  for arbitrary older helper material; rollback is constrained to
  installer-retained material from this app flow.
- This checklist does not claim to fix fractalmind-envd Issue #79.
