# fractalmind-envd

Lightweight Go daemon for remote AI Agent management. Runs on each machine hosting AI agents, providing discovery, heartbeat monitoring, remote commands, and self-healing — all coordinated through SUI blockchain instead of a central server.

## What Problem Does envd Solve?

Managing AI agents across multiple machines today requires centralized tools (TeamViewer, Tailscale, SSH jump hosts) that create single points of failure and trust. If the central server goes down or revokes access, you lose control of your agents.

**envd replaces the central server with SUI blockchain:**

- Identity and authorization live on-chain — no vendor can revoke your access
- Peer discovery happens through SUI Events — no coordination server needed
- Data flows peer-to-peer through WireGuard tunnels — no relay by default
- Every registration and status change is auditable on-chain

## Architecture (v3)

envd uses a **dual-plane architecture** inspired by Tailscale, but with SUI replacing the centralized coordination server. A single Go binary handles all roles — no separate components needed.

```
SUI Blockchain (Control Plane — replaces Tailscale Coordination Server)
├── PeerRegistry: WireGuard public key + endpoint + relay registration
├── AgentCertificate: Identity + permissions + reputation
├── Organization: Membership (determines who can discover whom)
├── Events: PeerRegistered / PeerUpdated / PeerOffline / RelayRegistered
└── Governance: DAO on-chain voting

envd (Single Go binary, runs on each machine)
├── Agent Manager:   tmux session discovery + crash detection + auto-restart
├── WireGuard:       P2P mesh tunnels (data plane)
├── SUI Client:      On-chain registration / peer discovery / event subscription
├── STUN Client:     NAT type detection (org STUN → shared STUN → public STUN)
├── STUN Server:     NAT discovery service (auto-enabled on public IP nodes)
├── Relay Server:    WireGuard packet forwarding (auto-enabled on public IP nodes)
├── Sponsor:         Org-level gas sponsorship (requires org wallet, manual enable)
├── REST API:        Management interface (coordinator role, manual enable)
└── P2P Heartbeat:   Node-to-node heartbeat + relay load broadcast

Role auto-detection:
  Public IP    → auto-enable STUN Server + Relay Server
  Org wallet   → enable Sponsor
  coordinator  → enable REST API

External dependency: SUI RPC only (e.g. fullnode.mainnet.sui.io)
Separate components: 0
```

### Connection Flow

```
1. envd starts
   → Reads sentinel.yaml for SUI RPC, org_id, local keypair
   → Generates WireGuard keypair (or loads existing)
   → STUN probe → detects NAT type
   → If public IP: auto-enable STUN Server + Relay on :3478

2. Registers on-chain
   → Calls PeerRegistry::register_peer(cert, wg_pubkey, endpoints)
   → If public IP: registers as relay (is_relay=true, relay_addr, region, isp)
   → SUI emits PeerRegistered event

3. Discovers peers
   → Queries historical PeerRegistered events (filtered by org_id)
   → Subscribes to new events (real-time discovery)
   → Establishes WireGuard tunnel to each peer

4. P2P communication
   → Heartbeat: envd ←WireGuard→ envd (direct, includes relay_load)
   → Commands: coordinator envd →WireGuard→ target envd
   → Logs: target envd →WireGuard→ coordinator envd

5. NAT traversal fallback
   → STUN: org STUN → shared STUN → public STUN (Google/Cloudflare)
   → Updates endpoint on-chain (PeerRegistry::update_endpoints)
   → Still fails → Relay fallback:
     → Query on-chain relay list → org Relay first → shared Relay
     → Relay forwards encrypted WireGuard packets (cannot see plaintext)
```

### Relay Layered Model

envd uses a layered relay architecture where connections are routed through the closest available relay:

```
Connection priority (fastest to slowest):
  1. WireGuard P2P direct (STUN hole punching)
  2. Organization Relay (public IP nodes within the same org)
  3. Shared Relay (public relay nodes serving all orgs)
```

On-chain smart relay selection (`get_best_relays`) returns top 5 relays, scored by:

| Factor | Weight | Description |
|--------|--------|-------------|
| Org match | +100 | Same organization relay preferred |
| Region | +50 | Same geographic region |
| ISP | +30 | Same network/ISP |
| Latency | +20 | Lower avg_latency_ms preferred |
| Load | +10 | Lower current_load/capacity preferred |

Relay load metrics (`current_load`, `avg_latency_ms`) are broadcast via P2P heartbeat — not stored on-chain — to avoid gas costs. Only `uptime_score` is updated on-chain daily.

### STUN Layered Fallback

STUN follows the same layered pattern as Relay:

```
STUN priority:                      Relay priority:
  1. Org STUN (same-org public IP)    1. Org Relay
  2. Shared STUN (other orgs)         2. Shared Relay
  3. Public STUN (Google/Cloudflare)   3. (connection failed)
```

STUN has an extra public fallback layer because STUN is a stateless standard protocol — using public STUN servers has no security risk (it only discovers your IP, no data is transmitted).

### Gas Sponsorship Model

Gas is paid at the organization level — org wallets sponsor all envd node transactions:

```
Gas sponsorship tiers:
  1. Org wallet (default): Org admin funds a shared wallet for all org nodes
  2. Self-pay (fallback): Worker nodes hold their own SUI balance
```

Sponsor flow (all via WireGuard P2P):
```
worker envd ──WireGuard──► sponsor envd
  1. Construct TX               1. Verify sender is org member
  2. Sign with own keypair      2. Check allowlist (envd contracts only)
  3. Send partial-signed TX     3. Check limits (per-tx + daily)
                                4. Add org gas coin + budget
                                5. Co-sign with org wallet keypair
  4. Receive tx_digest ◄─────── 6. Submit dual-signed TX to SUI
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
| **NAT traversal** | Proprietary UDP | DERP relay | **Built-in STUN + Relay (layered)** |
| **Identity** | ID + password | SSO + WG keys | **SUI keypair** |
| **Peer discovery** | Master Server | Coordination Server | **SUI Events** |
| **Relay** | TV Router Network | DERP (stateless) | **Layered: Org → Shared (smart selection)** |
| **Encryption** | RSA4096 + AES256 E2E | WireGuard (ChaCha20) | **WireGuard (ChaCha20)** |
| **Auditability** | Opaque | ACL logs | **Full on-chain record** |
| **Single point of failure** | TV Master down | Coord Server down | **None (chain doesn't stop)** |
| **Separate components** | N/A | Coord Server + DERP | **0 (single binary)** |
| **Cost (2 nodes/month)** | ~$50.90 | ~$12 | **~$0.19** |
| **Cost (100 nodes/month)** | N/A | ~$600 | **~$8.19** |

**Key differentiator:** envd is the only remote agent management tool where identity, authorization, and peer discovery are fully decentralized on blockchain. No vendor can revoke your access or shut down the coordination layer. A single binary handles all roles — STUN, Relay, Sponsor, and Agent management — with zero separate components.

## SUI Smart Contracts

envd deploys two Move modules as an independent package that depends on `fractalmind-protocol`:

### `peer.move` — PeerRegistry

Manages WireGuard public keys, endpoint registration, and relay node information for peer discovery via SUI Events.

**Key functions:**

| Function | Description |
|----------|-------------|
| `register_peer` | Register node with WG pubkey, endpoints, hostname, relay info. Requires active AgentCertificate. |
| `update_endpoints` | Update endpoints when IP changes. Only the node itself can call. |
| `go_offline` | Mark node offline (graceful shutdown). |
| `go_online` | Mark node online with updated endpoints. |
| `deregister_peer` | Remove node. Callable by node itself or org admin. |
| `update_uptime_score` | Update relay uptime score (daily). |

**PeerNode fields (v3 — relay extension):**

| Field | Description |
|-------|-------------|
| `org_id` | Organization the node belongs to |
| `wireguard_pubkey` | WireGuard Curve25519 public key |
| `endpoints` | Network endpoints (IP:port list) |
| `hostname` | Human-readable name |
| `status` | Online/Offline |
| `is_relay` | Whether this node serves as a relay |
| `relay_addr` | Relay public address (if is_relay=true) |
| `region` | Geographic region (e.g. "cn-east", "us-west") |
| `isp` | Network provider (e.g. "aliyun", "aws") |
| `relay_capacity` | Max relay connections |
| `uptime_score` | Availability score 0-100 (updated daily on-chain) |

> `relay_current_load` and `avg_latency_ms` are broadcast via P2P heartbeat, not stored on-chain.

**Events emitted:**

| Event | Triggered by | Contains |
|-------|-------------|----------|
| `PeerRegistered` | `register_peer` | peer address, org_id, WG pubkey, endpoints, hostname |
| `PeerEndpointUpdated` | `update_endpoints`, `go_online` | peer address, org_id, new endpoints |
| `PeerStatusChanged` | `go_offline`, `go_online` | peer address, org_id, new status |
| `PeerDeregistered` | `deregister_peer` | peer address, org_id |
| `RelayRegistered` | `register_peer` (is_relay=true) | peer, org_id, relay_addr, region, isp, capacity |

### `sponsor.move` — Gas Sponsorship

Manages organization-level gas sponsorship policies so worker nodes don't need to hold SUI tokens.

| Function | Description |
|----------|-------------|
| `enable_sponsor` | Org admin enables gas sponsorship with per-tx and daily limits |
| `get_sponsor` | Query sponsorship config for an org |

The actual gas payment uses SUI's native Sponsored Transaction mechanism (SIP-15) — the on-chain contract only manages **policy** (limits, admin). The envd sponsor role handles the dual-signing flow internally via WireGuard P2P.

## Testnet Deployment

| Object | ID |
|--------|----|
| envd Package | `0x74aef8ff3bb0da5d5626780e6c0e5f1f36308a40580e519920fdc9204e73d958` |
| PeerRegistry | `0xe557465293df033fd6ba1347706d7e9db2a35de4667a3b6a2e20252587b6e505` |
| SponsorRegistry | `0x22db6a75b60b1f530e9779188c62c75a44340723d9d78e21f7e25ded29718511` |
| Protocol Package | `0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24` |

## Gas Cost Analysis

envd operations are extremely cheap because only registration, status changes, and daily uptime scores go on-chain — heartbeats, commands, and relay load metrics flow P2P:

| Operation | Est. Gas (SUI) | Frequency |
|-----------|---------------|-----------|
| `register_peer` (with relay fields) | ~0.0022 | On startup |
| `update_endpoints` | ~0.0011 | On IP change |
| `go_offline` / `go_online` | ~0.001 | On restart |
| `update_uptime_score` | ~0.0009 | Daily (relay nodes only) |
| `enable_sponsor` | ~0.0015 | One-time (org setup) |
| `deregister_peer` | ~0.0003 | On removal (storage rebate) |

**Monthly cost estimates:**

| Scale | Operations/month | Cost (SUI) | Cost (USD) |
|-------|-----------------|------------|------------|
| 2 nodes (1 relay) | ~130 | ~0.166 | **~$0.19** |
| 100 nodes (10 relays) | ~5,300 | ~7.12 | **~$8.19** |

> `relay_current_load` and `avg_latency_ms` are broadcast via P2P heartbeat packets (every 30s), not on-chain. This saves ~83% of gas costs compared to on-chain relay load updates.

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
