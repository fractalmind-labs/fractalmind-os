# Example: heartbeat-state.json with turboFrequency

This shows a typical `memory/heartbeat-state.json` with the turboFrequency field.

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
    "changedAt": "2026-03-09T10:00:00Z",
    "reason": "pendingDecisions non-empty (+20), tmux has 1 agent session (+25), quiet hours (-30). Score: 15 → but deploy awaiting review (+10) → 25 → MEDIUM",
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
| `changedAt` | string | ISO 8601 timestamp of last tier change |
| `reason` | string | Human-readable explanation |
| `unchangedCount` | number | Consecutive evaluations with same tier |
| `manualOverride` | object? | Optional: `{ "tier": "HIGH", "until": "..." }` |

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

## Custom Signal Sources

You can extend the scoring rules by adding custom signals to your heartbeat-state.json. The skill evaluates signals by reading the JSON — any additional fields you add can be incorporated into your scoring logic.

Example: Add a `ciStatus` field:

```json
{
  "ciStatus": {
    "lastRun": "2026-03-09T13:45:00Z",
    "status": "failing",
    "failCount": 3
  }
}
```

Then in your heartbeat handler, add scoring logic:
- `ciStatus.status == "failing"` → +40 (triggers TURBO)
- `ciStatus.failCount > 5` → +40 (critical)

## Integration with agent-manager

If you use [agent-manager-skill](https://github.com/fractalmind-ai/agent-manager-skill) for cron management, the sync step is:

```bash
python3 .agent/skills/agent-manager/scripts/main.py heartbeat sync
```

This reads the cron from your `AGENTS.md` frontmatter and updates the system crontab accordingly.

Without agent-manager, you can use any crontab management approach:

```bash
# Direct crontab update
(crontab -l 2>/dev/null | grep -v 'heartbeat'; echo "*/30 * * * * /path/to/heartbeat.sh") | crontab -
```
