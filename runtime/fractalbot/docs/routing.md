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
oh-my-code workspaces. `receiverIds` is deliberately channel-agnostic: a
channel adapter normalizes its recipient identity into `receiver_id`, and the
Agent Router performs an exact match without inspecting the channel name.

Feishu is the first adapter that supplies this value. It uses the configured
Feishu App ID as the receiver identity; it does **not** use a sender or chat
ID. Other current or future adapters can use the same configuration once they
supply `receiver_id` in their normalized inbound context.

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
        receiverIds: ["cli_support_bot"]
        workspace: "/path/to/support-workspace"
        agentManagerScript: ".claude/skills/agent-manager/scripts/main.py"
        defaultAgent: "support-main"
        allowedAgents: ["support-main", "admin"]
        assignTimeoutSeconds: 90
```

Each receiver identity must be unique across targets; invalid or duplicate
routes fail configuration validation. A named target owns the default agent for
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

## Claude Desktop

The `claudeDesktop` router submits to an already authenticated Claude chat page exposed by CDP.

```yaml
agents:
  router: "claudeDesktop"
  claudeDesktop:
    enabled: true
    cdpEndpoint: "http://127.0.0.1:19334"
    targetSelector: ""
    inboxPath: "/Users/you/.fractalbot/claude-desktop-inbox"
    fallbackToInbox: true
    defaultAgent: "main"
    allowedAgents:
      - "main"
    deliveryTimeoutSeconds: 20
```

The selected CDP target must be a signed-in Claude chat, not a login page:

```bash
curl -fsS http://127.0.0.1:19334/json/version
curl -fsS http://127.0.0.1:19334/json/list
```

FractalBot does not launch Claude Desktop, patch the application, bypass its CDP authentication guard, scrape chat history, or inject input through AppleScript. If the target is unavailable, logged out, lacks a compose box, or rejects submission, a configured fallback inbox receives the normalized envelope and delivery prompt with private file permissions.

## Observability

Use the status endpoint to inspect the selected router and most recent outcome:

```bash
curl -sS http://127.0.0.1:18789/status | python3 -m json.tool
```

For desktop routes, `agents.last_routing` records the backend, status (`delivered`, `queued`, or `error`), selected agent, envelope ID, inbox path, and delivery error. The Codex App route also reports CDP readiness and the resolved project conversation.

See [Troubleshooting](troubleshooting.md) for startup and delivery failures.
