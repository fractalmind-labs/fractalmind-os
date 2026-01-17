# Getting Started (2 minutes)

## Prereqs

- `python3`
- `tmux`
- An `agents/` directory in your repo (supports `agents/EMP_0001.md` and `agents/EMP_0001/AGENTS.md`)

## 1) Verify setup

```bash
cd your-project

# If installed (project-local):
python3 .agent/skills/agent-manager/scripts/main.py doctor

# If installed (global):
python3 ~/.claude/skills/agent-manager/scripts/main.py doctor

# If running from a cloned copy of agent-manager-skill:
REPO_ROOT="$PWD" python3 /path/to/agent-manager-skill/agent-manager/scripts/main.py doctor
```

## 2) See configured agents

```bash
python3 .agent/skills/agent-manager/scripts/main.py list
```

## 3) Start an agent in tmux

```bash
python3 .agent/skills/agent-manager/scripts/main.py start EMP_0001
```

## 4) Monitor output

```bash
python3 .agent/skills/agent-manager/scripts/main.py monitor EMP_0001 --follow
```

## 5) Stop the agent

```bash
python3 .agent/skills/agent-manager/scripts/main.py stop EMP_0001
```
