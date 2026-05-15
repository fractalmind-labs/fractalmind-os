# use-codex-app-skill

Operate local Codex App agents from a same-machine environment.

## What this skill does

- List running Codex App agents and threads from the local state database and CDP endpoint.
- Resolve a named thread exactly before sending a message.
- Deliver messages through the current Codex App renderer bridge by default.
- Fall back to an explicitly chosen app-server WebSocket only when the user passes it.
- Keep delivery local, visible, and app-owned instead of synthetic DOM typing.

## Repository layout

- `SKILL.md`: main usage guide and transport rules.
- `scripts/`: helper scripts for listing agents, sending messages, and maintaining the CDP monitor.
- `agents/openai.yaml`: app-facing metadata used by Codex.

## Local usage

```bash
bash .codex/skills/use-codex-app/scripts/list-codex-app-agents.sh --cwd MyProject --json
bash .codex/skills/use-codex-app/scripts/send-codex-app-agent-message.sh --thread-id <id> --message 'hello'
```
