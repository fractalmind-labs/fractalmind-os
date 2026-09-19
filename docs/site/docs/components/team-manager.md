# team-manager

> Multi-agent team orchestration with lead-based coordination.

**Repo**: [fractalmind-ai/team-manager-skill](https://github.com/fractalmind-ai/team-manager-skill)
**Language**: Python
**Status**: Stable
**Install**: `npx openskills install fractalmind-ai/team-manager-skill`

## What It Does

team-manager is the **L1 management layer** — it coordinates multiple agents working together:

- **Team creation**: Define teams with a lead and members
- **Lead-based coordination**: One agent coordinates the rest
- **Task assignment**: Distribute work across team members
- **Progress monitoring**: Track team-level task completion
- **Visual workflows**: Define workflows with Mermaid diagrams

## Key Design

- **Lead pattern**: Every team has a lead agent who makes assignment decisions
- **Depends on agent-manager**: Uses agent-manager for individual agent operations
- **YAML configuration**: Teams defined in `teams/*.yml`
- **Workflow-driven**: Mermaid diagrams define task flow

## Usage

```bash
npx openskills read team-manager
```

```bash
# Create a team
python3 scripts/main.py team create code-review \
  --lead EMP_0001 \
  --members EMP_0002,EMP_0003

# Assign task to team
python3 scripts/main.py team assign code-review \
  --task "Review and merge PR #456"

# Check team status
python3 scripts/main.py team status code-review
```

## Where It Fits

```
agent-manager (L0: individual agents)
       │
       ▼
team-manager (L1: team coordination)
       │
       ├── team-chat (async messaging between members)
       └── okr-manager (team-level goal tracking)
```

## Related Components

- [agent-manager](/components/agent-manager) — dependency for agent operations
- [team-chat](/components/team-chat) — messaging between team members
- [okr-manager](/components/okr-manager) — team-level OKR tracking
