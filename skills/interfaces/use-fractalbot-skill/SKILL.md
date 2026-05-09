---
name: use-fractalbot
description: Send outbound messages with fractalbot CLI (Telegram, iMessage, Slack, Feishu, Discord, etc.) through the local gateway/user service. Use when the user asks to test or send a message, or when an inbound task includes FractalBot routing context such as channel/chat_id/thread_ts and needs a reply.
---

# use-fractalbot

## When to use

Use this skill when you need to:
- send a message via any channel (Telegram, iMessage, Slack, Feishu, Discord)
- reply to a FractalBot-routed inbound message that includes `Inbound routing context`
- verify fractalbot service is running and healthy
- diagnose send failures (`connection refused`, channel errors, invalid target)

## Supported channels

| Channel | Platform | Notes |
|---------|----------|-------|
| `telegram` | Telegram | DM only |
| `imessage` | macOS only | Requires Full Disk Access |
| `slack` | Slack | Socket Mode |
| `feishu` | Feishu/Lark | China/International |
| `discord` | Discord | DM only |

## Defaults in this workspace

```bash
# Environment (set once, reuse in commands)
export FRACTALBOT_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/fractalbot/config.yaml"
export FRACTALBOT_HOST="127.0.0.1:18789"
export FRACTALBOT_SERVICE="ai.fractalmind.fractalbot"  # macOS launchctl
# export FRACTALBOT_SERVICE="fractalbot"               # Linux systemd

# Binary location
FRACTALBOT_BIN="fractalbot"  # or ~/.local/bin/fractalbot
```

## Quick health check

```bash
# Fastest: check gateway + all channels at once
curl -s "http://${FRACTALBOT_HOST:-127.0.0.1:18789}/status" | jq '.'

# Alternative: check service status
launchctl list | grep -i fractalbot    # macOS
# systemctl --user is-active fractalbot  # Linux
```

## Preflight

If service not running:

```bash
# macOS
launchctl kickstart -k gui/$(id -u)/ai.fractalmind.fractalbot

# Linux
systemctl --user start fractalbot
```

## Send message

### Reply from inbound routing context

When the current task includes `Inbound routing context`, use those fields instead of guessing the recipient:

- `channel` -> pass to `--channel`
- `chat_id` -> default recipient for `--to`
- `thread_ts` -> pass to `--thread-ts` for Slack threaded replies
- `selected_agent` is informational only; do not use it as the recipient
- If `chat_id` is missing, use the channel-specific user ID only when the context clearly provides one

```bash
fractalbot --config "${FRACTALBOT_CONFIG}" message send \
  --channel "${CHANNEL_FROM_CONTEXT}" \
  --to "${CHAT_ID_FROM_CONTEXT}" \
  --text "<reply>"
```

For Slack threads:

```bash
fractalbot --config "${FRACTALBOT_CONFIG}" message send \
  --channel slack \
  --to "${CHAT_ID_FROM_CONTEXT}" \
  --thread-ts "${THREAD_TS_FROM_CONTEXT}" \
  --text "<reply>"
```

For Feishu/Lark, prefer the `chat_id` from context (usually `oc_...`) so the reply goes back to the same chat. Use an `open_id` (`ou_...`) only when `chat_id` is absent and the task is clearly a direct-user reply.

### Basic syntax

```bash
fractalbot --config "${FRACTALBOT_CONFIG}" message send \
  --channel <channel> \
  --to <recipient> \
  [--thread-ts <slack_thread_ts>] \
  --text "<message>"
```

### iMessage (macOS only)

```bash
fractalbot --config "${FRACTALBOT_CONFIG}" message send \
  --channel imessage \
  --to "+8619575545051" \
  --text "Hello from fractalbot"
```

### Telegram

```bash
# Find admin ID first
rg -n "adminID|allowedUsers" "${FRACTALBOT_CONFIG}"

# Send message
fractalbot --config "${FRACTALBOT_CONFIG}" message send \
  --channel telegram \
  --to "5088760910" \
  --text "Hello from fractalbot"
```

### Other channels

```bash
# Slack
fractalbot --config "${FRACTALBOT_CONFIG}" message send \
  --channel slack --to "U12345678" --text "..."

# Feishu
fractalbot --config "${FRACTALBOT_CONFIG}" message send \
  --channel feishu --to "oc_xxxxx" --text "..."

# Feishu direct-user fallback, only when no chat_id is available
fractalbot --config "${FRACTALBOT_CONFIG}" message send \
  --channel feishu --to "ou_xxxxx" --text "..."

# Discord
fractalbot --config "${FRACTALBOT_CONFIG}" message send \
  --channel discord --to "123456789012345678" --text "..."
```

## Verify delivery

Check logs after sending:

```bash
# macOS
log show --predicate 'process == "FractalBot"' --last 5m --info --debug

# Linux
journalctl --user -u fractalbot -n 50 --no-pager

# Follow live
journalctl --user -u fractalbot -f
```

## Troubleshooting flow

```
Send failed?
│
├─ "connection refused" → Service not running → launchctl kickstart ...
├─ "channel not found" (404) → Channel disabled in config → check config.yaml
├─ "to is required" (400) → Missing/invalid recipient → check --to value
├─ "502" → Downstream error → check channel token/permissions
└─ Silent → Check /status endpoint → curl http://127.0.0.1:18789/status
```

## Common failures

| Error | Cause | Fix |
|-------|-------|-----|
| `connection refused` | Service not running | `launchctl kickstart ...` |
| `channel "X" not found` (404) | Channel disabled | Enable in config.yaml |
| `to is required` (400) | Missing recipient | Add `--to <recipient>` |
| `502` | Downstream failed | Check token/network |

## Safety

- Never print or paste bot tokens in chat output
- Read recipient IDs from config, don't guess
- For inbound replies, prefer `chat_id` from routing context over user IDs
- Use explicit `--channel` in automation
- iMessage requires Full Disk Access for `/Library/Messages`
