---
name: okr-manager
description: OKR lifecycle management for AI agents. Use when creating, reviewing, updating, or reporting on OKRs. Ensures every OKR has measurable Success Criteria, result-oriented KRs with dependencies, and clear completion standards.
---

# OKR Manager

A skill for AI agents to manage OKR (Objectives and Key Results) lifecycle — from creation to completion.

## When to Use

- Your human assigns a new objective or goal
- Creating or restructuring an OKR in your OKR file
- Reviewing existing OKRs for completeness
- Heartbeat/periodic audit: checking if any OKR lacks completion standards
- Reporting OKR status to your human or team

## Configuration

This skill works with any markdown-based OKR file. Set these in your workspace:

| Config | Default | Description |
|--------|---------|-------------|
| OKR file path | `OKR.md` | Where OKRs are stored |
| Language | `en` | Primary language for OKR content (`en`, `zh`, etc.) |
| Status markers | `PENDING / IN PROGRESS / COMPLETE` | KR status labels |
| Priority markers | `P0 / P1 / P2` | Priority levels |

## OKR Creation Checklist

Every OKR MUST have ALL of these. Reject or flag any OKR missing items.

### 1. Objective (1 sentence)
- Starts with a verb (Build / Implement / Complete / Deliver)
- Describes the **outcome**, not the activity
- Bad: "Do orderbook development" / Good: "Complete orderbook development, testing, and launch"

### 2. Success Criteria (1-3 bullets, quantifiable)
- Must be binary verifiable: done or not done
- Must include at least ONE measurable metric
- Template: **"Complete {N} {specific actions} in {environment}, verify {specific metric}"**
- Examples:
  - "Complete 1 gasless transaction on TestNet"
  - "Third-party PR 24h first-response rate >= 95%"
  - "E2E test pass rate 100%, matching latency < 500ms"

### 3. Key Results (KR1 → KR2 → ... → KRn)
Each KR must have:
- **Outcome statement**: Describe an observable result, not an implementation action
- **Status**: PENDING / IN PROGRESS / COMPLETE
- **Dependency**: Explicit prerequisite KRs (e.g., KR1 → KR2)
- **Deliverable**: Concrete output (PR / Issue / Document / Deployment)
- **Verification**: How to prove completion (CI green / QA PASS / test passed)

### 4. Tasks / Milestones (recommended)
- Use Tasks / Milestones for execution order, owners, and unblock steps
- Good task examples: "Run k6 and attach report", "Backfill missing receipt checks", "Ask human to approve cutoff"
- Tasks support KRs; they must not replace KRs

### 5. Priority + Owner
- Priority: P0 (must do) / P1 (important) / P2 (nice to have)
- Owner: Who drives this (me / @teammate / Team X)

### 6. Deadline (optional but recommended)
- If there's a deadline, state it
- If not, state the expected completion timeframe

## OKR Quality Validation

Run this check when creating or reviewing OKRs:

```
[ ] Objective is outcome-oriented (not activity description)?
[ ] Success Criteria has quantifiable metric?
[ ] Success Criteria is binary verifiable (done/not done)?
[ ] Every KR has a clear status marker?
[ ] Every KR is result-oriented instead of task-oriented?
[ ] KR dependencies are explicit?
[ ] Tasks / milestones are separated from KRs when execution detail is needed?
[ ] Every KR has a concrete deliverable?
[ ] Priority is marked?
[ ] Owner is assigned?
```

Missing any item → fix before writing to the OKR file. Do not allow incomplete OKRs.

## OKR Template

```markdown
### OKR {Name} ({date}) — ACTIVE {priority_emoji} {priority}

**Owner**: {owner}

#### Objective
{1 sentence, verb + outcome}

#### Success Criteria
**{quantifiable completion statement}**

#### Key Results

> **Dependency order**: KR1 → KR2 → ... → KRn

**KR1: {title}** — {status}
- Deliverable: {what is produced}
- Outcome: {observable change when KR is complete}
- Verification: {how to prove done}

**KR2: {title}** — {status}
- Deliverable: {what is produced}
- Depends on: KR1
- Outcome: {observable change when KR is complete}
- Verification: {how to prove done}

#### Tasks / Milestones (recommended)
- [ ] {execution step tied to KR1 / owner / dependency}
- [ ] {execution step tied to KR2 / owner / dependency}
```

## OKR Lifecycle

```
Human assigns objective
    ↓
[Create OKR] → Use this skill to ensure checklist passes
    ↓
[Write to OKR file] → Confirm Success Criteria + KRs are complete
    ↓
[Human confirms] → If issues, iterate and fix
    ↓
[Execute & Track] → Each heartbeat/check-in: review progress, push forward
    ↓
[KR Complete] → Update status, notify human
    ↓
[Success Criteria met] → Mark OKR as ACHIEVED
```

## Operations

### Creating an OKR

1. Parse the human's objective into a clear, verb-first Objective statement
2. Draft measurable Success Criteria (what does "done" look like?)
3. Draft sequential, result-oriented KRs with dependencies
4. Add Tasks / Milestones if execution needs staging, owner mapping, or unblock steps
5. Validate against the checklist above
6. Write to OKR file
7. Confirm with human

### Updating KR Status

When a KR completes:
1. Update status: `PENDING` → `IN PROGRESS` → `✅ COMPLETE`
2. Add completion evidence (PR number, CI link, test results)
3. Check if downstream KRs are now unblocked
4. If all KRs complete → check Success Criteria → mark OKR ACHIEVED

### Heartbeat OKR Audit

During periodic check-ins:
1. Read the OKR file
2. For each ACTIVE OKR:
   - What KR is currently in progress?
   - Is anything blocked? For how long?
   - What's the next action?
3. Report summary to human (only if there are changes or blockers)
4. Push forward: assign tasks, trigger CI, follow up on blockers

### Reporting Status

Format for status reports:
```
[OKR Status]
• {OKR Name}: KR{n}/{total} — {current KR title} ({status})
• {OKR Name}: KR{n}/{total} — {current KR title} ({status})
Blockers: {list or "none"}
```

## Priority Emojis

| Priority | Emoji | Meaning |
|----------|-------|---------|
| P0 | 🔴 | Must do — blocks everything else |
| P1 | 🟡 | Important — do this week |
| P2 | 🟢 | Nice to have — do when capacity allows |

## Common Anti-patterns (Avoid)

1. **Vague completion standards**: "launch" "improve" "optimize" — must quantify
2. **Missing verification**: KR says what to do but not how to prove it's done
3. **Task masquerading as KR**: "build agent manager" / "integrate Slack" — move this into Tasks / Milestones
4. **KR too large**: Single KR contains multiple independent pieces of work → split it
5. **No priority**: All OKRs appear equally important → must rank
6. **Passive voice**: "wait for deploy" "wait for confirmation" → change to active: "trigger deploy" "verify completion"
7. **No owner**: Nobody is accountable → every OKR needs an owner
8. **Stale OKRs**: OKR status not updated for >1 week → audit and update or archive
