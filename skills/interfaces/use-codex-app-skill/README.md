# use-codex-app-skill

Operate local Codex App or upgraded ChatGPT App agents from a same-machine environment.

## What this skill does

- List running Codex/ChatGPT App agents and threads from the local state database, CDP endpoint, and the visible sidebar.
- Read the human-assigned sidebar names shown in the ChatGPT App/Codex App UI, such as `main`, `PM`, `architect`, or project-specific agents.
- Resolve a named thread exactly before sending a message.
- Deliver messages through the current Codex App renderer bridge by default.
- Fall back to a guarded visible-composer CDP path when the upgraded ChatGPT App no longer exposes the legacy renderer bridge.
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
bash .codex/skills/use-codex-app/scripts/send-codex-app-agent-message.sh --agent main --cwd CloudBank --message 'status?'
```

`list-codex-app-agents.sh` reports three evidence layers:

- `sidebar_agents`: names currently visible in the Codex/ChatGPT App sidebar.
- `threads`: state database rows, including newer `name`, `preview`, `agent_nickname`, `agent_role`, and `agent_path` columns when present.
- `agent_jobs`: active batch jobs when the local app schema still has `agent_jobs`; newer schemas without that table return an empty list instead of failing.
