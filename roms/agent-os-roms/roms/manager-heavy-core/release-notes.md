# manager-heavy-core release notes

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
