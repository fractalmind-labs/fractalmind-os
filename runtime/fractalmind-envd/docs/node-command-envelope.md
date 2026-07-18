# NodeCommand / NodeEvent Phase 0 Contract

Source: https://github.com/orgs/fractalmind-ai/discussions/5

Tracker: https://github.com/fractalmind-ai/.github/issues/6

Implementation issue: https://github.com/fractalmind-ai/fractalmind-envd/issues/64

## Boundary

The coordinator or relay transports commands. It does not grant authority. The
target envd validates the signed command before invoking any local runtime
adapter.

Phase 0 adds an isolated `internal/nodecommand` contract and validation core. It
does not replace the existing REST/WebSocket command path yet.

## Signed Envelope

`NodeCommand` version 1 contains:

- command ID and idempotency key
- signer and signature
- organization, node, and optional agent target
- action and scope
- SUI authority-plane capability reference and revocation version
- nonce, issued time, and expiry
- payload plus SHA-256 payload hash

The signature covers canonical JSON with fixed field order. Raw payload bytes
are represented by `payload_hash`, which avoids signing ambiguous JSON object
ordering.

## Target Validation Order

1. Validate protocol version and required fields.
2. Verify payload hash and issued/expiry bounds.
3. Reject a target that does not match the receiving envd.
4. Verify the signer over canonical signing bytes.
5. Resolve the capability through the protocol #17 adapter.
6. Check the capability-authorized signer, hierarchical target, action, scope,
   expiry, revocation, and checkpoint.
7. Require a fresh checkpoint for configured high-risk actions.
8. Reject actions without an explicit low-risk or high-risk classification.
9. Record command ID, nonce, and idempotency key before execution.

Stable rejection codes let REST, WebSocket, Console, and channel adapters expose
the same result without becoming authorization owners.

## Availability Policy

Low-risk commands may use a bounded cached capability state while the signed
intent is valid. New high-risk commands fail closed when the revocation
checkpoint is older than the configured freshness window.

The default cache windows are 24 hours for explicitly classified low-risk
actions and two minutes for explicitly classified high-risk actions. These are
maximums that deployments can tighten. Unclassified actions fail closed.

The target must have a configured organization and node identity. Commands have
a five-minute default maximum TTL. A node-scoped capability may authorize an
agent below that node, while an agent-scoped capability only authorizes that
exact agent.

## Follow-up Integration

- protocol #17 implements the production `CapabilityResolver`.
- envd command handlers wrap current REST/WS payloads into `NodeCommand` during
  the compatibility period.
- issue #65 provides the local runtime adapter called only after validation.
- durable replay/idempotency storage replaces the in-memory Phase 0 guard.
- Agent Console supplies wallet/passkey signatures and shared golden vectors.
