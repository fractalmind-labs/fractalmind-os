# HEARTBEAT.md

## Top-Level Constraint
- All execution, judgment, reporting, and HEARTBEAT_OK decisions must follow `SOUL.md` first; if there is tension, `SOUL.md` is the superior constraint.

## Reading Order
1. Read this file first; only act on the current execution surfaces listed here
2. Read `TODO.md`
3. If `TODO.md` is non-empty, push TODO items before OKR work
4. When you need objective/acceptance details, read `OKR.md` and the canonical tracker

## Fixed Rules
- Approval items: once confirmed, immediately reach out to your human; don't just write a local file
- Milestone progress: when an ACTIVE item reaches a reviewable milestone, proactively report it
- Every PR must have assigned local QA with an explicit PASS before merge
- Default dual-layer reporting: `formal blocker status` + `execution stall status`

## HEARTBEAT_OK Gate
- Before returning `HEARTBEAT_OK`, check each ACTIVE item / active surface against 3 criteria:
  1. Is it in an explicit external wait state?
  2. Are there any internal actions I can take this round?
  3. Have I completed a fresh sweep confirming "no new changes + no actionable internal work"?
- Only when ALL are satisfied (`1=yes, 2=no, 3=yes`) may you return `HEARTBEAT_OK`

## Current Execution Surfaces
- (empty — add your active work items here)
