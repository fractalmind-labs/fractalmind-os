# Routing

FractalBot delivers each message to one agent. Channels are bound to agents in the configuration:

```yaml
agents:
  xiaoyi:
    workspace: ~/xiaoyi-clawd
    runtime: codexApp
    session: 01a15669-badd-7c31-b094-660961b49af7
    channels: [feishu.xiaoyi, telegram.main]
  burry:
    workspace: ~/burry-claw
    runtime: claudeDesktop
    channels: [feishu.burry, telegram.main]
```

- **A dedicated channel** is bound to one agent. Every message on it goes to that agent; here, `feishu.burry` goes to burry.
- **A shared channel** is bound to several agents and must name a `default`. Each message goes to one of them, chosen in this order:
  1. **Mention.** `@burry …` at the start of the text, or `/agent burry …` / `/to burry …`. This applies to one message.
  2. **Pinned chat.** `chats` on the channel pins a chat or group to one agent.
  3. **`/use`.** `/use burry` sends the conversation to burry until `/use` is sent with no name. The choice survives restarts.
  4. **Default.** The channel's `default`.
- **`/who`** shows the current receiver and the agents on the channel.
- **Only bound agents can be chosen.** Naming another agent gets a reply listing the agents that can be chosen.

A channel that no agent receives is a configuration error. FractalBot never forwards a message to a host or agent that is not configured here.

## The prompt

Every runtime receives the same prompt. It starts with the routing context:

- the channel and channel instance;
- the chat, sender and receiving bot (`receiver_id` for Feishu);
- the agent, how it was chosen (`selected_by`) and the envelope ID.

The user's message follows. Messages from senders below full trust are wrapped in `<user_input>` with a security note. Long bodies are written to a file and referenced with `body_mode: file_pointer`.

Agents reply with the `use-fractalbot` skill:

```bash
fractalbot message send --channel feishu --receiver-id cli_xxx --to oc_xxx --text "done"
fractalbot message send --channel telegram --to 123 --agent burry --text "BTC is flat"
```

On a shared channel, `--agent` makes the gateway prefix the text with `[burry]` so people can tell who replied. It also checks that the agent is bound to the channel. For Feishu, `--receiver-id` selects the bot that received the message.

## Runtimes

### Claude Desktop

`runtime: claudeDesktop` writes each delivery to the agent's inbox, `<dataDir>/inbox/<agent>/`. A relay inside the agent's Claude Desktop session moves envelopes into the session over its authenticated messaging socket. Start the relay from the workspace's session start hook:

```json
{
  "hooks": {
    "SessionStart": [{"hooks": [{"type": "command", "command": "fractalbot relay >/dev/null 2>&1 &"}]}]
  }
}
```

- **Which agent.** Without `--agent`, the relay serves the `claudeDesktop` agent whose workspace is the current directory.
- **One relay per inbox.** A second relay exits successfully, saying another one already consumes the inbox.
- **Delivered or invalid envelopes.** Delivered envelopes move to `done/`; unreadable ones move to `failed/`.
- **While the session is closed,** deliveries wait in the inbox.
- **Presence.** `/status` reports the agent `online` while a relay holds its inbox.

The inbox format is specified in [inbox-protocol.md](inbox-protocol.md).

### Codex App

`runtime: codexApp` queues each delivery into the agent's pinned Codex thread with `codex queue --thread <session> --message …`, run in the workspace. Codex's own durable queue holds the message until the thread is free, so an active turn finishes first.

- **Confirmation.** A delivery succeeds only when `codex` confirms the target thread. Its error output is never logged, because it may quote the message.
- **Requirements.** No App debugging port, inbox relay or per-workspace script is needed.
- **Setup.** Find the thread ID in Codex and set it as the agent's `session`. Set `runtimes.codexApp.codex` when `codex` is not on the gateway's PATH.

### agent-manager

`runtime: agentManager` runs the workspace's agent-manager `assign <session>` with the prompt on standard input. The session defaults to `main`. Delivery means agent-manager accepted the task.

- **Script.** `runtimes.agentManager.script` changes the entrypoint (default `.claude/skills/agent-manager/scripts/main.py`).
- **Timeout.** `assignTimeoutSeconds` bounds the assign call.
- **Starting.** `startIfMissing` starts a stopped agent before a schedule is delivered.

### Capabilities

| | claudeDesktop | codexApp | agentManager |
| --- | --- | --- | --- |
| Durable while the session is closed | yes (inbox) | yes (Codex queue) | no |
| Starts work in an idle session | yes | yes | yes |
| Can start a stopped agent | no | no | yes |
| Can stop work at process level | no | no | yes |
| Waits for a heartbeat's terminal outcome | no | no | yes (`mode: heartbeatRun`) |
| Presence in `/status` | relay running | unknown | agent-manager status |

## Observability

`GET /status` groups by agent. For each agent it lists:

- runtime, workspace, bound channels and presence;
- declared capabilities;
- the last delivery (source, how the agent was chosen, status, envelope and error);
- the agent's schedules.

The `channels` section lists each instance with the following:

- its agents and default;
- whether it is running;
- why it is unavailable (such as a missing secret);
- telemetry.

Secrets are masked in every error.
