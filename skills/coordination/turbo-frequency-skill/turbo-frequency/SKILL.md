---
name: turbo-frequency
description: Dynamic heartbeat frequency adjustment for AI agent workspaces. Like CPU turbo boost — speeds up polling when busy (5 min), slows down when idle (4 hours). Invoke at the end of each heartbeat to auto-tune the next interval based on workload signals.
license: MIT
allowed-tools: [Read, Write, Edit, Bash]
---

# Turbo Frequency

## Overview

Dynamically adjusts your agent's heartbeat (cron) frequency based on real-time workload signals.

**Concept:** Like CPU turbo boost — poll frequently when there's active work, slow down when everything is idle. Saves resources without missing events.

## Frequency Tiers

| Tier | Interval | Cron | Trigger |
|------|----------|------|---------|
| TURBO | 5 min | `*/5 * * * *` | Active deployment, agent errors, CI failures |
| HIGH | 10 min | `*/10 * * * *` | Agents executing tasks, PRs in QA pipeline |
| MEDIUM | 30 min | `*/30 * * * *` | Pending decisions, queued tasks |
| LOW | 1 hour | `0 * * * *` | All idle, no pending work |
| IDLE | 2 hours | `0 */2 * * *` | Quiet hours (23:00-08:00) + all idle |
| SLEEP | 4 hours | `0 */4 * * *` | Deep night + zero activity + no pending decisions |

## Signal Evaluation

Read signals from multiple sources and compute a busyness score (0-100).

### Signal Sources

1. **`tmux list-sessions`** — **primary signal**: live agent session count (takes priority over JSON `activeAgentTasks`)
2. **`memory/heartbeat-state.json`** — deployWatch, pendingDecisions, queuedTasks, lastNudge, lastHumanMessage
3. **Current time** — automatic quiet-hours reduction
4. **Recent human activity** — lastNudge or lastHumanMessage within 15 minutes

### Scoring Rules

Accumulate scores, clamp to 0-100:

| Signal | Score | Condition |
|--------|-------|-----------|
| Active deployment | +40 | `deployWatch.status == "in-progress"` |
| Agent active tasks | +30 | tmux shows running agent sessions (primary) or any non-`idle` value in `activeAgentTasks` (fallback). **tmux takes priority** over the JSON field. |
| Recent human interaction | +25 | `lastNudge` or `lastHumanMessage` timestamp is within the last 15 minutes |
| tmux active sessions | +25 | `tmux list-sessions 2>/dev/null` has agent sessions (overlaps with agent active tasks; do not double-count) |
| Pending decisions | +20 | `pendingDecisions` array is non-empty |
| Queued tasks | +15 | `queuedTasks` array is non-empty |
| Deploy awaiting review | +10 | `deployWatch.status == "awaiting-review"` |
| Quiet hours | -30 | Current time is 23:00-08:00 (configurable) |

### Score-to-Tier Mapping

```
score >= 60  →  TURBO   (*/5 * * * *)
score >= 40  →  HIGH    (*/10 * * * *)
score >= 20  →  MEDIUM  (*/30 * * * *)
score >= 10  →  LOW     (0 * * * *)
score >= 1   →  IDLE    (0 */2 * * *)
score  = 0   →  SLEEP   (0 */4 * * *)
```

## Execution Steps

**Run these steps at the end of each heartbeat, after all work is done:**

### Step 1: Check Manual Override

Read `turboFrequency.manualOverride` from `memory/heartbeat-state.json`. If present and not expired, skip auto-adjustment.

### Step 2: Read Signals

```bash
# Primary signal: query tmux for live agent sessions
tmux list-sessions 2>/dev/null | grep -c 'agent-'

# Secondary: read heartbeat state (deployWatch, pendingDecisions, etc.)
cat memory/heartbeat-state.json
```

**Important:** tmux session count is the **ground truth** for agent activity. If tmux shows 3 running agent sessions but `activeAgentTasks` in JSON says all idle, trust tmux. The JSON field may be stale.

### Step 3: Compute Busyness Score

Accumulate scores using the rules above. This is a mental calculation — no script needed.

**Example:**
```
deployWatch.status = "awaiting-review"  → +10
tmux: 1 running agent session          → +30 (primary signal)
pendingDecisions: 1 item               → +20
lastNudge: 8 minutes ago               → +25 (human active)
Quiet hours (02:00)                     → -30
─────────────────────────────────────────
Total: 55  →  HIGH (*/10 * * * *)
```

### Step 4: Determine If Change Is Needed

Compare current tier (`turboFrequency.currentTier`) with the computed target tier:

- **No change**: Increment `turboFrequency.unchangedCount`. If `unchangedCount >= 3`, skip crontab sync (avoid redundant writes). Only update the score.
- **Tier changed**: Apply the **upgrade cap** and **downgrade cooldown** rules below, then continue to Step 4.5.

**Upgrade cap (max 2 tiers up per evaluation):**
When upgrading, the tier can move at most **2 levels up** per evaluation. The tier order is: SLEEP → IDLE → LOW → MEDIUM → HIGH → TURBO. Example: if current tier is SLEEP and score warrants TURBO, set target to LOW (2 levels up). The next heartbeat evaluation can then move to HIGH or TURBO. This prevents jarring jumps from deep sleep to full turbo.

**Downgrade cooldown (30 minutes after upgrade):**
After any tier **upgrade** (i.e., `changedAt` records an upward change), the tier cannot downgrade for **30 minutes**. If the cooldown period is still active and the computed tier is lower than the current tier, keep the current tier. This prevents oscillation after a deployment finishes or an agent completes its task. Upward changes are always allowed even during cooldown.

### Step 4.5: Cron/Tier Consistency Check

Before writing the config, verify that the **actual cron expression** in the agent's config file (e.g., `AGENTS.md` frontmatter) matches what `turboFrequency.cron` claims:

```bash
# Read the actual cron from the config
grep 'cron:' AGENTS.md
```

If they differ (e.g., someone manually edited the cron, or a previous sync failed), **force-sync to the computed tier's cron**. This ensures the heartbeat interval always matches the tier, even after manual edits or failed writes.

- **Mismatch detected**: Log a warning `[turbo] cron mismatch: config has "*/10 * * * *" but state says "*/30 * * * *", force-syncing`, then proceed to Step 5 with the correct cron.
- **Match confirmed**: Proceed normally.

### Step 5: Update Heartbeat Config

Use the **Edit tool** to modify the `cron:` line in your agent's config file (e.g., `AGENTS.md` frontmatter YAML):

```
old_string: '  cron: "*/10 * * * *"'
new_string: '  cron: "*/30 * * * *"'
```

**Important:** Only modify the `cron:` line under `heartbeat:`. Do not touch other config.

### Step 6: Sync to Crontab

If your workspace uses agent-manager for cron sync:

```bash
python3 .agent/skills/agent-manager/scripts/main.py heartbeat sync
```

Or use your own crontab sync mechanism.

### Step 7: Record the Change

Update `memory/heartbeat-state.json` with the `turboFrequency` field:

```json
{
  "turboFrequency": {
    "currentTier": "MEDIUM",
    "cron": "*/30 * * * *",
    "score": 30,
    "changedAt": "2026-03-06T02:00:00Z",
    "lastUpgradeAt": "2026-03-06T01:30:00Z",
    "reason": "tmux: 1 agent session (+30) + awaiting-review deploy (+10) + human active 8m ago (+25) - nighttime (-30) = 35 → capped at MEDIUM (was SLEEP, max +2 tiers)",
    "unchangedCount": 0
  }
}
```

Field reference:
- `currentTier`: Current tier name
- `cron`: Current cron expression
- `score`: Latest computed busyness score
- `changedAt`: Last tier change timestamp (ISO 8601)
- `lastUpgradeAt`: Last **upward** tier change timestamp (ISO 8601). Used for downgrade cooldown (30 min).
- `reason`: Brief explanation of why this tier was selected
- `unchangedCount`: Consecutive unchanged count (used to skip redundant sync)
- `manualOverride` (optional): `{ "tier": "HIGH", "until": "2026-03-06T12:00:00Z" }` — lock to a specific tier

## Notes

1. **Log tier changes** — Record in your daily log: `[turbo] TIER_A → TIER_B (score: N, reason: ...)`
2. **Skip redundant sync after 3 unchanged** — Avoid rewriting crontab every heartbeat. Only update the score in heartbeat-state.json.
3. **Manual override takes priority** — If `manualOverride` exists and `until` hasn't passed, use the manual tier.
4. **First run** — If `turboFrequency` field doesn't exist, initialize from the current cron in your config, `unchangedCount: 0`.
5. **Score floor is 0** — Quiet hours -30 won't make score negative. Minimum is 0 (SLEEP).
6. **Upgrade cap** — Max 2 tiers up per evaluation. SLEEP → LOW (not TURBO). Prevents jarring jumps.
7. **Downgrade cooldown** — After an upgrade, keep the tier for at least 30 minutes before allowing any downgrade. Prevents oscillation.
8. **tmux is ground truth** — For agent activity, tmux session count overrides `activeAgentTasks` in the JSON. The JSON field may be stale.
9. **Human presence boosts frequency** — If `lastNudge` or `lastHumanMessage` is within 15 minutes, add +25. The human is online and likely waiting for results.
10. **Agent errors / CI failures** — If detected during heartbeat, add +40 to score (same weight as active deployment).
