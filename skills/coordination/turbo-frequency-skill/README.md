<div align="center">

# Turbo Frequency

**Dynamic heartbeat frequency adjustment for AI agent workspaces.**

*Like CPU turbo boost — speeds up when busy, slows down when idle.*

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![openskills](https://img.shields.io/badge/openskills-compatible-blue.svg)](https://github.com/nichochar/open-skills)

</div>

---

## What It Does

AI agents with periodic heartbeats face a dilemma: poll too often and waste resources, poll too rarely and miss events. Turbo Frequency solves this by dynamically adjusting heartbeat cadence from real workload signals.

```
Busy (deploying, agents working)  →  TURBO   (every 5 min)
Moderate (pending decisions)      →  MEDIUM  (every 30 min)
Idle (nothing happening)          →  LOW     (every 1 hour)
Night + idle                      →  SLEEP   (every 4 hours)
```

## Two Independent Levers

Turbo Frequency now models heartbeat acceleration with **two independent levers**:

1. **Heartbeat cron frequency** — the baseline polling interval
2. **Full-speed follow-up** — an optional **one-shot timer-driven** extra heartbeat when a near-term re-check is genuinely worthwhile

Do not confuse them:
- **Cron tier** answers: “how often should I poll by default?”
- **Full-speed follow-up** answers: “should I queue one extra heartbeat before the next cron tick?”

## How It Works

1. At the end of each heartbeat, the skill reads workload signals (active agents, deployments, pending decisions, time of day)
2. Computes a busyness score (0-100)
3. Maps the score to one of 6 frequency tiers
4. Updates the heartbeat cron expression accordingly
5. Optionally schedules a timer-driven follow-up if a scene-aware near-term sweep is justified

There is **no always-on daemon**. Cron tiering stays skill-driven, and the optional extra follow-up can reuse `agent-manager timer` when that integration is available.

## Installation

```bash
# Via openskills (recommended)
npx openskills install fractalmind-ai/turbo-frequency-skill

# Manual
git clone https://github.com/fractalmind-ai/turbo-frequency-skill.git
cp -r turbo-frequency-skill/turbo-frequency ~/.claude/skills/turbo-frequency
```

## Quick Start

### 1. Install & register the skill

```bash
npx openskills install fractalmind-ai/turbo-frequency-skill
```

Then add `turbo-frequency` to your `AGENTS.md` frontmatter **and** enable heartbeat:

```yaml
---
name: my-agent
skills:
  - turbo-frequency
heartbeat:
  cron: "*/30 * * * *"
  max_runtime: 8m
  session_mode: auto
  mode: normal
  enabled: true
---
```

### 2. Initialize heartbeat state

Create (or update) `memory/heartbeat-state.json` in your workspace root:

```json
{
  "lastChecks": {},
  "turboFrequency": {
    "currentTier": "MEDIUM",
    "cron": "*/30 * * * *",
    "score": 30,
    "fullSpeedFollowup": false,
    "fullSpeedDelay": null,
    "changedAt": "",
    "fullSpeedChangedAt": "",
    "lastUpgradeAt": "",
    "reason": "initial setup",
    "fullSpeedReason": "initial setup",
    "unchangedCount": 0
  }
}
```

### 3. Invoke at the end of each heartbeat

At the **end** of your heartbeat handler (after all checks are done), load the skill:

```bash
npx openskills read turbo-frequency
```

The skill output guides your agent to:
1. Collect workload signals (active tasks, pending decisions, human activity, etc.)
2. Compute a busyness score (0–100)
3. Map the score to a frequency tier
4. Update `AGENTS.md` heartbeat cron and `heartbeat-state.json`
5. Decide whether an extra timer-driven follow-up is justified before the next cron tick

### 4. Verify it works

After 2–3 heartbeat cycles, check `memory/heartbeat-state.json`:

```bash
cat memory/heartbeat-state.json | jq .turboFrequency
```

You should see `currentTier`, `score`, `reason`, and (when relevant) `fullSpeed*` fields updating each cycle.

## Timer-Driven Follow-Up

When another near-term sweep is useful, schedule a one-shot timer instead of blindly shortening the baseline cron.

Example with `agent-manager`:

```bash
python3 .agent/skills/agent-manager/scripts/main.py timer heartbeat main --delay 100s --timeout 8m
```

Use a timer-driven follow-up when:
- the current tier is `HIGH` or `TURBO`
- a human is actively waiting for a response
- CI / QA / deploy output is likely to change before the next cron tick

Do **not** pick delays mechanically. Estimate the earliest next worthwhile check time:
- human follow-up → often around `5s`
- dev / CI likely needs ~2 minutes → prefer roughly `90s-110s`
- QA likely needs ~3-5 minutes → prefer roughly `2-3m`

The goal is **minimum wasted re-checks**, not minimum delay.

## Frequency Tiers

| Tier | Interval | Cron | When |
|------|----------|------|------|
| **TURBO** | 5 min | `*/5 * * * *` | Active deployment, agent errors, CI failures |
| **HIGH** | 10 min | `*/10 * * * *` | Agents executing tasks, PRs in QA |
| **MEDIUM** | 30 min | `*/30 * * * *` | Pending decisions, queued tasks |
| **LOW** | 1 hour | `0 * * * *` | All idle, no pending work |
| **IDLE** | 2 hours | `0 */2 * * *` | Quiet hours + all idle |
| **SLEEP** | 4 hours | `0 */4 * * *` | Deep night + zero activity |

## Signal Scoring

| Signal | Score | Condition |
|--------|-------|-----------|
| Active deployment | +40 | Deploy in progress |
| Agent active tasks | +30 | tmux shows running sessions (primary) or JSON non-idle (fallback) |
| Recent human interaction | +25 | `lastNudge` or `lastHumanMessage` within 15 min |
| tmux active sessions | +25 | Agent sessions detected (do not double-count with above) |
| Pending decisions | +20 | Decisions awaiting human input |
| Queued tasks | +15 | Tasks waiting to be assigned |
| Deploy awaiting review | +10 | Deploy done, needs review |
| Quiet hours (23:00-08:00) | -30 | Automatic night reduction |

Score is clamped to 0-100, then mapped to a tier.

## Features

- **6 frequency tiers** — from 5-minute turbo to 4-hour sleep
- **Signal-driven** — quantitative scoring, not guesswork
- **tmux as ground truth** — live agent session count takes priority over stale JSON state
- **Upgrade smoothing** — max 2 tiers up per evaluation, no jarring jumps from SLEEP to TURBO
- **Downgrade cooldown** — 30-minute hold after upgrades, prevents oscillation
- **Human presence detection** — boosts frequency when a human is actively interacting (within 15 min)
- **Cron/tier consistency check** — auto-detects and fixes mismatches between config and state
- **Debounce** — skips crontab sync after 3 consecutive unchanged evaluations
- **Manual override** — lock to a specific tier with expiry
- **Timer-driven full-speed follow-up** — add one extra heartbeat without changing the cron tier
- **Scene-aware delay selection** — choose the next useful check time instead of always using a fixed short delay
- **Quiet hours** — automatic night-time reduction
- **Zero required runtime dependencies** — optional timer support plugs into `agent-manager` if you have it

## Advanced Usage

See [examples/](turbo-frequency/examples/) for:
- full `heartbeat-state.json` examples
- manual override patterns
- full-speed override patterns
- integration with `agent-manager`

## Requirements

- An AI agent workspace with heartbeat/cron support
- `memory/heartbeat-state.json` for state persistence
- (Optional) `tmux` for agent session detection
- (Optional) `agent-manager` skill for crontab sync / timer follow-up

## License

[MIT](LICENSE) — use it however you want.
