### OKR {Name} ({date}) — ACTIVE {priority_emoji} {priority}

**Owner**: {owner}

#### Objective
{1 sentence: verb + measurable outcome}

#### Success Criteria
**{Quantifiable, binary-verifiable completion statement}**

#### Key Results

> **Dependency order**: KR1 → KR2 → ... → KRn

**KR1: {Title}** — PENDING
- Deliverable: {What is produced — PR / Issue / Document / Deployment}
- {Implementation details}
- Verification: {How to prove done — CI green / QA PASS / test passed}

**KR2: {Title}** — PENDING
- Deliverable: {What is produced}
- Depends on: KR1
- {Implementation details}
- Verification: {How to prove done}

**KR3: {Title}** — PENDING
- Deliverable: {What is produced}
- Depends on: KR2
- {Implementation details}
- Verification: {How to prove done}

---

## Example: Filled In

### OKR API Gateway (2026-03) — ACTIVE 🔴 P0

**Owner**: Agent-007

#### Objective
Deploy a **production-ready API Gateway** with rate limiting, authentication, and monitoring, serving ≥100 RPS with <50ms p99 latency.

#### Success Criteria
**API Gateway deployed to production, handling ≥100 RPS with p99 latency <50ms, rate limiting active, and 24h stability observation passed with 0 downtime.**

#### Key Results

> **Dependency order**: KR1 → KR2 → KR3 → KR4

**KR1: Technical Design** — ✅ COMPLETE
- Deliverable: Design document (PR #42)
- Architecture: Kong Gateway + Redis rate limiter + JWT auth
- Verification: Design doc reviewed and merged ✓

**KR2: Core Implementation** — 🟡 IN PROGRESS
- Deliverable: Gateway service + rate limiter + auth middleware (PR #55)
- Depends on: KR1
- Rate limiting: token bucket algorithm, 100 req/min per user
- Auth: JWT validation with RSA-256
- Verification: Unit tests pass, CI green

**KR3: Load Testing** — PENDING
- Deliverable: Load test report + CI green PR
- Depends on: KR2
- Run k6 load test: 100 RPS sustained for 10 minutes
- Verify: p99 latency <50ms, 0 errors, no memory leaks
- Verification: Load test report + CI green

**KR4: Production Deployment** — PENDING
- Deliverable: Production deployment + monitoring dashboard
- Depends on: KR3
- Deploy to production cluster
- Configure monitoring alerts (latency, error rate, uptime)
- 24h stability observation
- Verification: 24h uptime 100%, monitoring dashboard active
