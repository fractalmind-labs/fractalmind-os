---
name: use-fractalbot
description: Send outbound messages with fractalbot CLI (Telegram, iMessage, Slack, etc.) through the local gateway/user service. Use when the user asks to test or send a message.
---

# use-fractalbot

## When to use

Use this skill when you need to:
- send a message via any channel (Telegram, iMessage, Slack, Feishu, Discord)
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

### Basic syntax

```bash
fractalbot --config "${FRACTALBOT_CONFIG}" message send \
  --channel <channel> \
  --to <recipient> \
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
- Use explicit `--channel` in automation
- iMessage requires Full Disk Access for `/Library/Messages`
