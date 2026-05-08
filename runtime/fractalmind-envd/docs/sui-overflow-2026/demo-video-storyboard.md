# Demo Video Storyboard — FractalMind Agent OS on Sui

Target length: 2:45–3:00

## Goal

Show judges that Sui is the safety-critical layer for autonomous AI agents: delegation is bounded by a Move object, action evidence is typed and on-chain, and human revocation is enforced by Sui.

## Required capture assets

- Terminal capture of local demo CLI generating deterministic evidence.
- Sui explorer / CLI readback for:
  - package `0x6766c03da91b2579f05be82c2f149a28363fd8cdee052afd41eddf0fd3093fce`
  - policy `0x2a7e2efc42937c8d0ddb3d39170faefaa543b9d4e79520c803a65bf9710f6843`
  - execute tx `7m4uyLa7sSYvJr2S6javDGBfbL4NrC6EQ2Da7raniccc`
  - revoke tx `E8zrPEHzMEJyWKfsTqiEdED9yJVVdr2N179TpEw1hQp6`
  - post-revoke abort `8204`
- Timeline fallback HTML: [`policy-demo-timeline.html`](./policy-demo-timeline.html).
- README / one-pager screen for final call-to-action.

## Scene plan

### 0:00–0:15 — Hook

Visual: project title and one-line thesis.

Voice: "Autonomous agents should not rely on prompt promises for safety. FractalMind Agent OS puts agent authority into a bounded, revocable Sui Move policy object."

### 0:15–0:40 — Why Sui

Visual: four-object diagram or timeline: Organization → AgentCertificate → AgentPolicy → ActionExecuted.

Voice: "Sui is not just a payment rail here. The Move object model holds the authorization boundary, the typed event holds action evidence, and revocation is enforced on-chain."

### 0:40–1:15 — Create policy

Visual: policy fields: owner, org, agent, action kind `shell_exec`, target scope `host:worker-1`, max uses, expiry, gas budget, and testnet policy id.

Voice: "A human creates a policy that grants exactly one agent a narrow action scope, with max usage, expiry, and gas ceiling."

### 1:15–1:55 — Execute action evidence

Visual: demo CLI / local evidence JSON, execute tx `7m4u...iccc`, intent hash, and result hash.

Voice: "The off-chain command/result stays local. Sui receives canonical hashes plus policy context, so the action can be audited without leaking private machine output."

### 1:55–2:25 — Revoke / human override

Visual: revoke tx `E8zr...hQp6` and post-revoke retry failure with abort `8204`.

Voice: "When the owner revokes the policy, the same agent can no longer record an action under it. That is the human override path, enforced by Move."

### 2:25–2:50 — Judge close

Visual: proof summary and QA PASS.

Voice: "The MVP is already on Sui testnet with local evidence, raw tx artifacts, and QA PASS. Next steps are explorer integration, richer guard classes, and public submission."

## Recording checklist

- [ ] Use only testnet proof; no mainnet/funds.
- [ ] Do not show secrets, private keys, env files, or private chat pages.
- [ ] Keep final video under 3 minutes.
- [ ] Add resulting URL to the DeepSurge `Demo Video` field before final submission.
