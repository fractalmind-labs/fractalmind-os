# What is FractalMind?

FractalMind AI is **open-source infrastructure for running AI agent teams as a governed operating system**.

## The Problem

Most agent tooling stops at one layer:

- chat interfaces move messages
- agent frameworks manage one worker at a time
- team frameworks coordinate a local swarm
- protocol projects define trust surfaces

But real delivery needs the whole loop: shared state, priorities, governance, execution, evidence, and learning. Without that, multi-agent work becomes fragile, opaque, and dependent on heroic manual coordination.

## The Current Answer

FractalMind combines four surfaces into one operating model:

- **Communication** — `fractalbot` routes humans and agents across Slack, Telegram, Discord, Feishu, and more
- **Execution** — `agent-manager` runs tmux-based agents and lets the system dispatch work reliably
- **Operating system loop** — heartbeat, structured memory, candidate OKRs, governance, outcomes, and evolution
- **Trust surfaces** — `fractalmind-protocol`, `explorer`, and `fractalmind-envd` extend the system when on-chain identity or distributed execution matters

The control loop is explicit:

```
signal -> memory -> candidate OKR -> governance -> execution -> outcome -> evolution
```

## How It Works Today

```
L3  Trust & Distribution    protocol / envd / explorer    Optional trust and remote execution
L2  Operating System        heartbeat + memory + OKRs     Governed coordination and delivery
L1  Teams & Workflows       team-manager / okr-manager    Team-level planning and tracking
L0  Single Agent Execution  agent-manager                 Lifecycle, dispatch, and local work
```

The important shift is that **FractalMind is now OS-first, not only protocol-first**.

- The daily running core lives in `oh-my-code`
- Shared candidate OKRs land in `fractalmind-okrs`
- Public trust surfaces still matter, but they are no longer the only story

## Who Is This For?

- **AI builders** who need more than a chat bot or single-agent wrapper
- **Teams operating multiple agents** with real delivery pressure
- **Researchers** exploring governed autonomy and long-horizon coordination
- **Organizations** that want auditability, human–AI co-creation, and repeatable execution

## Current State

As of the current public org state:

- FractalMind AI spans **18 public repositories**
- The heartbeat-driven OS loop is running in `oh-my-code`
- Candidate OKR sync is active through `fractalmind-okrs`
- The protocol remains live on **SUI Testnet** as an optional trust layer
- Current work focuses on observability, governed delivery, memory, and distribution — not just proving the protocol exists

See the [Architecture Overview](/architecture/overview) and [Roadmap](/roadmap/) for the latest framing.
