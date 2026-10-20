# Agent Routing

FractalBot selects one inbound runtime with `agents.router`. Supported values are `ohMyCode`, `codexAppCDP`, and `claudeDesktop`. If `router` is empty, the first enabled runtime is selected in that order; if none is enabled, supported inbound messages use the legacy echo behavior.

Generic Agent Router ingress currently accepts Telegram, Feishu/Lark, Slack, Discord, and iMessage. Demail transport can receive and send messages, but Demail messages do not yet enter these Agent Routers.

## Agent selection

Send `/agent <name> <task>` (or `/to <name> <task>`) to select an allowed agent. Use `/admin <text>` to send recovery or management text to the reserved `admin` agent. Messages without an explicit selection use the active router's `defaultAgent`.

Agent names are logical IDs. For an agent-manager workspace with a tmux
namespace, address the reserved main agent as `main`; do not configure the
physical session name (for example, `xiaoyi--main`). FractalBot also accepts a
namespace-qualified `--main` value and normalizes it to `main` for compatibility.

When `allowedAgents` is set, only listed names are accepted, so add `admin` before enabling `/admin`. `/agents` shows the available names. Routed envelopes include the available source context (`channel`, chat/thread/user/message IDs, original text, and timestamp) plus `selected_agent` so the target can reply through the correct channel.

Common commands:

| Command | Purpose |
| --- | --- |
| `/agents` | List allowed agent names. |
| `/admin <text>` | Route recovery or management text to the `admin` agent. |
| `/monitor <name> [lines]` | Show recent oh-my-code agent output, capped at 200 lines. |
| `/startagent <name>` | Start an oh-my-code agent; admin only. |
| `/stopagent <name>` | Stop an oh-my-code agent; admin only. |
| `/doctor` | Run oh-my-code diagnostics; admin only. |
| `/whoami` | Show channel identity values for allowlist setup. |
| `/ping` | Check channel responsiveness. |

`/tool` and `/tools` are intentionally unavailable in gateway mode.

## oh-my-code

The `ohMyCode` router invokes the agent-manager script in an existing oh-my-code workspace.

```yaml
agents:
  router: "ohMyCode"
  ohMyCode:
    enabled: true
    workspace: "/path/to/oh-my-code"
    agentManagerScript: ".claude/skills/agent-manager/scripts/main.py"
    defaultAgent: "qa-1"
    allowedAgents:
      - "qa-1"
      - "admin"
      - "coder-a"
    assignTimeoutSeconds: 90
```

The workspace requires Python, tmux, and agent-manager. If routed agents need to send channel replies, make the `use-fractalbot` skill available in that workspace.

### Receiver-specific targets

One gateway can route different bot/receiver identities to separate named
oh-my-code workspaces. Prefer `receivers`, which binds both the normalized
`channel` and `receiverId`. That pairing prevents a receiver identity shared
by two different channel types from selecting the wrong workspace.

`receiverIds` remains supported for existing deployments, but is
channel-agnostic and must be globally unique. New configurations should use
`receivers`.

Feishu uses the configured App ID as `receiver_id`; it does **not** use a
sender or chat ID. A gateway may run the legacy singleton Feishu bot plus any
number of named `channels.feishu.bots` instances. Each named instance opens
its own connection, receives with its own App ID, and replies through that same
identity. The same chat can therefore be safely served by multiple bots.

```yaml
agents:
  router: "ohMyCode"
  ohMyCode:
    enabled: true

    # Existing single-workspace configuration remains the fallback for an
    # unmatched or unavailable receiver identity.
    workspace: "/path/to/default-workspace"
    defaultAgent: "main"
    allowedAgents: ["main"]

    targets:
      support:
        receivers:
          - channel: feishu
            receiverId: "cli_support_bot"
        workspace: "/path/to/support-workspace"
        agentManagerScript: ".claude/skills/agent-manager/scripts/main.py"
        defaultAgent: "support-main"
        allowedAgents: ["support-main", "admin"]
        assignTimeoutSeconds: 90
```

For two Feishu bots without a legacy singleton, configure the bot instances
alongside those receiver targets:

```yaml
channels:
  feishu:
    enabled: true
    bots:
      support:
        appId: "cli_support_bot"
        appSecret: "..."
      sales:
        appId: "cli_sales_bot"
        appSecret: "..."
```

The inbound assignment includes `receiver_id` for Feishu. When an agent sends
a later outbound reply through the CLI, preserve that identity explicitly:

```bash
fractalbot message send --channel feishu --receiver-id cli_support_bot --to <chat_id> --text "reply"
```

With named multi-bot configuration, an outbound Feishu send without
`--receiver-id` is rejected rather than guessing a bot. Existing singleton
configuration continues to work without this flag.

Each scoped channel/receiver pair must be unique across targets; invalid or
duplicate routes fail configuration validation. A named target owns the default agent for
messages without an explicit `/agent` or `/to` selection. Explicit selections
are checked again against the chosen target's `allowedAgents`. Status
diagnostics record the named target but never the raw receiver identity.

## ChatGPT / Codex App

The `codexAppCDP` router delivers into a project conversation managed by the ChatGPT/Codex desktop app. The configuration key keeps its historical `codexAppCDP` name. Delivery first uses the running renderer's in-process `start-turn-for-host` bridge through CDP. If an upgraded App no longer exposes that handler, FractalBot uses a guarded visible-composer fallback in the exact resolved thread, protects an unrelated draft, and requires target-thread readback. It does not start a separate `codex app-server --listen` backend.

```yaml
agents:
  router: "codexAppCDP"
  codexAppCDP:
    enabled: true
    cdpEndpoint: "http://127.0.0.1:9222"
    targetSelector: "Codex"
    hostId: "local"
    targetProject:
      name: "CloudBank"
      cwd: "/Users/you/Develop/SuLabsOrg/CloudBank"
      session: "main"
    conversationId: ""
    inboxPath: "/Users/you/Develop/SuLabsOrg/CloudBank/.fractalbot/inbox"
    fallbackToInbox: true
    repairPolicy: "relaunch"
    checkOnIncomingMessage: true
    watch:
      enabled: true
      intervalSeconds: 60
      cooldownSeconds: 90
    defaultAgent: "main"
    allowedAgents:
      - "main"
    deliveryTimeoutSeconds: 20
```

Launch the installed desktop bundle with CDP enabled. Current releases use `ChatGPT.app`; older installations or local aliases may expose `Codex.app`.

```bash
open -na /Applications/ChatGPT.app --args --remote-debugging-port=9222
curl -fsS http://127.0.0.1:9222/json/version
curl -fsS http://127.0.0.1:9222/json/list
```

Prefer `targetProject.cwd` plus `targetProject.session` over a pinned `conversationId`. FractalBot resolves the current non-archived conversation before each delivery. A configured `conversationId` remains an explicit override.

Repair policies are `off`, `status-only`, `new-instance`, and `relaunch`. The default for an enabled route is `relaunch`, with the watchdog enabled. Set `status-only` when FractalBot should report readiness without controlling the app lifecycle.

When both direct bridge delivery and the guarded composer fallback fail, and `fallbackToInbox` is true, FractalBot atomically writes the normalized envelope to `inboxPath` for later consumption.

### Native queue bridge without CDP

An existing Codex session can receive messages through the optional
[`codex queue` bridge](codex-native-queue.md). Point the intended receiver
target's `agentManagerScript` at the adapter to preserve the other receivers,
and use a dedicated Codex inbox for heartbeats. Queue acceptance and task
completion remain separate; replies are sent explicitly through FractalBot.

## Claude Desktop

The `claudeDesktop` router either submits to an authenticated Claude chat page exposed by CDP or queues to a private inbox consumed by a relay running inside the target Claude session.

```yaml
agents:
  router: "claudeDesktop"
  claudeDesktop:
    enabled: true
    # Leave empty when the signed Claude Desktop build blocks remote debugging.
    cdpEndpoint: ""
    targetSelector: ""
    inboxPath: "/Users/you/.fractalbot/claude-desktop-inbox"
    fallbackToInbox: true
    defaultAgent: "main"
    allowedAgents:
      - "main"
    deliveryTimeoutSeconds: 20
```

When CDP is enabled, the selected target must be a signed-in Claude chat, not a login page:

```bash
curl -fsS http://127.0.0.1:19334/json/version
curl -fsS http://127.0.0.1:19334/json/list
```

### Authenticated inbox relay

Current signed Claude Desktop builds may reject `--remote-debugging-port`. In that case, omit `cdpEndpoint` so FractalBot queues immediately, and start the relay from the target Claude session. The relay reads `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN` only from that session's environment, validates that the socket is owned by the current user with private permissions, sends the required auth frame, and archives delivered envelopes under `inboxPath/done/`.

Add a workspace-local Claude setting so only the intended project starts the relay:

```json
{
  "crossSessionInbound": "accept",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "umask 077; mkdir -p \"$HOME/.fractalbot/claude-desktop-inbox\"; nohup fractalbot --config \"$HOME/.config/fractalbot/config.yaml\" claude-desktop relay >>\"$HOME/.fractalbot/claude-desktop-inbox/.relay.log\" 2>&1 &",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

The command runs until the Claude session's socket closes. A private inbox lock makes repeated `SessionStart` hooks idempotent. Run it in the foreground for diagnostics, or process the current queue once:

```bash
fractalbot --config "$HOME/.config/fractalbot/config.yaml" claude-desktop relay
fractalbot --config "$HOME/.config/fractalbot/config.yaml" claude-desktop relay --once
```

Do not copy the messaging token into a config file or command-line flag. One inbox should have one intended Claude Desktop session relay.

When a message is queued, FractalBot checks that inbox's relay lock: if a relay process holds it and its Claude session socket still exists, the sender gets `处理中…`; otherwise `已排队，Claude 会话上线后处理。`, and the message waits for the next session that starts a relay. Whether the agent has actually picked a message up is the agent's own reply to send (for example from a workspace rule), not FractalBot's.

To move one bot to Claude Desktop while the others keep the agent-manager, leave `router: "ohMyCode"`, enable `claudeDesktop`, and give that bot's receiver target `runtime: claudeDesktop` (no workspace needed):

```yaml
agents:
  router: "ohMyCode"
  ohMyCode:
    enabled: true
    targets:
      xiaoyi:
        receivers:
          - channel: feishu
            receiverId: "cli_xxx"
        defaultAgent: main
        runtime: claudeDesktop
      burry:
        receivers:
          - channel: feishu
            receiverId: "cli_yyy"
        workspace: "/path/to/burry"
        defaultAgent: main
  claudeDesktop:
    enabled: true
    cdpEndpoint: ""
    inboxPath: "/Users/you/.fractalbot/claude-desktop-inbox"
    fallbackToInbox: true
    defaultAgent: main
```

The delivered prompt includes the inbound `receiver_id`, so replies can be sent as the receiving bot.

To relay different bots into different Claude sessions, give each such target its own inbox with `claudeDesktopInboxPath`, and start each session's relay on its inbox with `--inbox-path`. Targets without one keep `agents.claudeDesktop.inboxPath`:

```yaml
      xiaoyi:
        receivers:
          - channel: feishu
            receiverId: "cli_xxx"
        defaultAgent: main
        runtime: claudeDesktop
        claudeDesktopInboxPath: "/Users/you/.fractalbot/claude-desktop-inbox/xiaoyi"
```

```bash
fractalbot --config "$HOME/.config/fractalbot/config.yaml" claude-desktop relay --inbox-path "$HOME/.fractalbot/claude-desktop-inbox/xiaoyi"
```

`claudeDesktopInboxPath` is only valid with `runtime: claudeDesktop`. A `claudeDesktop` heartbeat job reaches the same session when it names the receiver target with `target` (see [heartbeat.md](heartbeat.md)); without one it uses the shared inbox.

FractalBot does not launch Claude Desktop, patch the application, bypass its CDP authentication guard, scrape chat history, or inject input through AppleScript. If the target is unavailable, logged out, lacks a compose box, or rejects submission, a configured fallback inbox receives the normalized envelope and delivery prompt with private file permissions.

## Observability

Use the status endpoint to inspect the selected router and most recent outcome:

```bash
curl -sS http://127.0.0.1:18789/status | python3 -m json.tool
```

For desktop routes, `agents.last_routing` records the backend, status (`delivered`, `queued`, or `error`), selected agent, envelope ID, inbox path, and delivery error. The Codex App route also reports CDP readiness and the resolved project conversation.

See [Troubleshooting](troubleshooting.md) for startup and delivery failures.
