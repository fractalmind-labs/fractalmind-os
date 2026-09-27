# agent-manager

> Local agent lifecycle adapter via tmux + Python.

**Source**: [agent-manager-skill](https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/coordination/agent-manager-skill)
**Language**: Python
**Status**: Stable
**Install**: `npx skills add https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/coordination/agent-manager-skill --skill agent-manager -a codex -y`

## What It Does

agent-manager is the local execution adapter for individual AI agents:

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

Restart your AI agent session after installation and ask it to use `agent-manager`.

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

For local-only workflows, agents and operators may invoke agent-manager directly according to local policy. For remote privileged workflows, target envd validates authority first and then invokes the bounded adapter:

```
application -> signed intent -> target envd -> agent-manager -> tmux agent
```

agent-manager does not define SUI capabilities, validate remote authority, or turn relay/channel identity into node control. Its JSON operations must remain typed and bounded; arbitrary remote shell is outside the canonical contract.

## Related Components

- [team-manager](/components/team-manager) — builds on agent-manager for team coordination
- [okr-manager](/components/okr-manager) — integrated via heartbeat
- [fractalbot](/components/fractalbot) — routes messages to agents
