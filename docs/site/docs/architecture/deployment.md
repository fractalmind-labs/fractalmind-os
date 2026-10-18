# Deployment

This page shows what runs where. It applies the [three-plane architecture](/architecture/overview) to a concrete deployment: authority lives on Sui, each host runs an application layer and an execution layer side by side, and the network only provides reachability.

> Status: target deployment, agreed on 2026-10-18. Parts of it are still being migrated; see [Current state](#current-state).

![FractalMind deployment: user devices, the envd network, each host with fractalbot, envd, the local runtime adapter layer and three runtimes, and Sui](/architecture/deployment.png)

## Each host

Every host that runs agents has two layers, and both reach agents through one shared adapter layer:

```text
              Application layer                    Execution layer
   chat apps ─▶ fractalbot ◀─ fractalmind channel ─┐   envd ◀─ envd network
                   │            (optional plugin)  └──▶ (subscribes)
                   │ conversations, wakeups              │ authorized tasks
                   │ best effort                         │ runtime chosen by capability
                   ▼                                     ▼
              ┌──────────── local runtime adapter layer ────────────┐
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
| fractalbot | Application | Human ↔ agent messaging on this host's channels; delivering conversations and scheduled wakeups to local agents | Authorization; forwarding to other hosts; agent-to-agent messaging |
| `fractalmind` channel plugin (optional) | Application | Subscribing to App conversations that arrive at the local envd and handing them to fractalbot | Authorization |
| envd | Execution | The authorization and execution boundary for privileged commands: verify, replay protection, budget, reserve, execute, receipt. The local endpoint of the envd network | Routing ordinary conversations |
| Local runtime adapter layer | Shared | Delivering to a runtime, reporting presence, declaring capabilities | Any authorization or interpretation of content |
| agent-manager, Claude Desktop, Codex App | Runtime | Where agents run | — |

## Three decisions

1. **App conversations travel over the envd network, nearest node first.** They reach the target host's envd; the optional `fractalmind` channel plugin subscribes there and hands them to fractalbot. Only that plugin depends on envd.
2. **fractalbot does not forward across hosts.** If the addressed agent is not on this host, fractalbot replies that it cannot find it. Its core never depends on envd.
3. **fractalbot and envd do not depend on each other.** fractalbot is an application-layer component. envd no longer calls agent-manager directly; both use a local runtime adapter layer extracted from fractalbot's runtime support, with agent-manager as one adapter.

Dependency direction: **fractalbot → local runtime adapter layer ← envd**.

## Local runtime adapter layer

A standalone Go package that knows how to reach agents in each runtime. It does not import fractalbot or envd and makes no authorization decisions.

| Provides | Meaning |
| --- | --- |
| Deliver | Hand a message or task to an agent in a runtime; returns delivered, queued or failed |
| Presence | Whether the agent can receive right now |
| Capabilities | Direct delivery into a session, durable inbox, waking an idle session, **hard stop**, durable results |

| Consumer | How it uses the layer |
| --- | --- |
| fractalbot | Delivers conversations and wakeups, best effort, to any runtime |
| envd | Delivers only tasks that passed authorization. Tasks that must be revocable go only to runtimes that declare hard stop (for example processes managed by agent-manager). envd keeps results and receipts itself |

## Two paths into an agent

```text
Conversations and wakeups (application layer)
  chat app → chat platform API → local fractalbot
  App → envd network (nearest) → target host envd → fractalmind channel plugin → fractalbot
    → pick a local agent (or reply "not found")
    → runtime adapter layer, best effort → agent replies with use-fractalbot

Authorized tasks (execution layer)
  capability (Sui) → signed intent → envd network → target host envd verifies
    → durable reservation → runtime adapter layer, chosen by capability → receipt
```

A "yes" in a chat is never an approval. When a conversation needs a privileged action, the agent goes through the execution path.

## Placement

| Where | Components |
| --- | --- |
| Sui | `fractalmind-protocol` contracts: organization and agent identity, capabilities, delegation, revocation, use and budget |
| Each host | fractalbot, envd, the local runtime adapter layer, runtimes, agents and their workspaces (memory, OKRs, task files), the OS secret store holding channel credentials |
| Network | Coordinator, relay, rendezvous and index caches for reachability and discovery; Sponsor for gas |
| User devices | FractalMind App: conversations, host and agent management, remote console, signed intents, results. Agent Console is retired and its functions move into the App |

Hosts can run macOS, Windows or Linux. iMessage is available only on macOS.

## Current state

- This is the target deployment; some repositories still contain compatibility paths.
- The local runtime adapter layer does not exist yet. It will be extracted from fractalbot's runtime support during the fractalbot V2 work; envd moves to it once it is stable.
- envd still calls agent-manager directly, and the `fractalmind` channel plugin is not implemented.
- Agent Console is still in the repository; its retirement and the move of its functions into the App are tracked in the [App PRD](https://github.com/fractalmind-labs/fractalmind-os/blob/main/docs/product/fractalmind-app-prd.md).
