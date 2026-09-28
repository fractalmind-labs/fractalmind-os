# FractalMind OS

**ASI that no one owns.**

FractalMind is building ASI as permissionless, decentralized public
infrastructure — not the private asset of a few companies. Anyone can create an
organization and join in; intelligence grows through self-similar organizations
of agents — the same primitives from a single agent up to federations of
organizations — and governance happens openly on-chain.
See [What is FractalMind?](https://fractalmind-labs.github.io/fractalmind-os/guide/what-is-fractalmind)
for the mission, the fractal model, and where the project stands today.

FractalMind OS is the consolidated public monorepo for FractalMind AI.

The repository keeps each source repository in a stable, named subtree so that
its code, authorship, and commit history remain inspectable after consolidation.
The source-to-destination mapping is recorded in [`repository-map.yaml`](repository-map.yaml).

## Layout

- `workspace/` — reference operating workspace and agent control loop
- `governance/` — OKR and governance surfaces
- `spec/` and `roms/` — Agent OS contracts and distribution manifests
- `protocols/` — SUI and agent communication protocols
- `runtime/` — daemons, gateways, and local runtimes
- `apps/` — user-facing applications and explorers
- `skills/` — installable agent skills and skill registries
- `docs/` — public documentation site and architecture notes

## Building and testing

Prerequisites: Go 1.24+ (workspace mode auto-downloads the exact toolchain
each module needs), Node.js 22 (SDK), Python 3.9+, `npm`, and `pnpm` (for
`apps/agent-console`).

```bash
make test          # everything: Go, Python, Node
make test-go        # every Go module (MODULE=<path> for one)
make test-python    # every Python project (MODULE=<path> for one)
make test-node      # every Node project (MODULE=<path> for one)
make vet             # go vet in every Go module
make lint            # gofmt (fractalbot, claude-code-go) + SDK typecheck
make help            # full target list
```

The Go modules are wired together with a root [`go.work`](go.work); see
[`docs/go-workspace.md`](docs/go-workspace.md) for what it covers, the one
module it deliberately excludes and why, and how to run a single module's
`go build`/`vet`/`test` directly. CI runs the same commands per project; see
[`docs/ci.md`](docs/ci.md).

## Install a skill

From the project where your agent will use it:

```bash
npx skills add fractalmind-labs/fractalmind-os --skill agent-manager
```

See the [skill installation guide](skills/README.md) for other skills, agents,
and installation scopes.

CI, Pages and release workflows are described in [`docs/ci.md`](docs/ci.md).

Private repositories remain separate in the `fractalmind-labs` organization:

- [`fractalmind-gateway`](https://github.com/fractalmind-labs/fractalmind-gateway)
- [`fractalmind-memory`](https://github.com/fractalmind-labs/fractalmind-memory)

The original repositories are retained as migration sources and historical
references until the migration is fully validated.
