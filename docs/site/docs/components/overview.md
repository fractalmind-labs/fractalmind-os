# Components Overview

FractalMind components are classified by the three-plane architecture and by supporting roles. A component's ability to route, cache, display, or execute data does not make it an authority source.

## Control / Authority Plane

| Component | Role |
|-----------|------|
| [fractalmind-protocol](https://github.com/fractalmind-ai/fractalmind-protocol) | SUI organization, identity, capability, delegation, revocation, bounded-use and audit primitives |
| explorer | Read-only visualization of verifiable state |

## P2P Data / Execution Plane

| Component | Role |
|-----------|------|
| [fractalmind-envd](https://github.com/fractalmind-ai/fractalmind-envd) | Target-side verification, replay protection, durable reservation/result, P2P transport, and typed local execution |
| [agent-manager](https://github.com/fractalmind-ai/agent-manager-skill) | Local tmux lifecycle adapter invoked behind target envd policy |
| rendezvous / relay / index cache | Reachability, forwarding, discovery, and availability support; never authority sovereignty |

## Application Plane

| Component | Role |
|-----------|------|
| Agent Console | Operator UI that produces signed privileged intents and displays results |
| envd-desktop | Desktop media/input application with bounded view/control scopes |
| [fractalbot](https://github.com/fractalmind-ai/fractalbot) | Slack, Telegram, Discord, Feishu, and iMessage channel adapter |
| other clients | Domain-specific applications using the same signed-intent contract |

## Local Governance and Distribution

| Component | Role |
|-----------|------|
| oh-my-code + heartbeat + memory | Local governed operating loop and reference workspace |
| fractalmind-okrs | Reviewable goal publication and strategic state |
| team-manager / okr-manager / team-chat | Local coordination and collaboration |
| skills | Installable distribution packages for bounded tools and workflows |
| this repository | Canonical public architecture and migration documentation |

## Trust Boundary Summary

- SUI capabilities define who may do what, to which target, within which bounds.
- Target envd makes the final decision and owns durable replay/result state.
- agent-manager performs local lifecycle operations only after envd validation.
- applications request actions but do not grant themselves authority.
- relays and coordinators may improve availability but cannot authorize control.
- raw logs, media, input, and frequent heartbeat telemetry stay off-chain.

## Migration State

The target model is being delivered incrementally. Compatibility paths may remain until parity, rollback evidence, and consumer migration are complete. Track current work in [fractalmind-ai/.github#6](https://github.com/fractalmind-ai/.github/issues/6).

Skills remain installable through openskills:

```bash
npx openskills install fractalmind-ai/<skill-name>
```
