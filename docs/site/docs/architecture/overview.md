# Architecture Overview

FractalMind uses a canonical **three-plane architecture** for remote agent control. The model separates authority, transport/execution, and user-facing applications so that no relay, gateway, or bearer token becomes the trust root.

> Migration status: this is the target architecture tracked in [Discussion #5](https://github.com/orgs/fractalmind-ai/discussions/5) and the [cross-repository tracker](https://github.com/fractalmind-ai/.github/issues/6). Some repositories still contain compatibility paths while the migration is in progress.

## The Three Planes

```text
Applications
Agent Console | envd-desktop | channel and automation clients
                         |
                         | signed intent + capability reference
                         v
Control / Authority Plane
SUI contracts: organization, identity, capability, delegation,
revocation checkpoint, bounded use and budget
                         |
                         | verifiable authority state
                         v
P2P Data / Execution Plane
target envd: verify -> reserve -> execute through local adapter -> result
                         ^
                         |
relay / rendezvous / cache: availability support only
```

### Control / Authority Plane

`fractalmind-protocol` is the canonical authority source for privileged remote actions. It defines:

- organization and agent identity
- target-scoped capabilities
- bounded delegation
- revocation checkpoints
- action, scope, command, nonce, idempotency, use, and budget constraints
- optional evidence anchors for durable audit

Authority is decided by the capability and signed intent, not by a relay, coordinator, application session, or bearer token.

### P2P Data / Execution Plane

`fractalmind-envd` runs on the target node. It owns the final authorization and execution boundary:

1. resolve the authority reference
2. verify the signed intent and target
3. enforce freshness, replay, use, and budget constraints
4. reserve execution in durable local state
5. invoke a typed local adapter
6. persist and return the result

`agent-manager` is the local tmux execution adapter. It is not a remote authority service. Relay, rendezvous, coordinator, and index-cache services may improve reachability and discovery, but they cannot grant node control or bypass target verification.

### Application Plane

Agent Console, envd-desktop, and other clients present user workflows. For privileged actions they create or relay signed intents; they do not become the authority source themselves.

`fractalbot` is a channel adapter. It preserves routing context between Slack, Telegram, Discord, Feishu, iMessage, and agents, but target envd still decides whether a privileged command is authorized.

## Data Placement

Only authority-critical and low-frequency audit state belongs on-chain. High-volume or private operational data remains off-chain.

| Data | Placement |
|------|-----------|
| Organization, agent identity, capabilities, delegation, revocation | SUI authority plane |
| Signed command envelope and target-side reservation/result | P2P plus durable target-local state |
| Raw logs, screen media, input events, files | Off-chain P2P only |
| High-frequency heartbeats, latency, relay load | Off-chain |
| Optional completion/evidence digest | On-chain anchor when required |

## Availability Is Not Authority

- Low-risk read-only operations may use cached discovery data when policy permits.
- High-risk or mutating operations fail closed when authority freshness, revocation state, target verification, or durable replay evidence is unavailable.
- A compromised relay may delay, drop, duplicate, or replay transport packets, but it must not gain the ability to authorize or execute a node command.

## Supporting Components

- `oh-my-code`, heartbeat, memory, and OKR tooling govern local work and delivery.
- `team-manager`, `okr-manager`, and `team-chat` coordinate local agent teams.
- skills are distribution packages that expose bounded tools and workflows.
- explorer and documentation surfaces visualize verifiable state; they do not decide authority.

See [Data Flow](/architecture/data-flow) for the privileged-command lifecycle.
