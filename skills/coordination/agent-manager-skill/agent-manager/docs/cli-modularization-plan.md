# CLI Modularization Plan (Issue #31)

This document defines the incremental refactor plan for `agent-manager/scripts/main.py`.

## Goals

- keep CLI behavior stable while reducing entrypoint complexity
- make command wiring explicit and testable
- prepare later extraction of command implementations into dedicated modules

## Slice Plan

### Slice 1 (this PR)

- extract argparse tree into `scripts/cli_parser.py`
- extract command dispatch map into `scripts/command_registry.py`
- keep all command implementations in `main.py`
- add regression tests for parser defaults + command routing contract

### Slice 2

- extract lifecycle commands to modules under `scripts/commands/`:
  - `start.py`, `stop.py`, `monitor.py`, `send.py`, `assign.py`
- keep shared helpers in `main.py` until service layer is introduced

### Slice 3

- extract scheduler/heartbeat command handlers:
  - `schedule.py`, `heartbeat.py`
- move heartbeat helper functions into `scripts/services/heartbeat_service.py`

### Slice 4

- introduce shared services:
  - `session_service.py`, `provider_service.py`, `runtime_service.py`
- reduce `main.py` to a thin entrypoint (parser + dispatch + process exit)

## Migration Notes (Slice 1)

- **User-facing CLI is unchanged**: command names, arguments, defaults, and outputs are preserved.
- `main.py` now imports parser/registry from:
  - `agent-manager/scripts/cli_parser.py`
  - `agent-manager/scripts/command_registry.py`
- Extensions/custom forks should add new command flags in `cli_parser.py` and register handlers in `command_registry.py`.
- No config/schema migration is required for existing `agents/*.md` files.
