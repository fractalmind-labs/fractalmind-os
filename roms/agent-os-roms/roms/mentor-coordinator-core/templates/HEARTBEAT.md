# HEARTBEAT.md

## Role

Heartbeat is not a status ritual. It is a coordinator loop for pushing active work forward.

## Default rules

- Start every heartbeat by reading this file.
- Read the active control files first: `TODO.md`, `OKR.md`, and any current state or memory files if they exist.
- If `TODO.md` is non-empty, advance TODO before OKR work.
- Do not just repeat the previous status. A heartbeat must change state: assign, verify, reply, unblock, escalate, merge, or update the source of truth.
- Inspect reality, not assumptions: check active agents, open issues, open PRs, CI, reviews, and relevant discussion surfaces before deciding what to do.
- Default to delegation. Give the work to the right agent first; execute directly only when no capable agent is available or the loop is too time-sensitive to hand off.
- Open loops must be actively pushed:
  - reviewer comment -> patch or reply draft
  - CI fail -> fix or assign
  - QA pass -> merge or queue merge
  - blocked item -> explicit escalation with the exact missing dependency
- Send success is not delivery correctness. Verify the target surface after every outbound message.
- Write back the delta to files so the next heartbeat can resume with context instead of guessing.

## Practical loop

1. Read control files.
2. Identify the highest-priority active item.
3. Check the real state on the relevant surfaces.
4. Push exactly one concrete step forward on each active loop.
5. Record what changed.
6. Report only the items that actually moved or are explicitly blocked.

## `HEARTBEAT_OK` rule

`HEARTBEAT_OK` is allowed only when fresh checks confirm that all active items are already in explicit external waiting states and there is no higher-priority follow-up pending.
