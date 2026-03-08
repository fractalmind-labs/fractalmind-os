<div align="center">

# Turbo Frequency

**Dynamic heartbeat frequency adjustment for AI agent workspaces.**

*Like CPU turbo boost — speeds up when busy, slows down when idle.*

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![openskills](https://img.shields.io/badge/openskills-compatible-blue.svg)](https://github.com/nichochar/open-skills)

</div>

---

## What It Does

AI agents with periodic heartbeats face a dilemma: poll too often and waste resources, poll too rarely and miss events. Turbo Frequency solves this by dynamically adjusting the heartbeat interval based on real-time workload signals.

```
Busy (deploying, agents working)  →  TURBO   (every 5 min)
Moderate (pending decisions)      →  MEDIUM  (every 30 min)
Idle (nothing happening)          →  LOW     (every 1 hour)
Night + idle                      →  SLEEP   (every 4 hours)
```

## How It Works

1. At the end of each heartbeat, the skill reads workload signals (active agents, deployments, pending decisions, time of day)
2. Computes a busyness score (0-100)
3. Maps the score to one of 6 frequency tiers
4. Updates the heartbeat cron expression accordingly

No external dependencies. No background process. Just a skill your agent invokes at the end of each heartbeat cycle.

## Installation

```bash
# Via openskills (recommended)
npx openskills install fractalmind-ai/turbo-frequency-skill

# Manual
git clone https://github.com/fractalmind-ai/turbo-frequency-skill.git
cp -r turbo-frequency-skill/turbo-frequency ~/.claude/skills/turbo-frequency
```

## Quick Start

### 1. Add to your agent's skill list

In your `AGENTS.md` or `.claude/settings.json`, register the skill:

```yaml
skills:
  - turbo-frequency
```

### 2. Initialize heartbeat state

Add the `turboFrequency` field to your `memory/heartbeat-state.json`:

```json
{
  "turboFrequency": {
    "currentTier": "MEDIUM",
    "cron": "*/30 * * * *",
    "score": 20,
    "changedAt": "2026-03-09T00:00:00Z",
    "reason": "Initial setup",
    "unchangedCount": 0
  }
}
```

### 3. Invoke at heartbeat end

At the end of your heartbeat handler, load the skill:

```bash
npx openskills read turbo-frequency
```

The skill instructions will guide your agent through signal evaluation and frequency adjustment.

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
| Agent active tasks | +30 | Any agent is non-idle |
| tmux active sessions | +25 | Agent sessions detected |
| Pending decisions | +20 | Decisions awaiting human input |
| Queued tasks | +15 | Tasks waiting to be assigned |
| Deploy awaiting review | +10 | Deploy done, needs review |
| Quiet hours (23:00-08:00) | -30 | Automatic night reduction |

Score is clamped to 0-100, then mapped to a tier.

## Features

- **6 frequency tiers** — from 5-minute turbo to 4-hour sleep
- **Signal-driven** — quantitative scoring, not guesswork
- **Debounce** — skips crontab sync after 3 consecutive unchanged evaluations
- **Manual override** — lock to a specific tier with expiry
- **Quiet hours** — automatic night-time reduction
- **Zero dependencies** — pure skill, no runtime or background process

## Advanced Usage

See [examples/](turbo-frequency/examples/) for:
- Custom signal sources
- Manual override patterns
- Integration with agent-manager

## Requirements

- An AI agent workspace with heartbeat/cron support
- `memory/heartbeat-state.json` for state persistence
- (Optional) `tmux` for agent session detection
- (Optional) `agent-manager` skill for crontab sync

## License

[MIT](LICENSE) — use it however you want.
