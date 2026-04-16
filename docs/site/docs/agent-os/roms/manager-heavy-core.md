# manager-heavy-core

> Manager-first AI Agent OS distribution for coordination-heavy workspaces.

| Field | Value |
|-------|-------|
| **Status** | Production-ready |
| **Version** | v0.5.0 |
| **Family** | manager-heavy |
| **Spec** | >=1.0.0 \<2.0.0 |
| **Persona** | Coordinator-first |
| **Heartbeat** | Proactive |

## Description

Full template set with battle-tested principles, escalation templates, OKR control plane, TODO-first heartbeat, and file-backed memory system. This is the most mature ROM, distilled from production experience managing multi-agent teams.

## Use Cases

- Multi-agent management with delegation
- OKR-driven execution with max 3 active objectives
- GitHub-centric development workflows
- Coordination-first workspaces where the agent orchestrates rather than codes

## Skills

### Required (included_skills)

| Skill | Source | Description |
|-------|--------|-------------|
| [agent-manager](https://github.com/fractalmind-ai/agent-manager-skill) | git | Employee agent lifecycle management — start, stop, monitor, assign tasks |
| [team-manager](https://github.com/fractalmind-ai/team-manager-skill) | git | Team orchestration — create teams, assign tasks, monitor progress |

### Optional (optional_skills)

| Skill | Source | Description |
|-------|--------|-------------|
| [agent-calendar](https://github.com/fractalmind-ai/agent-calendar-skill) | git (v0.1.0) | Agent availability calendar — track free/busy/unavailable states, monitor quotas |
| notifier | embedded | Multi-channel notifications — Feishu, Slack, Telegram, email |

## Workspace Files

After installation, your workspace will contain:

### Core OS files
| File | Purpose |
|------|---------|
| `SYSTEM.md` | Kernel contract with manager principles and operating rules |
| `SOUL.md` | 40+ operating principles across 11 categories |
| `AGENTS.md` | Session bootstrap, memory rules, structure invariants |
| `USER.md` | Operator profile template |
| `HEARTBEAT.md` | TODO-first execution surface with 3-gate criteria |
| `OKR.md` | Active OKR control plane (max 3) |
| `TODO.md` | High-priority temporary work tracker |
| `MEMORY.md` | Long-term curated memory |
| `TOOLS.md` | Local tools and environment notes |

### Memory system
| Path | Purpose |
|------|---------|
| `memory/index.md` | Topic navigation index |
| `memory/YYYY-MM-DD.md` | Daily notes (created as needed) |

### OKR system
| Path | Purpose |
|------|---------|
| `okrs/Candidate.md` | Non-active OKR parking lot |

## Key Principles

- **TODO-first heartbeat**: Temporary urgent work is resolved before OKR progression
- **3-gate HEARTBEAT_OK**: Must pass external-wait + no-internal-action + fresh-scan before returning OK
- **Max 3 active OKRs**: Non-active OKRs park in `okrs/Candidate.md`
- **File-backed memory**: Daily notes + topic index + long-term curated memory
- **Escalation templates**: Standardized approval request and blocker report formats
- **Evidence-based OKR closure**: 8 rules for closing objectives with proof

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| v0.5.0 | 2026-04-16 | agent-calendar open-sourced, switched to git source |
| v0.4.0 | 2026-04-16 | Embedded skills bundled, skill classification (included/optional) |
| v0.3.0 | 2026-04-16 | Structured skill source declarations |
| v0.2.0 | 2026-04-15 | Full 11-file template set, TODO-first heartbeat |
| v0.1.0 | 2026-03-26 | Bootstrap draft |

[View full release notes on GitHub](https://github.com/fractalmind-ai/agent-os-roms/blob/main/roms/manager-heavy-core/release-notes.md)

## Install

See the [Installation Guide](/agent-os/install) for step-by-step instructions.
