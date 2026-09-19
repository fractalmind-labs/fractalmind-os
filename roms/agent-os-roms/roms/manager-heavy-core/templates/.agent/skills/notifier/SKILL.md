---
name: notifier
description: Multi-channel notification system for sending alerts to Feishu webhooks, Slack Bot API, Telegram bots, and email. Use when agents need to notify humans about unrecoverable errors requiring human intervention, critical system alerts, task completion notifications, or escalation scenarios beyond agent capabilities. Supports markdown-formatted messages with structured cards.
---

# Notifier

## Overview

Send notifications to multiple channels when agents need human intervention or want to report status. Currently supports Feishu webhooks and Slack Bot API with planned support for Telegram and email.

## Supported Channels

### All Channels (Multi-Channel Broadcast)

Send notifications to all configured channels at once.

**Usage:**
```bash
# Send to all configured channels
python3 .agent/skills/notifier/scripts/notify.py \
  --channel all \
  --title "Important Alert" \
  --message "This message will be sent to **all configured channels**"

# Example output:
# Sending to all configured channels...
# Feishu: ✓ Sent
# Slack: ✓ Sent
```

**Behavior:**
- Automatically detects which channels are configured
- Skips unconfigured channels (shows `Skipping (not configured)`)
- Returns success if at least one channel succeeds
- Currently supports: Feishu, Slack (Telegram/Email not implemented)

**Note:** Thread replies (`--thread-ts`) are not supported in `--channel all` mode.

### Feishu Webhook (Current)

Send rich card notifications to Feishu with title and markdown-formatted content.

**Setup:**
1. Get Feishu webhook URL from bot settings
2. Save it to `.claude/state/notifier/feishu-webhook.txt` (recommended) or pass via `--webhook`

**Usage:**
```bash
# Using default webhook file
python3 .agent/skills/notifier/scripts/notify.py \
  --title "Alert: System Error" \
  --message "Agent **EMP_0007** encountered unrecoverable error"

# Using argument
python3 .agent/skills/notifier/scripts/notify.py \
  --webhook "https://open.feishu.cn/open-apis/bot/v2/hook/..." \
  --title "Task Complete" \
  --message "Backup finished successfully"
```

**Message Format:**
- Title: Plain text, appears in card header
- Message: Markdown supported (**bold**, `code`, links, etc.)
- Card color: Red (alert style)
- Escapes: `\\n`, `\\r`, `\\t`, `\\\\` in `--message` are decoded before sending

**Newlines in CLI:**
- Use `\n` to create line breaks (decoded by the notifier)
- Use `\\n` to keep a literal `\n` in the message
- You can also use Bash ANSI-C quoting: `--message $'line1\n\nline2'`

### Slack Bot API (Current)

Send notifications to Slack using Bot Token API with support for threaded replies.

**Setup:**
1. Create a Slack App at https://api.slack.com/apps
2. Enable "Bot Token Scopes" and add `chat:write` permission
3. Install the App to your Workspace and copy the **Bot Token** (`xoxb-...`)
4. Get the **Channel ID** (e.g., `C00000000`) from Slack channel URL or API
5. Save credentials to default files or pass via arguments:
   ```bash
   mkdir -p .claude/state/notifier/
   echo "xoxb-your-bot-token" > .claude/state/notifier/slack-token.txt
   echo "C00000000" > .claude/state/notifier/slack-channel-id.txt
   ```

**Usage:**
```bash
# Using default token/channel files
python3 .agent/skills/notifier/scripts/notify.py \
  --channel slack \
  --title "Alert: System Error" \
  --message "Agent **EMP_0007** encountered unrecoverable error"

# Using arguments
python3 .agent/skills/notifier/scripts/notify.py \
  --channel slack \
  --slack-token "xoxb-..." \
  --channel-id "C00000000" \
  --title "Task Complete" \
  --message "Backup finished successfully"

# Reply to a thread
python3 .agent/skills/notifier/scripts/notify.py \
  --channel slack \
  --slack-token "xoxb-..." \
  --channel-id "C00000000" \
  --thread-ts "1234567890.123456" \
  --title "Thread Reply" \
  --message "This is a threaded reply"
```

**Message Format:**
- Title: Plain text header block
- Message: Markdown supported (**bold**, `code`, links, etc.)
- Thread Support: Use `--thread-ts` to reply to existing messages
- Escapes: `\\n`, `\\r`, `\\t`, `\\\\` in `--message` are decoded before sending

**Finding Channel ID:**
- Method 1: Open channel in Slack, URL shows `https://.../archives/C00000000/...`
- Method 2: Right-click channel → "Copy Link" → extract ID from URL

### Telegram Bot (Future)

Planned support for Telegram bot notifications.

### Email (Future)

Planned support for SMTP email notifications.

## Use Cases

### 0. Critical Alerts (All Channels)

Broadcast important messages to all configured channels:

```bash
python3 .agent/skills/notifier/scripts/notify.py \
  --channel all \
  --title "🚨 Critical Alert" \
  --message "Production system requires immediate attention!\n\n**Issue**: Database connection failed\n**Impact**: All services affected\n**Action**: Check database status"
```

### 1. Unrecoverable Errors

When an agent encounters a situation it cannot resolve:

```bash
python3 .agent/skills/notifier/scripts/notify.py \
  --channel feishu \
  --title "Escalation Required" \
  --message "Agent **EMP_0007** cannot restart polymarket-quant team.\n\nError: Team lead session hung and unresponsive.\n\nAction: Please `tmux kill-session -t agent-emp-0008` manually."
```

### 2. Critical System Alerts

When infrastructure issues require attention:

```bash
python3 .agent/skills/notifier/scripts/notify.py \
  --channel feishu \
  --title "Infrastructure Alert" \
  --message "Multiple agent sessions disconnected:\n\n- EMP_0003: Disk space low\n- EMP_0004: Memory OOM"
```

### 3. Task Completion

Notify when long-running tasks finish:

```bash
python3 .agent/skills/notifier/scripts/notify.py \
  --channel feishu \
  --title "Build Complete" \
  --message "Project **destiny** build finished successfully.\n\nArtifacts: `./dist/destiny.tar.gz`"
```

## Resources

### scripts/notify.py

Executable Python script for sending notifications. Can be invoked directly by agents or used in automation workflows.

**Key Features:**
- Channel-based dispatch (feishu, slack, telegram, email, all)
- Multi-channel broadcast (`--channel all`)
- Environment variable support for sensitive config
- Markdown formatting
- Error handling and exit codes
- Timeout protection (10s)
- Thread support for Slack

**Exit Codes:**
- `0`: Success
- `1`: Failure (network error, invalid config, etc.)

**Configuration:**
| Channel | Default Files | CLI Args |
|---------|---------------|----------|
| Feishu | `.claude/state/notifier/feishu-webhook.txt` | `--webhook` / `--feishu-webhook` |
| Slack | `.claude/state/notifier/slack-token.txt`<br>`.claude/state/notifier/slack-channel-id.txt` | `--slack-token`, `--channel-id`, `--thread-ts` |
| Telegram | *(none)* | `--telegram-token`, `--chat-id` |
| Email | *(none)* | `--smtp-host`, `--to` |
