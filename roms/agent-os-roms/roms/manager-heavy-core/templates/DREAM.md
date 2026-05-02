# DREAM.md

Dream maintenance is for low-risk continuity hygiene while the agent is idle.

## Hard Boundary
Dream tasks must not modify OS/control-plane files unless the operator explicitly asked for that exact edit in the current conversation.

Do not modify:
- `SOUL.md`, `USER.md`, `AGENTS.md`, `SYSTEM.md`
- `HEARTBEAT.md`, `OKR.md`, `TODO.md`, `TOOLS.md`
- `.codex/`, `.claude/`, runtime state, launcher configs, cron/systemd files
- production/project code, workflows, secrets, deploy config, or money-sensitive files

## Allowed Dream Work
- Review recent `memory/YYYY-MM-DD.md` notes.
- Refresh `memory/index.md` topic pointers.
- Distill stable lessons into `MEMORY.md`.
- Improve local skill documentation/rules under `.agent/skills/<skill>/` when clearly safe.
- Archive stale notes or TODO residue into memory/archive files.

## If You Discover Control-Plane Drift
- Do not silently edit the control plane.
- Write a short recommendation into memory or a proposed patch note.
- Wait for explicit operator approval before changing OS/control-plane files.

## Output
- If useful work was done, summarize file paths changed and why.
- If nothing worth doing emerges, reply `DREAM_OK`.
