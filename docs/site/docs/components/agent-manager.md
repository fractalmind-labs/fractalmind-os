# agent-manager

> Agent lifecycle management via tmux + Python.

**Repo**: [fractalmind-ai/agent-manager-skill](https://github.com/fractalmind-ai/agent-manager-skill)
**Language**: Python
**Status**: Stable
**Install**: `npx openskills install fractalmind-ai/agent-manager-skill`

## What It Does

agent-manager is the **L0 management layer** — it handles everything about individual AI agents:

- **Start/Stop**: Launch agents in tmux sessions
- **Monitor**: Check agent health and status
- **Heartbeat**: Periodic health checks with configurable frequency
- **Schedule**: Cron-based task scheduling
- **Assign**: Give tasks to specific agents

## Key Design

- **Zero server**: Uses tmux sessions, no HTTP API needed
- **File-based config**: Agent definitions in YAML files
- **Cron-friendly**: Heartbeats and schedules via system crontab
- **Observable**: Attach to any agent session in real-time

## Usage

Load the skill in your AI agent:

```bash
npx openskills read agent-manager
```

Then your agent can manage other agents:

```bash
# Start an agent
python3 scripts/main.py agent start EMP_0003

# Check status
python3 scripts/main.py agent list

# Assign a task
python3 scripts/main.py agent assign EMP_0003 --task "Review PR #123"

# Sync heartbeat to crontab
python3 scripts/main.py heartbeat sync
```

## Agent Configuration

Agents are defined in YAML frontmatter in `agents/*.md` files:

```yaml
---
name: dev-agent
description: Development agent for code tasks
working_directory: /path/to/workspace
heartbeat:
  cron: "*/30 * * * *"
  enabled: true
skills:
  - agent-manager
  - okr-manager
---
```

## Where It Fits

agent-manager is the foundation of the management layer:

```
fractalbot → agent-manager (L0) → team-manager (L1)
                   │
                   ├── heartbeat monitoring
                   ├── task assignment
                   └── agent lifecycle
```

All other management skills depend on or integrate with agent-manager.

## Related Components

- [team-manager](/components/team-manager) — builds on agent-manager for team coordination
- [okr-manager](/components/okr-manager) — integrated via heartbeat
- [fractalbot](/components/fractalbot) — routes messages to agents
