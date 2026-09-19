# use-fractalbot-skill

Skill instructions for sending messages and replies through `fractalbot` CLI.

## Compatibility

| Component | Requirement |
|---|---|
| Host OS | Linux/macOS/Windows (WSL supported) |
| FractalBot CLI | Installed and reachable in `PATH` |
| Gateway | Running and authenticated where required |
| Skill File | `SKILL.md` at repo root |

## Inbound Reply Context

When FractalBot routes a channel message to an agent, the task may include `Inbound routing context` fields such as `channel`, `chat_id`, `thread_ts`, `user_id`, and `selected_agent`. The skill now instructs agents to reply with:

- `--channel` from `channel`
- `--to` from `chat_id`
- `--thread-ts` from `thread_ts` for Slack thread replies

For Feishu/Lark, `chat_id` values such as `oc_...` should be preferred over `open_id` values such as `ou_...` when replying to the same chat.

## Quick Check

```bash
fractalbot --help
```

If this command fails, install/configure FractalBot before using the skill.
