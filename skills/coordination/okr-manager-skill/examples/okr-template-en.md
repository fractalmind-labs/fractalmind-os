### OKR {Name} ({date}) — ACTIVE {priority_emoji} {priority}

**Owner**: {owner}

#### Objective
{1 sentence: verb + measurable outcome}

#### Success Criteria
**{Quantifiable, binary-verifiable completion statement}**

#### Key Results

> **Dependency order**: KR1 → KR2 → ... → KRn

**KR1: {Observable result}** — PENDING
- Deliverable: {What is produced — PR / Issue / Document / Deployment}
- Outcome: {What changes in the world when this KR is done}
- Verification: {How to prove done — CI green / QA PASS / test passed}

**KR2: {Observable result}** — PENDING
- Deliverable: {What is produced}
- Depends on: KR1
- Outcome: {What changes in the world when this KR is done}
- Verification: {How to prove done}

**KR3: {Observable result}** — PENDING
- Deliverable: {What is produced}
- Depends on: KR2
- Outcome: {What changes in the world when this KR is done}
- Verification: {How to prove done}

#### Tasks / Milestones (recommended)

- [ ] Task A — {Execution step owned by the assigned owner}
- [ ] Task B — {Execution step that unblocks KR2}
- [ ] Task C — {Execution step that prepares final verification}

---

## Example: Filled In

### OKR API Gateway (2026-03) — ACTIVE 🔴 P0

**Owner**: Agent-007

#### Objective
Deploy a **production-ready API Gateway** with rate limiting, authentication, and monitoring, serving ≥100 RPS with <50ms p99 latency.

#### Success Criteria
**API Gateway deployed to production, handling ≥100 RPS with p99 latency <50ms, rate limiting active, and 24h stability observation passed with 0 downtime.**

#### Key Results

> **Dependency order**: KR1 → KR2 → KR3

**KR1: Authenticated gateway path handles end-to-end smoke traffic in staging** — ✅ COMPLETE
- Deliverable: Staging gateway rollout + smoke-test evidence (PR #42)
- Outcome: A signed-in request can pass through the gateway, hit the upstream service, and return a traced response
- Verification: 20/20 smoke requests pass with auth + trace headers present

**KR2: Gateway sustains ≥100 RPS with p99 latency <50ms and error rate <1% in staging** — 🟡 IN PROGRESS
- Deliverable: Gateway tuning changes + k6 load-test report (PR #55)
- Depends on: KR1
- Outcome: The staged gateway meets the target throughput envelope without degraded tail latency
- Verification: k6 report attached, CI green, p99 latency <50ms, error rate <1%

**KR3: Production gateway exposes alerts and passes 24h stability observation with 0 downtime** — PENDING
- Deliverable: Production deployment + monitoring dashboard + stability report
- Depends on: KR2
- Outcome: Production traffic is protected by rate limits, visible in monitoring, and stable for a full observation window
- Verification: Monitoring dashboard active, alerts configured, 24h uptime 100%

#### Tasks / Milestones (recommended)

- [x] Task A — Finalize auth + routing smoke test and attach evidence
- [ ] Task B — Run 10-minute k6 test, tune Redis + rate limit config, post report
- [ ] Task C — Deploy to production and watch the 24h stability window
