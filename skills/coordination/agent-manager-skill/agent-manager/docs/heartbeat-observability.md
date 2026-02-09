# Heartbeat Observability & SLO

This document describes heartbeat audit fields, trace queries, and SLO summary metrics.

## Audit Log Location

Heartbeat runs append JSONL events to:

- `.claude/state/agent-manager/heartbeat-audit/{agent_id}.jsonl`

## Standard Event Fields

Each JSONL row includes:

- `timestamp` (UTC ISO-8601)
- `agent_id`
- `hb_id`
- `stage` (default: `heartbeat_attempt`)
- `result` (`success` / `failure` / `pending`)
- `duration` (milliseconds)
- `duration_ms` (milliseconds, same as `duration`)
- `send_status`
- `ack_status`
- `failure_type`
- `context_left`
- `session_mode`
- `attempt`
- `recovery_action`

## Trace Query

Use `heartbeat trace` to query audit logs by heartbeat id, agent, and time range.

```bash
python3 scripts/main.py heartbeat trace --agent EMP_0001 \
  --since 2026-02-09T00:00:00Z \
  --until 2026-02-10T00:00:00Z
```

## SLO Summary

Use `heartbeat slo` for daily/weekly summaries.

```bash
python3 scripts/main.py heartbeat slo --window daily
python3 scripts/main.py heartbeat slo --window weekly --agent EMP_0001
python3 scripts/main.py heartbeat slo --json
```

Standalone script:

```bash
python3 scripts/heartbeat_slo.py --window daily
```

## Built-in SLO Thresholds

- Success rate: `>= 99%`
- Timeout rate: `<= 2%`
- Recovery p95: `<= 120000ms`

When a metric breaches threshold, output status is `ALERT`.

## Failure Buckets

`failure_type` is bucketed as:

- `send_fail`
- `no_ack`
- `timeout`
- `blocked`

If `failure_type` is missing, bucket is inferred from `send_status`/`ack_status`.
