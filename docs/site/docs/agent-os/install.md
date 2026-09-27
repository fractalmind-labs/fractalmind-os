# Installation Guide

Install an AI Agent OS ROM into your workspace in a few steps.

## Prerequisites

- A workspace directory for your AI agent
- Git and Node.js (for installing git-sourced skills with `npx skills`)
- An AI agent runtime (e.g., Claude Code, Codex, or any LLM-based agent)

## Step 1: Choose a ROM

Browse the [ROM catalog](/agent-os/) and pick the ROM that matches your use case:

| ROM | Best for |
|-----|----------|
| [manager-heavy-core](/agent-os/roms/manager-heavy-core) | Multi-agent teams, OKR-driven execution |
| [trinity](/agent-os/roms/trinity) | AI employees with strict accountability |
| [mentor-coordinator-core](/agent-os/roms/mentor-coordinator-core) | Mentor-led coordination |

## Step 2: Clone the ROM templates

```bash
# Clone the monorepo and enter its ROM subtree
git clone https://github.com/fractalmind-labs/fractalmind-os.git
cd fractalmind-os/roms/agent-os-roms

# Choose your ROM (example: manager-heavy-core)
ROM=manager-heavy-core
```

## Step 3: Copy OS core files

Copy the template files from the ROM into your workspace:

```bash
# Set your workspace path
WORKSPACE=~/my-agent-workspace
MANIFEST=roms/$ROM/manifest.yaml

# Copy all template files
mkdir -p "$WORKSPACE"
cp -R "roms/$ROM/templates/." "$WORKSPACE/"

# Create directories declared in install_boundary.creates_directories
sed -n '/^ *creates_directories:$/,/^ *[^ -]/{s/^ *- //p}' "$MANIFEST" \
  | while IFS= read -r d; do mkdir -p "$WORKSPACE/$d"; done

# Create any missing files declared in install_boundary.creates_files
# (e.g. mentor-coordinator-core bundles 5 templates but declares 7 files)
sed -n '/^ *creates_files:$/,/^ *[^ -]/{s/^ *- //p}' "$MANIFEST" \
  | while IFS= read -r f; do
  [ -e "$WORKSPACE/$f" ] || { mkdir -p "$WORKSPACE/$(dirname "$f")"; touch "$WORKSPACE/$f"; }
done
```

This copies the ROM's bundled template files, including hidden directories, creates declared directories, then bootstraps any missing files as empty. The `sed` commands read only the scoped YAML block (`creates_files` or `creates_directories`), stopping at the next non-list key. Some ROMs (like `manager-heavy-core`) include all workspace files as templates; others (like `mentor-coordinator-core`) only include core templates — the loop handles both cases.

## Step 4: Install required skills

Check the ROM's `included_skills` in `manifest.yaml` and install each one:

### Git-sourced skills

```bash
# Run from the target workspace; choose the agent you use.
cd "$WORKSPACE"
npx skills add fractalmind-labs/fractalmind-os --skill agent-manager
```

### Embedded skills

Embedded skills are already included in the ROM's `templates/` directory. They are copied automatically in Step 3.

## Step 5: Install optional skills (recommended)

Check `optional_skills` in the manifest and install any that you need:

```bash
# Example: install agent-calendar
cd "$WORKSPACE"
npx skills add fractalmind-labs/fractalmind-os --skill agent-calendar
```

## Step 6: Customize

Edit the following files to match your environment:

1. **`USER.md`** — Add your name, preferences, and collaboration notes
2. **`TOOLS.md`** — Document local tools, SSH details, API keys (paths only, not secrets)
3. **`HEARTBEAT.md`** — Configure your execution surface and heartbeat checks

## Step 7: Bootstrap your agent

Point your AI agent to the workspace and let it read `AGENTS.md` on first run. The agent will:

1. Read `SOUL.md` to understand its operating principles
2. Read `USER.md` to understand who it's helping
3. Initialize the memory system
4. Start the heartbeat loop

## Verification

After installation, verify that:

- [ ] All files listed in `install_boundary.creates_files` exist
- [ ] `memory/` and `okrs/` directories are writable
- [ ] Each skill in `included_skills` has a `SKILL.md` in `.agents/skills/<name>/` (or the legacy `.agent/skills/<name>/`)
- [ ] Your agent can read and follow `AGENTS.md`

## Skill Directory Structure

Each installed skill follows this structure:

```
.agents/skills/<skill-name>/
├── SKILL.md          # Entry point — read this to use the skill
├── scripts/          # Executable scripts
├── references/       # Reference documentation
└── rules/            # Optional runtime rules
```

## What's Next

- Configure your agent's heartbeat schedule
- Set up your first OKR in `OKR.md`
- Add tasks to `TODO.md` for immediate work
- Explore the [Skills catalog](https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills) for additional capabilities

## Troubleshooting

**Skill not found after install?**
Run `npx skills list` and verify `.agents/skills/<name>/SKILL.md` exists. For
repositories containing multiple skills, pass `--skill <name>` and match the
skill's frontmatter.

**Agent doesn't follow OS rules?**
Ensure `AGENTS.md` is in the workspace root and your agent is configured to read it on session start.

**Missing template files?**
Re-copy from `roms/<rom-name>/templates/`. Check the manifest's `install_boundary.creates_files` for the complete list.
