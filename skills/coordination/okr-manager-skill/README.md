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

## Recommended Shape for AI Teams

For AI employees and human+AI collaboration, the most reliable structure is:

- **Objective** = why this work matters
- **KR** = what observable result proves progress
- **Task / Milestone** = how execution is staged, assigned, and unblocked

In practice, that means:

- Keep **KRs result-oriented** — they should answer “did the world actually get better?”
- Keep **Tasks/Milestones execution-oriented** — they hold implementation steps, owners, and sequencing
- Do **not** let a task list masquerade as KRs

**Good**

- Objective: Make AI task routing stable and auditable
- KR1: 80% of tasks are assigned within 10 minutes with a verifiable receipt
- KR2: 90% of completed tasks report back to the source channel with PR / issue / evidence links
- Tasks: persist assignment state, verify agent receipts, post source-channel callbacks

**Weak**

- Objective: Improve AI collaboration efficiency
- KR1: Build agent manager
- KR2: Integrate Slack
- KR3: Improve UX

Those are implementation tasks, not key results.

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
- [ ] Every KR describes an observable result, not just an implementation step
- [ ] KR dependencies are explicit
- [ ] Tasks / milestones are separated from KRs when execution detail is needed
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
