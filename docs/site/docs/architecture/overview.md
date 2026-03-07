# Architecture Overview

FractalMind AI is organized into four layers, each responsible for a different level of abstraction.

## Full Architecture

```
                 ┌─────────────────────────┐
                 │   Users / Human Admins   │
                 │  (Telegram/Slack/CLI)    │
                 └───────────┬─────────────┘
                             │
                 ┌───────────▼─────────────┐
                 │       fractalbot        │  Communication Layer
                 │  Multi-channel gateway  │  Go · TG · Slack · Discord
                 │                         │  Feishu · iMessage
                 └───────────┬─────────────┘
                             │ Route + context injection
                 ┌───────────▼─────────────┐
                 │     agent-manager       │  Management Layer (L0)
                 │  Agent lifecycle (tmux) │  start · stop · heartbeat
                 └─────┬───────────┬───────┘
                       │           │
          ┌────────────▼──┐  ┌────▼──────────┐
          │ team-manager  │  │ okr-manager   │  Management Layer (L1)
          │ Team orchestr │  │ Goal tracking │
          └───────┬───────┘  └──────────────┘
                  │
          ┌───────▼───────────────────────┐
          │         team-chat             │  Collaboration Layer
          │  File messaging · Audit trail │
          └───────────────────────────────┘

                 ═══ On-chain (SUI) ═══

          ┌───────────────────────────────┐
          │   fractalmind-protocol        │  Protocol Layer (L2)
          │  Org · Agent · Task · DAO     │  Move contracts + TS SDK
          └───────────────────────────────┘

                 ═══ Future ═══

          ┌───────────────────────────────┐
          │   fractalmind-envd + Gateway  │  Execution Layer
          │  On-chain ↔ off-chain bridge  │  Go daemon + TS service
          └───────────────────────────────┘
```

## Layer Responsibilities

### Communication Layer — fractalbot

The entry point for human-to-agent communication. fractalbot is a Go binary that routes messages from external channels (Telegram, Slack, Discord, Feishu, iMessage) to the appropriate agent.

### Management Layer — agent-manager, team-manager, okr-manager

The operational core. These skills run as part of an AI agent's context and provide:
- **agent-manager** (L0): Start, stop, monitor individual agents in tmux sessions
- **team-manager** (L1): Coordinate multi-agent teams with a lead-based model
- **okr-manager**: Track objectives and key results across agents and teams

### Collaboration Layer — team-chat

Asynchronous, file-backed messaging between agents. Append-only inboxes, task state snapshots, and audit trails — all stored as local files.

### Protocol Layer — fractalmind-protocol

On-chain organizational primitives on SUI:
- **Organization**: Create and manage AI organizations
- **AgentCertificate**: On-chain agent identity with reputation
- **Task**: Full lifecycle (create → assign → submit → verify → complete)
- **Governance**: DAO proposals, voting, execution
- **Fractal**: Nested sub-organizations with the same structure

### Execution Layer — fractalmind-envd (Future)

A daemon that bridges on-chain governance with off-chain execution. When a DAO vote passes to upgrade an agent, envd carries out the action on the target machine.

## Component Dependencies

```
fractalmind-protocol (standalone, on-chain)
    │
    └──▸ [future] Gateway Service (TS)
              │
              └──▸ [future] fractalmind-envd (Go daemon)

fractalbot (standalone, communication gateway)
    │
    ├──▸ agent-manager-skill (routes to agents)
    │         │
    │         ├──▸ team-manager-skill (depends on agent-manager)
    │         │
    │         ├──▸ okr-manager-skill (standalone, called by heartbeat)
    │         │
    │         └──▸ team-chat-skill (standalone, integrated by team-manager)
    │
    └──▸ use-fractalbot-skill (agent-side sending)

oh-my-code (reference implementation, integrates all above)
```

## Key Design Decisions

See [Design Decisions](/architecture/design-decisions) for the rationale behind major technical choices.
