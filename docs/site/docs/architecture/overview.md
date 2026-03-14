# Architecture Overview

FractalMind AI is currently best understood as a **heartbeat-driven operating system for AI agent teams**, with optional on-chain trust surfaces.

## Current Operating Stack

```
                   ┌──────────────────────────────┐
                   │    Humans / External Tools   │
                   │   Slack · Telegram · CLI     │
                   └──────────────┬───────────────┘
                                  │
                        ┌─────────▼─────────┐
                        │    fractalbot     │  Communication surface
                        │ routing + context │
                        └─────────┬─────────┘
                                  │
               ┌──────────────────▼──────────────────┐
               │         FractalMind OS core         │
               │   oh-my-code + heartbeat control    │
               │ signal -> memory -> OKR -> outcome  │
               └───────┬───────────────┬─────────────┘
                       │               │
          ┌────────────▼───────┐   ┌───▼──────────────────┐
          │   structured state │   │  fractalmind-okrs    │
          │ memory/*.json*     │   │ candidate publication │
          └────────────┬───────┘   └──────────────────────┘
                       │
               ┌───────▼────────┐
               │ agent-manager  │  Execution plane
               │ tmux lifecycle │
               └───────┬────────┘
                       │
               ┌───────▼────────┐
               │  Agent sessions │
               │ main / coder-*  │
               └─────────────────┘

      Optional trust / distribution surfaces:
      fractalmind-protocol · fractalmind-envd · explorer · openclaw-gateway-app
```

## Layer Responsibilities

### Communication Surface — `fractalbot`

Routes humans and agents across channels, injects routing context, and acts as the boundary between outside requests and the internal operating loop.

### Operating System Core — `oh-my-code` + heartbeat

The current center of gravity. This is where the system:

- records signals
- reduces state into priorities
- manages candidate OKRs
- governs actions by risk level
- dispatches work to agents
- records outcomes and evolution

### Execution Plane — `agent-manager`

Runs agents in tmux sessions, handles lifecycle management, and provides the actual execution plane for work chosen by the heartbeat.

### Shared Governance Surface — `fractalmind-okrs`

Stores exported candidate OKRs so strategy stays visible, reviewable, and durable beyond a single terminal session.

### Trust & Distribution Surfaces — `fractalmind-protocol`, `fractalmind-envd`, `explorer`

These remain important, but they are now part of a broader system story:

- **`fractalmind-protocol`** — optional on-chain identity / governance / trust layer on SUI
- **`fractalmind-envd`** — remote execution and distributed runtime direction
- **`explorer`** — public visualization surface

## Dependency Shape

```
fractalmind-protocol (optional trust layer)
    │
    ├──▸ explorer
    └──▸ [future] envd / gateway integration

fractalbot
    │
    └──▸ oh-my-code heartbeat
             │
             ├──▸ memory/*.json*
             ├──▸ fractalmind-okrs
             └──▸ agent-manager
                      │
                      ├──▸ team-manager
                      ├──▸ okr-manager
                      └──▸ team-chat / tool skills
```

## The Architectural Shift

The older public framing emphasized **protocol-first infrastructure on SUI**.

The current reality is broader:

- the protocol is still real and valuable
- but the system that runs every day is a **governed execution OS**
- heartbeat, memory, OKRs, routing, and outcomes are now the main operational story

That is the architecture the public docs should describe.
