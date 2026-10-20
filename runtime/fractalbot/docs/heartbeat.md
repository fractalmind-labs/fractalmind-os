# Schedules

FractalBot is the only scheduler for agent wakeups. Each schedule wakes one agent on a cron. It is delivered the way that agent's messages are: through the agent's Claude Desktop inbox, its Codex App thread or its agent-manager session.

## Configuration

```yaml
schedules:
  maxConcurrent: 2
  jobs:
    assistant-heartbeat:
      agent: assistant
      cron: "0 * * * *"
      backoff:
        idle: "0 */3 * * *"
        deep-idle: "0 9 * * *"
      resetOnInbound: true
      prompt: Read HEARTBEAT.md and follow it. If nothing needs attention, reply HEARTBEAT_OK.
    researcher-morning-report:
      agent: researcher
      cron: "30 7 * * *"
      timezone: Europe/Berlin
      promptFile: tasks/morning-report.md
```

- `prompt` is inline. `promptFile` is relative to the agent's workspace and is read on every run, so edit the task file without touching the configuration.
- Cron expressions are five-field. The time zone is the job's `timezone`, else the top-level `timezone`, else the system's.
- `backoff` lists the only lower-frequency schedules the agent may switch to. Arbitrary agent-provided cron expressions are rejected.
- `resetOnInbound: true` restores `cron` when a channel message is delivered to this job's agent. Messages to other agents do not affect it.

Field reference: [config-v2.md](config-v2.md#schedules).

## What the agent receives

Every wakeup carries `job_id`, `run_id`, the agent and its runtime, the scheduled time and an expiry, then the instruction. The gateway appends:

- the command to report the run's outcome;
- when `backoff` is set, the commands to lower the frequency and to restore it.

So prompts only need to describe the task.

## Lowering and restoring the frequency

Only when the agent finds nothing to do should it lower the frequency:

```bash
fractalbot heartbeat cron set --job assistant-heartbeat --profile idle --reason "no actionable tasks"
fractalbot heartbeat cron reset --job assistant-heartbeat
```

Setting the active profile again is a no-op. The loopback-only API is `PUT /api/v1/heartbeat/jobs/<id>/cron` with `{"profile":"idle","reason":"…"}`, and `DELETE` on the same path to restore the configured cron.

## Outcomes

Delivery only says the runtime accepted a wakeup, not whether the run was worth it. The agent reports what the run came to:

```bash
fractalbot heartbeat outcome --job assistant-heartbeat --run <run_id> --result noop --summary "nothing actionable"
```

- `--result` is one of `noop` (nothing needed doing), `acted` (did work), `notified` (sent a person a message) or `failed` (could not complete).
- `--summary` is one line of at most 500 characters.
- Only the latest run can report, and reporting the same run again replaces its outcome.

The loopback-only API is `POST /api/v1/heartbeat/jobs/<id>/outcome` with `{"run_id":"…","result":"noop","summary":"…"}`.

## agent-manager heartbeat lifecycle

For an `agentManager` agent, `mode: heartbeatRun` runs `agent-manager heartbeat run <session> --timeout <duration>` instead of assigning the prompt. The job stays in flight until agent-manager returns its terminal ACK, skip or failure, and the HB ID it prints is recorded in `/status`.

- **Timeout:** `timeoutSeconds` defaults to 480.
- **Prompt:** `prompt` is optional, because agent-manager owns the heartbeat prompt.
- **Failures:** a terminal failure is recorded as `heartbeat_failed` and is not retried.

With `runtimes.agentManager.startIfMissing: true`, a stopped agent-manager agent is started before a schedule is delivered to it.

## Delivery behavior

- **Overlap:** one run per job may be in flight; overlapping ticks are skipped.
- **Concurrency:** `maxConcurrent` limits dispatches across all jobs.
- **Restarts:** restart keeps the selected backoff level and computes the next future run. Missed runs are never replayed.
- **Queued wakeups:** in a Claude Desktop inbox, a newer wakeup for the same job replaces one still waiting.
- **Errors:** delivery errors get a bounded exponential-backoff retry, and the final failure is recorded.
- **State:** schedule state and outcomes are written atomically to `<dataDir>/state/schedules.json`.

## Status

`GET /status` lists each agent with its schedules. Each schedule shows:

- configured and effective cron, time zone, next run and in-flight state;
- the last dispatch and its result;
- the schedule-change audit;
- `delivered_runs`, `outcome_counts`, `unreported_runs` and the last outcome.

Prompt text is never included.

```bash
curl -sS http://127.0.0.1:18789/status | python3 -m json.tool
```
