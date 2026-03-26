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

This skill now manages **two independent levers**:

1. **Heartbeat cron frequency** — how often the regular heartbeat runs
2. **Full-speed follow-up** — whether the agent should proactively schedule a **timer-driven** extra heartbeat after a scene-aware delay

Do not confuse them:
- **Cron tier** answers: "how often should I poll?"
- **Full-speed follow-up** answers: "after this heartbeat finishes, should I queue one extra near-term heartbeat?"

## Full-Speed Follow-Up

The old Codex `Stop`-hook based `full_speed` implementation has been retired. In this workspace, **full-speed behavior is now implemented through `agent-manager timer`**.

Use this when you want one extra near-term heartbeat without waiting for the next cron tick.

### Mechanism

Schedule a one-shot timer:

```bash
python3 .agent/skills/agent-manager/scripts/main.py timer heartbeat main --delay <SCENE_AWARE_DELAY> --timeout 8m
```

What it does:

- waits for the chosen delay window
- runs `start main --restore`
- runs `heartbeat run main --timeout 8m`
- writes state to `.claude/state/agent-manager/timers/*.json`
- writes execution logs to `.crontab_logs/agent-manager-timer-*.log`

### Recommended Switch Policy

Use a timer-driven follow-up only when another near-term sweep is genuinely useful.

Schedule a follow-up when any of these are true:

- Current turbo tier is `HIGH` or `TURBO`
- Human is actively messaging and expects quick follow-up
- Main agent is coordinating multiple active agents / PRs / incidents
- You expect new information soon enough that waiting for the next cron tick would be too slow

Do **not** schedule a timer when all of these are true:

- Current turbo tier is `LOW`, `IDLE`, or `SLEEP`
- No active incident / deploy / inbox pressure
- No expectation that `main` must re-check again before the next cron tick

### Delay Selection Rules

Do **not** pick delay from a fixed menu mechanically.

Instead, estimate the **earliest next worthwhile check time** for the current scene:

1. identify the object you are waiting on (`dev`, `qa`, `ci`, `third-party author`, `deploy`, `human inbox`)
2. estimate when that object is most likely to produce new information
3. set delay slightly before or near that time
4. cap the delay so the timer heartbeat can finish **before the next regular heartbeat**

Use this formula:

```text
actual_delay = min(
  scene_estimated_check_time,
  time_until_next_regular_heartbeat - execution_budget - overlap_buffer
)
```

If the available window is too small after subtracting execution budget and buffer, **do not schedule a timer**; just wait for the next regular heartbeat.

Practical guidance:

- Human is actively messaging / near-term conversational follow-up → often `5s`
- Dev says a fix likely needs ~2 minutes → prefer roughly `90s-110s`, not `5s` and not a blind full `120s`
- QA focused review likely needs ~3-5 minutes → prefer roughly `2-3m`
- CI run likely needs another 1-3 minutes before meaningful change → check in that range, not every few seconds

The goal is **not** minimum delay. The goal is **minimum wasted re-checks** without missing the next meaningful update.

### Operation Guide

#### 1. Keep heartbeat config simple

```yaml
heartbeat:
  cron: "*/10 * * * *"
  max_runtime: 8m
  session_mode: auto
  mode: normal
  enabled: true
```

`cron:` is still controlled by the turbo tier logic in this skill.

`mode:` should normally stay `normal` in this workspace.

#### 2. When you decide a heartbeat needs fast follow-up

Choose a delay from the current scene, then run:

```bash
python3 .agent/skills/agent-manager/scripts/main.py timer heartbeat main --delay <DELAY> --timeout 8m
```

Example variants:

```bash
# Human is actively waiting; near-term follow-up is worthwhile
python3 .agent/skills/agent-manager/scripts/main.py timer heartbeat main --delay 5s --timeout 8m

# Dev / QA / CI is likely to produce useful output in ~2 minutes
python3 .agent/skills/agent-manager/scripts/main.py timer heartbeat main --delay 100s --timeout 8m

# Moderate re-check window
python3 .agent/skills/agent-manager/scripts/main.py timer heartbeat main --delay 3m --timeout 8m
```

#### 3. Inspect scheduled timers

```bash
python3 .agent/skills/agent-manager/scripts/main.py timer list
```

Look at:

- `.claude/state/agent-manager/timers/*.json` for status (`pending`, `running`, `completed`, `failed`)
- `.crontab_logs/agent-manager-timer-*.log` for execution details

#### 4. If you need a more custom delayed action

Use the generic timer command:

```bash
python3 .agent/skills/agent-manager/scripts/main.py timer command --delay 5s -- heartbeat run main --timeout 8m
```

### Runtime Behavior

- Timer-driven full-speed follow-up is **explicit**, not implicit
- It does **not** depend on Codex `Stop` hooks
- It is safer because normal turn completion and real process exit are no longer conflated
- It works as a one-shot acceleration layer on top of the normal cron heartbeat

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

Also read optional full-speed override:

```json
{
  "turboFrequency": {
    "fullSpeedOverride": {
      "enabled": true,
      "delay": "5s",
      "timeout": "8m",
      "until": "2026-03-19T04:00:00Z",
      "reason": "active incident"
    }
  }
}
```

If `fullSpeedOverride` exists and is not expired, treat it as a directive to schedule a timer-driven follow-up heartbeat.

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

### Step 5: Decide Full-Speed Follow-Up

Determine whether to schedule a timer-driven follow-up using this priority:

1. `turboFrequency.fullSpeedOverride` if present and unexpired
2. Otherwise only schedule a follow-up when target tier is `HIGH` or `TURBO` **and** you expect a meaningful new signal before the next cron tick
3. Otherwise do not schedule one

When a follow-up is justified, compute delay from the scene rather than defaulting to a fixed short value:

- estimate `scene_estimated_check_time`
- estimate `execution_budget` for the timer heartbeat itself
- choose an `overlap_buffer` (for example 30s)
- cap delay so `delay + execution_budget + overlap_buffer < time_until_next_regular_heartbeat`

If this inequality cannot be satisfied, skip the timer and wait for cron.

Recommended reason strings:

- `tier=HIGH, scene=human-inbox, delay=5s`
- `tier=TURBO, scene=qa, delay=2m`
- `manual override: active incident`
- `no-followup: next-cron-window-too-small`
- `no-followup: no-near-term-signal`

### Step 6: Update Heartbeat Config

Use the **Edit tool** to modify the heartbeat block in your agent's config file (e.g., `AGENTS.md` frontmatter YAML):

```
old_string: '  cron: "*/10 * * * *"'
new_string: '  cron: "*/30 * * * *"'
```

Important:

- `cron:` follows the turbo tier
- `mode:` should generally remain `normal` in this workspace
- Do not change unrelated fields in the frontmatter

### Step 7: Sync to Crontab

If your workspace uses agent-manager for cron sync:

```bash
python3 .agent/skills/agent-manager/scripts/main.py heartbeat sync
```

Or use your own crontab sync mechanism.

Note: changing `mode:` itself does **not** require crontab sync to take effect, but if you already changed `cron:` in the same pass, still run the normal sync.

### Step 8: Schedule Follow-Up Timer If Needed

If Step 5 says a follow-up is needed, schedule it with the computed delay:

```bash
python3 .agent/skills/agent-manager/scripts/main.py timer heartbeat main --delay <COMPUTED_DELAY> --timeout 8m
```

Recommended discipline:

- only schedule one when the current heartbeat actually finished meaningful work
- do not stack multiple timers blindly every turn
- use `timer list` to inspect whether a recent timer already exists
- prefer a scene-aware delay over a fixed short delay
- never choose a delay that leaves too little room before the next regular heartbeat

### Step 9: Record the Change

Update `memory/heartbeat-state.json` with the `turboFrequency` field:

```json
{
  "turboFrequency": {
    "currentTier": "MEDIUM",
    "cron": "*/30 * * * *",
    "score": 30,
    "fullSpeedFollowup": false,
    "fullSpeedDelay": null,
    "changedAt": "2026-03-06T02:00:00Z",
    "fullSpeedChangedAt": "2026-03-06T02:00:00Z",
    "lastUpgradeAt": "2026-03-06T01:30:00Z",
    "reason": "tmux: 1 agent session (+30) + awaiting-review deploy (+10) + human active 8m ago (+25) - nighttime (-30) = 35 → capped at MEDIUM (was SLEEP, max +2 tiers)",
    "fullSpeedReason": "no-followup: tier=MEDIUM",
    "unchangedCount": 0
  }
}
```

Field reference:
- `currentTier`: Current tier name
- `cron`: Current cron expression
- `score`: Latest computed busyness score
- `fullSpeedFollowup`: Whether this evaluation decided to schedule a timer-driven follow-up
- `fullSpeedDelay`: Last computed follow-up delay (e.g. `5s`, `100s`, `3m`) or `null`
- `changedAt`: Last tier change timestamp (ISO 8601)
- `fullSpeedChangedAt`: Last follow-up policy change timestamp (ISO 8601)
- `lastUpgradeAt`: Last **upward** tier change timestamp (ISO 8601). Used for downgrade cooldown (30 min).
- `reason`: Brief explanation of why this tier was selected
- `fullSpeedReason`: Brief explanation of why the current mode was selected
- `unchangedCount`: Consecutive unchanged count (used to skip redundant sync)
- `manualOverride` (optional): `{ "tier": "HIGH", "until": "2026-03-06T12:00:00Z" }` — lock to a specific tier
- `fullSpeedOverride` (optional): `{ "mode": "full_speed", "until": "2026-03-19T04:00:00Z", "reason": "active incident" }`

## Notes

1. **Log tier changes** — Record in your daily log: `[turbo] TIER_A → TIER_B (score: N, reason: ...)`
2. **Log mode changes too** — Example: `[turbo] heartbeat.mode normal → full_speed (reason: tier=HIGH)`
3. **Skip redundant sync after 3 unchanged** — Avoid rewriting crontab every heartbeat. Only update the score in heartbeat-state.json.
4. **Manual override takes priority** — If `manualOverride` or `fullSpeedOverride` exists and `until` hasn't passed, use it.
5. **First run** — If `turboFrequency` field doesn't exist, initialize from the current cron and current `heartbeat.mode` in your config.
6. **Score floor is 0** — Quiet hours -30 won't make score negative. Minimum is 0 (SLEEP).
7. **Upgrade cap** — Max 2 tiers up per evaluation. SLEEP → LOW (not TURBO). Prevents jarring jumps.
8. **Downgrade cooldown** — After an upgrade, keep the tier for at least 30 minutes before allowing any downgrade. Prevents oscillation.
9. **tmux is ground truth** — For agent activity, tmux session count overrides `activeAgentTasks` in the JSON. The JSON field may be stale.
10. **Human presence boosts frequency** — If `lastNudge` or `lastHumanMessage` is within 15 minutes, add +25. The human is online and likely waiting for results.
11. **Agent errors / CI failures** — If detected during heartbeat, add +40 to score (same weight as active deployment).
12. **Timer follow-up and cron tier are orthogonal** — timer-driven follow-up does not replace cron; it only adds one extra near-term heartbeat when justified.
13. **Delay must be scene-aware** — pick delay from the next likely meaningful update, not from a fixed preset.
14. **Delay must respect the next cron window** — `delay + execution_budget + buffer` must fit before the next regular heartbeat, otherwise skip the timer.
