---
name: oh-my-code
description: Process-oriented multi-agent team for this repo
enabled: true
team_lead_employee_id: EMP_0002
members:
  - employee_id: EMP_0002
    role: "lead + qa"
    config: agents/EMP_0002.md
  - employee_id: EMP_0003
    role: developer
    config: agents/EMP_0003.md
---

# Team

This file defines the **team composition** for `oh-my-code` (who the agents are, and where their configs live).

## Members

| Employee ID | Name | Role | Config | Focus |
|---|---|---|---|---|
| EMP_0002 | coder-a | lead + qa | `agents/EMP_0002.md` | Team Lead + QA; runs quality gates; reviews diffs |
| EMP_0003 | coder-b | developer | `agents/EMP_0003.md` | Developer; implements changes; keeps scope tight; ships fixes |

## Workflow

Follow `workflows/github_issues.md`.

## Working Style

- Source of truth for process rules: `AGENTS.md`
- Default validation wrapper: `bash scripts/quality-gates.sh --repo <changed-repo-path>`

## Quick Commands

```bash
# from repo root
bash scripts/preflight.sh

python3 .claude/skills/agent-manager/scripts/main.py list
python3 .claude/skills/agent-manager/scripts/main.py start coder-b
python3 .claude/skills/agent-manager/scripts/main.py start coder-a

python3 .claude/skills/agent-manager/scripts/main.py monitor coder-a --follow
```
