# NodeCommand / NodeEvent Phase 0 Contract

Source: https://github.com/orgs/fractalmind-ai/discussions/5

Tracker: https://github.com/fractalmind-ai/.github/issues/6

Implementation issue: https://github.com/fractalmind-ai/fractalmind-envd/issues/64

## Boundary

The coordinator or relay transports commands. It does not grant authority. The
target envd validates the signed command before invoking any local runtime
adapter.

Phase 0 adds an isolated `internal/nodecommand` contract, validation core, and
in-memory reference authority store. It does not replace the existing
REST/WebSocket command path or complete issue #64 yet.

## Signed Envelope

`NodeCommand` version 1 contains:

- command ID and idempotency key
- signer and signature
- organization, node, and optional agent target
- action and scope
- SUI authority-plane capability reference and revocation version
- nonce, issued time, and expiry
- optional budget asset plus integer amount in the asset's smallest unit
- payload plus SHA-256 payload hash

The signature covers compact JSON with fixed field order and the domain
`fractalmind.node-command.v1`. All signed identifiers use the ASCII alphabet
`A-Z a-z 0-9 - . _ : / @ +`, eliminating Unicode normalization and JSON string
escaping differences. Raw payload bytes are represented only by
`payload_hash`, which avoids signing ambiguous JSON object ordering.

All uint64 authority values, including revocation versions and budget amounts,
are JSON decimal strings. This avoids precision loss in JavaScript, where JSON
numbers above `2^53-1` cannot round-trip exactly.

The cross-repository fixture is
`internal/nodecommand/testdata/v1-golden.json`. It contains the complete command
fields, exact payload bytes, exact signing bytes, and exact event bytes as hex.
Protocol SDK and Agent Console implementations should consume the same fixture
before this contract is frozen.

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
9. Atomically compare the complete validated authority snapshot and reserve one
   capability use plus any declared budget together with command ID,
   signer-scoped nonce, and idempotency key.

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
agent below that node, an organization-scoped capability may authorize nodes
and agents below that organization, and an agent-scoped capability only
authorizes that exact agent.

Each capability must have a remaining-use bound, or the command must declare a
budget for an explicitly configured budgeted action. `AuthorityStore.Reserve`
is the atomic boundary: it makes exact retries idempotent, rejects command ID,
nonce, and idempotency conflicts, consumes at most one use per unique command,
and consumes budget only once. It also compares a canonical hash of signer,
target, actions, scopes, expiry, revocation, freshness checkpoint, and
reservation scope, so a same-version authority mutation cannot race validation.

Node- and agent-scoped capabilities may use target-node reservation storage.
Organization-scoped capabilities require `reservation_scope=authority` and a
single authority-wide store shared across target nodes; offline target-local
counters must fail closed for that scope. The in-memory implementation proves
cross-node concurrency only when the same store instance is shared. Production
integration must use durable protocol #17 / authority-plane reservation for
organization scope and durable target-local storage for node scope.

## Follow-up Integration

- protocol #17 implements the production `AuthorityStore` resolver/reservation
  adapter and consumes the shared fixture.
- envd command handlers wrap current REST/WS payloads into `NodeCommand` during
  the compatibility period.
- issue #65 provides the local runtime adapter called only after validation.
- durable replay/use/budget reservation storage replaces the in-memory Phase 0
  authority store.
- Agent Console supplies wallet/passkey signatures and shared golden vectors.
- rejected/executed command handlers emit `NodeEvent` audit envelopes once the
  REST/WS compatibility adapter is wired.
