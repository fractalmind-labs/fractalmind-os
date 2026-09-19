# Coordinator local runtime proof (sentinel listing + command proxy)

This document captures the smallest useful **coordinator runtime loop** that is currently proven **locally** by focused tests and sanitized request/response examples.

## What is proven locally (and what is not)

Proven (locally, by tests):

- a worker can register with the coordinator over WebSocket (`/ws`)
- the coordinator can ingest heartbeat state and expose it through `/api/sentinels`
- an HTTP command request can be bridged to the worker and correlated back into an HTTP response

Not proven by this packet:

- public endpoint availability
- live multi-host runtime reliability
- remote command execution against real worker machines
- production deployment readiness

## Runtime contract summary

Coordinator API:

- `GET /api/health`
- `GET /api/sentinels`
- `GET /api/sentinels/{id}`
- `GET /api/sentinels/{id}/agents`
- `POST /api/sentinels/{id}/command`
- `GET /ws`

Heartbeat payload fields:

- `host_id`, `hostname`, `timestamp`, `agents`, `system`, `uptime_seconds`, optional `relay_load`

WebSocket command envelope:

- top-level envelope `{ type, payload }`
- command payload `{ command, agent_id, args, request_id }`

## Focused test proof

Validation command:

```bash
# from repo root

go test ./internal/coordinator -run 'TestCoordinator(ListsRegisteredWorkers|ShellCommandProxy)' -count=1 -v
```

Example output:

```text
=== RUN   TestCoordinatorListsRegisteredWorkers
2026/03/18 21:02:24 [coordinator] new worker connection: temp-1
2026/03/18 21:02:24 [coordinator] worker registered: node-1 (worker-a, v1.2.3)
--- PASS: TestCoordinatorListsRegisteredWorkers (0.00s)
=== RUN   TestCoordinatorShellCommandProxy
2026/03/18 21:02:24 [coordinator] new worker connection: temp-1
2026/03/18 21:02:24 [coordinator] worker registered: node-2 (worker-b, vdev)
--- PASS: TestCoordinatorShellCommandProxy (0.00s)
PASS
ok  	github.com/fractalmind-ai/fractalmind-envd/internal/coordinator	0.008s
```

## Sanitized runtime transcript (highlights)

Worker registration:

```json
{ "type": "register", "payload": { "host_id": "node-1", "hostname": "worker-a", "version": "1.2.3" } }
```

Worker heartbeat:

```json
{
  "type": "heartbeat",
  "payload": {
    "host_id": "node-1",
    "hostname": "worker-a",
    "timestamp": "<RFC3339 timestamp>",
    "agents": [{ "id": "EMP_0001", "session": "EMP_0001", "status": "running" }],
    "system": { "os": "linux", "arch": "amd64", "num_cpu": 8 },
    "uptime_seconds": 42
  }
}
```

Sentinel summary:

```json
{
  "sentinels": [
    {
      "id": "node-1",
      "host_id": "node-1",
      "hostname": "worker-a",
      "version": "1.2.3",
      "connected_at": "<RFC3339 timestamp>",
      "last_heartbeat": "<RFC3339 timestamp>",
      "agent_count": 1,
      "uptime_seconds": 42,
      "system": { "os": "linux", "arch": "amd64", "num_cpu": 8 }
    }
  ],
  "count": 1
}
```

Command request and response:

```json
POST /api/sentinels/node-2/command
{
  "command": "shell",
  "args": "echo hello"
}
```

```json
{
  "type": "command",
  "payload": {
    "command": "shell",
    "agent_id": "",
    "args": "echo hello",
    "request_id": "cmd-<n>"
  }
}
```

```json
{
  "type": "command_result",
  "payload": {
    "request_id": "cmd-<n>",
    "result": { "success": true, "output": "hello\n" }
  }
}
```

```json
{ "success": true, "output": "hello\n" }
```

## Follow-up / next promotion

If you want to promote this beyond local proof, keep the next step governed and evidence-based:

- decide whether to deploy a shared coordinator ingress
- capture a real operator transcript
- define and validate authorization boundaries for command-plane actions

