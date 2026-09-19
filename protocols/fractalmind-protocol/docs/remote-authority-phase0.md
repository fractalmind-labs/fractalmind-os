# Remote Authority Phase 0

## Boundary

Phase 0 defines the authority-plane object and SDK projection used to authorize
signed envd `NodeCommand` envelopes. Payloads, logs, results, media, and evidence
remain off-chain. This change does not publish a Sui package, migrate production
objects, sign a command, broadcast a transaction, or change chain state.

The signed capability reference is exactly:

```json
{"id":"<capability-object-id>","revocation_version":"<u64-decimal>"}
```

The SDK creates signing bytes in the envd Go field order under the domain
`fractalmind.node-command.v1`. An authority-scoped claim binds the SHA-256 hash
of those exact bytes before execution. Post-execution `result_hash` and
`evidence_hash` belong to the off-chain `NodeEvent`, not the pre-execution claim.

## Reservation Ownership

Organization roots use `reservation_scope=authority`. The delegate submits an
on-chain pre-execution claim containing the canonical signing hash plus its
`command_id`, `nonce`, and `idempotency_key`. The shared capability atomically
reserves use/budget and all three replay namespaces. An exact claim retry is a
no-op; reusing any identifier with different signing bytes fails closed.

The target envd must use a composite authority store. Its shared authority
adapter verifies that the exact on-chain claim exists, while a durable local
execution ledger owns the `pending/completed/result` lifecycle. `Inspect` must
consult that local ledger rather than treating the pre-claim alone as a
completed duplicate. `Reserve` verifies the claim and creates the local pending
record without consuming authority quota a second time. After restart, an exact
completed retry returns the cached result; a pending record without a committed
result fails closed for operator reconciliation instead of executing twice.

Because the on-chain claim consumes quota before envd validates the command,
the envd `CapabilityState` projection for `reservation_scope=authority` exposes
the original use/budget bounds as validation ceilings, not post-claim remaining
counters. The exact full-field claim proves that this command already passed the
global quota check. The composite `Reserve` must compare action, scope, target,
command ID, nonce, idempotency key, budget asset/amount, and fingerprint before
creating the local pending record. Node-scoped projections continue to expose
actual remaining counters because their local `Reserve` still consumes quota.

Node and agent capabilities use `reservation_scope=node`. The target envd owns
both bounded quota consumption and the atomic durable reservation/result store.
It must reserve before execution, return the stored result for an identical
replay, and reject a replay whose command identifiers map to different signing
bytes.

Delegation is one level only: organization root to node or agent child. Child
target, actions, single scope, expiry, use quota, and budget must narrow the
parent. Phase 0 permanently reserves delegated quota at child creation. Revoke,
expiry, or deletion does not return quota to the parent; reclaim semantics need
a later protocol version and are not implicit in this release.

## Freshness

`CheckpointObservedAtMS` is the time of a successful trusted authority read. It
is not the capability object's creation or mutation time.

Envd applies its configured risk windows to that observation. The current envd
defaults are 24 hours for explicitly classified low-risk actions and 2 minutes
for high-risk actions. Unclassified actions fail closed. A delegated projection
also fails when its parent is missing, revoked, expired, organization-mismatched,
target/action/scope-widened, or at a different revocation version.

Authority-scoped execution requires both a fresh exact on-chain claim and the
durable local execution/result boundary. Node-scoped execution uses the durable
local boundary for quota and execution. A target-local store that cannot verify
the shared claim must report `Supports(authority)=false`; neither mode may
silently fall back to the other.

## Legacy Migration

Envd removed its source-level `fractalmind_envd::policy` module in commit
`80e07a2e9080f454c219ee3041ca4eab18b236f9` and routed the legacy demo calls
through `fractalmind_protocol::agent_policy`. Historical objects and events from
an already-published envd package remain queryable under that old package ID,
but they are not recreated, mutated, or assigned new protocol object IDs.

The existing protocol `agent_policy` module remains valid for its original
synchronous on-chain action-evidence flow. It is not reinterpreted as a remote
envd capability, and no existing `AgentPolicy` is auto-converted.

The minimum field map is:

- historical `AgentPolicy.org_id` -> `RemoteCapability.org_id`
- `owner` -> `issuer`; `agent` -> `delegate`
- single `allowed_action` -> bounded `actions[]`
- free-form `target_scope` -> one canonical `scope` plus explicit
  `target_kind/node_id/agent_id`
- `max_uses/uses_consumed` -> `max_uses/uses_claimed`, with
  `uses_delegated` reserving child quota
- `max_gas_budget` -> typed `budget_asset/max_budget/budget_claimed`, with
  `budget_delegated` reserving child budget
- `revoked` -> `revoked` plus the signed `revocation_version` checkpoint

The minimum event map is:

- legacy `PolicyCreated` remains historical evidence; new grants emit
  `CapabilityCreated`
- legacy `PolicyRevoked` remains historical evidence; new revocations emit
  `CapabilityRevoked` with a monotonic checkpoint
- legacy `ActionExecuted` combined pre-execution intent and post-execution
  `result_hash` on-chain; the new authority flow emits only the pre-execution
  `AuthorityUseClaimed`, while result/evidence moves to off-chain `NodeEvent`

During cutover, envd must select the resolver by the signed capability package
and type. Existing protocol `AgentPolicy` actions continue on their current
path; `RemoteCapability` references use the new parent-aware resolver and SDK
projection. The two models must not be merged into a wider effective policy.
Command issuers switch only after golden, freshness, durable replay, and restart
tests pass. Rollback stops issuing new `RemoteCapability` references and returns
traffic to the unchanged legacy path; it does not rewrite either object model.

Legacy resolution can be retired only after all supported issuers stop creating
legacy references, active legacy policies expire or are explicitly revoked, and
indexer/readback evidence confirms no accepted command depends on the old path.

Recommended rollout order:

1. Merge the protocol module, SDK, fixture, and documentation without publish.
2. Add envd RPC/indexer resolution for `RemoteCapability` and parent checkpoints.
3. Verify low-risk, high-risk, authority-claim, durable replay, and restart tests.
4. Prepare an explicit testnet publish and migration plan with package IDs and
   rollback evidence.
5. Request separate approval before any publish, credential change, signed
   command, broadcast, production migration, or mainnet operation.
