# Agent Manager Skill

Employee agent lifecycle management system for managing AI agents in tmux sessions.

This skill is designed to be installable via OpenSkills into arbitrary locations and still work correctly (including cron/schedule usage).

## Installation

### via skills CLI (recommended)

```bash
# Project installation
npx skills add fractalmind-labs/fractalmind-os --skill agent-manager

# Global installation
npx skills add fractalmind-labs/fractalmind-os --skill agent-manager -g
```

### Manual installation

```bash
git clone https://github.com/fractalmind-labs/fractalmind-os.git
cp -r fractalmind-os/skills/coordination/agent-manager-skill/agent-manager ~/.claude/skills/agent-manager
```

## Usage

After installation, read the skill documentation:

```bash
openskills read agent-manager
```

Or view directly:

```bash
cat ~/.claude/skills/agent-manager/SKILL.md
```

## Quick Start

```bash
# From your repository root
cd your-project

# If installed with `--universal` (repo-local):
python3 .agent/skills/agent-manager/scripts/main.py list

# If installed with `--global`:
python3 ~/.claude/skills/agent-manager/scripts/main.py list

# Start/monitor examples (adjust the path based on your install location)
python3 .agent/skills/agent-manager/scripts/main.py start dev
python3 .agent/skills/agent-manager/scripts/main.py monitor dev --follow
```

## Path & Repo Root Resolution

- Repo root is resolved in this priority order: `$REPO_ROOT` → git superproject (submodule-safe) → git toplevel → parent-walk fallback.
- `schedule sync` writes crontab entries that call the *installed* `main.py` absolute path (so cron keeps working regardless of where the skill is installed).

## Skills Resolution

When injecting agent skills into the system prompt, `agent-manager` searches for `SKILL.md` in the following locations (first match wins):

1) `<repo>/.agent/skills/<skill>/SKILL.md`
2) `~/.agent/skills/<skill>/SKILL.md`
3) `<repo>/.claude/skills/<skill>/SKILL.md`
4) `~/.claude/skills/<skill>/SKILL.md`

## Documentation

See [SKILL.md](SKILL.md) for complete documentation.

## Requirements

- Python 3.x
- tmux
- Agents defined in `agents/EMP_*.md` files

## Features

- 🚀 Simple agent lifecycle management (start/stop/monitor)
- 📅 Scheduled task execution via cron
- 🔧 Installation-agnostic (works from any location)
- 🎯 Zero dependencies beyond tmux + Python
- 💡 Dynamic path resolution for flexibility

## License

MIT
