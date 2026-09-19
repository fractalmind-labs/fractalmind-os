# Pitch One-pager — FractalMind Agent OS on Sui

## Track

The Agentic Web

## Thesis

The winning agent stack will not be the one that lets agents do anything. It will be the one that makes agent authority explicit, bounded, revocable, and verifiable.

## What is built

A Sui Move policy layer for AI agents:

- `AgentPolicy`: shared policy object with org, owner, agent, action kind, target scope, max uses, expiry, max gas, and revoked state.
- `ActionExecuted`: typed event recording policy-bound action evidence with canonical intent/result hashes.
- Go client/demo runner: deterministic evidence builder and CLI.
- Testnet proof-pack: create policy, execute action, revoke policy, prove post-revoke failure.
- Screenshot-ready timeline fallback for judging.

## Why it is differentiated

Most agent demos are LLM wrappers. This demo uses Sui for the safety-critical part: the authorization boundary.

## Proof

- Testnet package: `0x6766c03da91b2579f05be82c2f149a28363fd8cdee052afd41eddf0fd3093fce`
- Execute tx: `7m4uyLa7sSYvJr2S6javDGBfbL4NrC6EQ2Da7raniccc`
- Revoke tx: `E8zrPEHzMEJyWKfsTqiEdED9yJVVdr2N179TpEw1hQp6`
- Post-revoke abort: `8204`
- QA: `QA Verdict: PASS`

## Roadmap

1. Add explorer policy/action timeline as the primary UI.
2. Add PTB preview and richer guardian classes.
3. Add DeepBook or budgeted on-chain action variants for an autonomous-wallet track extension.
4. Publish a demo video under 3 minutes.
