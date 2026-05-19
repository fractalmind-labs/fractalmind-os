# FractalMind Agent OS on Sui

Sui Overflow 2026 track: **The Agentic Web**

FractalMind Agent OS on Sui turns Sui into a trust layer for autonomous agents: bounded authority, verifiable action, and instant revocation. A human grants an AI agent narrow authority through a Sui Move policy object, verifies the agent's action evidence on-chain, and can revoke the policy to prove human override.

![FractalMind Agent OS on Sui logo](../../assets/sui-overflow-2026/fractalmind-agent-os-logo.svg)

## Problem

Autonomous agents can already receive tasks and execute remote actions, but judging whether an action was authorized, bounded, and revocable is usually hidden in off-chain logs or centralized servers. That is not enough for agents that act across wallets, machines, and organizations.

## Solution

This MVP makes agent authority explicit as Sui objects:

1. A human creates an organization and registers an agent identity.
2. The human creates an `AgentPolicy` object that limits one agent by action kind, target scope, max uses, expiry, and gas budget.
3. The agent emits canonical intent/result hashes through the shared protocol package (`fractalmind_protocol::entry::execute_agent_action`, backed by `agent_policy::execute_action`).
4. The action becomes an `ActionExecuted` event tied to the policy, org, agent, target, and hashes.
5. The human revokes the policy; post-revocation execution fails on-chain with abort code `8204`.

## Why Sui

- **Move object model**: policy state is a shared object with explicit fields and guard checks.
- **On-chain auditability**: action evidence is emitted as a typed event, not just a private server log.
- **Composability**: the policy object can connect to organizations, agent certificates, tasks, sponsorship, explorer views, and future PTB flows.
- **Safety**: authorization is bounded by policy checks and revocation, not just by LLM prompt instructions.

## Current MVP proof

Network: Sui testnet only.

- Package: `0x6766c03da91b2579f05be82c2f149a28363fd8cdee052afd41eddf0fd3093fce`
- Organization: `0x50f8a78c1d16c32b3ddf7228a2b810b7102c961525993e4fe65c2d71366bd899`
- AgentCertificate: `0x5033263fa038e991b384b78bcdafa2db4c1c81c082a7304c98a3f717d5749d6d`
- AgentPolicy: `0x2a7e2efc42937c8d0ddb3d39170faefaa543b9d4e79520c803a65bf9710f6843`
- Execute action tx: `7m4uyLa7sSYvJr2S6javDGBfbL4NrC6EQ2Da7raniccc`
- Revoke policy tx: `E8zrPEHzMEJyWKfsTqiEdED9yJVVdr2N179TpEw1hQp6`
- Post-revoke failure: expected abort code `8204`

Proof artifacts in this repo:

- [`testnet-proof-summary.json`](./testnet-proof-summary.json)
- [`local-evidence.json`](./local-evidence.json)
- [`policy-demo-timeline.html`](./policy-demo-timeline.html)
- [`live-judge-mode.html`](./live-judge-mode.html) — 12/10 judge mode: click through Grant → Execute → Revoke with the real testnet proof IDs.

## Run tests

From the repository root:

```bash
go test ./...
cd contracts/envd && sui move test && sui move build
```

## Local demo

The demo CLI builds deterministic intent/result hashes and `ActionEvidence` payloads without executing real shell commands or touching funds:

```bash
go run ./cmd/envd-policy-demo \
  --policy-id 0xpolicy_demo_local_20260508 \
  --action-kind shell_exec \
  --target-scope host:worker-1 \
  --command "echo demo-safe" \
  --target-host worker-1 \
  --gas-budget 5000
```

## Prior-work / originality disclosure

FractalMind had existing agent runtime and Sui identity foundations before Sui Overflow 2026. The hackathon submission focuses on the new Sui-native bounded-agent trust loop built and packaged during this sprint: `AgentPolicy`, `ActionExecuted` proof semantics, deterministic evidence runner/CLI, Sui testnet proof pack, revocation failure proof, public packaging PR #44, demo video assets, Live Judge Mode, and the protocol-first refactor that moved the policy primitive into `fractalmind-protocol`. Existing code is disclosed as the runtime foundation; the submitted differentiator is the new verifiable agent authorization and revocation layer on Sui.

## Mainnet deployment plan

No mainnet deployment or funds are required for the current testnet proof. If selected / awarded, the proposed mainnet path is:

1. **Week 1 — security and scope freeze**: freeze the `AgentPolicy` API and threat model; add branch coverage for expiry, max-use, gas limit, hash-length, org mismatch, and inactive certificate cases; run independent QA and public-boundary review.
2. **Week 2 — limited mainnet pilot**: deploy the policy package to Sui mainnet with no custody of user funds; enable only low-risk action evidence and revocation flows; publish owner revoke / emergency-disable runbooks.
3. **Post-pilot — composable agent actions**: add human-readable PTB preview and guardian risk checks; consider DeepBook/Walrus only after no-funds/testnet validation and explicit approval.

Risk boundary: no real-funds autonomous action until policy enforcement, guardian checks, revoke path, and audit logging are independently verified.

## Safety boundaries

- Testnet only.
- No mainnet deployment or funds operation is required for this MVP proof.
- The local demo hashes command intent/result summaries; it does not execute real shell commands.
