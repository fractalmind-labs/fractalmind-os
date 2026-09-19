# okr-manager

> OKR lifecycle management for AI agents.

**Repo**: [fractalmind-ai/okr-manager-skill](https://github.com/fractalmind-ai/okr-manager-skill)
**Language**: Skill (Markdown-based)
**Status**: Stable
**Install**: `npx openskills install fractalmind-ai/okr-manager-skill`

## What It Does

okr-manager gives AI agents the ability to autonomously manage Objectives and Key Results:

- **Create OKRs**: With quality gates ensuring measurability and accountability
- **Track progress**: Status markers, dependency chains, priority levels
- **Heartbeat audit**: Automatic OKR review during agent heartbeats
- **Report status**: Formatted progress reports for humans

## Quality Gates

Every OKR must pass quality checks before creation:

- Objective is outcome-oriented (not task-oriented)
- Success criteria are measurable and binary-verifiable
- Each KR has status markers (`PENDING`, `IN PROGRESS`, `COMPLETE`)
- Dependencies between KRs are explicit
- Deliverables are specified
- Priority and owner are assigned

## Usage

```bash
npx openskills read okr-manager
```

The skill guides the agent through OKR operations:

```markdown
## Create a new OKR

### Objective
Build a complete documentation site for the protocol.

### Key Results
KR1: Architecture docs covering all 9 modules — PENDING
KR2: SDK API reference with examples — PENDING
KR3: Deploy to GitHub Pages — PENDING
```

## Configuration

Supports multiple languages and custom markers:

```yaml
language: en  # or zh, ja
status_markers:
  pending: "PENDING"
  in_progress: "IN PROGRESS"
  complete: "COMPLETE"
priority_markers:
  p0: "P0"
  p1: "P1"
```

## Where It Fits

okr-manager is **independent** — it doesn't depend on other skills but is commonly used with:

- **agent-manager**: OKR review during heartbeat cycles
- **team-manager**: Team-level OKR tracking
- **team-chat**: OKR progress shared via team messages

## Related Components

- [agent-manager](/components/agent-manager) — heartbeat integration
- [team-manager](/components/team-manager) — team-level goals
