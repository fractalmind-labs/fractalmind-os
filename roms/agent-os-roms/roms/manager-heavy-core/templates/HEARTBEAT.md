# HEARTBEAT.md

## Top-Level Constraint
- All execution, judgment, reporting, and `HEARTBEAT_OK` decisions must follow `SOUL.md`; if there is tension, `SOUL.md` wins.

## Reading Order
1. Read this file first; act only on fixed rules and current execution surfaces here.
2. Read `TODO.md`.
3. The current execution surface is maintained through `TODO.md`; if `TODO.md` has ACTIVE / in-progress items, push TODO before other OKRs.
4. When you need objective/acceptance details, read `OKR.md` and the canonical tracker.

## Fixed Rules
- Approval items: once confirmed, immediately reach out to the operator; don't just write a local file.
- Milestone progress: when an ACTIVE item reaches a reviewable milestone, proactively report it.
- ACTIVE OKR KR / milestone / PR merge / deploy / validation / execution-stall changes must be reported with `formal blocker` + `execution stalled` + evidence.
- Every PR must have assigned local QA with explicit `QA Verdict: PASS` before merge.
- Default dual-layer reporting: `formal blocker status` + `execution stalled status`.
- Heartbeat must not degrade into passive polling. If `TODO.md` has ACTIVE / in-progress work, push at least one step or fresh-sweep and prove explicit external wait.
- At the end of every heartbeat, evaluate load using `.agent/skills/turbo-frequency/rules/heartbeat.md` if installed; otherwise record a manual frequency decision in `memory/heartbeat-state.json`.

## HEARTBEAT_OK Gate
Before returning `HEARTBEAT_OK`, check each ACTIVE / in-progress item:
1. Is it in an explicit external wait state?
2. Are there any internal actions I can take this round?
3. Have I completed a fresh sweep confirming "no new changes + no actionable internal work"?

Only when all are satisfied (`1=yes, 2=no, 3=yes`) may you return `HEARTBEAT_OK`.

## Current Execution Focus
- (empty — add current ACTIVE/TODO focus here)

## Fixed Escalation Templates

### Template A: Approval
```text
[Approval] {OKR/item}
Decision needed: {specific decision}
Why now: {what stops without this decision}
Options:
1. {Option A} — {impact/tradeoff}
2. {Option B} — {impact/tradeoff}
Recommendation: {recommended option + reason}
Needed by: {operator timezone; or "as soon as convenient"}
If no response: I will remind at 1h, 4h, 4h intervals
```

### Template B: Blocker
```text
[Blocker] {OKR/item} — Issue #{number}
Current blocker: {one sentence}
Attempts:
1. {Attempt A} -> {result / why failed}
2. {Attempt B} -> {result / why failed}
3. {Attempt C} -> {result / why failed}
Decision/resource needed: {what the operator must decide/provide}
If no response: I will remind at 1h, 4h, 4h intervals
```

## Execution / Verification Discipline
- ACTIVE TODO items should be advanced every heartbeat unless explicitly external-wait.
- Assignment is not progress; verify fresh output (tmux, transcript, issue/PR comment, artifact, CI, deploy/readback).
- If an agent transcript/tmux does not update for too long, treat it as stuck/dead and recover before continuing.
- If an ACTIVE thread gets a new reply, hot-scan it; do not mechanically wait for the next heartbeat.

## TODO Maintenance
- `TODO.md` keeps current execution only, not history.
- Move completed/invalidated items to memory, issue/PR, or archive.
- If an item is external-wait, say who/what it waits for.

## Per-Heartbeat Checklist
- [ ] Read `TODO.md` current execution surface.
- [ ] Check related issue / PR / CI / deploy / agent fresh evidence.
- [ ] Check `memory/heartbeat-state.json.pendingDecisions`.
- [ ] If approval/blocker reminder is due, notify before considering `HEARTBEAT_OK`.
- [ ] Record fresh conclusions in `memory/YYYY-MM-DD.md` or state JSON.
- [ ] Structure check: `OKR.md` ACTIVE <= 3, no non-ACTIVE residue; `HEARTBEAT.md` no history creep.
- [ ] Run/record turbo-frequency evaluation.
