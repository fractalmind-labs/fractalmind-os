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
- ✅ Host helper architecture is separated behind Tauri commands and fails closed when deterministic helper assets are absent.
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
- `src-tauri/src/host.rs` owns helper status, checksum verification, LaunchAgent status, restart, rollback, and fail-closed install behavior.

Phase A does not bundle helper binaries because this repository does not yet
contain deterministic `envd` / `envd-desktop` macOS helper assets and a checksum
manifest. In that state, the installer reports `helper_bundle_unavailable` and
does not download or execute anything. If installed helper files and
`current/manifest.json` exist under `~/Library/Application Support/FractalMind/Host`,
the status path verifies their SHA256 values before reporting PASS.

## macOS Distribution Residuals

The ad-hoc Tauri bundle can prove the MVP flow, but it is not production-ready
for public macOS distribution. Production requires Developer ID signing,
hardened runtime, a stable Team ID/code identity, notarization, and a signed
update channel. TCC permissions are bound to the app identity; users must still
grant Screen Recording and Accessibility manually in System Settings, and the app
must not claim to bypass those prompts.

This app does not claim to fix fractalmind-envd Issue #79. Real Host validation
for ICE/media/non-black remote desktop behavior remains in the envd project.
