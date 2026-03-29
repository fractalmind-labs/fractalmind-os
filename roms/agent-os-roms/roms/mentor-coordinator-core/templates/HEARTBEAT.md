# HEARTBEAT.md

## Heartbeat rules
- heartbeat polls must start by reading this file
- if `TODO.md` is non-empty, push TODO first; then push `OKR.md`
- a heartbeat must advance a control surface: assign, verify, report, or unblock
- `HEARTBEAT_OK` is allowed only after fresh checks confirm all active items are in explicit external waiting states
- send success does not equal delivery correctness; verify the destination after each outbound message
