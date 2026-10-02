# FractalMind Protocol TypeScript SDK

TypeScript SDK for interacting with `fractalmind_protocol` on Sui.

## Features

- Organization: `createOrganization`, `getOrganization`, `updateDescription`
- Agent: `registerAgent`, `getAgentCertificate`, `updateCapabilities`
- Task: `createTask`, `assignTask`, `submitTask`, `verifyTask`, `completeTask`
- Fractal: `createSubOrganization`, `detachSubOrganization`
- Governance: `createProposal`, `castVote`, `executeProposal`

All write methods return a `Transaction` so you can compose multi-step PTBs.

## Install

Requires **Node.js 22+** and ESM. The default transport is gRPC through
`@mysten/sui` 2.33.1. Custom clients must implement `ClientWithCoreApi`.

```bash
cd sdk
npm install
```

## Quick Start

```ts
import { FractalMindSDK } from '@fractalmind-labs/fractalmind-sdk';

const sdk = new FractalMindSDK({
  packageId: '0xYOUR_PACKAGE_ID',
  registryId: '0xYOUR_REGISTRY_ID',
  network: 'testnet',
});

const tx = sdk.organization.createOrganization({
  name: 'Core Org',
  description: 'Fractal root organization',
});

const result = await sdk.client.signAndExecuteTransaction({
  signer, // Your Sui keypair
  transaction: tx,
  include: { effects: true, objectTypes: true },
});
const executed = result.Transaction ?? result.FailedTransaction;
if (!executed.status.success) throw new Error(executed.status.error.message);
await sdk.client.client.core.waitForTransaction({ digest: executed.digest });
```

## API Notes

### Product package graph

New v0.2.0 deployments publish three packages under the standard Sui package
size limit: the core protocol, OKR/handover, and direct Agent messages. Both
extensions depend on the core. Configure their IDs explicitly:

```ts
const sdk = new FractalMindSDK({
  packageId: '0xCORE_PACKAGE_ID',
  registryId: '0xPROTOCOL_REGISTRY_ID',
  okrPackageId: '0xOKR_PACKAGE_ID',
  directPackageId: '0xDIRECT_PACKAGE_ID',
  network: 'testnet',
});
```

`originalPackageId`, `originalOkrPackageId`, and `originalDirectPackageId`
select BCS/type origins separately from the respective current call package
IDs. Each defaults to its current package ID. Omitting extension configuration
retains historical monolithic routing; it does not discover a new deployment.
Core identities, capabilities, Runs and encrypted product records remain core
types. The extensions use the checked core witness bridge to bind execution
and write their own records.

New core publishes initialize the identity directory atomically; use
`sdk.identity.resolveRegistry()` afterward. `initializeRegistry()` remains for
older explicitly verified deployments whose directory has not been initialized.
The isolated three-package publish and native tests do not establish an
in-place upgrade or migration of previously published objects.

For the App's identity/device/OKR flows, use `SelfPayTransactionManager` with a
durable `TransactionJournal`, such as `IndexedDbTransactionJournal` in a browser
or WebView. `prepare()` estimates fees without signing; display its quote before
calling `submit()`. A lost response remains unknown and `query(requestId)` reads
the original digest. A failed transaction can still charge Gas. The
`MemoryTransactionJournal` is a test/reference provider, not durable App storage.

`createSelfPayOkrSubmitter({ manager, gasBudget, approveQuote })` connects the
manager to `NativeFileOkrRunner` using its stable ticket request ID. Recorded
requests are queried after restart rather than signed again. See the
[selfpay design and real-chain evidence](../../../docs/product/v020-selfpay-transactions.md).

- `registryId` is required for organization/fractal create flows.
- `getAgentCertificate` supports:
  - by object id: `{ certificateId }`
  - by owner address: `{ owner, orgId? }`
- Governance proposal lifecycle on-chain is:
  - `createProposal` -> `startProposalVoting` -> `castVote` -> `finalizeProposalVoting` -> `executeProposal`

## Development

```bash
cd sdk
npm run typecheck
npm run build
npm test
# Optional public testnet read; requires no wallet
npm run smoke:rpc
```

## Migrating from JSON-RPC

Use `include` instead of `options.show*`, inspect the nested transaction status,
and read created IDs from `effects.changedObjects` with types from `objectTypes`.
Object reads use native Move JSON; options may be scalar/null rather than `{ vec }`.
This package emits ESM; replace CommonJS `require` with `import` (or dynamic import).
See [the project migration guide](../../../docs/sui-rpc-migration.md).
