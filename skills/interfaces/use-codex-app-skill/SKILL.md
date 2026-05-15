---
name: use-codex-app
description: Use when operating the local Codex App itself, especially to list running Codex App agents, discover named Codex App sessions or threads, and deliver messages to them through the current Codex App Chrome DevTools Protocol renderer bridge or an explicitly selected app-server WebSocket. Prefer app-owned protocol delivery over UI typing and verify the exact target thread before sending.
---

# Use Codex App

Use this skill only for the local Codex App running on the same machine.

The goal is to inspect local Codex App runtime state or deliver a user message to a named Codex App session or thread. For message delivery, prefer the current Codex App renderer through CDP so the turn is routed through the visible app UI. Use an app-server WebSocket only when the user passes an explicit `--ws-url` or a currently running listener is intentionally selected; never start a detached app-server as a fallback.

## Safety Rules

- Never send to a fuzzy or ambiguous target. Resolve exactly one thread by `threadId`, `name`, title, `cwd`, or source metadata first.
- Report the exact target before or after delivery: `threadId`, `name` or title, `cwd`, `status`, and transport used.
- Do not use DOM typing/clicking as the first option. Use the protocol handler or an app-provided renderer bridge.
- Do not use `thread/inject_items` as a substitute for a live user turn. It appends model-visible history; it does not start agent work.
- Do not start `codex app-server`, `codex app-server proxy`, or a temporary `--listen` process as an automatic fallback. If CDP is not available, stop and report that the current Codex App renderer cannot be reached.
- If endpoint discovery, auth, socket connection, or method validation fails, stop and report the failure. Do not claim delivery.

## List Running Agents

When the user asks which Codex App agents are running, list live local evidence instead of relying on memory. Use the bundled script first:

```bash
bash .codex/skills/use-codex-app/scripts/list-codex-app-agents.sh
```

Common filters:

```bash
# Limit to a project family or repository name.
bash .codex/skills/use-codex-app/scripts/list-codex-app-agents.sh --cwd MyProject --limit 20

# Include archived threads when reconstructing historical agent names.
bash .codex/skills/use-codex-app/scripts/list-codex-app-agents.sh --include-archived --limit 100

# Machine-readable output for routing or scripting.
bash .codex/skills/use-codex-app/scripts/list-codex-app-agents.sh --cwd MyProject --limit 20 --json
```

Interpretation:

- `Codex App Processes` shows Electron app instances and app-server processes. More than one `MacOS/Codex` process can mean multiple app instances.
- `CDP Targets` shows renderer targets reachable through DevTools. This confirms inspectability; it is not the full agent list.
- `Codex App Threads` lists state DB threads. For Codex App sessions without `agent_nickname`, use the title as the display name and include `threadId`, `cwd`, `model`, `source`, `updated_at`, and `archived`.
- `Agent Jobs` lists active/busy Codex App batch jobs when present.
- Use the `id` from `Codex App Threads` as the `--thread-id` target for message delivery.

Report the source of truth and uncertainty. If a thread is unarchived but has not updated recently, call it "available/unarchived" rather than definitely active. If a process exists but no matching thread can be read, report it as an unmatched process.

## Deliver To A Listed Agent

Use the bundled sender after resolving exactly one target from `list-codex-app-agents.sh`:

```bash
bash .codex/skills/use-codex-app/scripts/send-codex-app-agent-message.sh \
  --thread-id <id-from-list-output> \
  --message '<message>'
```

Name-based targeting is allowed only when it resolves to one thread:

```bash
bash .codex/skills/use-codex-app/scripts/send-codex-app-agent-message.sh \
  --agent infra \
  --cwd MyProject \
  --message '<message>'
```

Safe validation before real delivery:

```bash
bash .codex/skills/use-codex-app/scripts/send-codex-app-agent-message.sh \
  --thread-id <id> \
  --message '<message>' \
  --dry-run --json
```

Sender behavior:

- Resolves named targets from the current Codex App sidebar through CDP first, then uses `~/.codex/state_*.sqlite` as read-only fallback evidence.
- Defaults to CDP delivery through the Codex renderer bridge so the message appears in the normal app conversation surface.
- Uses app-server JSON-RPC only with an explicit `--ws-url` or `--transport ws` against a listener that is already running.
- For app-server JSON-RPC, `turn/start` is used for idle or not-loaded threads; active threads are refused unless `--steer` is passed.
- For CDP, the script uses the Codex renderer bridge borrowed from the FractalBot approach: `Runtime.evaluate` locates the `app-server-manager-signals` bundle and calls the app-owned `start-turn-for-host` request. CDP delivery does not support `--steer`.
- `--dry-run` verifies the selected target and app-server/CDP bridge readback without sending the message.

## Keep CDP Enabled

If Codex App is running but the CDP endpoint is not reachable, install the bundled LaunchAgent monitor. It checks every 60 seconds and starts Codex App with `--remote-debugging-port=9222` when CDP is down:

```bash
bash .codex/skills/use-codex-app/scripts/install-codex-cdp-monitor.sh --install
```

Default behavior uses `relaunch` mode, which gracefully quits existing Codex App windows and starts a CDP-enabled instance when repair is needed. Use `new-instance` mode only when you must avoid closing current windows:

```bash
bash .codex/skills/use-codex-app/scripts/install-codex-cdp-monitor.sh --install --mode new-instance
```

Check or remove the service:

```bash
bash .codex/skills/use-codex-app/scripts/install-codex-cdp-monitor.sh --status
bash .codex/skills/use-codex-app/scripts/install-codex-cdp-monitor.sh --uninstall
```

The monitor log is `~/.codex/log/codex-cdp-monitor.log`. The LaunchAgent plist is `~/Library/LaunchAgents/ai.fractalmind.codex-cdp-monitor.plist`.

## Transport Order

### 1. Codex App CDP renderer bridge

Use CDP as the default delivery path. It talks to the current Codex App renderer and calls the app-owned `start-turn-for-host` bridge, so accepted turns are visible in the message UI. Prefer the bundled sender's default `auto` path or explicit `--transport cdp` instead of hand-writing CDP calls.

Discover the DevTools endpoint from the Codex user-data directory:

```bash
devtools_file="$HOME/Library/Application Support/Codex/DevToolsActivePort"
sed -n '1,2p' "$devtools_file"
port="$(sed -n '1p' "$devtools_file")"
curl -fsS "http://127.0.0.1:${port}/json/version"
curl -fsS "http://127.0.0.1:${port}/json/list"
```

If both probes fail, install or check the CDP monitor. Do not start a separate app-server listener for fallback delivery:

```bash
bash .codex/skills/use-codex-app/scripts/install-codex-cdp-monitor.sh --status
bash .codex/skills/use-codex-app/scripts/install-codex-cdp-monitor.sh --install
```

Use the page `webSocketDebuggerUrl` with a CDP client. The known stable bridge is the renderer's `app-server-manager-signals` bundle; call its request function (`Kn` or `rn`) with `start-turn-for-host`, `hostId`, `conversationId`, and text input. Prefer evaluating this app-owned bridge over synthetic keyboard input. If no stable bridge or handler can be found in the renderer, stop and report that CDP inspection worked but no safe delivery path was exposed.

CDP validation expectations:

- `Runtime.evaluate` can locate the Codex App renderer and bridge for the same `threadId`/conversation id.
- The evaluated call routes through an app-owned handler or client, not direct DOM event simulation.
- A subsequent renderer state update, visible notification, or app readback confirms the turn was accepted.

### 2. Explicit app-server WebSocket

Use this path only when the running Codex App already exposes a WebSocket listener and the user intentionally selects it with `--ws-url` or `--transport ws`. Do not create a listener just to make delivery work.

Discover the current binary and protocol surface:

```bash
CODEX_BIN="/Applications/Codex.app/Contents/Resources/codex"
"$CODEX_BIN" app-server --help
tmpdir="$(mktemp -d)"
"$CODEX_BIN" app-server generate-json-schema --out "$tmpdir"
find "$tmpdir/v2" -maxdepth 1 -type f | rg 'Thread|Turn'
```

Find a listener that is already running:

```bash
ps -axo command= | sed -nE 's#.*--listen[ =](ws://127\.0\.0\.1:[0-9]+).*#\1#p' | sort -u
lsof -nP -a -c codex | rg 'state_.*sqlite|sessions/.+jsonl|--listen'
```

Use JSON-RPC 2.0 over the app-server transport. Validate the exact request and response shapes against generated schema files before sending. The key methods are:

- `initialize`: handshake before issuing client requests.
- `thread/list`: discover candidate threads. Use `searchTerm`, `cwd`, `sourceKinds`, `limit`, and `useStateDbOnly` when useful.
- `thread/read`: confirm the resolved thread and optionally inspect turns.
- `thread/name/set`: only when the user explicitly asks to rename or create a stable target name.
- `turn/start`: deliver a new message to an idle target thread.
- `turn/steer`: add input to an active turn only when you have the current `turnId` and the user intends same-turn steering.
- `turn/interrupt`: only when the user asks to stop an active turn before sending a new one.

`turn/start` text input shape:

```json
{
  "method": "turn/start",
  "params": {
    "threadId": "<thread-id>",
    "input": [
      {
        "type": "text",
        "text": "<message>",
        "text_elements": []
      }
    ]
  }
}
```

After sending, watch for a success response and then re-read the thread or observe notifications such as `turn/started`, `item/agentMessage/delta`, `turn/completed`, or `thread/status/changed`.

## Target Resolution

Resolve names conservatively:

- Exact `threadId` match wins.
- Exact `name` match wins over title or preview.
- If only a title/search term is provided, list candidates and require a single exact or clearly disambiguated match by `cwd` and `updatedAt`.
- If multiple targets match, ask the user to choose; do not send.

For direct DB inspection, `~/.codex/state_*.sqlite` can help locate candidates, but it is read-only evidence. Do not write to the database.

Useful read-only query:

```bash
sqlite3 "$HOME/.codex/state_5.sqlite" \
  "select id,title,cwd,source,datetime(updated_at,'unixepoch') from threads order by updated_at desc limit 20;"
```

## Delivery Report

End with:

- transport used: `app-server` or `CDP`
- target `threadId`, name/title, cwd, and previous status
- message summary, not necessarily the full message if it contains secrets
- delivery result and readback evidence
- any remaining uncertainty, especially if only CDP/UI state could be verified
