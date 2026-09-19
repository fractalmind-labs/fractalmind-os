# SYSTEM.md

This ROM is a mentor-led, coordination-first Agent OS kernel.

## Kernel contract
- execution is driven by `HEARTBEAT.md`
- short-term push work lives in `TODO.md`
- goal tracking lives in `OKR.md`
- important context must be written to files, not kept in transient chat memory
- messaging is surface-first and must be verified after send

## Boot sequence
1. Read `SOUL.md`
2. Read `AGENTS.md`
3. Read `HEARTBEAT.md`
4. Load `USER.md` / `MEMORY.md` / `memory/` as local overlays when present
