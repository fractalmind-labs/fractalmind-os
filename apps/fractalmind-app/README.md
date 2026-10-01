# FractalMind App

React + TypeScript client for the unified FractalMind entry point. This is an
implementation in progress, separate from the static product prototypes under
`docs/product`. The current client reads real Sui data directly through the
production SDK and gRPC/Core API. It does not use a business backend.

## Run locally

Use Node.js 22.12 or newer. Build the local SDK dependency first, from the
repository root:

```sh
cd protocols/fractalmind-protocol/sdk
npm ci
npm run build
```

Then, from the repository root:

```sh
cd apps/fractalmind-app
npm ci
npm test
npm run build
npm run preview -- --host 127.0.0.1 --port 4189 --strictPort
```

Open `http://127.0.0.1:4189/`. The preview serves static files; the browser
contacts the configured Sui RPC directly. That RPC must support browser
gRPC-Web requests and permit the preview origin. The production bundle has a
CSP restricting scripts and styles to this origin; development uses Vite HMR.

## Public read-only connection

The welcome page's development preview accepts a public profile for an existing
deployment. Supply the full package, identity registry and Human object IDs:

```json
{
  "network": "localnet",
  "rpcUrl": "http://127.0.0.1:29000",
  "packageId": "<full deployed package ID>",
  "registryId": "<full identity registry ID>",
  "humanId": "<full Human object ID>"
}
```

For an upgraded package, also supply `originalPackageId` if required by the SDK.
The session verifies the identity's registry/network and pins the actual chain
identifier; the public connection cache keeps that identifier across reloads.
Remote endpoints must use HTTPS and cannot contain credentials, queries or
fragments. Only the allowlisted public fields are retained.

This profile is **not login**. It cannot sign commands, unlock encrypted product
bodies or grant authority. Do not paste private keys or recovery codes. Identity
creation, device pairing and recovery buttons remain disabled until secure
signing is integrated.

## Current behavior

- Workbench: factual OKR route, verified checkpoints, fresh measured progress,
  separate human acceptance, execution state and global budget/reservations.
- OKRs: lifecycle list/filter, details, immutable observation history, Run
  provenance and independent final acceptance record. Titles/units remain locked
  until an authorized device can decrypt the specification.
- Hosts: one card per stable address. The authoritative `active_hosts` table
  selects current membership; historical records do not create duplicate Hosts.
  Membership never implies current connectivity or a tool's execution authority.
- Agents: current organization's managed instance records. Live capability and
  connectivity are not inferred from registration labels.
- Identity: chain Human generation/recovery version and device grants. The page
  labels these as snapshots and refreshes them with organization reads.
- Chinese/English and system/light/dark appearance; responsive navigation includes
  all six pages. An actual narrow browser frame is tested separately from native
  phone/platform acceptance.

Reads refresh every 15 seconds in a visible document. Switching organizations
clears the previous scope immediately. Read failures stay unknown; only the
specific absent organization index can produce an empty directory. Unknown Run
outcomes preserve reservations even after agreement expiry or replanning.
Without action traces, the map does not establish drift or a dead end.

`localStorage` contains public connection metadata and device appearance settings,
not business snapshots, keys or encrypted product bodies. Clearing that connection
and reconnecting reconstructs public state from Sui; it does not modify the chain.

## Verification and remaining scope

`npm test` covers source/chain pinning, incomplete reads, pagination, authoritative
Host pointers, execution ambiguity, budget reservations, stale metrics and the
distinction between measurement, verification and acceptance. CI installs and
builds the local SDK, then installs, tests and builds this App.

The real-chain reader can reuse an **isolated** localnet integration deployment
report containing the registry, Human, organization and expected OKR IDs:

```sh
node --import tsx scripts/localnet-read.ts /tmp/deployment-report.json /tmp/app-reader-report.json
```

See [v0.2.0 validation](../../docs/product/fractalmind-app-v020-validation.md) for
actual public evidence and browser screenshots. Unit tests and the public reader
do not prove full v0.2.0 acceptance. Secure identity/key storage/signing, encrypted
body access, fees and approval UI, dialogue/intervention, sustained autonomous
execution, a real cloud Host and native platform validation remain required.

The production bundle currently emits a large-chunk warning. Loading and bundle
splitting still need performance work before release.
