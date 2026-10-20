# Agent Heartbeats

FractalBot can wake supported Agent Runtimes on explicit-timezone cron schedules. A heartbeat asks an Agent to inspect and advance its work; it is not a runtime readiness probe and it is not a synthetic channel message.

Supported targets are `ohMyCode`, `codexAppCDP`, and `claudeDesktop`. Each job selects its Runtime and Agent directly, independently of the inbound `agents.router` setting.

## Configuration

The target Runtime must be enabled, and the job's Agent must be accepted by its `defaultAgent` or `allowedAgents` configuration.

```yaml
agents:
  heartbeat:
    enabled: true
    statePath: "./workspace/heartbeat-state.json"
    maxConcurrent: 2
    jobs:
      - id: "cloudbank-main"
        runtime: "codexAppCDP"
        agent: "main"
        text: "Inspect the current project and continue any actionable work."
        cron: "*/10 * * * *"
        timezone: "Asia/Shanghai"
        agentCronProfiles:
          idle: "0 * * * *"
          deep-idle: "0 */6 * * *"
        resetCronOnInbound: true
        # ohMyCode only. Default false. When true, FractalBot starts a missing
        # tmux session before dispatching this heartbeat tick.
        startIfMissing: false
```

`text` is the complete inline instruction. Heartbeat prompt files are not supported. Cron expressions use the standard five-field format, and every job requires an IANA timezone.

A `claudeDesktop` or `ohMyCode` job can add `target`, the name of a receiver target under `agents.ohMyCode.targets`, so the heartbeat reaches the same destination as that bot's messages. A `claudeDesktop` job then queues to the target's `claudeDesktopInboxPath` (without `target` it uses `agents.claudeDesktop.inboxPath`). The target must exist and use the job's runtime (a target without `runtime` is `ohMyCode`); `codexAppCDP` jobs reject `target`:

```yaml
      - id: "burry-main"
        runtime: "claudeDesktop"
        agent: "main"
        target: "burry"
        text: "Read HEARTBEAT.md if it exists. If nothing needs attention, reply HEARTBEAT_OK."
        cron: "0 * * * *"
        timezone: "Asia/Shanghai"
```

An `ohMyCode` job with `target` runs that target's `agentManagerScript` in its `workspace`, and its `agent` must be allowed by the target's `defaultAgent`/`allowedAgents` rather than the shared ones. This is how a scheduled job reaches a Codex App session through the queue adapter in [codex-native-queue.md](codex-native-queue.md):

```yaml
      - id: "project-heartbeat"
        runtime: "ohMyCode"
        agent: "main"
        target: "project"
        text: "Read HEARTBEAT.md if it exists. If nothing needs attention, reply HEARTBEAT_OK."
        cron: "0 */4 * * *"
        timezone: "Asia/Shanghai"
```

That adapter supports `assign` only, so leave `startIfMissing` and `dispatchMode` unset for such a job.

`startIfMissing` is off by default. When it is true and the job targets `ohMyCode`, FractalBot checks `agent-manager status` and, if the session is not running, calls `start` before dispatch. Failed starts enter a 90s cooldown. This is not `heartbeat rescue` and does not apply to Codex App or Claude Desktop jobs.

The configured `cron` remains the default. `agentCronProfiles` contains the only alternative schedules an Agent may select; arbitrary Agent-provided cron expressions are rejected.

### Completion-aware ohMyCode heartbeats

By default, an `ohMyCode` heartbeat uses the existing generic `agent-manager assign` delivery. That preserves custom `text` instructions, but successful delivery only means that agent-manager accepted the task; it does not mean the heartbeat work finished.

Set `dispatchMode: heartbeatRun` when agent-manager's native heartbeat lifecycle should remain authoritative:

```yaml
agents:
  ohMyCode:
    enabled: true
    workspace: "/absolute/path/to/workspace"
    defaultAgent: "main"
    allowedAgents: ["main"]
  heartbeat:
    enabled: true
    jobs:
      - id: "main"
        runtime: "ohMyCode"
        agent: "main"
        dispatchMode: "heartbeatRun"
        timeoutSeconds: 480
        cron: "*/5 * * * *"
        timezone: "Asia/Shanghai"
```

This mode calls `agent-manager heartbeat run <agent> --timeout <duration>`. The job stays in flight until agent-manager returns a terminal ACK, skip, or failure, so overlapping ticks are coalesced for the full lifecycle rather than only for task assignment. The HB ID printed by agent-manager is recorded as `last_envelope_id` in `/status`.

`text` is optional and not delivered in this mode because agent-manager owns the canonical heartbeat prompt. `timeoutSeconds` defaults to 480 and may be set from 1 to 86400 seconds; zero selects the default. A terminal agent-manager failure is recorded as `heartbeat_failed` and is not retried by FractalBot, avoiding duplicate heartbeat execution. Generic runtime delivery errors keep the existing bounded retry behavior.

## Schedule adjustment

A normal heartbeat requires no callback. Only when the Agent determines that there is no actionable work should it reduce the frequency:

```bash
fractalbot heartbeat cron set \
  --job cloudbank-main \
  --profile idle \
  --reason "no actionable tasks"
```

Setting the active profile again is a successful no-op. Restore the configured default with:

```bash
fractalbot heartbeat cron reset --job cloudbank-main
```

The equivalent loopback-only API is:

```http
PUT /api/v1/heartbeat/jobs/cloudbank-main/cron
Content-Type: application/json

{"profile":"idle","reason":"no actionable tasks"}
```

```http
DELETE /api/v1/heartbeat/jobs/cloudbank-main/cron
```

When `resetCronOnInbound` is true, a normal user message successfully routed to the same Runtime and Agent also restores the default cron. Rejected, malformed, or unrelated messages do not reset it.

## Delivery behavior

- One run per job may be in flight; overlapping ticks are skipped.
- `maxConcurrent` limits dispatches across all jobs.
- The effective profile and delivery telemetry are written atomically to `statePath`.
- Restart preserves the effective profile but calculates the next future occurrence. Missed heartbeats are never replayed.
- Codex App and Claude Desktop inbox fallback uses a stable key per job. A newer queued heartbeat replaces the older unconsumed heartbeat.
- Runtime delivery errors receive a bounded exponential-backoff retry. The final failure is recorded without changing the Agent-selected schedule.
- `startIfMissing: true` on an `ohMyCode` job starts a missing tmux session before dispatch. Default remains no extra start.
- `ohMyCode` jobs using `dispatchMode: heartbeatRun` hold the in-flight lease through agent-manager's terminal result and do not retry terminal heartbeat failures.

## Outcomes

Delivery only says the runtime accepted a heartbeat, not whether it was worth running. Every heartbeat prompt therefore ends with the command the Agent uses to report what the run came to:

```bash
fractalbot heartbeat outcome \
  --job cloudbank-main \
  --run <run_id from the wakeup> \
  --result noop \
  --summary "nothing actionable"
```

`--result` is one of `noop` (nothing needed doing), `acted` (did work), `notified` (sent a person a message) or `failed` (could not complete). `--summary` is optional, one line, and kept to 500 characters. Only the job's latest run can report; reporting the same run again replaces its outcome rather than counting twice. The loopback-only API is:

```http
POST /api/v1/heartbeat/jobs/cloudbank-main/outcome
Content-Type: application/json

{"run_id":"<run_id>","result":"noop","summary":"nothing actionable"}
```

`/status` shows, per job, `delivered_runs`, `outcome_counts`, `unreported_runs` (delivered runs that never reported), and the last outcome with its time and summary. They are kept in `statePath`, so a week of them answers which heartbeats do work, which are mostly `noop` and should be slowed down or removed, and which Agents don't report at all.

## Status

For a local Codex session without CDP, the optional
[native queue bridge](codex-native-queue.md#heartbeat-relay) drains a dedicated
`codexAppCDP` inbox into `codex queue`. FractalBot remains the sole scheduler;
the relay preserves run metadata, retries unconfirmed deliveries, and archives
expired envelopes. Gateway inbox acceptance is separate from native queue
acceptance and task completion.

`GET /status` includes a redacted `heartbeat` section with configured and effective cron, timezone, dispatch mode and timeout, next run, in-flight state, last dispatch result, and schedule-change audit fields.

```bash
curl -sS http://127.0.0.1:18789/status | python3 -m json.tool
```

The inline instruction is not included in status output.
