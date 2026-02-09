# Agent Manager Runbook Checklist (Slice 1)

This runbook is an actionable SOP for day-to-day operation and common failures.

## 0) 30-Minute Newcomer Path

Use this exact sequence from repo root:

```bash
CLI="python3 agent-manager/scripts/main.py"

$CLI doctor
$CLI list
$CLI start EMP_0001
$CLI status EMP_0001
$CLI monitor EMP_0001 -n 80
$CLI stop EMP_0001
```

Checklist:
- [ ] `doctor` shows tmux available (or prints a clear install hint)
- [ ] `list` returns configured agents without parse errors
- [ ] `start/status/monitor/stop` flow works for at least one enabled agent
- [ ] no unknown command/flag errors in the basic path

## 1) Preflight Before Heartbeat / Schedule Operations

```bash
CLI="python3 agent-manager/scripts/main.py"
$CLI doctor
$CLI heartbeat list
$CLI schedule list
```

Checklist:
- [ ] environment healthy (`doctor`)
- [ ] expected heartbeat and schedule jobs are visible
- [ ] target agent is enabled and not misconfigured

## 2) Incident SOP: Heartbeat No ACK

Symptoms:
- `heartbeat run` prints timeout/failure
- no ACK in recent audit events

Commands:

```bash
CLI="python3 agent-manager/scripts/main.py"
$CLI heartbeat run EMP_0001 --timeout 30
$CLI heartbeat trace --agent EMP_0001 --limit 20
$CLI status EMP_0001
$CLI monitor EMP_0001 -n 120
```

Checklist:
- [ ] capture latest `HB_ID`
- [ ] verify `send_status` / `ack_status` / `failure_type`
- [ ] verify retry/backoff/fallback behavior matches policy
- [ ] if unresolved, escalate with `HB_ID` + trace output + next owner

## 3) Incident SOP: Session Stuck / Blocked

Symptoms:
- runtime state remains `busy`/`blocked` for too long
- no forward progress in monitor output

Commands:

```bash
CLI="python3 agent-manager/scripts/main.py"
$CLI status EMP_0001
$CLI monitor EMP_0001 -n 160
$CLI heartbeat run EMP_0001 --timeout 20
# last resort
$CLI stop EMP_0001
$CLI start EMP_0001 --restore
```

Checklist:
- [ ] record runtime state + reason + elapsed seconds
- [ ] capture last meaningful output lines before restart
- [ ] after restart, confirm status returns to healthy state
- [ ] post incident note with owner and ETA for follow-up prevention

## 4) Incident SOP: CI Gate Failure (PR Not Merge-Ready)

Commands:

```bash
# from repo root
python3 -m compileall -q agent-manager
python3 -m unittest discover -s agent-manager/scripts/tests -p 'test_*.py' -v

gh pr checks <PR_NUMBER>
gh pr view <PR_NUMBER> --json mergeable,mergeStateStatus,statusCheckRollup,reviews,comments
```

Checklist:
- [ ] required checks are green on latest head
- [ ] QA posts explicit `PASS` / `FAIL` with commands and evidence
- [ ] no blocking comments/reviews remain
- [ ] only then mark merge-ready

## 5) Merge Gate (Hard Rule)

A PR is merge-ready only if all are true:
- [ ] CI PASS
- [ ] QA PASS (explicit, evidence-backed)
- [ ] no blocking comments/reviews

If any item is missing, post a gate-status comment with:
1) missing item
2) owner
3) ETA

## 6) Evidence Comment Template

Use this template on issue/PR threads:

```text
Progress update:
- Scope: <what was executed>
- Commands: <exact commands>
- Result: PASS/FAIL + key evidence
- Gate: CI=<...>, QA=<...>, blocking comments=<...>
- Owner/ETA: <who does next step by when>
```


## 7) Expected Output Anchors (Quick QA)

Use these as lightweight checks when validating docs/command behavior:

- `doctor` should end with either `✅ Doctor checks passed` or a clear problem count line.
- `schedule sync --dry-run` should print `🔍 Dry run - would sync` and show generated content/no-config message.
- `heartbeat run` failure path should print one of:
  - `❌ Heartbeat failed after recovery policy`
  - `⚠️  Heartbeat unresolved ... applying fallback: fresh`
- `status <agent>` should print `Runtime state:` and `Recent heartbeat:` lines.

## 8) QA Review Checklist for Docs PRs

Before posting `QA Verdict`, verify:

- [ ] all command paths in docs are repo-relative and executable in current tree
- [ ] examples align with current CLI flags/subcommands
- [ ] merge-gate policy text matches team rule (CI PASS + QA PASS + no blocking comments)
- [ ] at least one copy-paste command sequence was executed end-to-end

Suggested QA evidence snippet:

```text
QA Verdict: PASS
Commands:
- python3 -m compileall -q agent-manager
- python3 -m unittest discover -s agent-manager/scripts/tests -p 'test_*.py' -v
- gh pr checks <PR>
Evidence:
- docs command paths/flags matched runtime behavior
- gate checklist wording verified
```
