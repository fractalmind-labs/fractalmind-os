# CI and release workflows

All GitHub Actions workflows live in the root `.github/workflows/`. GitHub does
not run workflows from subdirectories, so the per-project workflows imported
with each repository were moved here or removed.

## Checks on pull requests and `main`

`ci.yml` detects which projects a change touches and runs only their jobs:

| Job | Project | Runs |
| --- | --- | --- |
| `Go (<module>)` | each Go module | `go build`, `go vet`, `go test` (`-race` for the demail bridge); `gofmt` for fractalbot and claude-code-go |
| `agent-manager (Python 3.9–3.12)` | `skills/coordination/agent-manager-skill` | compile, CLI smoke test, unit tests |
| `agent-manager quality gates` | same | coverage gate (`QUALITY_COVERAGE_MIN`, default 45) and integration suite |
| `team-manager`, `team-chat`, `Skills CLI layout` | Python skills | unit tests |
| `Skill structure` | `skills/` | `SKILL.md` front matter and per-skill file checks |
| `Explorer`, `Agent Console`, `Docs site`, `Protocol SDK` | Node projects | install, test or typecheck, build |
| `Sui transport migration` | active Sui consumers | `make check-sui-rpc` (always runs) |
| `Move (<package>)` | protocol, envd and demail contracts | `sui move build` and `sui move test` |
| `TypeMind Android` | `apps/typemind-android` | debug APK build |
| `OpenClaw gateway app` | `apps/openclaw-gateway-app` | bundle and installer checks |

Editing `ci.yml` runs every job. `CI result` fails when any other job fails, so
it is the single status check to require in branch protection.

## Pages

`pages.yml` publishes the docs site and the explorer as one GitHub Pages site on
pushes to `main` that touch either project:

- Docs: https://fractalmind-labs.github.io/fractalmind-os/
- Explorer: https://fractalmind-labs.github.io/fractalmind-os/explorer/

The docs use the VitePress base `/fractalmind-os/`; links in custom theme
components must go through `withBase()`.

## Agent Console native builds

`agent-console-desktop.yml` and `agent-console-android.yml` build the Tauri
desktop app and the Capacitor Android APK on every push to `main` that touches
`apps/agent-console/**` (and from the Actions tab), uploading the build as a
workflow artifact. Neither needs a secret or an environment.

`agent-console-release-assets.yml` (Actions tab only) builds the desktop
and/or Android release for a given tag and uploads the assets to that tag's
GitHub Release; it also needs no secret beyond the default `GITHUB_TOKEN`.
Its `tag` input must be a bare `vMAJOR.MINOR.PATCH` tag on this repo — that
scheme doesn't scope to agent-console, so it will collide if another
component in the monorepo also releases under bare `v*` tags. It was carried
over as-is from the standalone repository; give it a per-component tag
convention (e.g. `apps/agent-console/vX.Y.Z`) before using it for the next
release.

## Manual workflows

These run only from the Actions tab. Every job that reads a secret runs in a
GitHub environment, so secrets and approval rules can be scoped per target:

| Workflow | Environment | Secrets |
| --- | --- | --- |
| `Protocol: Deploy contracts` | `sui-testnet` / `sui-mainnet` | `SUI_MNEMONICS` |
| `Protocol: Get Sui address` | `sui-testnet` / `sui-mainnet` | same |
| `Protocol: Rename organization`, `Protocol: Set agent profile`, `Protocol: KR4 verification` | `sui-testnet` | `SUI_MNEMONICS` |
| `envd: Deploy contracts` | `sui-testnet` / `sui-mainnet` | same as protocol deploys |
| `envd: Deploy` | `envd-deploy` | `SHARED_RELAY_HOST`, `SHARED_RELAY_USER`, `SHARED_RELAY_SSH_KEY`, `SULABS_ORG_HOST`, `SULABS_ORG_USER`, `SULABS_ORG_SSH_KEY` |
| `SDK: Publish`, `SDK: Pre-publish validation` | `npm` | `NPMJS_ACCESS_TOKEN` |

## Repository setup

These settings are not stored in the repository:

1. **Pages:** Settings → Pages → Source: GitHub Actions.
2. **Environments:** create `sui-testnet`, `sui-mainnet`, `envd-deploy` and
   `npm`, and add the secrets above to each one. `sui-testnet` and
   `sui-mainnet` each hold their own `SUI_MNEMONICS` value under the same
   name; jobs read the right one because they select the environment that
   matches the network. Add required reviewers to `sui-mainnet` (and to
   `npm` and `envd-deploy` if desired).
3. **Branch protection:** require the `CI result` check on `main`.

## Sui transport migration

CI always runs `make check-sui-rpc` to reject deprecated Sui JSON-RPC transports.
The protocol SDK uses Node.js 22 and checks source plus verification scripts.
Move jobs and deployment workflows use the gRPC-capable Sui CLI 1.80.1.
Go jobs also run when the root Makefile or Go workspace dependencies change.
See [the migration guide](sui-rpc-migration.md) for configuration and smoke checks.
