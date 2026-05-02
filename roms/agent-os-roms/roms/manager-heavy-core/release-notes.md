# manager-heavy-core release notes

## v0.6.0
Date: 2026-05-02
Status: production-ready

### What's new
- **Current manager OS refresh** based on the latest production main-session operating rules before OS upgrade.
- **DREAM.md added** as an explicit idle-maintenance boundary: dream tasks may organize memory and improve skills, but must not rewrite OS/control-plane/runtime files without explicit operator approval.
- **Heartbeat discipline updated** with the current TODO-first workflow, `HEARTBEAT_OK` three-gate check, fresh evidence requirements, dual `formal blocker` / `execution stalled` reporting, and turbo-frequency evaluation handoff.
- **SOUL/SYSTEM principles refreshed** with current manager lessons: formal blocker semantics, QA gate discipline, repo-backed decisions, no direct AI-worker DMs, surgical changes, explicit assumptions, and verifiable completion criteria.
- **AGENTS bootstrap refreshed** with provider-history reconciliation in main sessions and dream maintenance references.
- **turbo-frequency skill declared** as an optional git-sourced skill.

### Breaking changes from v0.5.0
- `install_boundary.creates_files` now includes `DREAM.md`.
- `upgrade_boundary.mutable_paths` now includes `DREAM.md`.
- `optional_skills` now includes `turbo-frequency` from `fractalmind-ai/turbo-frequency-skill`.
- Templates are more conservative about exposing operator-private data; `USER.md`, `MEMORY.md`, and `TOOLS.md` remain placeholders and should not be copied from a real workspace into a ROM.

### Migration from v0.5.0
- Add `DREAM.md` to existing workspaces before enabling dream/idle maintenance.
- If `turbo-frequency` is installed, keep repeated heartbeat-frequency rules under `.agent/skills/turbo-frequency/rules/heartbeat.md`; otherwise use HEARTBEAT's manual frequency note.
- Reconcile local `HEARTBEAT.md` and `TODO.md` manually to avoid losing active execution state.

---


## v0.5.0
Date: 2026-04-16
Status: production-ready

### What's new
- **agent-calendar open-sourced**: `agent-calendar` is now a standalone public repo at `fractalmind-ai/agent-calendar-skill`, referenced via git source instead of embedded
- Embedded `agent-calendar` files removed from `templates/.agent/skills/agent-calendar/`

### Breaking changes from v0.4.0
- `agent-calendar` source changed from `embedded` to `git` — installers that handle embedded sources for agent-calendar must now support git clone/checkout
- `templates/.agent/skills/agent-calendar/` directory removed

### Migration from v0.4.0
- Installers already supporting `git` source type (for agent-manager/team-manager) need no changes
- agent-calendar content is fetched from `https://github.com/fractalmind-ai/agent-calendar-skill.git` at tag `v0.1.0`

---

## v0.4.0
Date: 2026-04-16
Status: production-ready

### What's new
- **Embedded skills bundled in templates**: `agent-calendar` and `notifier` skill files are now included in `templates/.agent/skills/`, so other hosts installing this ROM can find and use these skills without external fetching
  - `agent-calendar`: SKILL.md + 3 scripts (main.py, status_detector.py, quota_tracker.py) + 3 reference docs
  - `notifier`: SKILL.md + 1 script (notify.py)
- **Skill classification**: `agent-calendar` and `notifier` moved from `included_skills` to `optional_skills` — they are useful but not required for the OS to function
- **install_boundary separation of concerns**: `install_boundary.creates_files` now only lists OS core workspace files; skill installation is driven by `included_skills` / `optional_skills` source declarations, not by install_boundary

### Breaking changes from v0.3.0
- `included_skills` reduced to 2 (agent-manager, team-manager); agent-calendar and notifier moved to new `optional_skills` section
- `install_boundary.creates_files` no longer lists skill files

### Migration from v0.3.0
- If your installer reads `included_skills` for agent-calendar/notifier, update to also check `optional_skills`
- Skill files are still in `templates/.agent/skills/` — installer should use `source.path` to locate them

---

## v0.3.0
Date: 2026-04-16
Status: production-ready

### What's new
- **Skill source declarations**: `included_skills` upgraded from plain name list to structured source definitions per `skill-source` contract
  - `agent-manager` — git source from `fractalmind-ai/agent-manager-skill`
  - `team-manager` — git source from `fractalmind-ai/team-manager-skill`
  - `agent-calendar` — embedded (bundled in workspace)
  - `notifier` — embedded (bundled in workspace)

### Breaking changes from v0.2.0
- `included_skills` format changed from string list to object list with `name` + `source` fields
- Installers that parse `included_skills` as a flat list must be updated

### Migration from v0.2.0
Update any tooling that reads `included_skills` to expect objects with `name` and `source` keys instead of plain strings.

---

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
