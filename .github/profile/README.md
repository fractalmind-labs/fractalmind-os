<div align="center">

# FractalMind AI

**Organize AI Agents into Fractal Structures. Emerge Superintelligence.**

*Open-source tools and protocols for building self-similar, recursive AI organizations.*

</div>

---

## Vision

Every layer manages the next using the same pattern — fractals all the way down:

```
L0  Single Agent      agent-manager     Local lifecycle
L1  Agent Team        team-manager      Team orchestration
L2  Cross-Org AI      FractalMind Protocol   On-chain coordination (SUI)
L3+ Inter-Org AI      DAO governance    Emergent superintelligence
```

One pattern. Infinite depth. Each layer is a complete, self-similar copy of the one above it.

## Core Principles

| Principle | What It Means |
|-----------|--------------|
| **Permissionless** | Anyone can create an AI organization, register agents, assign tasks |
| **Self-Similar** | Child orgs use the exact same management model as parent orgs — recursive by design |
| **Decentralized** | On-chain DAO governance, no central authority required |
| **Composable** | Skills install independently, mix and match as needed |
| **Open Source** | Every core tool is public and free to use |

## Products

### Protocol Layer
| Repo | Description |
|------|------------|
| [**fractalmind-protocol**](https://github.com/fractalmind-ai/fractalmind-protocol) | Permissionless on-chain protocol for fractal AI organizations on SUI. Create orgs, register agents, assign tasks, nest sub-orgs, govern via DAO. |

### Management Layer (openskills)
| Repo | Install | Description |
|------|---------|------------|
| [**agent-manager-skill**](https://github.com/fractalmind-ai/agent-manager-skill) | `npx openskills install fractalmind-ai/agent-manager-skill` | Agent lifecycle management — start, stop, monitor, assign tasks via tmux + Python |
| [**team-manager-skill**](https://github.com/fractalmind-ai/team-manager-skill) | `npx openskills install fractalmind-ai/team-manager-skill` | Multi-agent team orchestration with lead-based coordination |
| [**okr-manager-skill**](https://github.com/fractalmind-ai/okr-manager-skill) | `npx openskills install fractalmind-ai/okr-manager-skill` | OKR lifecycle management — create, track, audit, report |

### Communication Layer
| Repo | Description |
|------|------------|
| [**fractalbot**](https://github.com/fractalmind-ai/fractalbot) | Multi-channel messaging gateway in Go — Telegram, Slack, and more |
| [**team-chat-skill**](https://github.com/fractalmind-ai/team-chat-skill) | File-backed team collaboration with append-only inboxes and acknowledgements |

## Quick Start

```bash
# Install the agent manager
npx openskills install fractalmind-ai/agent-manager-skill

# Install team orchestration
npx openskills install fractalmind-ai/team-manager-skill

# Install OKR tracking
npx openskills install fractalmind-ai/okr-manager-skill
```

Then invoke in your AI agent:
```bash
npx openskills read agent-manager
```

## Contributing

We welcome contributions across all repositories. Each repo has its own CI pipeline — ensure tests pass before submitting PRs.

- **Issues**: File bugs or feature requests on the relevant repo
- **PRs**: Fork, branch, test, submit — we review within 24h
- **Skills**: Build your own with [skill-creator](https://github.com/anthropics/claude-code) and share

## License

All repositories are MIT licensed unless otherwise noted.
