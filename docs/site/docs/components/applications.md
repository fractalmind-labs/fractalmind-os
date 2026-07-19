# Applications

Applications are user-facing clients of the authority and execution planes. They present workflows, create signed intents, and display durable results. They do not become the authority source themselves.

## Agent Console

Agent Console is the operator application for discovering nodes and agents, viewing state, and requesting bounded privileged actions. The target architecture replaces bearer/direct-local control with short-lived signed intents that name the action, target, scope, command identity, and limits.

## envd-desktop

envd-desktop provides remote desktop media and input workflows. View and control are separate scopes with explicit expiry and revocation behavior.

Screen frames, audio, clipboard contents, and input events stay off-chain and flow through encrypted data paths. The chain carries authority state, not media streams.

## Channel and Automation Clients

fractalbot-backed agents, CLIs, and domain applications can use the same signed-intent contract. A Slack or Telegram identity may identify the requester to an application, but the target still verifies the resulting authority envelope.

## oh-my-code

[oh-my-code](https://github.com/fractalmind-ai/oh-my-code) is the reference local workspace for heartbeat, memory, OKR, and team coordination. Its local governance loop is separate from remote node authority.

## Application Rules

1. Never treat a relay, bearer token, or channel session as sovereign authority.
2. Show the target, action, scope, expiry, and material limits before signing.
3. Distinguish pending, completed, rejected, and result-unavailable states.
4. Fail closed for high-risk actions when freshness or durable replay evidence is unavailable.
5. Keep raw logs, files, media, input, and high-frequency telemetry off-chain.

See [Data Flow](/architecture/data-flow) for the full command lifecycle.
