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

The bounded operational writes available in this protocol build are:

```
fm run pause <run-id> --dry-run --request-id <stable-id>
fm run pause <run-id> --request-id <same-stable-id> --max-fee 0.05
fm okr draft create --file <draft.json> --dry-run --request-id <stable-id>
fm approval request <kind> --title <title> --body <body> --dry-run --request-id <stable-id>
```

They require an unrevoked on-chain READ+OPERATE Agent Operator grant. Output
always identifies the action as `由 Agent 代为操作` with the grant ID and
Agent label.

`fm okr draft create` creates only an immutable `DRAFT`; its JSON must include
`priority`, `deadlineMs`, and 1–3 `krs` with decimal-string `baseline`,
`target`, `weight`, and `maxAgeMs`. The draft body is encrypted with the
Agent's grant envelope. `fm okr show <id>` decrypts and displays that body.
`fm okr draft update <id>` never mutates a draft: it retries the same logical
proposal and the chain rejects changed content. A human must review and make
any replacement or activation.

`fm approval request` files an encrypted, pending request under the reserved
`agent-request:` namespace. It is not an approval decision. `fm approval show
<id>` decrypts the request. A human with APPROVE must make every decision.

`fm agent message <agent-or-instance> <text>` creates the App-compatible,
encrypted direct `ask` message. It also needs a human-created standing
permission for that target and an organization-key envelope shared to this
Agent. If either is absent, it exits `8`; configure it in the App and retry
with the same operation only after the human action is visible on chain.

Use the command catalogue in `fm schema --json` for OKR draft, KR progress,
evidence, direct-message, and approval-request syntax. Never try to activate
an OKR or approve a request: those are human decisions.

Exit `8` means `needs_approval`: a required human-governed prerequisite (for
example a direct-message standing permission) is absent. It never means that
the CLI may substitute a human key. `9` means the quoted fee is above
`--max-fee`; `10` means a stale revision, pending gas reservation, immutable
draft conflict, or other conflict—refresh state and use a new request ID only
after the original request has been resolved.

Exit codes: `0` ok, `2` usage, `3` needs funding, `4` not authorized, `5`
revoked or expired, `6` chain unreachable, `7` not found, `8` needs human
approval, `9` fee exceeds limit, `10` conflict. Errors are JSON on stderr.
