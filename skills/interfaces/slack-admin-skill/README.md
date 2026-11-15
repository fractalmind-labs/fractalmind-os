# slack-admin-skill

Skill instructions for administering a Slack workspace from the CLI, including
diagnosing the `missing_scope` errors that stop an agent from reading a channel.

## Compatibility

| Component | Requirement |
|---|---|
| Host OS | Linux / macOS / Windows (WSL supported) |
| Python | 3.9+ — standard library only, no dependencies |
| Slack app | Bot token carrying the scopes listed in `SKILL.md` |
| Skill file | `SKILL.md` at the skill root |

## Install

```bash
npx skills add fractalmind-labs/fractalmind-os --skill slack-admin
npx skills list
```

Restart an already-running agent session so it discovers the skill. The CLI
installs into `.agents/skills/`; existing setups that use `.agent/skills/` keep
working.

## What it does

`scripts/slack_admin.py` is a single-file CLI over the Slack Web API:

- `auth-test` — bot identity and workspace
- `scopes` — the token's granted scopes, the required ones it is missing, and the
  scopes FractalBot's inbound context needs; exits `1` when something is missing
- `user-info`, `user-list`, `user-avatar` — users and avatars
- `channel-list`, `channel-info`, `channel-members` — channels and members
- `channel-create`, `channel-topic` — channel administration
- `upload` — upload a file to a channel
- `set-avatar` — set the bot's profile photo

Every subcommand prints JSON on stdout, so callers can parse it.

## Fixing `missing_scope`

A bot token only has the scopes it was issued with; Slack never grants a new one
retroactively. When an agent or gateway logs errors such as
`failed to resolve channel info for C…: missing_scope`, the message still
arrives — only the enrichment around it is dropped. Each error names a scope gap:

| Symptom | Missing scope |
|---|---|
| cannot resolve channel info | `channels:read`, `groups:read` |
| cannot fetch recent messages | `channels:history`, `groups:history` |
| cannot fetch files for a mention | `files:read` |
| cannot fetch the user directory | `users:read` |

Run `scopes` to confirm, then add the scopes under **OAuth & Permissions** in
<https://api.slack.com/apps>, reinstall the app to the workspace, update the token
where the gateway reads it, and re-run `scopes` until nothing is missing.
`references/setup-guide.md` has the full walkthrough.

## Token resolution

The script resolves the bot token in this order:

1. `--token` argument
2. `SLACK_BOT_TOKEN` environment variable
3. `~/.config/fractalbot/config.yaml` → `channels.slack.botToken`

The token is read at runtime and never written anywhere. Keep it out of prompts,
logs, reports and commits.

## Verify

```bash
python3 "<skill_dir>/scripts/slack_admin.py" auth-test
python3 "<skill_dir>/scripts/slack_admin.py" scopes
```
