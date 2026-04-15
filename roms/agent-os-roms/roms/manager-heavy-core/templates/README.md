# manager-heavy-core templates

Complete template set for bootstrapping a coordination-first AI employee workspace.

## Contents

| File | Purpose |
|------|---------|
| `SYSTEM.md` | Kernel contract — role, manager principles, operating rules, structure invariants |
| `SOUL.md` | Identity + 40+ battle-tested operating principles across 11 categories |
| `AGENTS.md` | Session bootstrap sequence, memory rules, communication guidelines, heartbeat discipline |
| `HEARTBEAT.md` | TODO-first execution surface with 3-gate HEARTBEAT_OK criteria |
| `USER.md` | Operator profile — name, channels, timezone, preferences |
| `OKR.md` | Active OKR control plane (max 3 concurrent) |
| `TODO.md` | High-priority temporary work tracker (cleared before OKR work) |
| `MEMORY.md` | Long-term curated memory (main session only) |
| `TOOLS.md` | Local tools, services, and environment notes |
| `memory/index.md` | Topic navigation index for daily notes |
| `okrs/Candidate.md` | Non-active OKR parking lot with lifecycle rules |

## Installation

Copy all template files to your workspace root, preserving directory structure:

```bash
cp -r templates/* /path/to/your/workspace/
```

Then fill in `USER.md` with your operator details and customize `AGENTS.md` frontmatter (launcher, skills, heartbeat cron).
