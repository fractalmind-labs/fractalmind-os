<div align="center">

# fractalmind-envd

**Lightweight daemon for remote AI Agent management on SUI.**

[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8)](https://go.dev/)
[![SUI](https://img.shields.io/badge/SUI-Identity-4DA2FF)](https://sui.io/)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](../../LICENSE)

</div>

---

## What is envd?

`envd` (environment daemon) runs on each machine hosting AI Agents. It:

1. **Discovers** local AI agents (tmux sessions)
2. **Reports** status via heartbeat to a coordinator envd
3. **Executes** remote commands (restart, logs, kill, shell)
4. **Self-heals** — auto-restarts crashed agents within 60 seconds

Unlike traditional remote control tools (TeamViewer, Tailscale), envd uses **SUI blockchain** for identity and authorization — no central server can revoke your access.

## Native model questions and file planning

The chain-authorized `native-file-agent` can use a Host-configured Anthropic
Messages-compatible provider or Ollama's native chat API. Set
`runtime.model.enabled`, `protocol` (`anthropic-messages`, the default, or
`ollama`), the explicit `api_base` and model `name` in `sentinel.yaml`; provide
remote credentials through the named `api_key_env`. A local Ollama server can
use `http://127.0.0.1:11434` with an empty `api_key_env`; install the selected
generation model separately. This is disabled by default. Questions send only the
signed message and use zero file tools. Approved text-file OKRs may let the
model select the next tool action, while envd enforces the original exact goals,
directories, tool allowance, deadline and current Sui authority.

Enabling this sends questions and approved file-task observations to that
provider. Model billing is separate from Sui Gas and tool counts. Model replies
are unverified proposals; they cannot approve an action or accept an OKR.
Missing configuration and failed model requests do not trigger retries or an
alternative executor. This still supports only explicit text-file goals;
general project planning and the App model-configuration wizard are pending.
See [configuration, evidence and acceptance limits](../../docs/product/v020-host-model-runtime.md).

## Architecture

```
SUI Blockchain               Identity + Authorization
       │
coordinator envd             Embedded REST API + WebSocket control plane
       │
  ┌────┴────┐
  │         │
 envd     envd               Go daemon (this repo)
host-A   host-B              Heartbeat + Agent discovery + Self-heal
  │         │
tmux      tmux               AI Agent processes
```

## Quick Start

### Linux

```bash
# Build
make build

# Configure
cp sentinel.yaml.example sentinel.yaml
# Edit coordinator address, gateway URL, identity, etc.

# Run
./bin/envd --config sentinel.yaml
```

### macOS

envd supports macOS with graceful degradation — WireGuard is optional, and SUI + agent scanning work independently.

```bash
# Install dependencies
brew install wireguard-tools go git

# Build (produces bin/envd-darwin-arm64)
make build-darwin
# Or: CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build -o bin/envd ./cmd/envd/

# Configure
cp sentinel.yaml.example sentinel.yaml
```

**macOS-specific config notes:**

```yaml
wireguard:
  enabled: true
  interface_name: "utun99" # macOS requires utun[0-9]* names (not wg0)
  listen_port: 51820
  keypair_path: "~/.wireguard/envd.key"

stun:
  enabled: true
  bind_address: "" # Set to your physical IP if VPN causes STUN timeouts
  servers:
    - stun:stun.l.google.com:19302
```

- **Interface name:** macOS uses `utun*` format. Set `interface_name: "utun99"` (or any unused utun number).
- **WireGuard requires root:** `wireguard-go` needs root/sudo to create TUN devices. Run with `sudo` or use a launchd plist.
- **VPN conflict:** If a VPN is active, STUN may bind to the VPN tunnel address and time out. Set `stun.bind_address` to your physical interface IP (e.g., `192.168.1.100`).
- **Graceful degradation:** If WireGuard fails (no root, interface creation error), envd continues with SUI registration + agent scanning. WireGuard features are disabled but everything else works.

**Running with launchd (recommended for macOS worker + desktop nodes):**

```bash
python3 scripts/macos_launchagent.py install \
  --binary /usr/local/bin/envd \
  --config "$HOME/.config/fractalmind-envd/sentinel.yaml"
```

The installer creates a per-user `LaunchAgent` with `RunAtLoad=true` and
`KeepAlive=true`, then bootstraps it into the current Aqua login session. This
is required for screen capture and input permissions; a system LaunchDaemon
runs outside the GUI session and cannot provide a usable remote desktop.

For fully unattended recovery:

- launchd restarts the worker after a crash and after the user logs in following
  a reboot;
- the worker retries the coordinator connection forever using
  `gateway.reconnect_interval` (default `5s`), so a network outage needs no
  operator action;
- set `desktop.command` to make the worker supervise `envd-desktop`, including
  restart after exit or repeated `/healthz` failures; the worker also passes a
  parent PID watchdog so a hard worker crash cannot leave an orphan desktop
  process holding port 8090;
- keep both binaries at stable absolute paths. Sign production binaries with a
  stable Apple signing identity before upgrades so Screen Recording and
  Accessibility grants remain attached to the same designated requirement.

macOS cannot capture or inject input before an Aqua user session exists. After
a cold reboot, recovery therefore completes at user login. Automatic login is
an OS security decision and is not enabled by this installer.

## Configuration

See [`sentinel.yaml.example`](sentinel.yaml.example) for all options.

### Chain-authorized command runtime

The v0.2.0 command factory uses Sui authority and encrypted chain results.
Initialize this Host's local signing/encryption keys explicitly, then enable
the runtime as described in [Host identity and runtime setup](../../docs/product/v020-host-identity-runtime.md).
`envd --config sentinel.yaml --init-host` prints public keys only; normal startup
never generates a replacement identity. The macOS build requires CGO and
Xcode command-line tools for Keychain access. Linux requires an available
Secret Service session; Windows uses Credential Manager. The current
agent-manager adapter supports observation only. Control requires the bounded
runtime and a current chain-confirmed execution; a chain capability alone does
not grant it. The `native-file-agent` adapter supports 1–3 explicit text-file
goals with bounded file tools. App handover and execution authorization remain
under implementation.

`sui.enabled` also enables this signed execution runtime. Startup only performs
legacy mesh peer/AgentCertificate registration when **both** `sui.package_id`
and `sui.registry_id` are explicitly configured. Omitting both leaves mesh
registration disabled; supplying only one rejects startup. Chain-connected
Hosts reuse their native signing identity if mesh registration is configured.

### Host invitation admission

Copy the App's public connection fields into `sentinel.yaml`: `sui.network`,
`chain_identifier`, `protocol_package_id`, `protocol_original_package_id`,
`protocol_registry_id`, `org_id` and `host_join_gas_budget`. The protocol registry
is distinct from the legacy peer `registry_id`; admission does not read the
legacy wallet file. Initialize native Host keys explicitly, fund their printed
address, then run:

```sh
envd --config sentinel.yaml --join-host
```

For an upgraded core, `protocol_package_id` is the current call package and
`protocol_original_package_id` is its first publication. Production admission,
Coordinator reads, worker connection and execution use the immutable current
package BCS datatype table. Field IDs, generic keys and value/object validation
all resolve the same per-type origins; unavailable or inconsistent package
metadata blocks authority instead of falling back to the original address.
OKR/direct extension call and original type IDs stay separately configured.
See [actual upgraded execution and recovery](../../docs/product/v020-mixed-type-origins.md).

Enter the one-use code through hidden terminal input, check the chain/organization,
Coordinator public key, finite observation permissions and Gas quote, then type
`JOIN <full organization ID>` to confirm. No code is accepted in argv, URLs or
configuration. Cancelling signs/broadcasts nothing. Admission grants chain
membership and bounded observation; execution authority and connectivity are
verified separately.

After a confirmed receipt, admission waits within its 20-second reconstruction
deadline for missing membership/directory objects to become visible. It repeats
only chain reads, preserves the original digest and fee, and reports other
source failures with their cause. A timeout does not redeem another invitation.

Before broadcast, envd flushes an original digest and public Gas/object metadata
under the OS cache's `fractalmind/host-join-v1` directory. It never persists the
invitation, signed transaction or business state there. Re-running queries the
original first. Unknown/pruned receipts are not permission to replay or create
another transaction. Public receipt lookup needs no private key or invitation:

```sh
envd --config sentinel.yaml --host-join-status --host-address 0xYOUR_FULL_HOST_ADDRESS
```

Only after a known terminal original receipt, use `--join-host
--new-host-join-attempt` to explicitly preview another invitation. The old digest
is archived after the new confirmation. Both successful and failed receipts
retain actual fees. Chain membership can be reconstructed even though a
historical admission receipt does not establish current membership.

Real localnet tests cover production signing/gRPC and a disk journal with injected
memory Host keys, including a deliberately lost receipt and a single broadcast;
a separate pseudo-terminal verifies hidden input. Native credential-store,
physical/cloud Host and five-platform acceptance remain pending. The
[installed Android Host flow](../../docs/product/v020-app-android-host-flow.md)
also exercises the formal CLI with macOS native Host keys, signed observations,
explicit observation-only import, and an actual Coordinator process restart.
See [Host admission implementation and evidence](../../docs/product/v020-envd-host-join.md).

### Chain-bound Host connections

Set `sui.host_connection_enabled: true` after admission and start envd normally.
This mode loads the explicitly initialized NativeStore Host keys independently
of the execution adapter. It reads the exact current membership and Coordinator
binding before every reconnect and rechecks them on traffic; the endpoint and
Coordinator signer come from Sui. A Coordinator must additionally configure
`coordinator.binding_id` to match its own signing key and organization.
Authenticated registration/heartbeat IDs are signing addresses; names are display
labels. Replies are bound to their original socket, and revoked/unknown membership
rejects routing. Closing cancels chain lookup/dial/retry. This mode preserves
existing Agent processes and refuses legacy desktop control envelopes that cannot
carry device authority. Agent import/control still requires separate authorization.

In this mode, Coordinator HTTP reads require a single-use native device proof
and a current Sui read grant and organization role. The App first verifies the
on-chain Coordinator key; the response is signed for the specific read. Legacy
Bearer tokens cannot replace device authority. Challenges are held in memory
for at most one minute; restart invalidates them. This read protocol does not
authorize HTTP writes or desktop control. See
[device reads and evidence](../../docs/product/v020-device-http-read.md).

Chain-mode heartbeats now retain an independent Host signature over the exact
body, current membership/binding versions, handshake nonce, connection sequence
and a validity window of at most one minute. The Coordinator rejects unsigned,
replayed or changed-scope observations. The App checks the Host signature and
exact current chain pointer separately from the Coordinator response signature;
it never promotes self-reported Agent metadata to independent identity or control.
See [Host signatures and evidence](../../docs/product/v020-host-signed-observations.md).

Chain-connected Hosts also include a read-only tmux pane discovery snapshot.
Each scan has its own deadline; failed scans clear the list rather than renewing
old instances. macOS and Linux use kernel process birth and boot identifiers
together with tmux internal pane IDs. `agents.tmux_socket` optionally selects an
existing server. Other platforms report the adapter as unsupported. The App's
Team & Agents view checks Host signatures, workspaces and scan freshness;
discovery does not import, restart or grant control of an Agent. See
[discovery implementation and remaining acceptance](../../docs/product/v020-agent-discovery.md).

With `runtime.enabled: true`, `runtime.adapter_kind: native-file-agent` and
`runtime.workspaces` mapping binding names to existing absolute directories,
the installed native adapter also reports a separate signed `native_discovery`
snapshot. On macOS/Linux its `native-*` IDs bind this envd kernel process birth
to the configured binding name. Canonical directory identities are pinned;
replacement directories invalidate the scan and cannot become an authorized
tool root. Restarting envd creates new instance IDs. tmux entries cannot claim
this adapter's capability. Discovery and App import remain observation-only;
they do not adopt an old task, confirm control or continue an OKR. See
[native adapter discovery and limits](../../docs/product/v020-native-agent-discovery.md).

The native adapter answers signed `status` / `availability` commands with its
physical idle/running state and active command/checkpoint IDs. Configured names
and discovered aliases share one execution slot and pinned workspace; a second
assignment returns `instance_busy` before tools run. Physical idle alone does
not authorize handover or prove that chain checkpoints are terminal. See
[native execution validation](../../docs/product/v020-native-agent-execution.md).

Actual loopback sockets with generated memory test keys and race checks passed.
NativeStore/main startup, cloud/TLS, desktop authorization, Agent import and five-platform
acceptance remain pending. See [connection implementation and evidence](../../docs/product/v020-host-chain-connection.md).

`FRACTALMIND_RUNTIME_STATE_DIR` no longer selects a production file store,
and `FRACTALMIND_NODE_COMMAND_AUTHORITY_FILE` is rejected when the chain runtime
is enabled. Legacy file stores remain only for compatibility tests.

| Setting                   | Default                  | Description                                                                                       |
| ------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| `coordinator.listen_addr` | `:8080`                  | Bind address for the embedded coordinator API                                                     |
| `coordinator.api_token`   | `""`                     | Optional bearer token for `/api/*` (when set, requests must send `Authorization: Bearer <token>`) |
| `gateway.url`             | `ws://localhost:8080/ws` | Coordinator WebSocket URL for worker nodes                                                        |
| `agents.scan_method`      | `tmux`                   | Agent discovery method                                                                            |
| `agents.auto_restart`     | `true`                   | Auto-restart crashed agents                                                                       |
| `heartbeat.interval`      | `30s`                    | Heartbeat frequency                                                                               |

`roles.coordinator=true` now starts the REST API and WebSocket server inside `envd`. Worker nodes still use `gateway.url` as the transport target, so point it at the coordinator node, for example `ws://10.87.12.34:8080/ws`.

## Remote Commands

| Command           | Description                      |
| ----------------- | -------------------------------- |
| `status`          | List all agents and their status |
| `restart <agent>` | Restart a specific agent         |
| `kill <agent>`    | Stop an agent                    |
| `logs <agent>`    | Get recent agent logs            |
| `shell <cmd>`     | Execute a shell command          |

## Docs

- Competitive research and architecture design: [`docs/research.md`](docs/research.md)
- TCP relay fallback design: [`docs/tcp-relay-design.md`](docs/tcp-relay-design.md)
- Coordinator local runtime proof (local-only): [`docs/coordinator-local-runtime-proof.md`](docs/coordinator-local-runtime-proof.md)

## Part of FractalMind AI

```
fractalmind-protocol    ← On-chain identity (SUI)
fractalmind-envd        ← This repo: remote agent management
agent-manager-skill     ← Local agent management
fractalbot              ← Multi-channel messaging
```

## License

MIT

## Sui Overflow 2026 demo

This repo includes the Sui Overflow 2026 Agentic Web demo package: [FractalMind Agent OS on Sui](docs/sui-overflow-2026/README.md).

The demo adds a Sui Move `AgentPolicy` object, deterministic action-evidence hashing, a local CLI runner, and a Sui testnet proof-pack showing policy creation, action evidence, revocation, and post-revoke failure.
