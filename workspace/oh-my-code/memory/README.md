# memory/

Persistent state for the heartbeat-OKR workflow.

## Files

| File | Purpose |
|------|---------|
| `heartbeat-state.json` | Heartbeat persistent state: last postmortem timestamp, open PR tracking list. |
| `YYYY-MM-DD.md` | Daily log files created automatically by the heartbeat's daily postmortem. Contains postmortem findings and notable events. |

## Notes

- `heartbeat-state.json` is the only file that should be committed. Daily logs are ephemeral and can be gitignored if preferred.
- Do not store secrets or credentials in this directory.
