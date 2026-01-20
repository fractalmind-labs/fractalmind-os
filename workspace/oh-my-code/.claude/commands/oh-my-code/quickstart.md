---
description: Quickstart for oh-my-code (agent-manager + AGENTS.md)
---

# Quickstart

## Goal
Run a zero-setup multi-agent workflow using the vendored `agent-manager` skill in this repo.

## Prereqs
- `python3`
- `tmux`

## Steps

### 1) List configured agents
```bash
python3 .claude/skills/agent-manager/scripts/main.py list
```

### 2) Start supervisor + developer + qa
```bash
python3 .claude/skills/agent-manager/scripts/main.py start supervisor
python3 .claude/skills/agent-manager/scripts/main.py start developer
python3 .claude/skills/agent-manager/scripts/main.py start qa
```

### 3) Assign a task to the supervisor
```bash
python3 .claude/skills/agent-manager/scripts/main.py assign supervisor <<'EOF'
Task:
- <describe what you want built>

Requirements:
- Follow AGENTS.md
- Primary workflow: workflows/github_issues.md
- Split into parallel subtasks (developer + qa)
- Provide evidence (commands run, files changed)
EOF
```

### 4) Monitor output
```bash
python3 .claude/skills/agent-manager/scripts/main.py monitor supervisor --follow
```

## Notes
- If you use a different CLI than `codex`, update `agents/EMP_*.md` `launcher:` fields.
