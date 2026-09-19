# fractalbot

> Multi-channel application adapter for AI agent communication.

**Repo**: [fractalmind-ai/fractalbot](https://github.com/fractalmind-ai/fractalbot)
**Language**: Go
**Status**: Active development

## What It Does

fractalbot is a **channel adapter** in the Application Plane. It routes messages between humans and AI agents across multiple channels:

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
Discord API  ──┼──▸ fractalbot (Go) ──▸ application / agent
Feishu API   ──┤         │
iMessage     ──┘         │
                         ├── signed privileged intent ──▸ target envd ──▸ local adapter
                         ▼
                    Agent / envd result
                         │
                         ▼
                    fractalbot ──▸ Channel API ──▸ Human
```

## Where It Fits

fractalbot is the **entry point** for human ↔ agent communication:

- **Inbound**: Human sends message → fractalbot preserves routing context → application or agent receives it
- **Outbound**: Agent uses `use-fractalbot-skill` → fractalbot sends to correct channel

It does **not** handle agent-to-agent communication — that's `team-chat-skill`.

It also does not grant remote node authority. Channel identity and routing context may feed application policy, but privileged actions still require a signed intent and target-side envd verification. Compromising fractalbot must not grant direct agent-manager or node control.

## Related Components

- [agent-manager](/components/agent-manager) — receives routed messages
- [use-fractalbot-skill](/components/tool-skills) — agent-side sending
- [team-chat](/components/team-chat) — agent-to-agent messaging
