# Heartbeat Integration for OKR Manager

How to wire OKR audits into your agent's heartbeat loop.

## Setup

### 1. Reference the Skill in Your Agent Config

In your agent's `AGENTS.md` or equivalent config, add the skill:

```yaml
skills:
  - okr-manager
```

### 2. Add OKR Audit to Your Heartbeat

In your `HEARTBEAT.md` (or heartbeat config), add an OKR check step:

```markdown
## Heartbeat Checklist

- [ ] Read `OKR.md` — check for ACTIVE OKRs
- [ ] For each IN PROGRESS KR: is it still progressing or blocked?
- [ ] For blocked KRs: what's the unblock action? Take it or escalate.
- [ ] Update KR statuses if anything changed
- [ ] If all KRs complete → check Success Criteria → mark OKR ACHIEVED
```

### 3. Example Heartbeat Flow

```
Heartbeat triggers
    ↓
Read OKR.md
    ↓
For each ACTIVE OKR:
    ├── Any KR completed since last check?
    │   └── Yes → Update status, check if downstream KRs unblocked
    ├── Any KR blocked?
    │   └── Yes → Log blocker, attempt unblock, or escalate
    └── What's the next action?
        └── Push it forward (assign task, trigger CI, follow up)
    ↓
Report changes (if any) to human
    ↓
Log to memory/YYYY-MM-DD.md
```

## Status Report Format

When reporting OKR status during heartbeats, use this compact format:

```
[OKR Status]
• API Gateway: KR2/4 — Core Implementation (IN PROGRESS)
• Docs Site: KR5/7 — Getting Started Guide (PENDING)
Blockers: KR2 waiting on Redis cluster provisioning
```

## Tips

- **Don't report every heartbeat** — only report when there are changes or blockers
- **Rotate through OKRs** — if you have many, check 2-3 per heartbeat
- **Push forward, don't just observe** — if a KR is unblocked, start working on it
- **Flag stale OKRs** — if a KR hasn't moved in >1 week, audit and update or escalate
