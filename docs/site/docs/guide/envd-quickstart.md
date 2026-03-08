# envd Quick Start

This guide walks you through installing and running `fractalmind-envd` on a machine hosting AI agents.

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Go | 1.22+ | [Install Go](https://go.dev/dl/) |
| tmux | any | Agent sessions run in tmux |
| WireGuard | any | Optional — for P2P mode |
| git | any | To clone the repo |

## Installation

### 1. Clone and Build

```bash
git clone https://github.com/fractalmind-ai/fractalmind-envd.git
cd fractalmind-envd
make build
```

This produces `./bin/envd`. For cross-compilation:

```bash
# Linux AMD64
make build-linux

# All platforms (Linux AMD64 + macOS ARM64)
make build-all
```

### 2. Configure

```bash
cp sentinel.yaml.example sentinel.yaml
```

Edit `sentinel.yaml` with your settings (see [Configuration Reference](#configuration-reference) below).

### 3. Run

```bash
./bin/envd --config sentinel.yaml
```

Or build and run in one step:

```bash
make run
```

To install system-wide:

```bash
sudo make install
# Now available as: envd
```

## Configuration Reference

The `sentinel.yaml` file controls all envd behavior. Here's every field explained:

### Identity

```yaml
identity:
  host_id: ""        # Unique ID for this host. Auto-generated (UUID) if empty.
  hostname: ""       # Human-readable name. Defaults to os.Hostname() if empty.
```

### Roles

```yaml
roles:
  coordinator: false   # Enable REST API management interface
  sponsor: false       # Enable org-level gas sponsorship (requires org wallet)
  # relay + stun server: auto-detected — enabled when public IP is detected
```

Roles determine what capabilities this envd node provides:

| Role | How enabled | Description |
|------|------------|-------------|
| **worker** | Always on | Agent management, heartbeat, P2P communication |
| **coordinator** | `roles.coordinator: true` | REST API for remote management |
| **relay** | Auto (public IP) | WireGuard packet forwarding for NAT-blocked peers |
| **stun** | Auto (public IP) | STUN Server for NAT endpoint discovery |
| **sponsor** | `roles.sponsor: true` | Org gas sponsorship (needs org wallet keypair) |

### Agents

```yaml
agents:
  scan_method: tmux          # Discovery method: tmux | systemd | docker
  scan_interval: 10s         # How often to scan for agents
  auto_restart: true         # Auto-restart crashed agents
  max_restart_attempts: 3    # Max restarts before alerting
```

- **scan_method**: How envd finds local agents. `tmux` scans for tmux sessions (recommended for FractalMind). `systemd` and `docker` are planned.
- **auto_restart**: When enabled, envd detects agents that were running but disappeared from tmux and restarts them automatically.
- **max_restart_attempts**: After this many failed restarts, envd sends an alert instead of retrying.

### Heartbeat

```yaml
heartbeat:
  interval: 30s    # How often to send heartbeat
```

Heartbeat is sent directly via WireGuard P2P (no on-chain cost). Relay nodes include `relay_load` info (current_load, capacity, avg_latency_ms) in heartbeat packets.

### SUI

```yaml
sui:
  enabled: true
  rpc: https://fullnode.testnet.sui.io:443
  keypair_path: ~/.sui/envd.key       # Ed25519 keypair (auto-generated if missing)
  package_id: "0x74aef8ff3bb0da5d5626780e6c0e5f1f36308a40580e519920fdc9204e73d958"
  registry_id: "0xe557465293df033fd6ba1347706d7e9db2a35de4667a3b6a2e20252587b6e505"
  org_id: "0x..."                     # Your Organization object ID
  cert_id: "0x..."                    # Your AgentCertificate object ID
  poll_interval: 30s                  # How often to poll for new peer events
```

SUI blockchain provides decentralized peer discovery, identity, and authorization.

### WireGuard

```yaml
wireguard:
  enabled: true
  interface_name: wg0
  listen_port: 51820
  keypair_path: ~/.wireguard/envd.key  # Curve25519 keypair (auto-generated)
  # address: 10.100.X.Y/32             # Auto-assigned from SUI address hash if empty
```

WireGuard creates P2P tunnels to other envd nodes discovered through SUI Events.

### STUN

```yaml
stun:
  enabled: true
  servers:                            # Fallback STUN servers (used after org/shared STUN)
    - stun:stun.l.google.com:19302
    - stun:stun1.l.google.com:19302
```

STUN discovers your public IP and port for NAT traversal. envd uses a layered STUN fallback:

1. **Org STUN** — Public IP nodes within the same organization (discovered on-chain)
2. **Shared STUN** — Public IP nodes in other organizations (discovered on-chain)
3. **Public STUN** — Google/Cloudflare (configured in `stun.servers`)

### Sponsor

```yaml
sponsor:
  org_wallet_path: ~/.sui/org-wallet.key  # Organization wallet private key
  max_gas_per_tx: 10000000     # Max gas per transaction (MIST)
  daily_gas_limit: 100000000   # Daily gas budget (MIST)
  allowed_packages:            # Contract allowlist (only envd contracts)
    - "0x74aef8ff3bb0da5d5626780e6c0e5f1f36308a40580e519920fdc9204e73d958"
```

Only needed when `roles.sponsor: true`. The sponsor node receives partial-signed transactions from other org nodes via WireGuard, validates them, co-signs with the org wallet, and submits to SUI.

## Deployment

envd runs as a fully decentralized P2P system — SUI for peer discovery, WireGuard for direct communication. No central server required.

```yaml
# sentinel.yaml
identity:
  hostname: my-agent-host

roles:
  coordinator: false          # Set true for management node
  sponsor: false              # Set true + add sponsor config for gas sponsorship

agents:
  scan_method: tmux
  auto_restart: true
  max_restart_attempts: 3

heartbeat:
  interval: 30s

sui:
  enabled: true
  rpc: https://fullnode.testnet.sui.io:443
  keypair_path: ~/.sui/envd.key
  package_id: "0x74aef8ff3bb0da5d5626780e6c0e5f1f36308a40580e519920fdc9204e73d958"
  registry_id: "0xe557465293df033fd6ba1347706d7e9db2a35de4667a3b6a2e20252587b6e505"
  org_id: "0x..."    # Your org
  cert_id: "0x..."   # Your agent certificate
  poll_interval: 30s

wireguard:
  enabled: true
  listen_port: 51820

stun:
  enabled: true
  servers:
    - stun:stun.l.google.com:19302
```

**What happens automatically:**
- STUN probe detects NAT type
- Public IP nodes auto-enable STUN Server + Relay on :3478
- Peers are discovered via SUI Events and WireGuard tunnels are established
- Heartbeats flow P2P (no on-chain cost)

**Pros:** Fully decentralized, no single point of failure, on-chain auditability, zero separate components.
**Cons:** Requires SUI keypair, AgentCertificate, and WireGuard setup.

## Remote Commands

Once envd is running, you can send commands directly via WireGuard P2P:

### status

List all agents running on the host.

```
→ status
← { "agents": [
     { "id": "agent-001", "session": "agent-001", "status": "running" },
     { "id": "agent-002", "session": "agent-002", "status": "running" }
   ]}
```

### restart

Restart a specific agent by session name.

```
→ restart agent-001
← { "message": "agent agent-001 restarted" }
```

### logs

Get recent output from an agent's tmux session.

```
→ logs agent-001 [lines=100]
← { "logs": "..." }
```

### kill

Stop an agent's tmux session.

```
→ kill agent-001
← { "message": "agent agent-001 killed" }
```

### shell

Execute an arbitrary shell command on the host.

```
→ shell "df -h"
← { "output": "..." }
```

## SUI + WireGuard Setup

To set up the full decentralized P2P mode:

### 1. Get a SUI Keypair

envd auto-generates a keypair on first run if `keypair_path` doesn't exist. To create one manually:

```bash
mkdir -p ~/.sui
# envd will generate ~/.sui/envd.key automatically
```

### 2. Obtain an AgentCertificate

Your org admin needs to register your agent on-chain using the [fractalmind-protocol SDK](/protocol/sdk):

```typescript
import { FractalMindSDK } from '@anthropic-ai/fractalmind-sdk'

const sdk = new FractalMindSDK({ network: 'testnet' })
const cert = await sdk.registerAgent(orgId, {
  name: 'envd-host-a',
  address: '<your-sui-address>',
})
// cert.id → use as cert_id in sentinel.yaml
```

### 3. Install WireGuard

```bash
# Ubuntu/Debian
sudo apt install wireguard

# macOS
brew install wireguard-tools
```

### 4. Configure and Run

Update `sentinel.yaml` with SUI and WireGuard settings (see [Deployment](#deployment) above), then:

```bash
sudo ./bin/envd --config sentinel.yaml
```

::: tip
`sudo` is needed for WireGuard interface creation.
:::

### 5. Verify

Check that envd registered on-chain:

```bash
# Query PeerRegistry for your node
curl -s https://fullnode.testnet.sui.io:443 \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "method": "suix_queryEvents",
    "params": [{"MoveEventType": "0x74aef8ff3bb0da5d5626780e6c0e5f1f36308a40580e519920fdc9204e73d958::peer::PeerRegistered"}],
    "id": 1
  }' | jq '.result.data'
```

## Troubleshooting

### envd can't find agents

- Verify tmux is installed: `tmux -V`
- Check that agents are running as tmux sessions: `tmux list-sessions`
- Ensure `scan_method` in config matches your setup

### WireGuard tunnel not establishing

- Verify WireGuard is installed: `wg --version`
- Check that `listen_port` (default 51820) is open in firewall
- Ensure STUN is enabled if nodes are behind NAT
- Check envd logs for `[wg]` and `[stun]` entries

### STUN discovery failing

- Check that at least one STUN source is reachable:
  - Org STUN: other public IP nodes in your org (check SUI events)
  - Public STUN: `stun.l.google.com:19302` must be reachable
- If behind strict firewall, ensure UDP port 3478 is not blocked

### SUI registration fails

- Verify SUI RPC endpoint is reachable
- Check that `org_id` and `cert_id` are correct
- Ensure the AgentCertificate is in `active` status
- If self-paying: ensure your SUI address has balance (~0.01 SUI is enough)
- If using org sponsor: verify sponsor node is running and reachable via WireGuard

### Agent auto-restart not working

- Check that `auto_restart: true` in config
- Verify `max_restart_attempts` hasn't been exhausted (check logs for `max attempts reached`)
- Ensure the agent's tmux session has a valid restart command

## Next Steps

- [envd Component Overview](/components/envd) — Architecture, SUI contracts, and competitive analysis
- [Architecture Overview](/architecture/overview) — How envd fits into the FractalMind stack
- [Protocol SDK](/protocol/sdk) — Register agents and orgs on-chain
- [Testnet Deployment](/protocol/testnet) — Contract addresses and existing org data
