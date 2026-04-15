# manager-heavy-core release notes

## v0.2.0
Date: 2026-04-15
Status: production-ready

### What's new
- **Full template set**: 11 files across workspace root, memory, and OKR subsystems
  - `SYSTEM.md` — kernel contract with manager principles and operating rules
  - `SOUL.md` — 40+ battle-tested operating principles across 11 categories (work philosophy, role, safety, autonomy, escalation, quality, patrol, communication, anti-drift, templates, OKR completion)
  - `AGENTS.md` — session bootstrap, memory rules, structure invariants, communication guidelines, heartbeat discipline
  - `HEARTBEAT.md` — TODO-first execution surface with 3-gate HEARTBEAT_OK criteria
  - `USER.md` — operator profile template with collaboration notes
  - `OKR.md` — active OKR control plane (max 3)
  - `TODO.md` — high-priority temporary work tracker
  - `MEMORY.md` — long-term curated memory
  - `TOOLS.md` — local tools and environment notes
  - `memory/index.md` — topic navigation index
  - `okrs/Candidate.md` — non-active OKR parking lot with lifecycle rules
- **Manifest updated** to reflect all created files and directories
- **TODO-first heartbeat** discipline: temporary urgent work is resolved before OKR progression
- **Escalation templates**: standardized approval request and blocker report formats
- **OKR completion guidelines**: 8 rules for evidence-based closure

### Breaking changes from v0.1.0
- `install_boundary.creates_files` expanded (added TODO.md, MEMORY.md, TOOLS.md, okrs/Candidate.md, memory/index.md)
- `bootstrap_entrypoint` changed from `install.sh` to `manual-bootstrap`
- `included_skills` removed `use-fractalbot` (operator-specific, should be added per workspace)

### Migration from v0.1.0
Since v0.1.0 had no real templates, this is effectively a fresh install. Copy templates/ contents to your workspace root.

---

## v0.1.0
Date: 2026-03-26
Status: bootstrap draft

### What was included
- First `manager-heavy-core` manifest draft
- Placeholder templates directory (README only)
- Goal was to validate spec <-> ROM minimal layering
