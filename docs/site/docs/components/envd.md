# fractalmind-envd

Lightweight Go daemon for remote AI Agent management. Runs on each machine hosting AI agents, providing discovery, heartbeat monitoring, remote commands, and self-healing — all coordinated through SUI blockchain instead of a central server.

## What Problem Does envd Solve?

Managing AI agents across multiple machines today requires centralized tools (TeamViewer, Tailscale, SSH jump hosts) that create single points of failure and trust. If the central server goes down or revokes access, you lose control of your agents.

**envd replaces the central server with SUI blockchain:**

- Identity and authorization live on-chain — no vendor can revoke your access
- Peer discovery happens through SUI Events — no coordination server needed
- Data flows peer-to-peer through WireGuard tunnels — no relay by default
- Every registration and status change is auditable on-chain

## Architecture

envd uses a **dual-plane architecture** inspired by Tailscale, but with SUI replacing the centralized coordination server:

```
SUI Blockchain (Control Plane — replaces Tailscale Coordination Server)
├── PeerRegistry: WireGuard public key + endpoint registration
├── AgentCertificate: Identity + permissions + reputation
├── Organization: Membership (determines who can discover whom)
├── Events: PeerRegistered / PeerUpdated / PeerOffline
└── Governance: DAO on-chain voting

envd (Single binary, runs on each machine)
├── WireGuard: P2P mesh tunnels (data plane)
├── SUI Client: Read peer list / register self / subscribe to events
├── Agent Scanner: tmux session discovery
├── Self-heal: Crash detection + auto-restart (max 3 attempts)
├── REST API: Local management interface (coordinator mode)
├── STUN Client: NAT endpoint discovery
└── P2P Heartbeat: Direct node-to-node heartbeat

TURN Relay (Optional, stateless)
└── Forwards encrypted WireGuard packets only when P2P fails
```

### Connection Flow

```
1. envd starts
   → Reads sentinel.yaml for SUI RPC, org_id, local keypair
   → Generates WireGuard keypair (or loads existing)

2. Registers on-chain
   → Calls PeerRegistry::register_peer(cert, wg_pubkey, endpoints)
   → SUI emits PeerRegistered event

3. Discovers peers
   → Queries historical PeerRegistered events (filtered by org_id)
   → Subscribes to new events (real-time discovery)
   → Establishes WireGuard tunnel to each peer

4. P2P communication
   → Heartbeat: envd ←WireGuard→ envd (direct)
   → Commands: coordinator envd →WireGuard→ target envd
   → Logs: target envd →WireGuard→ coordinator envd

5. NAT traversal failure
   → STUN discovers public endpoint
   → Updates endpoint on-chain (PeerRegistry::update_endpoints)
   → Still fails → TURN relay fallback
```

## Core Features

### Agent Discovery
Scans for local AI agents running as tmux sessions. Configurable scan interval (default 10s) with support for tmux, systemd, and Docker discovery methods.

### Heartbeat Monitoring
Sends periodic heartbeat via WireGuard P2P (not on-chain — to avoid gas costs). Default interval: 30s. Reports agent count, status, hostname, and uptime.

### Remote Commands

| Command | Description |
|---------|-------------|
| `status` | List all agents and their current status |
| `restart <agent>` | Restart a specific agent's tmux session |
| `kill <agent>` | Stop an agent's tmux session |
| `logs <agent> [lines]` | Get recent agent logs (default: 100 lines) |
| `shell <cmd>` | Execute an arbitrary shell command |

### Self-Healing
Automatically detects crashed agents (was running, now missing from tmux) and restarts them:
- Detection within one scan interval (default 10s)
- Maximum 3 restart attempts per agent
- Alerts sent via Gateway/P2P when max attempts exhausted

### SUI On-Chain Identity
Each envd node has a SUI Ed25519 keypair and an `AgentCertificate`. Identity is verified on-chain — no passwords, no vendor accounts.

### WireGuard P2P Mesh
Data plane uses WireGuard (ChaCha20-Poly1305 encryption). Peers are added/removed dynamically based on SUI Events. ~95% P2P success rate (matching Tailscale).

## Comparison with Alternatives

| Feature | TeamViewer | Tailscale | **fractalmind-envd** |
|---------|------------|-----------|---------------------|
| **Trust root** | TV Master Server | Tailscale Coord Server | **SUI blockchain** |
| **Control plane** | Centralized | Centralized | **On-chain (decentralized)** |
| **Data plane** | P2P ~70% / relay | WireGuard P2P ~95% | **WireGuard P2P ~95%** |
| **Identity** | ID + password | SSO + WG keys | **SUI keypair** |
| **Peer discovery** | Master Server | Coordination Server | **SUI Events** |
| **Encryption** | RSA4096 + AES256 E2E | WireGuard (ChaCha20) | **WireGuard (ChaCha20)** |
| **Auditability** | Opaque | ACL logs | **Full on-chain record** |
| **Single point of failure** | TV Master down | Coord Server down | **None (chain doesn't stop)** |
| **Cost (2 nodes/month)** | ~$50.90 | ~$12 | **~$0.14** |
| **Cost (100 nodes/month)** | N/A | ~$600 | **~$7.13** |

**Key differentiator:** envd is the only remote agent management tool where identity, authorization, and peer discovery are fully decentralized on blockchain. No vendor can revoke your access or shut down the coordination layer.

## SUI Smart Contracts

envd deploys two Move modules as an independent package that depends on `fractalmind-protocol`:

### `peer.move` — PeerRegistry

Manages WireGuard public keys and endpoint registration for peer discovery via SUI Events.

**Key functions:**

| Function | Description |
|----------|-------------|
| `register_peer` | Register node with WG pubkey, endpoints, hostname. Requires active AgentCertificate. |
| `update_endpoints` | Update endpoints when IP changes. Only the node itself can call. |
| `go_offline` | Mark node offline (graceful shutdown). |
| `go_online` | Mark node online with updated endpoints. |
| `deregister_peer` | Remove node. Callable by node itself or org admin. |

**Events emitted:**

| Event | Triggered by | Contains |
|-------|-------------|----------|
| `PeerRegistered` | `register_peer` | peer address, org_id, WG pubkey, endpoints, hostname |
| `PeerEndpointUpdated` | `update_endpoints`, `go_online` | peer address, org_id, new endpoints |
| `PeerStatusChanged` | `go_offline`, `go_online` | peer address, org_id, new status |
| `PeerDeregistered` | `deregister_peer` | peer address, org_id |

### `sponsor.move` — Gas Sponsorship

Manages organization-level gas sponsorship policies so worker nodes don't need to hold SUI tokens.

| Function | Description |
|----------|-------------|
| `enable_sponsor` | Org admin enables gas sponsorship with per-tx and daily limits |
| `get_sponsor` | Query sponsorship config for an org |

The actual gas payment uses SUI's native Sponsored Transaction mechanism (SIP-15) — the on-chain contract only manages **policy** (limits, admin). A lightweight off-chain Gas Sponsor Service handles the dual-signing flow.

## Testnet Deployment

| Object | ID |
|--------|----|
| envd Package | `0x74aef8ff3bb0da5d5626780e6c0e5f1f36308a40580e519920fdc9204e73d958` |
| PeerRegistry | `0xe557465293df033fd6ba1347706d7e9db2a35de4667a3b6a2e20252587b6e505` |
| SponsorRegistry | `0x22db6a75b60b1f530e9779188c62c75a44340723d9d78e21f7e25ded29718511` |
| Protocol Package | `0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24` |

## Gas Cost Analysis

envd operations are extremely cheap because only registration and status changes go on-chain — heartbeats and commands flow P2P:

| Operation | Est. Gas (SUI) | Frequency |
|-----------|---------------|-----------|
| `register_peer` | ~0.0017 | On startup |
| `update_endpoints` | ~0.0011 | On IP change |
| `go_offline` / `go_online` | ~0.001 | On restart |
| `deregister_peer` | ~0.0003 | On removal (storage rebate) |

**Monthly cost estimates:**

| Scale | Operations/month | Cost (SUI) | Cost (USD) |
|-------|-----------------|------------|------------|
| 2 nodes | ~100 | ~0.122 | **~$0.14** |
| 100 nodes | ~5,000 | ~6.10 | **~$7.13** |

## Related Components

| Component | Relationship |
|-----------|-------------|
| [fractalmind-protocol](/components/protocol) | Provides `AgentCertificate` and `Organization` used for identity and authorization |
| [agent-manager](/components/agent-manager) | Local agent lifecycle management; envd extends this to remote |
| [fractalbot](/components/fractalbot) | Alerts routed through fractalbot when agent recovery fails |
| [explorer](https://fractalmind-ai.github.io/explorer) | Visualizes peer nodes registered on-chain |

## Source Code

- GitHub: [fractalmind-ai/fractalmind-envd](https://github.com/fractalmind-ai/fractalmind-envd)
- Language: Go 1.22+
- License: MIT
