# 3-minute Demo Script — FractalMind Agent OS on Sui

## 0:00–0:20 — Hook

"AI agents are getting powerful enough to act on wallets and machines. The missing piece is not more autonomy — it is bounded, revocable, verifiable autonomy. FractalMind Agent OS puts that boundary on Sui."

Show: title slide / timeline artifact.

## 0:20–0:55 — Object model

Explain the objects:

- Organization: the human-controlled trust domain.
- AgentCertificate: the on-chain identity of an agent.
- AgentPolicy: the bounded delegation object.
- ActionExecuted: the audit trail of an agent action.

Show testnet IDs from the proof summary.

## 0:55–1:35 — Create policy

Show `PolicyCreated` proof:

- policy allows exactly `shell_exec`
- target scope is `host:worker-1`
- max uses: `2`
- gas budget: `5000`
- expiry set on-chain

Narration: "This is not an LLM promise. These are Move checks."

## 1:35–2:10 — Execute bounded action

Show `execute_action` tx:
`7m4uyLa7sSYvJr2S6javDGBfbL4NrC6EQ2Da7raniccc`

Show local evidence:

- intent hash: `0x16da140a1740f90e1defbadb6a541f7c905b4ab08663e3070a1224ab073559d1`
- result hash: `0x0309dfd2aeb7dc29379de7dfba70d47ece0adcb10e58a2273e6c0e37dee09b1a`

Explain: "The private command/result stays local; Sui stores typed, verifiable hashes and policy context."

## 2:10–2:40 — Human override / revoke

Show revoke tx:
`E8zrPEHzMEJyWKfsTqiEdED9yJVVdr2N179TpEw1hQp6`

Show post-revoke retry failure:
`abort code 8204`.

Narration: "After revocation, the same agent cannot record the same action under this policy. The override is enforced by Move."

## 2:40–3:00 — Why it can win Agentic Web

Close with:

- Sui is central to authorization, audit, composability, and safety.
- The demo is already on testnet with QA PASS.
- Next steps: explorer UI, PTB preview, richer guard classes, and public submission.
