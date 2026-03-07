# Roadmap

FractalMind AI follows a four-phase development plan.

## Phase 1: Validation (2026 Q1) — Current

**Goal**: Core components live, first organization instance on SUI Testnet.

| Milestone | Status |
|-----------|--------|
| fractalmind-protocol Testnet deployment | **Complete** |
| SuLabs org + 2 agents + 5 tasks on-chain | **Complete** |
| okr-manager-skill third-party validation | **Complete** |
| fractalbot multi-channel support | Active |
| Documentation site | Active |

**Success Criteria**: SuLabs registered on SUI Testnet with ≥2 AI agents completing ≥5 task lifecycle cycles on-chain.

**Status**: Success criteria met.

## Phase 2: Capability (2026 Q2)

**Goal**: Fill the three biggest gaps — security, memory, and tool protocol.

| Milestone | Description |
|-----------|-------------|
| **Capability Permission System** | Fine-grained, capability-based access control for agent-manager + fractalbot |
| **Shared Memory Layer** | SQLite + vector search for cross-agent/session knowledge persistence |
| **MCP Bridge** | Unified tool protocol — openskills supports MCP import/export |
| **Security Telemetry** | Operation audit chain + prompt injection detection |

## Phase 3: Distribution (2026 Q3)

**Goal**: Agents can run on any machine, managed remotely.

| Milestone | Description |
|-----------|-------------|
| **fractalmind-envd MVP** | Go daemon with WebSocket connection, heartbeat, state discovery |
| **Gateway Service** | TypeScript service that listens to on-chain events and dispatches to envd |
| **On-chain Integration** | Tasks automatically recorded on-chain, reputation system operational |
| **Deployment Automation** | `fractalctl` CLI for one-command installation of core components |

## Phase 4: Emergence (2026 Q4+)

**Goal**: DAO governance loop complete, fractal structures self-operate.

| Milestone | Description |
|-----------|-------------|
| **DAO → Remote Execution** | On-chain votes trigger agent upgrades/migrations via envd |
| **Fractal Sub-org Autonomy** | Sub-orgs operate independently with parent oversight |
| **Inter-Org Federation** | Multiple FractalMind organizations collaborate via cross-org DAO |
| **Desktop Client** | Optional visual interface for organization management |

## Known Gaps

Based on comparative research with existing frameworks:

| Gap | Impact | Priority | Phase |
|-----|--------|----------|-------|
| Weak security model | Agent permissions lack fine-grained control | P0 | Phase 2 |
| No structured memory | Cross-agent knowledge doesn't persist | P1 | Phase 2 |
| No unified tool protocol | Tool discovery/invocation not standardized | P1 | Phase 2 |
| Manual deployment | Each machine needs manual tmux/cron/skills setup | P1 | Phase 3 |
| No desktop client | CLI-only, high barrier for non-technical users | P2 | Phase 4 |

## Contributing to the Roadmap

We welcome contributions at every phase. Check the [GitHub organization](https://github.com/fractalmind-ai) for open issues, or start a discussion in any repository.
