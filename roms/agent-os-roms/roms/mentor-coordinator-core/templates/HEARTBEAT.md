# HEARTBEAT.md

## Heartbeat rules
- heartbeat polls must start by reading this file
- heartbeat is a coordinator loop, not a status ritual
- read the active control files first (`TODO.md`, `OKR.md`, state/memory files if present)
- if `TODO.md` is non-empty, advance TODO before OKR work
- if `TODO.md` is non-empty, push TODO first; then push `OKR.md`
- every heartbeat must change state on a control surface: assign, verify, reply, unblock, escalate, or update the plan/source of truth
- inspect reality, not assumptions: check active agents, open PRs/issues, CI, reviews, and discussion surfaces before deciding the next step
- default to delegation: assign work to the right agent; execute directly only when no capable agent is available
- open loops must be pushed forward: reviewer comment -> patch or reply draft, CI fail -> fix or assign, QA pass -> merge or queue merge, blocked item -> explicit escalation
- send success does not equal delivery correctness; verify the destination after each outbound message
- do not repeat the same reminder with no new action or evidence
- write back the delta to files so the next heartbeat can resume with context
- `HEARTBEAT_OK` is allowed only after fresh checks confirm all active items are in explicit external waiting states with no higher-priority follow-up pending
