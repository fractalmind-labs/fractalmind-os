<div align="center">

# fractalmind-envd

**Lightweight daemon for remote AI Agent management on SUI.**

[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8)](https://go.dev/)
[![SUI](https://img.shields.io/badge/SUI-Identity-4DA2FF)](https://sui.io/)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

---

## What is envd?

`envd` (environment daemon) runs on each machine hosting AI Agents. It:

1. **Discovers** local AI agents (tmux sessions)
2. **Reports** status via heartbeat to a coordinator envd
3. **Executes** remote commands (restart, logs, kill, shell)
4. **Self-heals** — auto-restarts crashed agents within 60 seconds

Unlike traditional remote control tools (TeamViewer, Tailscale), envd uses **SUI blockchain** for identity and authorization — no central server can revoke your access.

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
# Or: CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -o bin/envd ./cmd/envd/

# Configure
cp sentinel.yaml.example sentinel.yaml
```

**macOS-specific config notes:**

```yaml
wireguard:
  enabled: true
  interface_name: "utun99"    # macOS requires utun[0-9]* names (not wg0)
  listen_port: 51820
  keypair_path: "~/.wireguard/envd.key"

stun:
  enabled: true
  bind_address: ""            # Set to your physical IP if VPN causes STUN timeouts
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

| Setting | Default | Description |
|---------|---------|-------------|
| `coordinator.listen_addr` | `:8080` | Bind address for the embedded coordinator API |
| `coordinator.api_token` | `""` | Optional bearer token for `/api/*` (when set, requests must send `Authorization: Bearer <token>`) |
| `gateway.url` | `ws://localhost:8080/ws` | Coordinator WebSocket URL for worker nodes |
| `agents.scan_method` | `tmux` | Agent discovery method |
| `agents.auto_restart` | `true` | Auto-restart crashed agents |
| `heartbeat.interval` | `30s` | Heartbeat frequency |

`roles.coordinator=true` now starts the REST API and WebSocket server inside `envd`. Worker nodes still use `gateway.url` as the transport target, so point it at the coordinator node, for example `ws://10.87.12.34:8080/ws`.

## Remote Commands

| Command | Description |
|---------|-------------|
| `status` | List all agents and their status |
| `restart <agent>` | Restart a specific agent |
| `kill <agent>` | Stop an agent |
| `logs <agent>` | Get recent agent logs |
| `shell <cmd>` | Execute a shell command |

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
