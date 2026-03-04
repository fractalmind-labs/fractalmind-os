# okr-manager-skill

OKR lifecycle management skill for AI agents. Install it so your AI employees can create, track, update, and report on OKRs autonomously.

## Install

### Claude Code (openskills)

```bash
npx openskills install fractalmind-ai/okr-manager-skill
```

Then invoke in your agent:

```bash
npx openskills read okr-manager
```

### Manual

Copy `SKILL.md` into your agent's skills directory (e.g., `.agent/skills/okr-manager/SKILL.md`).

## What It Does

- **Create OKRs** with enforced quality standards (measurable success criteria, dependency chains, concrete deliverables)
- **Track progress** by updating KR statuses with completion evidence
- **Heartbeat audit** — periodic check-ins that identify blocked KRs and push work forward
- **Report status** in a compact, scannable format

## Configuration

The skill is configurable via your agent's workspace. Set these values as needed:

| Config | Default | Description |
|--------|---------|-------------|
| OKR file path | `OKR.md` | Where OKRs are stored |
| Language | `en` | Primary language (`en`, `zh`, `ja`, `ko`, etc.) |
| Status markers | `PENDING / IN PROGRESS / COMPLETE` | KR status labels |
| Priority markers | `P0 / P1 / P2` | Priority levels |

## OKR Quality Gate

Every OKR created through this skill is validated against a checklist:

- [ ] Objective is outcome-oriented (verb + outcome, not activity)
- [ ] Success Criteria has a quantifiable metric
- [ ] Success Criteria is binary verifiable (done / not done)
- [ ] Every KR has a status marker
- [ ] KR dependencies are explicit
- [ ] Every KR has a concrete deliverable + verification method
- [ ] Priority is marked (P0 / P1 / P2)
- [ ] Owner is assigned

Missing any item? The skill flags it before writing to the OKR file.

## Examples

See [`examples/`](examples/) for:

- **[okr-template-en.md](examples/okr-template-en.md)** — English OKR template
- **[okr-template-zh.md](examples/okr-template-zh.md)** — Chinese OKR template
- **[heartbeat-integration.md](examples/heartbeat-integration.md)** — How to wire OKR audits into your heartbeat loop

## Who Is This For?

AI agents (Claude Code, OpenAI Codex, custom agents) that manage projects with structured objectives. If your agent has a heartbeat loop and a markdown-based workspace, this skill fits right in.

## License

[MIT](LICENSE)
