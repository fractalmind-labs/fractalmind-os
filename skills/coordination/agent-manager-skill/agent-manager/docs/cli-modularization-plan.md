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

### Next slice (current target)

- **Slice 3-B**: heartbeat dispatch wrapper extraction
  - move `cmd_heartbeat` dispatch branching into `scripts/commands/heartbeat.py`
  - keep `cmd_heartbeat_run/cmd_heartbeat_trace/cmd_heartbeat_slo` behavior unchanged
  - keep `main.py` wrapper-only delegation for backward compatibility
  - add regression tests for wrapper routing and unchanged exit/output contract

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
