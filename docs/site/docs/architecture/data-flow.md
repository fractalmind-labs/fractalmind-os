# Data Flow

This page traces data through the three-plane architecture. The key rule is that transport delivers a request, while the target independently verifies authority before execution.

## Privileged Command Lifecycle

```text
1. Capability grant
   SUI contract creates target-scoped, bounded authority
          |
2. Signed intent
   Application signs action + scope + target + command metadata
          |
3. Transport
   Direct P2P or relay delivers the envelope to target envd
          |
4. Target verification
   envd resolves authority, checks signature/freshness/revocation/replay/budget
          |
5. Durable reservation
   target records pending command before local execution
          |
6. Local execution
   envd invokes a typed agent-manager/system adapter
          |
7. Durable result
   target records completed/result; exact retry returns the same result
          |
8. Optional evidence anchor
   a digest may be committed on-chain when audit policy requires it
```

The signed intent binds the action, scope, target, command ID, nonce, idempotency key, budget, and canonical payload hash. A relay cannot edit those fields without invalidating verification.

## Human and Channel Inbound

```text
Human -> Slack/Telegram/etc. -> fractalbot -> application or agent
                                             |
                                             v
                                  create signed privileged intent
                                             |
                                             v
                                         target envd
```

fractalbot supplies channel and thread context. Channel identity may inform application policy, but it is not sufficient authority for target mutation.

## Results and Outbound Messages

```text
target envd -> durable result -> requesting application/agent
                                      |
                                      v
                              use-fractalbot skill
                                      |
                                      v
                               human channel
```

Applications should distinguish `pending`, `completed`, and `result unavailable`. A restart must not turn an unproven pending command into a successful duplicate.

## Agent-to-Agent Collaboration

Local team coordination may use file-backed `team-chat` inboxes and agent-manager sessions. This collaboration state is operational data, not remote node authority.

## On-Chain vs Off-Chain

| On-chain | Off-chain |
|----------|-----------|
| Organization and agent identity | Raw logs and files |
| Capability, delegation, revocation | Screen/video/audio and input events |
| Bounded use and budget metadata | High-frequency heartbeats and presence |
| Optional evidence digest | Relay load, latency, and routing telemetry |

Putting raw operational streams on-chain would leak private data, increase cost, and make high-frequency control impractical.

## Failure Behavior

- **Stale or unavailable revocation state:** mutating commands fail closed.
- **Duplicate exact command:** return the durable prior result without consuming quota again.
- **Conflicting command metadata:** reject, even when one identifier matches.
- **Relay unavailable:** try another route or direct P2P; do not weaken authorization.
- **Target restart with pending/no result:** fail closed until durable state can prove the outcome.
- **Read-only discovery cache:** may be served only where policy explicitly accepts staleness.

## Local Heartbeat Flow

Workspace heartbeats remain a local governance loop:

```text
cron -> read current state -> verify evidence -> take owner action -> record result
```

They are not SUI transactions and do not grant remote authority.
