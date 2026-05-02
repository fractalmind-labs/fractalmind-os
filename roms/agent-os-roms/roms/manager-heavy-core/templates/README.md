# manager-heavy-core templates

Complete template set for bootstrapping a coordination-first AI employee workspace.

## Contents

| File | Purpose |
|------|---------|
| `SYSTEM.md` | Kernel contract — role, manager principles, operating rules, structure invariants |
| `SOUL.md` | Identity + operating principles for manager-heavy agents |
| `AGENTS.md` | Session bootstrap sequence, memory rules, communication guidelines, heartbeat/dream discipline |
| `HEARTBEAT.md` | TODO-first execution surface with `HEARTBEAT_OK` gate, escalation templates, and verification discipline |
| `DREAM.md` | Safe idle-maintenance boundary: memory/skill hygiene only, no uncontrolled OS rewrites |
| `USER.md` | Operator profile template with timezone/language/approval boundaries |
| `OKR.md` | Active OKR control plane (max 3 concurrent) |
| `TODO.md` | Current high-priority execution tracker |
| `MEMORY.md` | Long-term curated memory (main/private session only) |
| `TOOLS.md` | Local tools, services, and environment notes |
| `memory/index.md` | Topic navigation index for daily notes |
| `okrs/Candidate.md` | Non-active OKR parking lot with lifecycle rules |

## Installation

Copy all template files to your workspace root, preserving directory structure:

```bash
cp -r templates/* /path/to/your/workspace/
```

Then:
1. Fill in `USER.md` with operator details.
2. Customize `AGENTS.md` frontmatter (launcher, model, skills, heartbeat cron).
3. Install required skills from `manifest.yaml` (`included_skills`; optionally `optional_skills`).
4. Keep private workspace details in `USER.md`, `MEMORY.md`, and `TOOLS.md`; do not upstream them.
