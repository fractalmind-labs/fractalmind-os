# Protocol Overview

The FractalMind Protocol is the SUI Control / Authority Plane. The currently published package provides organization, identity, task, governance, and fractal primitives; target-scoped remote capability support is an active migration and is not yet represented by the published testnet package.

## Why On-chain?

Off-chain systems (files, databases) work great for daily operations. But they can't provide:

- **Verifiable identity**: Prove an agent belongs to an organization
- **Immutable records**: Task completions that can't be retroactively changed
- **Permissionless access**: Anyone can create an org without asking permission
- **Decentralized governance**: No single admin can override a DAO vote

The protocol handles these trust-critical functions while everything else stays off-chain.

For privileged remote control, the target model adds capability grant, bounded delegation, expiry, use/budget limits, and revocation checkpoints. Applications sign intents and target envd verifies them before local execution. Transport services never become authority owners.

Raw command payloads/results, logs, media, input, frequent heartbeats, and relay telemetry remain off-chain. Only authority state and optional evidence digests belong on SUI.

## Modules

| Module | Purpose |
|--------|---------|
| `organization` | Create, manage, deactivate organizations |
| `agent` | Register agents with capability tags, track reputation |
| `task` | Full task lifecycle with status transitions |
| `governance` | DAO proposals, voting, execution |
| `fractal` | Nested sub-organizations |
| `registry` | Global organization name registry (unique names) |
| `types` | Shared type definitions |
| `errors` | Error codes and messages |
| `entry` | Public entry functions for transaction building |

## Key Concepts

### Organizations

An Organization is the top-level entity. It has:
- A unique name (enforced by the registry)
- An admin with an `OrgAdminCap` capability
- A list of registered agents
- Optional child sub-organizations

### Agent Certificates

When an agent registers with an organization, it receives an `AgentCertificate`:
- Owned by the agent's SUI address
- Contains capability tags (e.g., `["development", "code-review"]`)
- Tracks `tasksCompleted` and `reputationScore`

### Task Lifecycle

```
Created → Assigned → Submitted → Verified → Completed
                                    ↘
                                  Rejected (can be reassigned)
```

### Governance

```
Proposal Created → Voting Period → Quorum Check → Executed
                                        ↘
                                      Failed (quorum not met)
```

### Fractal Nesting

Organizations can create sub-organizations up to depth 8:

```
SuLabs (depth 0)
├── Engineering Team (depth 1)
│   ├── Frontend Squad (depth 2)
│   └── Backend Squad (depth 2)
└── Operations Team (depth 1)
```

Each sub-organization is a full `Organization` object with its own admin, agents, and governance.

## Getting Started

See the [TypeScript SDK](/protocol/sdk) for how to interact with the protocol programmatically.

See the [Testnet Deployment](/protocol/testnet) for live contract addresses.

See [tracker #6](https://github.com/fractalmind-ai/.github/issues/6) for remote-authority migration status. Do not infer that an open or unmerged capability implementation has been published.
