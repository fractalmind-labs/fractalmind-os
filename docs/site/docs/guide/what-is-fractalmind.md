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

FractalMind combines a local governed operating loop with three remote-control planes:

- **Control / Authority Plane** — SUI contracts define target-scoped capability, delegation, revocation, use, and budget bounds.
- **P2P Data / Execution Plane** — target envd verifies signed intents, protects replay state, and invokes typed local adapters.
- **Application Plane** — Agent Console, envd-desktop, channel adapters, and automation clients create requests and display results.
- **Local operating loop** — heartbeat, structured memory, candidate OKRs, governance, evidence, and outcomes coordinate delivery.

The control loop is explicit:

```
signal -> memory -> candidate OKR -> governance -> execution -> outcome -> evolution
```

## How It Works Today

The three-plane architecture is the migration target. Existing repositories still contain compatibility paths, so public docs distinguish current implementation from target behavior.

For remote privileged actions:

```text
capability -> signed intent -> P2P/relay -> target envd verify
           -> durable reservation -> local adapter -> durable result
```

Relay, coordinator, channel identity, and bearer tokens are not authority sources. Raw logs, media, input, files, and frequent heartbeats remain off-chain.

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
- The existing protocol package remains live on **SUI Testnet** for identity, tasks, and governance
- Remote capability and target-enforcement work remains a tracked migration until reviewed, merged, and published
- Current migration status is tracked in [fractalmind-ai/.github#6](https://github.com/fractalmind-ai/.github/issues/6)

See the [Architecture Overview](/architecture/overview) and [Roadmap](/roadmap/) for the latest framing.
