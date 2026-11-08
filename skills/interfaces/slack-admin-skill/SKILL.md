---
name: slack-admin
description: Slack workspace administration — manage channels, users, files, and bot settings, and diagnose Slack API `missing_scope` errors that stop an agent from reading a channel. Use when you need to read user profiles or avatars, list or create channels, read channel info and members, upload files, configure the Slack bot, or check which OAuth scopes a bot token actually has.
license: MIT
allowed-tools: [Bash, Read]
---

# slack-admin

Manage a Slack workspace from the CLI. Single Python script, stdlib only.

## When to use

Use this skill when you need to:

- find out which OAuth scopes a bot token really has (`scopes`)
- fix `missing_scope` errors that block an agent from reading a channel, its
  files, or the user directory
- read user profiles, emails and avatars (`user-info`, `user-list`, `user-avatar`)
- list channels, read channel details and members (`channel-list`, `channel-info`,
  `channel-members`)
- create a channel or set its topic (`channel-create`, `channel-topic`)
- upload a file to a channel (`upload`)
- set the bot's avatar (`set-avatar`)

## Quick start

```bash
# Which scopes does this token have, and which are missing?
python3 "<skill_dir>/scripts/slack_admin.py" scopes

# Bot identity and workspace
python3 "<skill_dir>/scripts/slack_admin.py" auth-test

# Channel details
python3 "<skill_dir>/scripts/slack_admin.py" channel-info C0123456789
```

## Diagnosing `missing_scope`

`missing_scope` means the bot token was issued without the scope the call needs.
Slack does not grant a scope retroactively: you add it in the app settings and
reinstall the app, which issues a token carrying the new scope.

Run `scopes` first — it reports the granted scopes plus what is missing:

```bash
python3 "<skill_dir>/scripts/slack_admin.py" scopes
```

```json
{
  "granted": ["chat:write", "channels:read", "users:read"],
  "missing_required": ["files:read", "groups:read"],
  "missing_inbound_context": ["channels:history", "files:read"],
  "reinstall_hint": "Add the missing scopes under OAuth & Permissions, ..."
}
```

Exit code is `1` when a required or inbound-context scope is missing, so a
caller can gate on it.

Map the symptom to the scope that fixes it:

| Symptom in the agent or gateway log | Missing scope |
|---|---|
| `failed to resolve channel info for C…: missing_scope` | `channels:read` (public), `groups:read` (private) |
| `failed to fetch recent messages for channel C…: missing_scope` | `channels:history`, `groups:history` |
| `failed to fetch files for mention in C…: missing_scope` | `files:read` |
| `failed to fetch user directory: missing_scope` | `users:read` |
| `cannot read email` | `users:read.email` |

FractalBot logs these as `slack: failed to … : missing_scope` in its
`error.log`. Each one is a scope gap, not a network or routing failure: the
message itself still arrives, only the enrichment around it is dropped.

Repair steps:

1. Open <https://api.slack.com/apps> and select the app whose token the gateway
   uses.
2. **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** add the missing
   scopes (see `references/setup-guide.md`).
3. **Install App** → **Reinstall to Workspace** and approve.
4. If Slack shows a new **Bot User OAuth Token**, update it wherever the gateway
   reads it (`channels.slack.botToken` in the FractalBot config) and restart the
   gateway.
5. Re-run `scopes` and confirm `missing_required` and `missing_inbound_context`
   are empty.

Adding a scope does not require re-inviting the bot to a channel, and it does
not change existing message history.

## Commands

### Authentication and scopes

```bash
# Bot identity + workspace
python3 "<skill_dir>/scripts/slack_admin.py" auth-test

# Granted scopes and missing ones (exit 1 when something required is missing)
python3 "<skill_dir>/scripts/slack_admin.py" scopes
```

### Users

```bash
# User info (name, email, avatar URL, status, timezone)
python3 "<skill_dir>/scripts/slack_admin.py" user-info U0123456789

# List all workspace users
python3 "<skill_dir>/scripts/slack_admin.py" user-list

# Download a user avatar
python3 "<skill_dir>/scripts/slack_admin.py" user-avatar U0123456789
python3 "<skill_dir>/scripts/slack_admin.py" user-avatar U0123456789 --output /tmp/avatar.jpg
```

### Channels

```bash
# List channels (public + private the bot can see)
python3 "<skill_dir>/scripts/slack_admin.py" channel-list

# Channel details (topic, purpose, member count, created date)
python3 "<skill_dir>/scripts/slack_admin.py" channel-info C0123456789

# Create a channel
python3 "<skill_dir>/scripts/slack_admin.py" channel-create my-new-channel
python3 "<skill_dir>/scripts/slack_admin.py" channel-create my-private --private

# Set the channel topic
python3 "<skill_dir>/scripts/slack_admin.py" channel-topic C0123456789 "New topic here"

# List channel members
python3 "<skill_dir>/scripts/slack_admin.py" channel-members C0123456789
```

### Files

```bash
python3 "<skill_dir>/scripts/slack_admin.py" upload /tmp/report.pdf C0123456789
python3 "<skill_dir>/scripts/slack_admin.py" upload /tmp/image.png C0123456789 --comment "Screenshot"
```

### Bot settings

```bash
python3 "<skill_dir>/scripts/slack_admin.py" set-avatar /tmp/bot-avatar.jpg
```

## Token resolution

The script finds the Slack bot token in this order:

1. `--token` CLI argument
2. `SLACK_BOT_TOKEN` environment variable
3. auto-read from `~/.config/fractalbot/config.yaml` → `channels.slack.botToken`

Pass the token through one of those channels only. Never paste a token into a
prompt, a log, a report, or a committed file, and never print it back to a
channel.

## Required scopes

| Group | Scopes | Needed by |
|---|---|---|
| Core | `chat:write`, `channels:read`, `groups:read`, `files:read`, `users:read` | `scopes`, `channel-*`, `user-*`, `upload` |
| Inbound context | `channels:history`, `groups:history` (plus core) | gateway enrichment of a message that mentions the bot |
| Optional | `users:read.email`, `im:read`, `files:write`, `channels:manage`, `groups:write`, `users.profile:read`, `team:read` | email lookups, uploads, channel creation, topic changes |

Full setup walkthrough: `references/setup-guide.md`.

## Resources

### `scripts/slack_admin.py`

Single-file CLI tool. Python 3 stdlib only (`urllib`, `json`, `argparse`). All
subcommands print JSON.

Exit codes:

- `0`: success
- `1`: error (auth failure, API error, missing argument, missing scope)

### `references/setup-guide.md`

Step-by-step Slack app scope setup and troubleshooting.
