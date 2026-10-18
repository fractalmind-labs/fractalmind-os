# Deployment

This page shows what runs where. It applies the [three-plane architecture](/architecture/overview) to a concrete deployment: authority lives on Sui, each host runs an application layer and an execution layer side by side, and the network only provides reachability.

> Status: target deployment, agreed on 2026-10-18. Parts of it are still being migrated; see [Current state](#current-state).

![FractalMind deployment: user devices, the envd network, each host with envd dispatching to registered applications, fractalbot and an agent task handler delivering through the local runtime adapter layer to three runtimes, and Sui](/architecture/deployment.png)

## Each host

Every host that runs agents has an execution layer and an application layer. envd verifies and dispatches; applications parse and deliver:

```text
   envd network ─▶ envd                     execution layer
                   verify · reserve · dispatch · receipt
                    │ conversation intents          │ authorized agent tasks, cancel
                    ▼                               ▼
   chat apps ─▶ fractalbot                    agent task handler     application layer
               (+ fractalmind channel plugin)  (today: agent-manager)
                    │ best effort                   │
                    ▼                               ▼
              ┌──────────── local runtime adapter layer (library) ──┐
              │        deliver · presence · capabilities            │
              └──────┬───────────────────┬───────────────────┬──────┘
                     ▼                   ▼                   ▼
             agent-manager (tmux)   Claude Desktop        Codex App
                     └───────────────────┼───────────────────┘
                                         ▼
                                       Agents
```

| Component | Layer | Responsible for | Not responsible for |
| --- | --- | --- | --- |
| envd | Execution | The local endpoint of the envd network and the authorization boundary: verify, replay protection, budget, reserve, dispatch to the registered application for the intent type, propagate cancellation, receipt | Parsing intents; knowing about runtimes or how to reach agents |
| fractalbot | Application | Human ↔ agent messaging on this host's channels; delivering conversations and scheduled wakeups to local agents | Authorization; forwarding to other hosts; agent-to-agent messaging |
| `fractalmind` channel plugin (optional) | Application | Registers with the local envd for conversation intents and hands them to fractalbot as channel messages | Authorization |
| Agent task handler (today: agent-manager) | Application | Registers with the local envd for agent tasks; parses and executes them; supports cancel; reports results | Accepting tasks that did not come through envd |
| Local runtime adapter layer | Application (library) | Delivering to a runtime, reporting presence, declaring runtime capabilities | Any authorization or interpretation of content |
| agent-manager, Claude Desktop, Codex App | Runtime | Where agents run | — |

## Three decisions

1. **App conversations travel over the envd network, nearest node first.** They reach the target host's envd, which dispatches them to the optional `fractalmind` channel plugin, which hands them to fractalbot. Only that plugin depends on envd.
2. **fractalbot does not forward across hosts.** If the addressed agent is not on this host, fractalbot replies that it cannot find it. Its core never depends on envd.
3. **envd verifies and dispatches; applications parse and execute.** envd depends on no application and knows nothing about runtimes. Applications register with the local envd, declaring the intent types they handle and their capabilities. fractalbot is an application-layer component.

Dependency direction: **applications → envd registration interface** (optional for each application), and **applications → local runtime adapter layer**. envd depends on neither.

## Application registration and dispatch

Which applications a host may run, and which intent types each may handle, is decided on chain. Local configuration only says where an application is installed.

### On-chain application authorization

Each host's membership carries an **application authorization table**. Each entry records:

| Field | Meaning |
| --- | --- |
| Application ID | For example `fractalbot`, `agent-manager` |
| Intent types | Which verified intents it may handle |
| Required capabilities | For example "must support cancel" |
| Publisher key (optional) | If set, envd also verifies the application's code signature against it |

- The organization admin (`OrgAdminCap`) adds, changes and removes entries; each change emits an event that envd follows. A host invitation can carry an initial list (for example agent-manager) so a new host needs no extra transaction.
- Two keys: an entry takes effect only after the host owner has installed the application locally. Local configuration maps the application ID to its executable path; it is an install detail, not authority.
- Publisher verification is optional per entry. Binary hashes are not used by default, because every upgrade would need a transaction.

envd checks the table when an application registers and again on every dispatch, as part of its existing check of current Sui authority. When the admin revokes an entry, envd stops dispatching to that application, disconnects it and cancels its in-flight intents. If envd cannot read current chain authority, it fails closed: no new registrations and no new dispatches.

The chain answers "may this host run this application"; envd still verifies locally that the connecting process is that application: same OS user, executable path matching local configuration, and code signature when a publisher key is set.

### Local protocol

Applications talk to envd only over local channels, using JSON-RPC 2.0 messages, one per line. Two connection modes share the same messages:

| Mode | For | Transport |
| --- | --- | --- |
| Long-running | fractalbot (`fractalmind` channel plugin), remote desktop | The application connects to envd's local endpoint and keeps one bidirectional connection: a Unix domain socket (0600, owned by the host user) on macOS and Linux, a named pipe restricted to the same user on Windows |
| Spawned | agent-manager, file tasks | envd starts the application as a child process and exchanges messages over stdin/stdout, as `internal/runtimeadapter` does today; cancel terminates the process group |

| Message | Direction | Content |
| --- | --- | --- |
| `register` | app → envd | Application ID, protocol version, intent types, capabilities. Must match the on-chain entry; a different major version is rejected |
| `dispatch` | envd → app | A verified intent: ID (the envd reservation ID, used by the application for deduplication), type, typed payload, deadline |
| `accepted` / `progress` / `result` | app → envd | Execution status; `result` carries bounded evidence and envd writes the receipt |
| `cancel` / `cancelled` | envd → app / app → envd | Revocation and its acknowledgement |
| `reply` | app → envd | A reply to a dispatch the application received, routed back by envd (for example fractalbot answering an App conversation). Applications cannot send unsolicited messages through envd |
| `ping` | both | Keepalive |

If the connection drops, dispatched intents without a result become "unknown" and are not re-sent. When the application reconnects, it reports their status by ID and envd completes the receipts. JSON-RPC keeps the protocol easy to implement in Go (fractalbot) and Python (agent-manager) and continues the existing `runtimeadapter` envelopes; the message model would survive a later move to another transport.

Trust: once an intent is verified, the application that receives it is on the trusted path. envd's receipt covers what was authorized, which application received it and whether it was revoked; the execution result is reported by the application. This is the same trust envd places in agent-manager today.

## Local runtime adapter layer

A Go library in the application layer that knows how to reach agents in each runtime. fractalbot and the agent task handler each embed it; envd does not use it. It does not import fractalbot or envd and makes no authorization decisions.

| Provides | Meaning |
| --- | --- |
| Deliver | Hand a message or task to an agent in a runtime; returns delivered, queued or failed |
| Presence | Whether the agent can receive right now |
| Capabilities | Direct delivery into a session, durable inbox, waking an idle session, hard stop, durable results |

It is a library rather than a service so that fractalbot keeps running on its own and no extra process can inject into every local session. Processes that embed it coordinate through versioned on-disk conventions: the inbox format, relay locks and a per-agent delivery lock so concurrent deliveries to one agent do not interleave. It becomes a local service only if a runtime allows a single connection holder, file locks cannot resolve delivery conflicts, or one place must report every local agent's status.

## Two paths into an agent

```text
Conversations and wakeups (application layer)
  chat app → chat platform API → local fractalbot
  App → envd network (nearest) → target host envd → fractalmind channel plugin (registered) → fractalbot
    → pick a local agent (or reply "not found")
    → runtime adapter layer, best effort → agent replies with use-fractalbot

Authorized tasks (execution layer)
  capability (Sui) → signed intent → envd network → target host envd verifies
    → durable reservation → dispatch to the registered agent task handler
    → handler parses and delivers through the runtime adapter layer → result → envd receipt
```

A "yes" in a chat is never an approval. When a conversation needs a privileged action, the agent goes through the execution path.

## Placement

| Where | Components |
| --- | --- |
| Sui | `fractalmind-protocol` contracts: organization and agent identity, capabilities, delegation, revocation, use and budget |
| Each host | envd, fractalbot, the agent task handler, the local runtime adapter layer, runtimes, agents and their workspaces (memory, OKRs, task files), the OS secret store holding channel credentials |
| Network | Coordinator, relay, rendezvous and index caches for reachability and discovery; Sponsor for gas |
| User devices | FractalMind App: conversations, host and agent management, remote console, signed intents, results. Agent Console is retired and its functions move into the App |

Hosts can run macOS, Windows or Linux. iMessage is available only on macOS.

## Current state

- This is the target deployment; some repositories still contain compatibility paths.
- envd's existing `internal/runtimeadapter` already invokes agent-manager as a local process only after `NodeCommand` authorization, with fixed versioned request and result envelopes (see `runtime/fractalmind-envd/docs/local-runtime-adapter.md`). That is the first instance of dispatch to an application; the target generalizes it into registration by intent type, so envd stops naming agent-manager.
- The local runtime adapter layer does not exist yet as a library. It will be extracted from fractalbot's runtime support during the fractalbot V2 work.
- The `fractalmind` channel plugin, the local protocol's long-running mode and the on-chain application authorization table are not implemented.
- Agent Console is still in the repository; its retirement and the move of its functions into the App are tracked in the [App PRD](https://github.com/fractalmind-labs/fractalmind-os/blob/main/docs/product/fractalmind-app-prd.md).
