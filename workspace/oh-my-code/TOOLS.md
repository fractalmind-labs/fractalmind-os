# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- SSH hosts and aliases
- Preferred voices for TTS
- Device nicknames
- API endpoints (non-secret)
- Anything environment-specific

## Examples

```markdown
### SSH

- dev-server → 10.0.0.5, user: deploy

### Notification Channels

- Slack webhook: (set via $SLACK_WEBHOOK_URL)
- Telegram bot chat: (set via $TELEGRAM_CHAT_ID)

### Repos Under Management

- workspace/my-app → main product repo
- workspace/docs → documentation site
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.
