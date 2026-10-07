# FractalMind App

React + TypeScript client for the unified FractalMind entry point. This is a
v0.2.0 Alpha implementation whose authoritative interface baseline is
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

## New device setup

The native App sets up a new device instead of browsing read-only: without
device keys it opens "Create my identity" (device keys and one recovery code,
funds, Human identity, personal organization), with pairing and recovery as
alternatives. The read-only chain browser exists only in the web preview.

The network and contracts come from the build. For a local network, put the
public deployment and faucet in `.env.local` (not committed):

```sh
VITE_FRACTALMIND_DEPLOYMENT={"network":"localnet","rpcUrl":"http://127.0.0.1:29000","packageId":"0x…","okrPackageId":"0x…","directPackageId":"0x…","registryId":"0x…"}
VITE_FRACTALMIND_FAUCET=http://127.0.0.1:29123
```

Without a built-in deployment the setup asks for the deployment JSON under
"Advanced". Faucets are offered only for localnet and devnet.

A v0.2.0 deployment on Sui testnet is recorded in
[`v021-testnet-deployment.json`](../../docs/product/evidence/v021-testnet-deployment.json);
use its `deployment` object as `VITE_FRACTALMIND_DEPLOYMENT` for a testnet
build. Testnet has no faucet the App can call: fund the two setup addresses at
faucet.sui.io or by transfer.

## Styles

The interface follows prototype v2 in three layers:

- `src/prototype-v2-tokens.css`: the prototype's color and spacing tokens.
- `src/prototype-v2-components.css`: the prototype's component classes
  (buttons, chips, cards, notes, tabs, shell, decision cards and so on),
  generated from the prototype stylesheet. Do not edit it by hand; change the
  prototype, then run `node scripts/port-prototype-v2-components.mjs`. CI runs
  it with `--check` to catch drift.
- `src/styles.css`: maps existing App markup (`panel`, `badge`, `notice`, bare
  controls, native dialogs) onto those components and holds App-only views
  such as the run map. Use prototype class names for new markup.

`src/display.ts` holds display-name rules: a readable name first, and chain
IDs only shortened as secondary detail.

## Device session

The native App unlocks device keys once per sign-in instead of reading the OS
credential store (Keychain, Keystore, Credential Manager, Secret Service) for
every operation:

- `fm_device_unlock` reads the store once and keeps the keys in native process
  memory (`DeviceVault` session, zeroized on drop). Signing, decryption and the
  other device operations use only that session; a locked or expired session
  returns `Locked` and never falls back to the store.
- The App unlocks automatically at start. It locks on "Lock this app", after
  the idle timeout (default 15 minutes, set in Settings; machine sleep counts
  as idle), after more than a minute in the background on phones, and when this
  device's grant is revoked. While locked nothing from the organization is
  rendered.
- Keys never cross IPC; the WebView only sees public keys, signatures and
  decrypted results. With the session unlocked, OKR titles are decrypted
  automatically (`src/use-okr-texts.ts`) and kept in memory only. The browser
  preview has no device keys and keeps the "Title encrypted" fallback.

## This computer as Host

Personal setup ends by making this computer the organization's Host and
Coordinator (#64), and the Hosts page can do the same later. One confirmation
runs:

1. envd (bundled as a sidecar) creates the Host key in the OS credential store.
   The same key signs for both roles in one process; the App gets only public
   keys.
2. This device creates a Coordinator binding for that key at
   `http://127.0.0.1:<port>` (7443 or the next free port, loopback only).
   `create_coordinator_binding` does not return the binding, so the invitation
   is a second device transaction.
3. The App writes a public `sentinel.yaml` (Host + Coordinator roles, pinned
   binding, runtime with a workspace folder) under the App data directory.
4. A one-use invitation (15 minutes) is created and, in the same PTB, the Host
   address receives 0.1 SUI for its own Gas, since it signs its join and later
   execution results. The invitation goes from memory to envd's stdin;
   `--app-join-host` joins only if the chain plan matches the configured
   organization, binding, this Host's key and the loopback endpoint.
5. The service is installed as a per-user background service (macOS launchd
   LaunchAgent, Linux systemd user unit, Windows logon task), starts at login
   and keeps running after the App closes.

Every step is resumable: an original transaction is queried, never
broadcast again, and a known failure waits for an explicit retry. The Hosts
page shows the service state, endpoint, log and workspace, stops and starts it,
and "Revoke this host" revokes the membership on chain and then removes the
service, configuration and Host key (the workspace stays). Changing the
endpoint to LAN or internet HTTPS is not offered yet.

Building the desktop App needs Go: `scripts/build-envd.mjs` builds
`src-tauri/binaries/fractalmind-envd-<target>` before the Rust build
(`tauri.{macos,linux,windows}.conf.json`). The localnet acceptance script
`scripts/local-host-localnet.ts` drives the same native code through
`src-tauri/examples/local-host-helper.rs`; see
[`v021-local-host-localnet.json`](../../docs/product/evidence/v021-local-host-localnet.json).

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

For an upgraded core package, supply its current `packageId` and first-published
`originalPackageId`. The SDK and App read the exact immutable package BCS table
for each datatype: old Organization/RemoteCapability types and new identity,
Host, Run and budget types can have different origins, even within one module.
Missing or inconsistent metadata remains an unavailable read, never an empty
directory or guessed permission. Extension call/type IDs remain explicit.
Actual upgraded App/Host execution and recovery evidence is recorded in
[`v020-mixed-type-origins.md`](../../docs/product/v020-mixed-type-origins.md).
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

The native shell exposes the same Rust library entry point to desktop and mobile.
Its vault uses Keychain on iOS and a named Android Keystore-backed encrypted
credential store on Android. An ARM64 debug APK now builds and installs;
actual Android emulator IPC, offline signatures and credential reload after a
cold process restart pass. The installed emulator App has also exercised
on-chain identity/organization creation, Host discovery, cloud OKR handover,
execution and independent Human verification/acceptance. Physical phones and
five-platform production releases remain outside this evidence. Current scope
and remaining checks are maintained in the
[milestone acceptance map](../../docs/product/v020-milestone-acceptance.md). See
[Android build and actual evidence](../../docs/product/v020-app-android-native.md)
and [mobile entry evidence](../../docs/product/v020-app-mobile-native.md).

The desktop development shell uses Tauri with a native device vault. From this
directory run `npm run desktop:dev`, or `npm run desktop:build -- --debug` for a
bundled-assets debug executable. These are development artifacts, not signed
five-platform releases. The identity page can explicitly load/prepare a device
and prove its possession against a current chain grant. New devices still need
an existing trusted device's on-chain authorization; a public profile cannot
authorize one. The Memory & results page now connects current encrypted body reads to fresh device/organization authority checks and native key unwrapping. Management controls, history selection and content writes remain pending.

For a macOS bundle used in isolated native UI acceptance, run:

```sh
./node_modules/.bin/tauri build --debug --bundles app --config '{"bundle":{"active":true}}'
codesign --force --deep --sign - src-tauri/target/debug/bundle/macos/FractalMind.app
codesign --verify --deep --strict src-tauri/target/debug/bundle/macos/FractalMind.app
FM_NATIVE_ACCEPTANCE=isolated ./src-tauri/target/debug/bundle/macos/FractalMind.app/Contents/MacOS/fractalmind-app
```

The debug-only acceptance flag selects the `org.fractalmind.app.device.test`
vault and a separate persistent WebView store; test profiles must start with
`test-`. Local ad hoc signing seals the generated bundle for testing and does
not provide an Apple developer signature or notarization. Building and checking
the bundle cannot establish that its native UI journeys pass.

The native vault keeps independent signing/encryption private keys in the OS
credential store, never in the WebView. macOS real-Keychain/signature/localnet
evidence, transport limits and test instructions are documented in
[native device verification](../../docs/product/v020-app-native-device.md). Current encrypted-body reads and their test scope are documented in
[private record access](../../docs/product/v020-app-private-records.md).

### Mobile development

Use the [Tauri mobile prerequisites](https://v2.tauri.app/start/prerequisites/)
for a full Xcode installation on iOS, or Java and the Android SDK/NDK on Android.
Build the local SDK as described above, then initialize the platform project
from this directory:

```sh
npm run android:init
npm run android:build -- --debug
```

On a Mac with full Xcode and the required test signing configuration:

```sh
npm run ios:init
npm run ios:build -- --debug
```

Generated projects live in the ignored `src-tauri/gen/` directory. Bundled
assets use the same native origin guard and command permissions as desktop;
a browser preview or remote development page does not acquire signing rights.
Use a reachable HTTPS RPC/Coordinator for a physical phone; the phone's
loopback address does not point at the desktop Host. Check the pinned network,
device grant and organization before approving an operation.

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
  fee confirmation and original-digest recovery. Real macOS and Ubuntu Host
  admission/discovery evidence is in the [cloud report](../../docs/product/v020-remote-host-acceptance.md).
  See [Host access](../../docs/product/v020-app-host-access.md)
  and [envd CLI evidence](../../docs/product/v020-envd-host-join.md).
- Agents: current organization's managed instance records. Live capability and
  connectivity are not inferred from registration labels. Native review/approval
  controllers now persist exact encrypted review tickets with the original Run,
  restore them read-only and consume authenticated Host proofs through explicit
  fee-confirmed approval. The v2 Include in OKR dialog now connects device-bound
  observation issuance, concrete plan review, separate fees, ticket lookup,
  Host response validation and approval. The installed Android UI has approved
  an original five-minute review after 255 seconds and completed the cloud
  file task; [current review evidence](../../docs/product/v020-review-window-and-approval-queue.md)
  records the exact scope and retained failures. Approval never dispatches
  continuation. See [flow and limits](../../docs/product/v020-app-handover-flow.md)
  and [review tickets](../../docs/product/v020-app-handover-review.md).
- Native OKR runner bridge: approved-plan decryption, encrypted ticket creation
  and Host-specific result wrapping use the OS vault without organization-key
  export. Durable originals are queried before private reads/signing, and a
  preparation can remain queued until explicit delivery. Workbench and OKR
  detail now expose separate one-use control and command fee confirmations,
  original-request queries and explicit Host delivery. Real OS vault + localnet
  - production envd validates native review, approval, exact file execution,
    result decryption and revocation. Installed journal/IPC, autonomous execution
    and their distinct evidence scopes are tracked in the milestone map.
    See [implementation and evidence](../../docs/product/v020-native-okr-runner.md).
- Human KR verification and final acceptance: Workbench and OKR detail expose
  original evidence, independent confirmation, a reason and separate native fee
  submissions. KR verification advances only its cursor; final acceptance
  separately confirms overall success criteria. Historical encrypted verification
  records are read from the current head with current authority checks. Actual
  OS + localnet + envd tests cover two ordered KR Runs, both verification decisions
  and an ACHIEVED OKR, with scripted explicit Human decisions. Installed Android
  UI has separately completed a real cloud task and both Human review steps.
  Combined installed-client cache clearing and Coordinator restart have also
  restored the existing encrypted work history without dispatch. The final
  successful one-off write remains pending explicit acceptance authorization;
  partial writes and failed Runs are retained. Platform limits are recorded in
  the milestone map. See
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

`localStorage` contains public connection metadata, technical attempt identifiers,
appearance settings and explicitly saved encrypted **unsent local drafts**.
Each draft is scoped to the original chain, Human, organization, Host, instance
and native device; its independent content key is sealed to the device public key.
No long-term private key or execution authority is stored there. Closing or
backgrounding clears page plaintext. A submission marker prevents restoring
an attempted draft as a new unsent message. Drafts never send automatically.
Clearing local data loses these disposable working copies; committed business
state is reconstructed from Sui without new execution or chain writes.

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
actual public evidence and screenshots. The
[21-issue acceptance map](../../docs/product/v020-milestone-acceptance.md)
is the current checklist; historical increment reports retain the limitations
observed at their own date. Unit tests and a public reader alone do not establish
installed UI behavior, physical-phone support or production release readiness.

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
