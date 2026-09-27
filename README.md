# FractalMind OS

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

## Install a skill

From the project where your agent will use it:

```bash
npx skills add https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/coordination/agent-manager-skill --skill agent-manager -a codex -y
```

See the [skill installation guide](skills/README.md) for other skills, agents,
and installation scopes.

Private repositories remain separate in the `fractalmind-labs` organization:

- [`agent-console`](https://github.com/fractalmind-labs/agent-console)
- [`fractalmind-gateway`](https://github.com/fractalmind-labs/fractalmind-gateway)
- [`fractalmind-memory`](https://github.com/fractalmind-labs/fractalmind-memory)

The original repositories are retained as migration sources and historical
references until the migration is fully validated.
