---
name: use-claude-desktop
description: Inspect and operate the local Claude Desktop app for FractalBot-style inbound message delivery. Use when Codex needs to check or force Claude Desktop CDP readiness, understand Claude Desktop CDP auth guard failures, queue normalized inbound envelopes, or deliver an inbound Slack/Telegram/Feishu/Discord/iMessage message into Claude Desktop with durable inbox fallback.
---

# use-claude-desktop

Use this skill for local Claude Desktop routing work on macOS. Prefer the bundled script over ad hoc shell snippets so CDP probing, envelope formatting, and fallback behavior stay consistent.

## Quick Start

Check status:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/use-claude-desktop/scripts/claude-desktop.js" status
```

Queue an inbound envelope without touching the UI:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/use-claude-desktop/scripts/claude-desktop.js" enqueue \
  --channel feishu \
  --chat-id oc_xxx \
  --user-id ou_xxx \
  --selected-agent main \
  --message "user message"
```

Deliver through CDP if available, otherwise queue to inbox:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/use-claude-desktop/scripts/claude-desktop.js" deliver \
  --endpoint http://127.0.0.1:19334 \
  --channel feishu \
  --chat-id oc_xxx \
  --selected-agent main \
  --message "user message"
```

## CDP Reality Check

Claude Desktop 1.19367.0 contains an explicit main-process guard: if `process.argv` includes `--remote-debugging-port` or `--remote-debugging-pipe`, the app exits unless `CLAUDE_CDP_AUTH` verifies for `CLAUDE_USER_DATA_DIR`.

Do not claim CDP is enabled until both probes pass:

```bash
curl -fsS http://127.0.0.1:19334/json/version
curl -fsS http://127.0.0.1:19334/json/list
```

If normal launch fails:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/use-claude-desktop/scripts/claude-desktop.js" force-cdp --port 19334 --try-launch
```

On this host, prefer Launch Services so Claude keeps the normal user profile and keychain path:

```bash
open -na /Applications/Claude.app --args \
  --remote-debugging-port=19334 \
  --remote-debugging-address=127.0.0.1 \
  --remote-allow-origins='*'
```

Use `--mock-keychain` only as a diagnostic mode; it can make CDP available while forcing Claude into a logged-out web session, which is not acceptable for main-session delivery.

Interpretation:

- `cdp.available=true`: CDP can be used.
- `cdp_auth_guard.detected=true` and CDP unavailable: current Claude Desktop blocks unauthenticated `--remote-debugging-port`.
- In-place app patching invalidates vendor signing and is only appropriate after explicit operator approval.
- A patched/ad-hoc-signed app can lose access to the original `Claude Safe Storage` keychain item. If `/json/version` listens but hangs or Claude remains logged out, inspect Keychain ACL before claiming Desktop delivery works.

## Inbound Delivery

The script builds a normalized FractalBot-style envelope with:

- `channel`, `chat_id`, `thread_ts`, `user_id`, `username`
- `selected_agent`, `text`, `body_mode`, `body_file`
- stable `id` and `received_at`

Default fallback is durable queueing at:

```text
~/.fractalbot/claude-desktop-inbox
```

Only use UI fallback when the user explicitly wants the visible current Claude Desktop chat to receive the prompt:

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/use-claude-desktop/scripts/claude-desktop.js" deliver \
  --fallback ui \
  --submit \
  --message "message to paste and submit"
```

Without `--submit`, UI fallback prepares text but does not send.

## Safety

- Never scrape or export arbitrary Claude Desktop history.
- Do not print local config secrets or OAuth/token cache contents.
- Prefer `chat_id` from inbound routing context over guessed recipients.
- Keep external replies explicit; inbound delivery alone must not auto-send outbound FractalBot replies.
- If CDP is blocked, report that status and use inbox fallback rather than claiming direct Desktop delivery.
