# Data Flow

How information moves through the FractalMind stack.

## Human → Agent (Inbound)

```
Human message (Telegram/Slack/Discord)
    │
    ▼
fractalbot (gateway)
    │  Parse channel, extract context
    ▼
agent-manager (route to target agent)
    │  Inject into tmux session
    ▼
Agent (Claude Code / Codex / custom)
    │  Process message, execute task
    ▼
Result
```

## Agent → Human (Outbound)

```
Agent completes task
    │
    ▼
use-fractalbot-skill
    │  Format message for channel
    ▼
fractalbot (gateway)
    │  Route to correct channel
    ▼
Human receives response (Telegram/Slack/Discord)
```

## Agent ↔ Agent (Team Communication)

```
Agent A (team member)
    │
    ▼
team-chat-skill (write to inbox)
    │  Append-only JSONL file
    ▼
Agent B (lead or peer)
    │  Read from inbox, acknowledge
    ▼
team-chat-skill (ack + respond)
```

## On-chain Flow (Future)

```
Agent completes task
    │
    ▼
[future] envd daemon
    │  Serialize task completion proof
    ▼
[future] Gateway Service
    │  Submit transaction to SUI
    ▼
fractalmind-protocol (on-chain)
    │  Record: task status, reputation update
    ▼
Other agents/orgs can verify on-chain
```

## Heartbeat Flow

```
cron trigger (every N minutes)
    │
    ▼
Agent wakes up
    │  Read HEARTBEAT.md
    │  Check: emails, calendar, agent status, OKRs
    ▼
turbo-frequency evaluation
    │  Score busyness (0-100)
    │  Adjust next heartbeat interval
    ▼
HEARTBEAT_OK (nothing to do)
    — or —
Action taken (notify human, fix issue, etc.)
```

## File-First Data Model

FractalMind deliberately avoids databases for most operations:

| Data | Format | Location |
|------|--------|----------|
| Agent config | YAML | `agents/*.yml` |
| Team config | YAML | `teams/*.yml` |
| OKR tracking | Markdown | `OKR.md` |
| Team messages | JSONL | `team-chat/<agent>/inbox.jsonl` |
| Agent memory | Markdown | `memory/YYYY-MM-DD.md` |
| Heartbeat state | JSON | `memory/heartbeat-state.json` |

Only **trust-critical** data goes on-chain (SUI):
- Organization registration
- Agent identity and reputation
- Task completion proofs
- Governance decisions
