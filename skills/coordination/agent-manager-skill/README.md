# Agent Manager Skill

Employee agent lifecycle management system for managing AI agents in tmux sessions.

## Installation

### via openskills (recommended)

```bash
# Project installation
openskills install fractalmind-ai/agent-manager-skill

# Global installation
openskills install fractalmind-ai/agent-manager-skill --global
```

### Manual installation

```bash
git clone https://github.com/fractalmind-ai/agent-manager-skill.git
cp -r agent-manager-skill ~/.claude/skills/agent-manager
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
python3 ~/.claude/skills/agent-manager/scripts/main.py list
python3 ~/.claude/skills/agent-manager/scripts/main.py start dev
python3 ~/.claude/skills/agent-manager/scripts/main.py monitor dev --follow
```

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
