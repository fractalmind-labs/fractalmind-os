# CLI Modularization Plan (Issue #46)

This document tracks incremental modularization of `agent-manager/scripts/main.py`.

## Goals

- keep CLI behavior stable while reducing entrypoint complexity
- make command wiring explicit and testable
- move command implementations into dedicated modules in small merge-safe slices

## Delivery Status

### Completed slices

- **Slice 1**: parser/registry extraction
  - `agent-manager/scripts/cli_parser.py`
  - `agent-manager/scripts/command_registry.py`
- **Slice 2**: lifecycle command extraction
  - `agent-manager/scripts/commands/lifecycle.py`
  - `main.py` wrappers delegate to lifecycle handlers
- **Slice 3-A**: status/schedule handler extraction
  - `agent-manager/scripts/commands/status.py`
  - `agent-manager/scripts/commands/schedule.py`
  - wrapper delegation tests updated
- **Slice 4**: list handler extraction
  - `agent-manager/scripts/commands/listing.py`
  - `main.py` `cmd_list` converted to wrapper delegation
  - list output/filter regression tests added
- **Slice 5**: doctor handler extraction
  - `agent-manager/scripts/commands/doctor.py`
  - `main.py` `cmd_doctor` converted to wrapper delegation
  - doctor command behavior + wrapper delegation tests added

### Completed slice (latest)

- **Slice 6**: heartbeat dispatch extraction
  - extracted `cmd_heartbeat` subcommand routing to `scripts/commands/heartbeat.py`
  - kept `cmd_heartbeat_run/cmd_heartbeat_trace/cmd_heartbeat_slo` behavior unchanged
  - converted `main.py` `cmd_heartbeat` to wrapper-only delegation
  - added wrapper routing + command branching tests

### Next slice (current target)

- **Slice 7**: schedule run orchestration extraction
  - extract `cmd_schedule_run` orchestration path into command/service helpers
  - keep schedule guardrails and restart policy behavior unchanged
  - keep `main.py` wrapper-only delegation for schedule command family
  - add regression tests for busy/stuck/error restart boundaries

## Migration Notes

- User-facing CLI remains unchanged: command names, arguments, defaults, and outputs are preserved.
- No config/schema migration is required for existing `agents/*.md` files.
- Any future command extension should update:
  - argument definitions in `cli_parser.py`
  - command routing in `command_registry.py`
  - command implementation in `scripts/commands/`

## Validation Baseline

- `python3 -m compileall -q agent-manager`
- `python3 -m unittest discover -s agent-manager/scripts/tests -p 'test_*.py' -q`
- plus targeted wrapper tests for each extracted slice

## Rollback Strategy

- revert only the latest slice commit(s) if behavior drift is detected
- keep wrappers in `main.py` stable so rollback does not change CLI surface
