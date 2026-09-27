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
| `Explorer`, `Docs site`, `Protocol SDK` | Node projects | install, test or typecheck, build |
| `Move (<package>)` | protocol and demail contracts | `sui move build` and `sui move test` |
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

## Manual workflows

These run only from the Actions tab. Every job that reads a secret runs in a
GitHub environment, so secrets and approval rules can be scoped per target:

| Workflow | Environment | Secrets |
| --- | --- | --- |
| `Protocol: Deploy contracts` | `sui-testnet` / `sui-mainnet` | `TESTNET_SUI_MNEMONICS`, `MAINNET_SUI_MNEMONICS` |
| `Protocol: Get Sui address` | `sui-testnet` / `sui-mainnet` | same |
| `Protocol: Rename organization`, `Protocol: Set agent profile`, `Protocol: KR4 verification` | `sui-testnet` | `TESTNET_SUI_MNEMONICS` |
| `envd: Deploy contracts` | `sui-testnet` / `sui-mainnet` | same as protocol deploys |
| `envd: Deploy` | `envd-deploy` | `SHARED_RELAY_HOST`, `SHARED_RELAY_USER`, `SHARED_RELAY_SSH_KEY`, `SULABS_ORG_HOST`, `SULABS_ORG_USER`, `SULABS_ORG_SSH_KEY` |
| `SDK: Publish`, `SDK: Pre-publish validation` | `npm` | `NPMJS_ACCESS_TOKEN` |

## Repository setup

These settings are not stored in the repository:

1. **Pages:** Settings → Pages → Source: GitHub Actions.
2. **Environments:** create `sui-testnet`, `sui-mainnet`, `envd-deploy` and
   `npm`, and add the secrets above to each one. Add required reviewers to
   `sui-mainnet` (and to `npm` and `envd-deploy` if desired).
3. **Branch protection:** require the `CI result` check on `main`.
