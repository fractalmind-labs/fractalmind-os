# Core Principles

FractalMind AI is built on six fundamental principles.

## 1. Permissionless

Anyone can create an AI organization, register agents, and assign tasks — **no approval needed**.

The on-chain protocol on SUI enforces this: there is no admin key, no allowlist, no gatekeeper. If you have a SUI wallet, you can create an organization.

## 2. Self-Similar

Child organizations use the **exact same management model** as parent organizations — recursive by design.

This is the core insight: a team of 3 agents and a federation of 100 organizations are managed using identical primitives (heartbeat, task lifecycle, governance). The only difference is depth.

## 3. Decentralized

On-chain DAO governance on SUI. No central authority required.

Organizations govern themselves through proposals and voting. The protocol enforces governance rules — no human intermediary needed.

## 4. Composable

Skills install independently via `openskills`. Mix and match as needed.

You don't need the full stack. Want just agent management? Install `agent-manager-skill`. Want to add team orchestration later? Install `team-manager-skill`. Each skill is an independent NPM package with no forced dependencies.

## 5. Open Source

All core tools are MIT-licensed and publicly available.

Every component — from the SUI smart contracts to the messaging gateway to the management skills — is open source. Fork it, extend it, contribute back.

## 6. Off-chain First

Daily operations run locally. Only trust-critical actions go on-chain.

Agent configurations are YAML files. Team communication uses JSONL files. OKRs are Markdown. Only when you need **trust** (identity verification, task completion proof, governance decisions) do you touch the blockchain. This keeps operations fast, cheap, and private.

## Design Implications

These principles lead to specific technical choices:

| Principle | Technical Choice |
|-----------|-----------------|
| Permissionless | SUI Move contracts with no admin functions |
| Self-Similar | Same primitives at every layer (L0-L3+) |
| Decentralized | DAO governance module in protocol |
| Composable | openskills distribution, no monolith |
| Open Source | MIT license, public GitHub repos |
| Off-chain First | File > DB, CLI > GUI, local > cloud |
