# Team Chat Skill Local Install Guide

This guide mounts `projects/fractalmind-ai/team-chat-skill` as a **local skill** in the team runtime environment, aligned with the existing `agent-manager` install style.

## Goal

- No npm publish required
- Use local repo path + symlink mount
- Make at least one team runnable first (`fractalmind-ai`)
- Keep a reusable one-command path for future teams

## Install Entry (Local Mount)

The canonical mount point is:

- `<workspace>/.agent/skills/team-chat` -> `<workspace>/projects/fractalmind-ai/team-chat-skill/team-chat`

Expected structure under `.agent/skills/`:

```text
.agent/skills/
  agent-manager -> ../../projects/fractalmind-ai/agent-manager-skill/agent-manager
  team-manager  -> ../../projects/fractalmind-ai/team-manager-skill/team-manager
  team-chat     -> ../../projects/fractalmind-ai/team-chat-skill/team-chat
```

`team-chat` itself must contain at least:

```text
team-chat/
  SKILL.md
  scripts/main.py
```

## One-Command Setup (Recommended)

From `projects/fractalmind-ai/agent-manager-skill`:

```bash
./examples/configure-team-chat-skill-local.sh \
  --team fractalmind-ai \
  --agents EMP_0016,EMP_0017
```

What this does:

1. Create/update `.agent/skills/team-chat` symlink
2. Add `team-chat` to `teams/fractalmind-ai.md` frontmatter `skills`
3. Add `team-chat` to `agents/EMP_0016.md` and `agents/EMP_0017.md` frontmatter `skills`

Safety behavior:

- `--team` and each `--agents` entry must match `^[A-Za-z0-9._-]+$` (no path traversal tokens)
- `--dry-run` does not write any files or create directories

## Do We Need To Update AGENTS.md / Team Files / Agent Startup?

- `AGENTS.md`: **Not required** for runtime mounting. Optional if you want policy text to mention `team-chat`.
- `teams/<team>.md`: **Required** for team-level auto-injection when using `team-manager assign`.
- `agents/EMP_xxxx.md` `skills`: **Recommended** when agents are started directly (outside team-manager assignment flow).
- Agent startup scripts (`agent-manager start ...`): **No code change required**. Existing startup flow already loads skills by name from `.agent/skills` / `.claude/skills` search paths.

## One-Time Global vs Per-Team Changes

Global one-time (change once):

1. Mount local skill symlink in `.agent/skills/team-chat`

Per-team (repeat per onboarded team):

1. Add `team-chat` to `teams/<team>.md` -> `skills`

Per-agent (optional, depending on workflow):

1. Add `team-chat` to `agents/EMP_xxxx.md` -> `skills`

### All Teams One-Key Update

```bash
./examples/configure-team-chat-skill-local.sh --all-teams
```

This updates all `teams/*.md` skill lists in the workspace (plus symlink mount).

## Verification Steps

1. Validate symlink:

```bash
readlink -f .agent/skills/team-chat
```

Expected result ends with:

```text
projects/fractalmind-ai/team-chat-skill/team-chat
```

2. Validate skill file exists:

```bash
test -f .agent/skills/team-chat/SKILL.md && echo OK
```

3. Validate team config patched:

```bash
rg -n "^skills:|team-chat" teams/fractalmind-ai.md
```

4. Validate agent configs patched (if requested):

```bash
rg -n "^skills:|team-chat" agents/EMP_0016.md agents/EMP_0017.md
```

5. Runtime smoke test (team flow):

```bash
python3 .agent/skills/team-manager/scripts/main.py show fractalmind-ai
```

If `team-chat` appears in loaded team skills and no missing-skill warning is shown during assignment, setup is successful.
