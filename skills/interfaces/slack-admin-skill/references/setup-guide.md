# Slack Admin — Setup Guide

## Step 1: Open Slack App Settings

Go to: https://api.slack.com/apps

Select your bot app (the one whose token is in `~/.config/fractalbot/config.yaml`).

## Step 2: Add Bot Token Scopes

1. In the left sidebar, click **OAuth & Permissions**
2. Scroll down to **Scopes** → **Bot Token Scopes**
3. Click **Add an OAuth Scope** and add the scopes listed below

### Required Scopes

These are needed for core functionality:

| Scope | Used By | Purpose |
|-------|---------|---------|
| `chat:write` | (already have) | Send messages |
| `users:read` | `user-info`, `user-list`, `user-avatar` | Read user profiles and avatars |
| `users:read.email` | `user-info` | Read user email addresses |
| `channels:read` | `channel-list`, `channel-info`, `channel-members` | List and read public channels |
| `groups:read` | `channel-list`, `channel-info` | List and read private channels |
| `im:read` | `channel-list` | List DM conversations |
| `files:write` | `upload` | Upload files to channels |
| `files:read` | `upload` | Read file metadata |
| `channels:history` | gateway mention context | Read recent messages in public channels |
| `groups:history` | gateway mention context | Read recent messages in private channels |

### Optional Scopes

Add these only if you need the corresponding admin features:

| Scope | Used By | Purpose |
|-------|---------|---------|
| `channels:manage` | `channel-create`, `channel-topic` | Create channels, set topic/purpose |
| `groups:write` | `channel-create --private` | Create/manage private channels |
| `users.profile:read` | `user-info` (enhanced) | Read detailed user profile fields |
| `pins:write` | (future) | Pin messages in channels |
| `reactions:write` | (future) | Add emoji reactions |
| `team:read` | (future) | Read workspace info |

## Step 3: Reinstall App

After adding scopes, Slack will show a yellow banner:

> **You've changed the permission scopes your app uses. Please reinstall your app.**

1. Click **Reinstall to Workspace** (or scroll up to the Install App section)
2. Click **Allow** on the OAuth consent screen
3. The Bot User OAuth Token (`xoxb-...`) may change — update it in `~/.config/fractalbot/config.yaml` if needed

## Step 4: Verify

First, print the token's granted scopes and anything missing:

```bash
python3 scripts/slack_admin.py scopes
```

`missing_required` and `missing_inbound_context` must both be empty; the command
exits `1` while a scope is still missing. The `missing_inbound_context` group is
what a gateway needs to enrich a message that mentions the bot (channel info,
recent messages, files, user directory).

Run the auth test to confirm the token works and has the right scopes:

```bash
python3 scripts/slack_admin.py auth-test
```

Expected output:
```json
{
  "ok": true,
  "bot": "your-bot-name",
  "team": "your-workspace",
  "user_id": "U...",
  "team_id": "T..."
}
```

Then test a user lookup:

```bash
python3 scripts/slack_admin.py user-info U0123456789
```

If you see `missing_scope` errors, go back to Step 2 and add the missing scope.

## Troubleshooting

### "missing_scope" error

The API response includes `needed: "scope_name"`. Add that scope in Step 2 and
reinstall, then confirm with `python3 scripts/slack_admin.py scopes`.

A gateway that logs `failed to resolve channel info`, `failed to fetch recent
messages`, `failed to fetch files for mention`, or `failed to fetch user
directory` is hitting the same class of error: add
`channels:read`/`groups:read`, `channels:history`/`groups:history`,
`files:read`, and `users:read` respectively.

### "invalid_auth" error

The token is wrong or expired. Re-copy from the OAuth & Permissions page.

### "not_in_channel" error

The bot needs to be invited to the channel first. In Slack, type `/invite @your-bot-name` in the channel.

### Token changed after reinstall

Update `~/.config/fractalbot/config.yaml`:
```yaml
channels:
  slack:
    botToken: xoxb-NEW-TOKEN-HERE
```
