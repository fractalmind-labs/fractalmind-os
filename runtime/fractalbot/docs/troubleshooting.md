# Troubleshooting: Failure Handling and Rollback

This guide is based on FractalBot's current runtime and error-handling code in:

- `cmd/fractalbot/main.go`
- `internal/config/config.go`
- `internal/gateway/server.go`
- `internal/channels/*`
- `internal/agent/manager.go`

If you follow the steps below, you can usually recover without data loss.

## 0) Fast Triage (Run First)

### Symptoms

- Bot is silent
- `fractalbot message send` fails
- Gateway APIs are unreachable

### Likely Cause

- Gateway process is down, wrong bind/port, or one channel failed to start.

### Fix

```bash
# 1) Basic gateway health
curl -sS http://127.0.0.1:18789/health

# 2) Full runtime status (channels + last_error timestamps)
curl -sS http://127.0.0.1:18789/status | python3 -m json.tool

# 3) CLI path check (goes through /api/v1/message/send)
fractalbot --config ./config.yaml message send \
  --channel telegram \
  --to 123456789 \
  --text "health check"
```

### Rollback and Recovery

```bash
# If you run as systemd user service
systemctl --user restart fractalbot.service
journalctl --user -u fractalbot.service -n 200 --no-pager
```

---

## 1) Config Errors

### Symptoms

The gateway refuses to start with `failed to load config:` followed by one line per problem, for example:

- `this is a version 1 configuration (it has no version: 2)` followed by the rewrites it needs
- `line 12: unknown field "text" (text is now prompt (or promptFile))`
- `line 8: must be a secret reference (secret:<name>); plaintext values are not accepted`
- `channels.telegram.main: no agent receives this channel`
- `channels.telegram.main.default: required because burry, xiaoyi share this channel`
- `agents.burry.workspace: /path is not a directory`
- `agents.xiaoyi.session: codexApp agents need the Codex thread ID`

### Fix

```bash
cp config.yaml config.yaml.bak.$(date +%Y%m%d%H%M%S)
fractalbot --config config.yaml config check
```

`config check` lists every problem at once and also checks this machine: whether each secret is set, whether `codex` and `tmux` exist, and whether each channel and runtime works on this OS. Rewrite a version 1 file with the table in [Configuration](config-v2.md#rewriting-a-version-1-file).

A channel whose secret is missing does not stop the gateway: that channel stays stopped and `/status` shows `"unavailable": "secret … is not set"`. Store it with `fractalbot secret set <name>`.

---

## 2) Token/Credential Invalid or Revoked

### Symptoms

Examples from runtime logs/errors:

- Telegram polling: `Telegram polling error: telegram getUpdates failed: ...`
- Telegram webhook registration: `telegram setWebhook failed: ...`
- Slack runtime: `slack socket mode error: ...`
- Feishu send: `feishu send failed: code=<code> msg=<msg>`
- Discord init/open fails with token/auth errors from Discord API

### Likely Cause

- Expired/revoked/incorrect token (`botToken`, `appToken`, `token`, `appSecret`).

### Fix

1. Rotate token in provider console (BotFather / Slack App / Discord Developer Portal / Feishu/Lark console).
2. Update `config.yaml`.
3. Restart FractalBot.
4. Re-check:

```bash
curl -sS http://127.0.0.1:18789/status | python3 -m json.tool
```

### Rollback and Recovery

- Temporarily disable only the broken channel (`enabled: false`) and keep others running.
- Restore previous token from secure secret manager if rotation was accidental.

---

## 3) Network Issues (Gateway Timeout, Webhook Callback Failure)

### Symptoms

- CLI send path:
  - `failed to send message: request http://127.0.0.1:18789/api/v1/message/send failed: ...`
- Telegram webhook:
  - HTTP `401` from webhook endpoint when secret header mismatch
  - `Telegram webhook server error: ...`
  - `Failed to parse Telegram webhook update: ...`

### Likely Cause

- Gateway not listening on expected bind/port.
- Firewall/reverse proxy/public URL mismatch.
- Telegram webhook secret token mismatch.

### Fix

```bash
# Check local listener
ss -ltnp | rg 18789 || lsof -i :18789

# Check gateway endpoints
curl -sS http://127.0.0.1:18789/health
curl -sS http://127.0.0.1:18789/status | python3 -m json.tool
```

For webhook mode:

- Ensure `webhookPublicURL` is public HTTPS.
- Ensure reverse proxy forwards `X-Telegram-Bot-Api-Secret-Token` unchanged.
- Ensure `webhookPath` matches exactly.

### Rollback and Recovery

If webhook path is unstable, roll back to polling mode (local-friendly):

```yaml
channels:
  telegram:
    mode: "polling"
    webhookRegisterOnStart: false
    webhookDeleteOnStop: false
    webhookListenAddr: ""
    webhookPublicURL: ""
```

Then restart service.

---

## 4) Message Send Failures (`channel_not_found`, rate limit, channel not enabled)

### Symptoms

From `fractalbot message send` / gateway API:

- `gateway API error (404): channel "slack" not found`
- `gateway API error (502): ...`
- Slack API may bubble errors such as `channel_not_found` or `ratelimited`
- Telegram send path may return `telegram API returned status <code>: ...`

### Likely Cause

- Channel is not enabled/registered.
- Wrong `--channel` or wrong target ID (`--to`).
- Provider-side constraints (invalid channel, rate limit, permission scope).

### Fix

```bash
# Confirm channel is enabled and running
curl -sS http://127.0.0.1:18789/status | python3 -m json.tool

# Retry with a known-good target
fractalbot --config ./config.yaml message send \
  --channel slack \
  --to C0123456789 \
  --text "retry after verification"
```

If using Slack thread replies, verify `--thread-ts` is valid for that channel.

### Rollback and Recovery

- Remove `--thread-ts` and send as a normal message first.
- Route urgent outbound notification through another healthy channel until Slack/Telegram target is fixed.

---

## 5) Gateway Crash/Restart and State Recovery

### Symptoms

- `/health` unreachable
- Process exits and no new channel events
- systemd repeatedly restarts service

### Likely Cause

- Fatal startup error (config/channel init failure).
- Runtime crash in environment/dependency.

### Fix

```bash
# systemd user service status/logs
systemctl --user status fractalbot.service --no-pager
journalctl --user -u fractalbot.service -n 200 -f

# Manual foreground run for immediate stack/log visibility
fractalbot --config ./config.yaml --verbose
```

### Rollback and Recovery

```bash
# Revert to last known-good config
cp config.yaml.bak.<timestamp> config.yaml

# Restart service
systemctl --user restart fractalbot.service
```

Telegram polling recovery note:

- `pollingOffsetFile` persists `UpdateID+1`.
- Keep this file writable to avoid duplicate update processing after restart.
- If offset file is corrupted, fix/remove it and restart:

```bash
rm -f ./workspace/telegram.offset
systemctl --user restart fractalbot.service
```

---

## 6) Agent Integration Failures (timeout, assign/start/stop/monitor errors)

### Symptoms

- `❌ … does not receive this channel; choose one of: …`: the message named an agent not bound to the channel.
- A message is acknowledged but nothing happens: check the agent's `last_delivery` in `/status`.
- `agent-manager assign failed: …`, `codex queue rejected the message (exit code N)` or `codex queue did not confirm the target thread`.
- A Claude Desktop agent shows `"presence": "offline"`: no relay holds its inbox, so deliveries wait in `<dataDir>/inbox/<agent>/`.

### Fix

```bash
curl -sS http://127.0.0.1:18789/status | python3 -m json.tool   # agents[].last_delivery, presence
```

- **agent-manager:** in the workspace, run `python3 .claude/skills/agent-manager/scripts/main.py doctor`, then `status main` and `monitor main --lines 120`. Raise `runtimes.agentManager.assignTimeoutSeconds` for slow assigns.
- **Codex App:** confirm the thread ID in the agent's `session` and that `runtimes.codexApp.codex` (or `codex` on PATH) is the CLI that owns that thread. Then run `codex queue --thread <id> --message test` from the workspace.
- **Claude Desktop:** open the agent's session. Its start hook should run `fractalbot relay`, or run it in the session yourself. Envelopes the relay cannot read are in `failed/`.

---

## 7) iMessage-Specific Failures (macOS permissions/runtime)

### Symptoms

- `imessage channel is only supported on darwin`
- `imessage database not accessible (...)`
- `imessage database permission check failed: ...`
- `imessage app permission check failed: ...`
- `messages app did not start in time`
- `imessage osascript failed: ...`

### Likely Cause

- Running on non-macOS host.
- Missing Full Disk Access / Automation permissions for `sqlite3` or `osascript`.
- Messages app not started or inaccessible.

### Fix

1. Run iMessage channel only on macOS.
2. Grant required permissions (Terminal + Messages automation / database access).
3. Verify recipient + service (`E:iMessage` by default).

### Rollback and Recovery

- Disable `channels.imessage.enabled` and keep other channels running.
- Re-enable after permission checks pass.

---

## Operational Safety Tips

- Always backup `config.yaml` before edits.
- Change one channel at a time, then validate with `/status`.
- For production-like usage, prefer systemd user service + log tailing.
- Keep webhook mode only when HTTPS ingress is stable; otherwise use polling.
