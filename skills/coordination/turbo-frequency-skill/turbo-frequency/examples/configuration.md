# Example: heartbeat-state.json with turboFrequency

This shows a typical `memory/heartbeat-state.json` with both the cron-tier state and the optional full-speed follow-up state.

```json
{
  "lastChecks": {
    "email": "2026-03-09T08:00:00Z",
    "calendar": "2026-03-09T06:00:00Z"
  },
  "pendingDecisions": [],
  "queuedTasks": [],
  "deployWatch": null,
  "activeAgentTasks": {
    "EMP_0002": "idle",
    "EMP_0003": "idle"
  },
  "turboFrequency": {
    "currentTier": "MEDIUM",
    "cron": "*/30 * * * *",
    "score": 25,
    "fullSpeedFollowup": false,
    "fullSpeedDelay": null,
    "changedAt": "2026-03-09T10:00:00Z",
    "fullSpeedChangedAt": "2026-03-09T10:00:00Z",
    "lastUpgradeAt": "2026-03-09T09:30:00Z",
    "reason": "pendingDecisions non-empty (+20), tmux has 1 agent session (+25), quiet hours (-30). Score: 15 → but deploy awaiting review (+10) → 25 → MEDIUM",
    "fullSpeedReason": "no-followup: tier=MEDIUM",
    "unchangedCount": 2
  }
}
```

## Fields

### turboFrequency

| Field | Type | Description |
|-------|------|-------------|
| `currentTier` | string | One of: TURBO, HIGH, MEDIUM, LOW, IDLE, SLEEP |
| `cron` | string | Current cron expression matching the tier |
| `score` | number | Latest computed busyness score (0-100) |
| `fullSpeedFollowup` | boolean | Whether this evaluation scheduled a timer-driven follow-up |
| `fullSpeedDelay` | string/null | Last computed delay such as `5s`, `100s`, or `3m` |
| `changedAt` | string | ISO 8601 timestamp of last tier change |
| `fullSpeedChangedAt` | string | ISO 8601 timestamp of last follow-up policy change |
| `lastUpgradeAt` | string? | ISO 8601 timestamp of last **upward** tier change. Used for 30-min downgrade cooldown. |
| `reason` | string | Human-readable explanation for the tier decision |
| `fullSpeedReason` | string | Human-readable explanation for the follow-up decision |
| `unchangedCount` | number | Consecutive evaluations with same tier |
| `manualOverride` | object? | Optional: `{ "tier": "HIGH", "until": "..." }` |
| `fullSpeedOverride` | object? | Optional: `{ "enabled": true, "delay": "5s", "timeout": "8m", "until": "...", "reason": "active incident" }` |

### Manual Override Example

Lock to TURBO for 2 hours during a critical deployment:

```json
{
  "turboFrequency": {
    "currentTier": "TURBO",
    "cron": "*/5 * * * *",
    "score": 80,
    "changedAt": "2026-03-09T14:00:00Z",
    "reason": "Manual override: critical deployment",
    "unchangedCount": 0,
    "manualOverride": {
      "tier": "TURBO",
      "until": "2026-03-09T16:00:00Z"
    }
  }
}
```

The manual override is checked in Step 1. If `until` has not passed, the auto-adjustment is skipped entirely.

### Full-Speed Override Example

Force one near-term follow-up heartbeat during an active incident:

```json
{
  "turboFrequency": {
    "currentTier": "HIGH",
    "cron": "*/10 * * * *",
    "score": 55,
    "fullSpeedFollowup": true,
    "fullSpeedDelay": "5s",
    "changedAt": "2026-03-09T14:00:00Z",
    "fullSpeedChangedAt": "2026-03-09T14:00:00Z",
    "reason": "human active (+25), pendingDecisions (+20), tmux agent session (+30), quiet hours (-20) => 55",
    "fullSpeedReason": "manual override: active incident",
    "unchangedCount": 0,
    "fullSpeedOverride": {
      "enabled": true,
      "delay": "5s",
      "timeout": "8m",
      "until": "2026-03-09T14:10:00Z",
      "reason": "active incident"
    }
  }
}
```

## Integration with agent-manager

If you use [agent-manager-skill](https://github.com/fractalmind-ai/agent-manager-skill) for cron management, the sync step is:

```bash
python3 .agent/skills/agent-manager/scripts/main.py heartbeat sync
```

For timer-driven follow-up, you can schedule a one-shot heartbeat like this:

```bash
python3 .agent/skills/agent-manager/scripts/main.py timer heartbeat main --delay 100s --timeout 8m
```

When choosing `delay`, prefer the next likely meaningful update time instead of a fixed preset.
