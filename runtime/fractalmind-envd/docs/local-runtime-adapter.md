# Local Runtime Adapter Phase 0

Issue: https://github.com/fractalmind-ai/fractalmind-envd/issues/65

The target envd invokes the local runtime adapter only after `NodeCommand`
authorization succeeds. The relay and coordinator never receive tmux, systemd,
Docker, or agent-manager command strings.

`internal/runtimeadapter` implements:

- the agent-manager schema version 1 request/result envelopes;
- a local stdin/stdout process client with bounded evidence;
- deterministic timeout, cancellation, process-exit, and malformed-output paths;
- a fixed action-to-operation mapping that cannot be overridden by payloads;
- an executor that owns `NodeCommand` validation, singleflights exact concurrent
  duplicates, caches their result, and emits
  stable `NodeEvent` result codes such as `runtime_ok` and `runtime_timeout`.
- typed operation payloads only: optional `restore` for `start`, bounded inline
  `task` for `assign`, and bounded `lines` with forced `follow=false` for
  `monitor`/`logs`;
- agent-targeted lifecycle/observation operations and strictly node-wide
  `inventory`/`health` operations;
- Unix process-group cancellation so timeout or context cancellation terminates
  descendants as well as the direct adapter process.

The supported actions are `inventory`, `status`, `start`, `stop`, `assign`,
`monitor`, `logs`, `health`, and `availability`. Arbitrary `shell` execution is
not part of this boundary.

For agent-manager, construct the process client with the local CLI path:

```go
adapter := runtimeadapter.AgentManager(
    "python3",
    "/path/to/agent-manager/scripts/main.py",
)
executor := runtimeadapter.NewExecutor(nodeCommandValidator, adapter)
```

Signed runtime payload examples are deliberately operation-specific:

```json
{"restore":true}
{"task":"inspect the assigned issue"}
{"lines":100}
```

Fields such as `working_dir`, `task_file`, `tmux_layout`, and `follow` are not
accepted from a remote command. They remain local implementation details.

The returned adapter is sealed: its process execution method is package-private,
so callers outside `internal/runtimeadapter` can only invoke it through
`Executor.Execute` and its validator-owned authorization path.

The adapter is local-process only. It does not open a listener or move
authorization into agent-manager. The existing REST/WebSocket compatibility
handler remains unchanged until it is wrapped in the signed `NodeCommand`
validation path.

Phase 0 singleflight and result caching are intentionally process-local. They
prevent duplicate execution within one envd process, but do not by themselves
provide the same guarantee across multiple envd processes or after restart.
Production wiring must pair durable authority reservations with a durable result
store/agent-manager ledger before treating restart replay as recoverable. Until
then, a duplicate whose authorized result is absent fails closed and is not
executed again.

For restart-safe deployments, initialize the executor with a file-backed state
directory via `runtimeadapter.NewExecutorWithStateDir(...)` and set
`FRACTALMIND_RUNTIME_STATE_DIR` in the envd process. This keeps prior results on
disk instead of in the process-local memory store.
