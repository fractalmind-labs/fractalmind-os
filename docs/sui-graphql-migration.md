# Explorer: migrating off Sui JSON-RPC

The [explorer](../apps/explorer) (`https://fractalmind-labs.github.io/fractalmind-os/explorer/`)
read on-chain data through the legacy Sui JSON-RPC public fullnode
(`fullnode.testnet.sui.io`). Sui has decommissioned that interface: it was
disabled on Sui Foundation mainnet full nodes the week of July 27, 2026, with
full removal (including code) targeted for mid-October 2026; testnet
fullnodes already reject every JSON-RPC method with the same error. Every
request the explorer made started failing with a CORS error in the browser —
the deeper cause is that the endpoint no longer serves JSON-RPC at all, not a
CORS misconfiguration. See Sui's
[JSON-RPC Migration Guide](https://docs.sui.io/develop/accessing-data/json-rpc-migration).

## What changed

`src/sui/queries.ts` now reads through Sui's **GraphQL RPC**
(`https://graphql.testnet.sui.io/graphql`, configured in `src/sui/config.ts`)
instead of the old `@mysten/sui/client` `SuiClient` JSON-RPC client.

The public GraphQL and gRPC load-balancer URLs
(`https://{graphql,fullnode}.<network>.sui.io`) are rate-limited and meant for
development and public-good use, which fits a public read-only explorer; Sui's
docs ask production services to run their own node or use a paid provider
instead.

GraphQL returns Move object content as **raw BCS bytes** (base64-encoded), not
decoded JSON fields the way JSON-RPC did. `src/sui/bcs.ts` defines the BCS
schema for every Move struct the explorer reads (`Organization`,
`AgentCertificate`, `Task`, `AgentProfile`, `PeerRegistry`/`PeerNode`, and the
`Table` wrapper), and `src/sui/graphql.ts` is a small GraphQL client plus the
handful of queries used: single and batched object lookups, dynamic field
pagination (for `Table` traversal), and owned-objects-by-type (for
`AgentCertificate`).

`src/sui/queries.ts`'s public API (`fetchAllData()`) and the `Organization`/
`AgentCertificate`/`Task`/`PeerNode` types in `src/sui/types.ts` are unchanged,
so the rest of the app (components, the graph layout) needed no changes.

## Source and deployed contracts can disagree — verify against live data

Every schema in `src/sui/bcs.ts` was checked against the actual bytes of every
live object on testnet as of 2026-09-28 (the object IDs in `config.ts`), not
just against the Move source. That check caught a real mismatch: the deployed
`Task` struct does not have the `key_result_id: Option<ID>` field that
`protocols/fractalmind-protocol/contracts/protocol/sources/task.move` has —
it was evidently added to the source after the contract's last deployment.
Sui's upgrade compatibility rules don't allow changing an existing struct's
layout, so every already-published `Task` still uses the narrower shape, and
decoding with a schema that included that field failed with a
`Buffer.readUint8 out of bounds`-style error partway through the struct (the
byte offsets after the extra field shift everything that follows it).

`PeerNode` is the one schema that is transcribed from source
(`runtime/fractalmind-envd/contracts/envd/sources/peer.move`) but not verified
this way, because no peer has ever registered on testnet
(`PeerRegistry.peer_count` is 0 — there's nothing to decode). Its fields also
don't line up one-to-one with the app's `PeerNode` UI type (there's no
on-chain `node_id`, `endpoint`, `last_heartbeat`, or "syncing" status); the
mapping in `queries.ts` is the closest reasonable match, not a checked one.
Revisit it once a peer actually registers.

### How to verify a schema against live data

Fetch an object's BCS and decode it standalone (Node, with `@mysten/bcs`
installed) before trusting a schema:

```js
import { bcs, fromBase64 } from "@mysten/bcs";

const res = await fetch("https://graphql.testnet.sui.io/graphql", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `query($id: SuiAddress!) {
      object(address: $id) { asMoveObject { contents { bcs type { repr } } } }
    }`,
    variables: { id: "0x..." },
  }),
});
const { data } = await res.json();
const bytes = fromBase64(data.object.asMoveObject.contents.bcs);
console.log(MySchema.parse(bytes)); // MySchema from src/sui/bcs.ts
```

If a struct fails partway through (a string field decoding as garbage, an
`Option` reading an invalid tag byte, or a length-prefixed field consuming
either too many or too few bytes), decode field-by-field from the start of the
struct to find exactly where the byte offset stops matching the schema — that
is almost always evidence of a field the deployed contract doesn't have (or
has in a different position), not a bug in the BCS library.
