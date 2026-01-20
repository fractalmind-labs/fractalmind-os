---
description: Assign a task to the supervisor
---

# Agents: Assign (Supervisor)

```bash
python3 .claude/skills/agent-manager/scripts/main.py assign supervisor <<'EOF'
Task:
- <what you want done>

Must:
- Follow AGENTS.md
- Decompose into parallel subtasks
- Ask `qa` to run quality gates and check edge cases
- Report evidence: commands run + files changed
EOF
```
