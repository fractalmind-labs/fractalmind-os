# Sui RPC migration

All active Sui consumers use gRPC or GraphQL. Existing contracts and on-chain
object IDs do not need to be redeployed for this transport change.

| Consumer | Transport | Configuration |
| --- | --- | --- |
| Protocol TypeScript SDK and KR4 script | gRPC Core API | `network`, `fullnodeUrl`, or a custom `ClientWithCoreApi` |
| envd peer registry and both sponsor services | gRPC v2 for objects, simulation and execution; GraphQL for indexed events | `sui.rpc` and `sui.graphql_url` |
| demail Go listener and fractalbot inbound channel | GraphQL for events and message objects | `GraphQLURL` / `channels.demail.graphqlUrl` |
| Explorer | GraphQL and BCS decoding | Existing Explorer GraphQL configuration |
| demail bridge and fractalbot outbound channel | Sui CLI gRPC, with single or dual signatures | Install Sui CLI 1.80.1+ and configure its active network |
| Contract deployment and maintenance workflows | Sui CLI 1.80.1 with gRPC support | The CLI still names its endpoint flag `--rpc` |

## Upgrade configuration

envd keeps the `rpc` key, which now selects a gRPC fullnode endpoint:

```yaml
sui:
  rpc: https://fullnode.testnet.sui.io:443
  graphql_url: https://graphql.testnet.sui.io/graphql
```

For mainnet, set **both** hosts to their mainnet equivalents. If `graphql_url`
is omitted, envd infers it for official mainnet/testnet fullnodes. Custom fullnode
providers must support gRPC v2; the Go adapter accepts a fullnode host without
an API path. Local nodes can use `http://127.0.0.1:9000`. Indexed event reads
require a separate GraphQL indexer for the same network.

fractalbot configuration:

```yaml
channels:
  demail:
    enabled: true
    graphqlUrl: https://graphql.testnet.sui.io/graphql
    # Retain packageId, address, identityKeyFile and cursorFile from your config.
```

`rpcUrl` (Go listener: `RPCURL`) remains a deprecated configuration alias.
When that alias points to an official mainnet/testnet fullnode URL, the listener
selects the matching official GraphQL URL. Custom URLs must be changed to a
GraphQL endpoint explicitly. An explicit `graphqlUrl` always takes precedence.

## SDK compatibility changes

- Requires **Node.js 22+** and ESM imports, with `@mysten/sui` 2.33.1.
- The SDK creates a `SuiGrpcClient` by default. Custom clients must expose `core`.
- Object reads use `include: { json: true }` and consume `object.json`.
- Execution uses `include` in place of legacy `options.show*` fields.
- Execution returns `Transaction` or `FailedTransaction`; inspect the nested
  `status` before using its `digest`. Created objects come from
  `effects.changedObjects`, with types supplied by `objectTypes`.

See the [SDK README](../protocols/fractalmind-protocol/sdk/README.md) for an example.
Go adapter request types remain compatible with existing domain callers, but
all network requests use gRPC/GraphQL. The Sui CLI still renders transaction
results with `effects.status.status`, `objectChanges` and `digest`; these JSON
fields are an output compatibility layer, not JSON-RPC network calls. Byte vector arguments must be arrays,
and large Move integer arguments must be exact decimal strings or Go integers.

## Durable event cursors

GraphQL cursors are opaque strings. They cannot be replaced with a transaction
digest/event sequence pair. Keep the demail cursor file during upgrades.

The demail listener automatically converts a stored JSON-RPC event ID by:

1. Looking up the transaction's original checkpoint.
2. Paging through matching events in that checkpoint to find the exact event.
3. Persisting its GraphQL cursor and resuming after it.

If the provider no longer retains that history or returns a GraphQL error, the
listener preserves the old checkpoint and retries. It does not silently skip
offline mail. Use a provider retaining the original checkpoint to finish the
conversion. Existing fresh-deployment behavior still starts at the latest event.

envd maintains an independent in-memory cursor per event type and drains each
page before advancing. Partial GraphQL errors never produce a new checkpoint.

## Verification

```bash
make check-sui-rpc
make test-go
make test-node MODULE=protocols/fractalmind-protocol/sdk
make test-node MODULE=apps/explorer
make test-node MODULE=docs/site

# Optional public testnet reads and unsigned simulation; no wallet required.
SUI_RPC_LIVE_TEST=1 go test -v ./runtime/fractalmind-envd/internal/sui -run TestLiveGRPCReadAndSimulation -count=1
cd protocols/fractalmind-protocol/sdk && npm run smoke:rpc
```

Deterministic transport tests cover sponsored gas ownership, gas budget caps,
BCS/signature forwarding, failed execution, pagination, integer precision,
native Move JSON and legacy cursor conversion. Live smoke checks submit no
transactions. KR4 remains the wallet-funded lifecycle verification workflow.

References: [Sui migration guide](https://docs.sui.io/develop/accessing-data/json-rpc-migration),
[TypeScript gRPC client](https://sdk.mystenlabs.com/sui/clients/grpc),
[SDK 2.0 migration](https://sdk.mystenlabs.com/sui/migrations/sui-2.0).
