# fractalbot

> Multi-channel messaging gateway for AI agent communication.

**Repo**: [fractalmind-ai/fractalbot](https://github.com/fractalmind-ai/fractalbot)
**Language**: Go
**Status**: Active development

## What It Does

fractalbot is the **communication layer** of the FractalMind stack. It routes messages between humans and AI agents across multiple channels:

- Telegram
- Slack
- Discord
- Feishu (Lark)
- iMessage

One gateway, all channels.

## Key Principles

- **Local-first**: Runs as a single binary on your machine
- **Gateway-first**: Routes messages, doesn't process them
- **CLI-first**: Everything works from the command line
- **External-agent routing**: Connects to agents managed by agent-manager
- **Secure by default**: No cloud dependencies, data stays local

## Quick Start

```bash
# Install
go install github.com/fractalmind-ai/fractalbot@latest

# Configure (create config file)
fractalbot init

# Start the gateway
fractalbot serve

# Send a message
fractalbot message send --channel telegram --to <chat_id> --text "Hello from fractalbot"
```

## Architecture

```
Telegram API ──┐
Slack API    ──┤
Discord API  ──┼──▸ fractalbot (Go) ──▸ agent-manager ──▸ Agent (tmux)
Feishu API   ──┤         │
iMessage     ──┘         │
                         ▼
                    Agent response
                         │
                         ▼
                    fractalbot ──▸ Channel API ──▸ Human
```

## Where It Fits

fractalbot is the **entry point** for human ↔ agent communication:

- **Inbound**: Human sends message → fractalbot routes to agent-manager → agent receives in tmux
- **Outbound**: Agent uses `use-fractalbot-skill` → fractalbot sends to correct channel

It does **not** handle agent-to-agent communication — that's `team-chat-skill`.

## Related Components

- [agent-manager](/components/agent-manager) — receives routed messages
- [use-fractalbot-skill](/components/tool-skills) — agent-side sending
- [team-chat](/components/team-chat) — agent-to-agent messaging
