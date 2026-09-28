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
