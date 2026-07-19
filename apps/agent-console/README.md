# Agent Console

Cross-platform app to manage [envd](https://github.com/fractalmind-ai/fractalmind-envd)-coordinated agents from anywhere: view node/agent status, run remote control commands, and (WIP) open a WebRTC remote desktop.

- **Shared UI**: a Vite + React + TypeScript web app (`src/`) that talks to the envd coordinator REST API.
- **Desktop**: [Tauri](https://tauri.app) v2 wraps the web app (macOS / Windows / Linux) — `src-tauri/`.
- **Mobile**: [Capacitor](https://capacitorjs.com) wraps the same web build (iOS / Android) — `capacitor.config.json`.

## Status (KR1 — scaffold)

- ✅ Shared web frontend builds (`pnpm build` → `dist/`).
- ✅ Coordinator API client (`src/lib/coordinator.ts`): `/api/health`, `/api/sentinels`, `/api/sentinels/{id}/agents`, `/api/sentinels/{id}/command` with bearer-token auth.
- ✅ UI: connect (URL + token) → live node list (status / heartbeat / system) → run commands (`status | logs | restart | kill | shell`).
- ✅ Tauri (desktop) + Capacitor (mobile) configs present.
- ⏳ Native builds (KR5), live agent observability against a real coordinator (KR2), WebRTC desktop integration (KR4).

## Develop

```bash
pnpm install
pnpm dev            # web dev server (http://localhost:5173)
pnpm build          # production web bundle -> dist/
```

Connect to a coordinator: run an `envd` node with `roles.coordinator: true` and an `api_token`, then enter its URL (e.g. `http://host:8080`) + token in the app.

### Desktop (Tauri)

```bash
pnpm add -D @tauri-apps/cli
pnpm tauri dev      # needs Rust + platform webview deps (webkit2gtk on Linux)
pnpm tauri build
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

## NodeCommand compatibility

`src/lib/node-command.ts` exports the Agent Console representation of the
`fractalmind.node-command.v1` contract shared with protocol SDK and envd issue
[#64](https://github.com/fractalmind-ai/fractalmind-envd/issues/64). The module
keeps capability revocation versions and budget amounts as decimal strings so
uint64 authority values never pass through unsafe JavaScript numbers. Its
canonical signing-byte helper serializes the exact field order used by protocol
SDK `sdk/src/node-command.ts` and envd `internal/nodecommand`.

The checked-in fixture at `src/lib/testdata/node-command-v1-golden.json` is a
byte-for-byte copy of protocol SDK
`fixtures/node-command/v1-golden.json` at
`c0c06062e6784ebd2c15b167fd074c9f1c32db90`, which also matches envd
`internal/nodecommand/testdata/v1-golden.json` at
`2569137f44bff86f482df6560df556c7f8df44d5`. Run
`pnpm test:node-command` to verify fixture hash, signing bytes, payload-hash
binding, uint64 max handling, and deterministic field omission/order.

This slice intentionally stops at codec and fixture parity. Wallet/passkey
collection, signature prompts, network dispatch, and migration away from the
temporary coordinator bearer-token command path remain separate integration
work and must not be inferred from these exports alone.
