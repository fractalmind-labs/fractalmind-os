# FractalMind Agent CLI

Use `fm` only with an Agent Operator grant for the organization in question.
Start with `fm auth status`, `fm whoami`, then read the on-chain state with
`org show`, `okr list`, `host list`, `agent list`, `run list`, and `approval
list`. Every read rechecks the live chain grant; a cached response is marked
`stale_since` and is never authorization.

For a write that can spend SUI, always run the exact command with `--dry-run`
first. A dry run prints the fee quote, digest, exact effect, and the Agent
trail, and broadcasts nothing. Real writes accept `--request-id <id>` and
`--max-fee <SUI>` (default `0.05`). Keep the request ID when retrying: the CLI
queries the durable original digest and never re-submits it.

The operational write available in this protocol build is:

```
fm run pause <run-id> --dry-run --request-id <stable-id>
fm run pause <run-id> --request-id <same-stable-id> --max-fee 0.05
```

It requires an unrevoked on-chain READ+OPERATE Agent Operator grant. Output
always identifies the action as `由 Agent 代为操作` with the grant ID and
Agent label.

`fm agent message <agent-or-instance> <text>` creates the App-compatible,
encrypted direct `ask` message. It also needs a human-created standing
permission for that target and an organization-key envelope shared to this
Agent. If either is absent, it exits `8`; configure it in the App and retry
with the same operation only after the human action is visible on chain.

Use the command catalogue in `fm schema --json` for OKR draft, KR progress,
evidence, direct-message, and approval-request syntax. Never try to activate
an OKR or approve a request: those are human decisions.

Exit `8` means `needs_approval`. Read its JSON `approval` and `how_to_file`
fields, hand the request to a human with an APPROVE grant in the App, and do
not retry it as an Agent. In this deployment, generic approval records and
OKR draft writers require APPROVE on-chain, so the CLI deliberately returns
exit 8 rather than simulating a record or using a human key. `9` means the
quoted fee is above `--max-fee`; `10` means a stale revision, pending gas
reservation, or other conflict—refresh state and use a new request ID only
after the original request has been resolved.

Exit codes: `0` ok, `2` usage, `3` needs funding, `4` not authorized, `5`
revoked or expired, `6` chain unreachable, `7` not found, `8` needs human
approval, `9` fee exceeds limit, `10` conflict. Errors are JSON on stderr.
