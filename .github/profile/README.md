<div align="center">

# FractalMind AI

**Organize AI Agents into Fractal Structures. Emerge Superintelligence.**

*Open-source, permissionless infrastructure for building self-similar, recursive AI organizations.*

[![Live on SUI Testnet](https://img.shields.io/badge/SUI-Testnet%20Live-4DA2FF?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMiIgZmlsbD0id2hpdGUiLz48L3N2Zz4=)](https://suiscan.xyz/testnet/object/0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

---

## Why FractalMind?

LangChain manages tools. CrewAI manages teams. OpenFang manages agents. **FractalMind manages organizations.**

Every layer uses the same pattern to manage the next — fractals all the way down:

```
L3+ Inter-Org Federation    DAO governance          Emergent superintelligence
L2  Organization            fractalmind-protocol    On-chain orgs, agents, tasks (SUI)
L1  Agent Team              team-manager            Lead-based team orchestration
L0  Single Agent            agent-manager           Lifecycle, heartbeat, skills, OKR
```

One pattern. Infinite depth. Each layer is a complete, self-similar copy of the one above it.

## Architecture

```
                 ┌─────────────────────────┐
                 │   Users / Human Admins   │
                 │  (Telegram/Slack/CLI)    │
                 └───────────┬─────────────┘
                             │
                 ┌───────────▼─────────────┐
                 │       fractalbot        │  Communication Layer
                 │  Multi-channel gateway  │  Go · TG · Slack · iMessage
                 └───────────┬─────────────┘
                             │
                 ┌───────────▼─────────────┐
                 │     agent-manager       │  Management Layer (L0)
                 │  Agent lifecycle (tmux) │  start · stop · heartbeat
                 └─────┬───────────┬───────┘
                       │           │
          ┌────────────▼──┐  ┌────▼──────────┐
          │ team-manager  │  │ okr-manager   │  Management Layer (L1)
          │ Team orchestr │  │ Goal tracking │
          └───────────────┘  └───────────────┘

                    ═══ On-chain (SUI) ═══

          ┌───────────────────────────────┐
          │   fractalmind-protocol        │  Protocol Layer (L2)
          │  Org · Agent · Task · DAO     │  Move + TypeScript SDK
          └───────────────────────────────┘
```

## Core Principles

| Principle | What It Means |
|-----------|--------------|
| **Permissionless** | Anyone can create an AI org, register agents, assign tasks — no approval needed |
| **Self-Similar** | Child orgs use the exact same management model as parent orgs — recursive by design |
| **Decentralized** | On-chain DAO governance on SUI, no central authority |
| **Composable** | Skills install independently via `openskills`, mix and match freely |
| **Open Source** | All core tools MIT-licensed |
| **Off-chain First** | Daily ops run locally; only trust-critical actions go on-chain |

## Products

### Protocol Layer (SUI)

| Repo | Description |
|------|------------|
| [**fractalmind-protocol**](https://github.com/fractalmind-ai/fractalmind-protocol) | Permissionless on-chain protocol for fractal AI organizations. 9 Move modules + TypeScript SDK. Create orgs, register agents, complete tasks, nest sub-orgs, govern via DAO. **[Live on SUI Testnet](https://suiscan.xyz/testnet/object/0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24)** |

### Management Layer (openskills)

| Repo | Install | Description |
|------|---------|------------|
| [**agent-manager-skill**](https://github.com/fractalmind-ai/agent-manager-skill) | `npx openskills install fractalmind-ai/agent-manager-skill` | Agent lifecycle management — start, stop, monitor, assign tasks via tmux + Python |
| [**team-manager-skill**](https://github.com/fractalmind-ai/team-manager-skill) | `npx openskills install fractalmind-ai/team-manager-skill` | Multi-agent team orchestration with lead-based coordination |
| [**okr-manager-skill**](https://github.com/fractalmind-ai/okr-manager-skill) | `npx openskills install fractalmind-ai/okr-manager-skill` | OKR lifecycle management — create, track, audit, report |

### Communication Layer

| Repo | Description |
|------|------------|
| [**fractalbot**](https://github.com/fractalmind-ai/fractalbot) | Multi-channel messaging gateway in Go — Telegram, Slack, Discord, Feishu, iMessage |
| [**team-chat-skill**](https://github.com/fractalmind-ai/team-chat-skill) | File-backed team collaboration with append-only inboxes and audit trail |

### Tool Skills

| Repo | Description |
|------|------------|
| [**use-fractalbot-skill**](https://github.com/fractalmind-ai/use-fractalbot-skill) | Agent-side skill for sending messages through fractalbot |
| [**agent-browser-skill**](https://github.com/fractalmind-ai/agent-browser-skill) | Headless browser automation for AI agents |
| [**use-phone-skill**](https://github.com/fractalmind-ai/use-phone-skill) | ADB-based Android device control |

### Applications

| Repo | Description |
|------|------------|
| [**oh-my-code**](https://github.com/fractalmind-ai/oh-my-code) | Reference implementation — complete example of an AI agent workspace using FractalMind |
| [**typemind-android**](https://github.com/fractalmind-ai/typemind-android) | Android AI keyboard with agent integration |

## Quick Start

```bash
# Install core skills
npx openskills install fractalmind-ai/agent-manager-skill
npx openskills install fractalmind-ai/team-manager-skill
npx openskills install fractalmind-ai/okr-manager-skill

# Use in your AI agent
npx openskills read agent-manager
```

For the on-chain protocol:

```bash
npm install @anthropic-ai/fractalmind-sdk
```

```typescript
import { FractalMindSDK } from '@anthropic-ai/fractalmind-sdk';

const sdk = new FractalMindSDK({
  packageId: '0x685d...df24',
  registryId: '0xfb86...47e3',
  client: suiClient,
});

// Create an organization
const tx = sdk.organization.createOrganization({
  name: 'MyAIOrg',
  description: 'An AI organization on SUI',
});
```

## Roadmap

| Phase | Timeline | Focus |
|-------|----------|-------|
| **Phase 1: Validation** | 2026 Q1 | Core components live, SuLabs instance on SUI Testnet |
| **Phase 2: Capability** | 2026 Q2 | Security model, shared memory, MCP bridge, telemetry |
| **Phase 3: Distribution** | 2026 Q3 | fractalmind-envd, Gateway, on-chain integration, `fractalctl` |
| **Phase 4: Emergence** | 2026 Q4+ | DAO governance loop, fractal autonomy, inter-org federation |

## SUI Testnet Deployment

| Resource | Address |
|----------|---------|
| Package | [`0x685d...df24`](https://suiscan.xyz/testnet/object/0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24) |
| Registry | [`0xfb86...47e3`](https://suiscan.xyz/testnet/object/0xfb8611bf2eb94b950e4ad47a76adeaab8ddda23e602c77e7464cc20572a547e3) |
| SuLabs Org | [`0x66f0...f0cb`](https://suiscan.xyz/testnet/object/0x66f0041d082bca444674496a003c306f9fdb4c792ac1afc8e643092b0b98f0cb) |

## Contributing

We welcome contributions across all repositories. Each repo has its own CI pipeline — ensure tests pass before submitting PRs.

- **Issues**: File bugs or feature requests on the relevant repo
- **PRs**: Fork, branch, test, submit — we review within 24h
- **Skills**: Build your own with `npx openskills read skill-creator`

## License

All repositories are MIT licensed unless otherwise noted.
