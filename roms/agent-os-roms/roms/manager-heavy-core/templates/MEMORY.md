# MEMORY.md - Long-Term Memory

## Purpose
Keep stable, high-value context that should survive session restarts.

Examples:
- Operator preferences and recurring constraints.
- Stable project truths.
- Lessons learned from incidents.
- Long-term collaboration patterns.

Rules:
- Load only in main/private sessions.
- Never expose this file in group/shared contexts.
- Do not dump short-term logs here; use `memory/YYYY-MM-DD.md`.
- Do not store secrets unless explicitly instructed and safe to do so.
