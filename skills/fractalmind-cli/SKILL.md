# FractalMind Agent CLI

Use `fm` when an authorized Agent needs a read-only, fresh on-chain view of
one FractalMind organization. Start with `fm auth status` and `fm whoami`;
then use `org show`, `okr list`, `host list`, `agent list`, `run list`, and
`approval list` for the relevant directory. `fm schema --json` is the
machine-readable command and error-code contract. `fm events --follow --json`
polls organization-related chain events and prints one JSON value per line.

Pair a new machine with `fm auth login --org <name-or-id>`. It creates an
Agent-owned key in the system secret store and displays a public six-digit
comparison code; the human must check and approve that code in the App. On
localnet only, `--faucet` can fund the new Agent address. A zero balance exits
with code 3 and never sends a pairing transaction.

Approvals, authorization changes, host management, recovery, and spending are
always the human's responsibility in the App. This P1 CLI has no command that
approves or operates on-chain; `auth login` is its sole transaction.

Exit codes: `0` ok, `2` usage, `3` needs funding, `4` not authorized, `5`
revoked or expired, `6` chain unreachable, `7` not found. Errors are JSON on
stderr. A cached value, when available after a successful fresh authorization,
is marked `stale_since`; cache never authorizes a grant.
