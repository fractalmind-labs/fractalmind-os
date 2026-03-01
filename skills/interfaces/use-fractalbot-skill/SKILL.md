---
name: use-fractalbot
description: Send outbound messages with fractalbot CLI (especially Telegram) through the local gateway/systemd user service. Use when the user asks to test or send a message.
---

# use-fractalbot

## When to use

Use this skill when you need to:
- send a Telegram message from local fractalbot CLI
- verify fractalbot user service is running
- quickly diagnose send failures (`connection refused`, channel errors, invalid target)

## Defaults in this workspace

- Binary command: `fractalbot` (from PATH) or `~/.local/bin/fractalbot`
- Config: `${XDG_CONFIG_HOME:-$HOME/.config}/fractalbot/config.yaml`
- Data dir: `${XDG_DATA_HOME:-$HOME/.local/share}/fractalbot`
- Service: `fractalbot` (systemd user service)
- Gateway: `127.0.0.1:18789`

## Preflight

```bash
systemctl --user is-active fractalbot
systemctl --user status fractalbot --no-pager -n 20
```

If not active:

```bash
systemctl --user start fractalbot
```

## Send message to Telegram

Basic command:

```bash
fractalbot \
  --config "${XDG_CONFIG_HOME:-$HOME/.config}/fractalbot/config.yaml" \
  message send \
  --channel telegram \
  --to <telegram_chat_id> \
  --text "<message>"
```

Expected success output:

```text
✅ Message sent via telegram to <telegram_chat_id>
```

## Find target chat id

Check configured admin/allowed Telegram users:

```bash
rg -n "adminID|allowedUsers" "${XDG_CONFIG_HOME:-$HOME/.config}/fractalbot/config.yaml"
```

If you must send with the exact config used by systemd service, inspect it first:

```bash
systemctl --user cat fractalbot | rg -n -- "--config"
```

## Verify delivery path

After sending, check logs:

```bash
journalctl --user -u fractalbot -n 50 --no-pager
```

Follow logs in real time:

```bash
journalctl --user -u fractalbot -f
```

## Common failures

- `request ... failed: dial tcp 127.0.0.1:18789 ... connection refused`
  - gateway/service is not running
- `gateway API error (404): channel "telegram" not found`
  - Telegram channel not enabled in config or config mismatch
- `gateway API error (400): to is required`
  - missing or invalid `--to`
- `gateway API error (502): ...`
  - downstream channel send failed (token/permissions/network)

## Safety

- Never print or paste bot tokens in chat output.
- Prefer reading IDs from config rather than guessing recipients.
- Use explicit `--channel telegram` in automation for clarity.
