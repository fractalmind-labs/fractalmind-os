# FractalMind

Cross-platform app to manage [envd](https://github.com/fractalmind-ai/fractalmind-envd)-coordinated agents from anywhere and prepare the local Mac as a Host.

Canonical macOS identity:

- Product name: `FractalMind`
- App path: `/Applications/FractalMind.app`
- Bundle identifier: `ai.fractalmind.app`

- **Shared UI**: a Vite + React + TypeScript web app (`src/`) that talks to the envd coordinator REST API.
- **Desktop**: [Tauri](https://tauri.app) v2 wraps the web app (macOS / Windows / Linux) — `src-tauri/`.
- **Mobile**: [Capacitor](https://capacitorjs.com) wraps the same web build (iOS / Android) — `capacitor.config.json`.

## Status

- ✅ Shared web frontend builds (`pnpm build` → `dist/`).
- ✅ Coordinator API client (`src/lib/coordinator.ts`): `/api/health`, `/api/sentinels`, `/api/sentinels/{id}/agents`, `/api/sentinels/{id}/command` with bearer-token auth.
- ✅ UI: connect (URL + token) → live node list (status / heartbeat / system) → run commands (`status | logs | restart | kill | shell`).
- ✅ Console and This Mac surfaces under the FractalMind product identity.
- ✅ Native macOS permission probes for Screen Recording and Accessibility, plus exact System Settings deep links.
- ✅ Host helper architecture is separated behind Tauri commands, verifies bundled helper SHA256 material before install, and fails closed on missing/tampered source, install, restart, or rollback material.
- ⏳ Production signing, notarization, signed update channel, and real macOS TCC/LaunchAgent readback remain Phase B / host-validation work.

## Develop

```bash
pnpm install
pnpm dev            # web dev server (http://localhost:5173)
pnpm build          # production web bundle -> dist/
pnpm test           # focused TypeScript tests
```

Connect to a coordinator: run an `envd` node with `roles.coordinator: true` and an `api_token`, then enter its URL (e.g. `http://host:8080`) + token in the app.

### Desktop (Tauri)

```bash
pnpm add -D @tauri-apps/cli
pnpm tauri dev      # needs Rust + platform webview deps (webkit2gtk on Linux)
pnpm tauri build
cd src-tauri && cargo test
```

### Mobile (Capacitor)

```bash
pnpm add @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
pnpm build && pnpm cap sync
pnpm cap open ios       # needs Xcode
pnpm cap open android   # needs Android SDK
```

## Architecture

The app is a thin, transport-agnostic client (plain `fetch`) so the exact same
web bundle runs inside the Tauri and Capacitor WebViews. All privileged actions
(remote commands, desktop) go through the envd coordinator, which authenticates
the control plane on the SUI-identity plane; this app holds only the coordinator
API token.

The local Host surface is intentionally separate from the Console controller:

- `src/components/ThisMac.tsx` renders local host status and operations.
- `src/lib/host.ts` is the TypeScript boundary for Tauri host commands and browser fallbacks.
- `src-tauri/src/permissions.rs` reads native macOS TCC status and opens exact privacy panes.
- `src-tauri/src/host.rs` owns helper status, checksum verification, LaunchAgent status, install/update/start, restart, rollback, and fail-closed helper behavior.

Phase A bundles deterministic Darwin arm64 helper sidecars under
`src-tauri/bundled-sidecars/fractalmind-host-pr77-darwin-arm64/`:

- Source: `fractalmind-ai/fractalmind-envd` PR #77 merge `46d03eb9aa3f02cde7b82a9bc1829661b7e498d7`.
- Build toolchain: `go version go1.25.6 linux/arm64`.
- Build commands:
  - `GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags='-buildid=' -o <out>/envd ./cmd/envd`
  - `cd desktop && GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags='-buildid=' -o <out>/envd-desktop ./cmd/envd-desktop`
- Bundled `envd` SHA256: `69567766184162e6966ab624c61c725634b5bd87a3996454ed351ac2558168b0`.
- Bundled `envd-desktop` SHA256: `da4b6ec8040475766909b72be4452a78615990e0ce849cdb43d6d3066975721b`.
- Historical known-good deployed PR #77 desktop SHA256 retained as rollback identity context: `a5c1dff7a1b34ef8999cae70c26c8daac3f9113a60396c1f0d32cbd341340f9d`.

PR #80 / beta.2 is intentionally not used as the default helper set because its
real-host gate was rolled back after `ICE connected` with `frames_sent=0` and
`bytes_sent=0`. The installer verifies the bundled manifest and binary SHA256s
before writing anything. Replacement uses same-filesystem rename with a verified
backup so a failed rename path restores the previous runnable `current` helper.
Updates retain an installer-marked rollback copy before replacement, then start
the helper and require bounded desktop health plus orphan `ffmpeg=0` readback.
If that post-update readback fails, the installer automatically restores the
retained helper and runs rollback readback. Restart requires exact installed
helper checksum verification, the app-written trust marker, and LaunchAgent
identity verification. Rollback refuses missing, tampered, or non-installer-
retained material.

Phase A does not cryptographically authenticate arbitrary older helper material.
The retained rollback trust boundary is ad-hoc: a private app-written marker must
match the manifest and both binary SHA256s, and the manifest must match the
trusted PR #77 source identity. Developer ID signing and notarized helper
provenance remain Phase B.

The installed helper location is
`~/Library/Application Support/FractalMind/Host/current`; rollback material is
kept under `~/Library/Application Support/FractalMind/Host/rollback`; the
LaunchAgent is `~/Library/LaunchAgents/ai.fractalmind.host.plist`.

## macOS Distribution Residuals

The ad-hoc Tauri bundle can exercise the MVP flow on a supervised Mac, but it is
not production-ready for public macOS distribution. Production requires Developer ID signing,
hardened runtime, a stable Team ID/code identity, notarization, and a signed
update channel. TCC permissions are bound to the app identity; users must still
grant Screen Recording and Accessibility manually in System Settings, and the app
must not claim to bypass those prompts.

This app does not claim to fix fractalmind-envd Issue #79. Real Host validation
for ICE/media/non-black remote desktop behavior remains in the envd project.

See `docs/macos-host-qa.md` for the exact-artifact macOS QA checklist that must
be run on a supervised macOS host before this Phase A flow is considered proven
for users.
