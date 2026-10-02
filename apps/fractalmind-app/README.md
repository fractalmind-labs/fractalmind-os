# FractalMind App

React + TypeScript client for the unified FractalMind entry point. This is an
implementation in progress whose authoritative interface baseline is
[prototype v2](../../docs/product/fractalmind-app-prototype-v2/README.md).
The static prototype supplies the product design; this client supplies real
chain/native integrations. v1 is not an implementation reference. The current client reads real Sui data directly through the
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
deployment. Supply the full package, ProtocolRegistry and Human object IDs:

```json
{
  "network": "localnet",
  "rpcUrl": "http://127.0.0.1:29000",
  "packageId": "<full deployed package ID>",
  "registryId": "<full ProtocolRegistry ID>",
  "humanId": "<full Human object ID>"
}
```

For an upgraded package, also supply `originalPackageId` if required by the SDK.
The SDK resolves the IdentityRegistry through the ProtocolRegistry's private
dynamic-field binding; the two registry IDs are not interchangeable.
The session verifies the identity's registry/network and pins the actual chain
identifier; the public connection cache keeps that identifier across reloads.
Remote endpoints must use HTTPS and cannot contain credentials, queries or
fragments. Only the allowlisted public fields are retained.

This profile is **not login**. It cannot sign commands, unlock encrypted product
bodies or grant authority. Do not paste private keys or recovery codes. The native welcome page now connects identity creation to independent OS keys,
a one-shot recovery backup, fee preparation and separately confirmed Human / personal
organization transactions. The browser cannot generate those keys. The native recovery entry now imports a recovery code, locates the same Human from
chain, prepares a one-shot replacement backup and separately quotes/confirms the
atomic recovery. The browser recovery entry does not accept secrets. Native
device pairing now creates a 10-minute chain request, requires fingerprint
comparison and an organization-scoped approval, then separately confirms data
sharing. The browser pairing entry cannot initialize keys. See
[pairing, actual evidence and remaining gates](../../docs/product/v020-app-pairing.md).

## Current behavior

The desktop development shell uses Tauri with a native device vault. From this
directory run `npm run desktop:dev`, or `npm run desktop:build -- --debug` for a
bundled-assets debug executable. These are development artifacts, not signed
five-platform releases. The identity page can explicitly load/prepare a device
and prove its possession against a current chain grant. New devices still need
an existing trusted device's on-chain authorization; a public profile cannot
authorize one. The Memory & results page now connects current encrypted body reads to fresh device/organization authority checks and native key unwrapping. Management controls, history selection and content writes remain pending.

The native vault keeps independent signing/encryption private keys in the OS
credential store, never in the WebView. macOS real-Keychain/signature/localnet
evidence, transport limits and test instructions are documented in
[native device verification](../../docs/product/v020-app-native-device.md). Current encrypted-body reads and their test scope are documented in
[private record access](../../docs/product/v020-app-private-records.md).

- V2 shell: neutral/iris light and dark tokens, fractal brand and mission welcome,
  ten grouped desktop entries, persistent execution context and organization growth
  path. Mobile uses five tabs plus an All features bottom drawer and a route strip.
- Workbench: decisions first, then objectives and factual OKR route; verified checkpoints, fresh measured progress,
  separate human acceptance, execution state and global budget/reservations.
- OKRs: a candidate form with 1–3 KRs, exact fixed-point metrics, evidence rules and constraints; native encrypted draft creation requires current admin/approval authority and explicit self-paid fee confirmation. Confirmed drafts do not activate Agents. See [draft creation and limits](../../docs/product/v020-app-okr-draft.md).
- OKR reads: lifecycle list/filter, details, immutable observation history, Run
  provenance and independent final acceptance record. Titles/units remain locked
  until an authorized device can decrypt the specification.
- Hosts: one card per stable address. The authoritative `active_hosts` table
  selects current membership; historical records do not create duplicate Hosts.
  The native Connect Host dialog registers Coordinator entries, issues one-use
  invitations, quotes/confirms actual Gas, queries original transactions and
  revokes unused invitations or memberships. Invitation secrets remain in the
  current session only. Membership never implies current connectivity or a
  tool's execution authority. The envd redemption CLI supports inspection,
  fee confirmation and original-digest recovery; the installed-host/cloud journey
  still needs acceptance. See [Host access](../../docs/product/v020-app-host-access.md)
  and [envd CLI evidence](../../docs/product/v020-envd-host-join.md).
- Agents: current organization's managed instance records. Live capability and
  connectivity are not inferred from registration labels. Native review/approval
  controllers now persist exact encrypted review tickets with the original Run,
  restore them read-only and consume authenticated Host proofs through explicit
  fee-confirmed approval. The v2 Include in OKR dialog now connects device-bound
  observation issuance, concrete plan review, separate fees, ticket lookup,
  Host response validation and approval. Installed UI, expired/failed attempts
  and the complete autonomous journey still need acceptance;
  approval never dispatches continuation. See [flow and limits](../../docs/product/v020-app-handover-flow.md)
  and [review tickets](../../docs/product/v020-app-handover-review.md).
- Native OKR runner bridge: approved-plan decryption, encrypted ticket creation
  and Host-specific result wrapping use the OS vault without organization-key
  export. Durable originals are queried before private reads/signing, and a
  preparation can remain queued until explicit delivery. Workbench and OKR
  detail now expose separate one-use control and command fee confirmations,
  original-request queries and explicit Host delivery. Real OS vault + localnet
  + production envd validates native review, approval, exact file execution,
  result decryption and revocation. Installed journal/IPC and sustained execution
  still need end-to-end acceptance.
  See [implementation and evidence](../../docs/product/v020-native-okr-runner.md).
- Human KR verification and final acceptance: Workbench and OKR detail expose
  original evidence, independent confirmation, a reason and separate native fee
  submissions. KR verification advances only its cursor; final acceptance
  separately confirms overall success criteria. Historical encrypted verification
  records are read from the current head with current authority checks. Actual
  OS + localnet + envd tests cover two ordered KR Runs, both verification decisions
  and an ACHIEVED OKR, with scripted explicit Human decisions. Installed Human UI,
  full cache wiping and cloud/phone journeys remain pending. See
  [review implementation and limits](../../docs/product/v020-app-human-review.md).
- Identity: chain Human generation/recovery version and device grants. The page
  labels these as snapshots and refreshes them with organization reads.
- Chinese/English and system/light/dark appearance; responsive navigation includes
  all ten pages. An actual narrow browser frame is tested separately from native
  phone/platform acceptance.

Reads refresh every 15 seconds in a visible document. Switching organizations
clears the previous scope immediately. Read failures stay unknown; only the
specific absent organization index can produce an empty directory. Unknown Run
outcomes preserve reservations even after agreement expiry or replanning.
Without action traces, the map does not establish drift or a dead end.

`localStorage` contains public connection metadata, disposable technical attempt identifiers and device appearance settings,
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
do not prove full v0.2.0 acceptance. Complete native identity/onboarding and
authorized encrypted-body access, fees and approval UI, dialogue/intervention, sustained autonomous
execution, a real cloud Host and native platform validation remain required.

The production bundle currently emits a large-chunk warning. Loading and bundle
splitting still need performance work before release.

Interface mapping, actual v2 walk-through evidence and remaining integration gates:
[v2 baseline](../../docs/product/v020-app-v2-baseline.md).

Native identity creation, exact current gates and localnet interoperability evidence:
[creation flow](../../docs/product/v020-app-identity-creation.md).

Native recovery import, staged replacement codes and per-organization historical
key rings now connect to the v2 welcome page and allowlisted Tauri commands. The
production controller has isolated real-chain coverage, including ambiguous
responses and an atomic snapshot guard for changes during signing. Installed
UI/IPC and durable-journal recovery acceptance remain pending. The guarded flow
requires a deployment with `identity::assert_recovery_snapshot`; it does not fall
back to unguarded recovery on older packages. See
[recovery journey and limits](../../docs/product/v020-app-recovery.md).
