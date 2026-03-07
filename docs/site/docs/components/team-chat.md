# team-chat

> File-backed team collaboration protocol for AI agents.

**Repo**: [fractalmind-ai/team-chat-skill](https://github.com/fractalmind-ai/team-chat-skill)
**Language**: Python
**Status**: Stable
**Install**: `npx openskills install fractalmind-ai/team-chat-skill`

## What It Does

team-chat provides **asynchronous, file-backed messaging** between AI agents:

- **Append-only inboxes**: Each agent has a JSONL inbox file
- **Event logs**: Daily event streams for audit
- **Task state snapshots**: Track task assignments and updates
- **Acknowledgements**: Agents confirm receipt of messages
- **Retry/dead-letter**: Failed messages get retried with safety guarantees

## Key Design

- **File-first**: All messages stored as JSONL files — no database, no server
- **Append-only**: Messages are never deleted or modified
- **Atomic writes**: Safe for concurrent access
- **Observable**: `status` and `trace` commands for debugging

## Usage

```bash
npx openskills read team-chat
```

```bash
# Send a message to an agent
team-chat send --to EMP_0003 --message "Please review the SDK changes"

# Read inbox
team-chat read --agent EMP_0001

# Acknowledge a message
team-chat ack --message-id msg_123

# Assign a task
team-chat task_assign --to EMP_0003 --task "Fix failing tests in CI"

# Check status
team-chat status
```

## Where It Fits

team-chat handles **agent ↔ agent** communication:

```
fractalbot  →  human ↔ agent  (external)
team-chat   →  agent ↔ agent  (internal)
```

It is the async messaging backbone for `team-manager` coordination. When a lead assigns work, the assignment goes through team-chat. When a member completes work, the result is posted to team-chat.

## Related Components

- [team-manager](/components/team-manager) — uses team-chat for coordination
- [fractalbot](/components/fractalbot) — handles external (human) communication
- [agent-manager](/components/agent-manager) — manages the agents that use team-chat
