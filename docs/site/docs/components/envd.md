# fractalmind-envd

`fractalmind-envd` is the target-side P2P data and execution runtime for remote agent control.

**Repo**: [fractalmind-ai/fractalmind-envd](https://github.com/fractalmind-ai/fractalmind-envd)

**Language**: Go

**Architecture status**: migration in progress

## Responsibility

envd receives signed command envelopes over direct P2P or relay-assisted paths. The target node independently verifies authority before any local operation.

```text
application -> signed intent -> P2P/relay -> target envd
                                              |
                                     verify authority
                                              |
                                     durable reservation
                                              |
                                      typed local adapter
                                              |
                                      durable result
```

Target envd owns:

- signed-intent and target verification
- authority freshness and revocation checks
- command, nonce, and idempotency replay protection
- use and budget enforcement
- durable `pending` / `completed` / `result` state
- typed invocation of local adapters
- encrypted P2P data exchange and availability fallback

## What envd Does Not Delegate

Relay, rendezvous, coordinator, sponsor, and index-cache services do not decide authority. They may forward packets, locate peers, cache public discovery data, or assist availability. A compromised support service must not gain node control.

Bearer tokens and channel sessions are not sufficient proof for privileged execution. Compatibility APIs must converge on the same validator/executor boundary.

## Local Execution Adapter

agent-manager is a local JSON/tmux adapter behind envd. It exposes bounded lifecycle operations such as status, start, stop, assignment, and log retrieval. It is not the network authority plane, and callers must not bypass envd validation for remote privileged actions.

Arbitrary remote shell execution is outside the canonical contract. Commands use typed payloads, explicit targets, bounded sizes, deadlines, and fail-closed validation.

## Replay and Restart Semantics

- An exact retry with identical authority metadata does not consume quota twice.
- Conflicting command ID, nonce, idempotency key, target, action, scope, or budget metadata is rejected.
- A completed retry returns the durable prior result.
- A pending command without durable result evidence after restart fails closed.
- Process-local caches are optimizations, not the source of exactly-once truth.

## Network and Data Placement

envd may use direct P2P, NAT traversal, organization relays, or shared relays. Route selection changes availability, not authority.

The following remain off-chain:

- raw logs and files
- desktop video/audio and input events
- frequent heartbeats and presence
- latency and relay-load telemetry

Only authority-critical state and optional audit digests belong on SUI.

## Availability Policy

Read-only discovery may use bounded-staleness caches when policy allows it. High-risk or mutating commands fail closed when the target cannot prove authority freshness, revocation state, replay state, or durable result semantics.

## Migration

The migration is tracked across protocol, envd, adapters, applications, and legacy retirement in [tracker #6](https://github.com/fractalmind-ai/.github/issues/6). Legacy endpoints are removed only after parity, consumer inventory, rollback evidence, and target-side enforcement are verified.

## Related Components

- [fractalmind-protocol](/components/protocol) - authority and capability primitives
- [agent-manager](/components/agent-manager) - local execution adapter
- [Applications](/components/applications) - signed-intent clients
- [fractalbot](/components/fractalbot) - channel adapter
