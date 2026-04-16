# Installation Guide

Install an AI Agent OS ROM into your workspace in a few steps.

## Prerequisites

- A workspace directory for your AI agent
- Git (for fetching skills with `git` source type)
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
# Clone the ROMs repository
git clone https://github.com/fractalmind-ai/agent-os-roms.git
cd agent-os-roms

# Choose your ROM (example: manager-heavy-core)
ROM=manager-heavy-core
```

## Step 3: Copy OS core files

Copy the template files from the ROM into your workspace:

```bash
# Set your workspace path
WORKSPACE=~/my-agent-workspace

# Copy all template files
cp -r roms/$ROM/templates/* $WORKSPACE/

# Create required directories
mkdir -p $WORKSPACE/memory $WORKSPACE/okrs
```

This installs the files listed in the ROM's `install_boundary.creates_files`.

## Step 4: Install required skills

Check the ROM's `included_skills` in `manifest.yaml` and install each one:

### Git-sourced skills

```bash
# Create skills directory
mkdir -p $WORKSPACE/.agent/skills

# Example: install agent-manager skill
git clone https://github.com/fractalmind-ai/agent-manager-skill.git \
  /tmp/agent-manager-skill
cp -r /tmp/agent-manager-skill/agent-manager \
  $WORKSPACE/.agent/skills/agent-manager
```

### Embedded skills

Embedded skills are already included in the ROM's `templates/` directory. They are copied automatically in Step 3.

## Step 5: Install optional skills (recommended)

Check `optional_skills` in the manifest and install any that you need:

```bash
# Example: install agent-calendar
git clone --branch v0.1.0 \
  https://github.com/fractalmind-ai/agent-calendar-skill.git \
  /tmp/agent-calendar-skill
cp -r /tmp/agent-calendar-skill/agent-calendar \
  $WORKSPACE/.agent/skills/agent-calendar
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
- [ ] Each skill in `included_skills` has a `SKILL.md` in `.agent/skills/<name>/`
- [ ] Your agent can read and follow `AGENTS.md`

## Skill Directory Structure

Each installed skill follows this structure:

```
.agent/skills/<skill-name>/
├── SKILL.md          # Entry point — read this to use the skill
├── scripts/          # Executable scripts
├── references/       # Reference documentation
└── rules/            # Optional runtime rules
```

## What's Next

- Configure your agent's heartbeat schedule
- Set up your first OKR in `OKR.md`
- Add tasks to `TODO.md` for immediate work
- Explore the [Skills catalog](https://github.com/fractalmind-ai/skills) for additional capabilities

## Troubleshooting

**Skill not found after install?**
Verify the skill directory exists at `.agent/skills/<name>/SKILL.md`. Check that the `source.path` in the manifest matches the directory structure in the git repo.

**Agent doesn't follow OS rules?**
Ensure `AGENTS.md` is in the workspace root and your agent is configured to read it on session start.

**Missing template files?**
Re-copy from `roms/<rom-name>/templates/`. Check the manifest's `install_boundary.creates_files` for the complete list.
