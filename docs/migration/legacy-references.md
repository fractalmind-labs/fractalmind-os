# Remaining `fractalmind-ai` references

Links, Go module paths, install commands, ROM sources and the SDK package now
point at `fractalmind-labs/fractalmind-os`. The references below still name
`fractalmind-ai` on purpose.

List them with:

```bash
git grep -n 'fractalmind-ai' -- ':!governance'
```

## Historical records

These describe what happened before the migration and stay verbatim:

- `repository-map.yaml` and `docs/migration/` — the migration record itself.
- `governance/fractalmind-okrs/candidate-okrs/` — generated candidate OKRs
  record the repository they targeted when they were written.
- Release notes under `roms/**/release-notes.md` and the catalog release
  manifest `skills/registry/skills/releases/use-fractalbot/v0.1.0.json`.
- Design and status notes that cite the original repository:
  `protocols/fractal-demail/docs/phase1-design.md`,
  `runtime/claude-code-go/docs/pr1-recovery-plan.md`,
  `runtime/fractalbot/docs/issue-269-implementation-status.md`,
  `runtime/fractalbot/docs/research/`,
  `runtime/fractalmind-envd/docs/coordinator-local-runtime-proof.md`,
  `skills/coordination/agent-manager-skill/docs/branch-protection-rollout.md`.
- Links to numbered issues, pull requests and discussions
  (`.../issues/<n>`, `orgs/fractalmind-ai/discussions/<n>`,
  `fractalmind-ai/.github#6`). Their history was not migrated, so the original
  URLs remain the only valid ones.
- `LICENSE` copyright lines and the `authors` field in
  `protocols/fractal-demail/sui-contracts/Move.toml`.

## Names that are not repository references

- The documentation domain `fractalmind-ai.github.io`. It changes when the site
  deployment moves to this repository ([fractalmind-os#6](https://github.com/fractalmind-labs/fractalmind-os/issues/6)).
- The team name `fractalmind-ai` and the `projects/fractalmind-ai/...` workspace
  layout used by agent-manager and team-chat examples and by
  `skills/interfaces/team-chat-skill/team-chat/scripts/unread_notifier.py`.
- `workspace/oh-my-code/.claude/skills/agent-manager/.openskills.json`, the
  install record of the vendored copy. Reinstalling with `npx skills` replaces it.

## Deferred build dependencies

- `runtime/fractalmind-envd/contracts/envd/Move.toml` and `Move.lock` depend on
  `fractalmind-ai/fractalmind-protocol` at a pinned revision. Switching to the
  in-repo package changes how the published envd contract resolves its
  dependency, so it is left for a separate change.
- `runtime/fractalmind-envd/.github/workflows/deploy-contracts.yml` checks out
  `fractalmind-ai/fractalmind-protocol`. Nested workflows do not run; it is
  migrated together with the other workflows in [fractalmind-os#6](https://github.com/fractalmind-labs/fractalmind-os/issues/6).
