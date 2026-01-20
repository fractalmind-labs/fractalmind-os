---
description: Upgrade vendored agent-manager skill via OpenSkills
---

# Upgrade: agent-manager

Upgrades the vendored `.claude/skills/agent-manager` skill to the latest upstream version using OpenSkills.

## Upgrade

### Use `npx` (no global install)
```bash
npx -y openskills@latest update agent-manager
```

If `agent-manager` is not installed yet in this repo, install once:
```bash
npx -y openskills@latest install fractalmind-ai/agent-manager-skill -y
```

## Verify
```bash
python3 .claude/skills/agent-manager/scripts/main.py doctor
git diff -- .claude/skills/agent-manager
```
