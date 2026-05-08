# FractalMind Agent OS on Sui

Sui Overflow 2026 track: **The Agentic Web**

FractalMind Agent OS on Sui lets a human grant an AI agent bounded, revocable authority through a Sui Move policy object, then verify the agent's action evidence on-chain.

![FractalMind Agent OS on Sui logo](../../assets/sui-overflow-2026/fractalmind-agent-os-logo.svg)

## Problem

Autonomous agents can already receive tasks and execute remote actions, but judging whether an action was authorized, bounded, and revocable is usually hidden in off-chain logs or centralized servers. That is not enough for agents that act across wallets, machines, and organizations.

## Solution

This MVP makes agent authority explicit as Sui objects:

1. A human creates an organization and registers an agent identity.
2. The human creates an `AgentPolicy` object that limits one agent by action kind, target scope, max uses, expiry, and gas budget.
3. The agent emits canonical intent/result hashes through `policy::execute_action`.
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

FractalMind builds on existing `fractalmind-ai` agent runtime and Sui identity work. The bounded `AgentPolicy` / `ActionExecuted` MVP, deterministic evidence runner, CLI demo, Sui testnet proof-pack, revocation demonstration, and submission materials were built during the Sui Overflow 2026 sprint. Existing code is disclosed as foundation/runtime context; the submitted differentiator is the new Sui-native bounded agent policy and verifiable remote-action proof.

## Safety boundaries

- Testnet only.
- No mainnet deployment or funds operation is required for this MVP proof.
- The local demo hashes command intent/result summaries; it does not execute real shell commands.
