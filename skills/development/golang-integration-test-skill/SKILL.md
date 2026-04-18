---
name: golang-integration-test
description: Build Go integration tests that support deterministic mock mode, containerized dependency mode, and opt-in live mode. Use when designing or refactoring test harnesses for SDKs, services, bots, or other external integrations in Go; especially when you need Testcontainers for Go to manage MySQL/Redis dependencies, env-gated real network access, subprocess-managed daemons, Godog/Cucumber scenarios, scenario lifecycle cleanup, and operator-safe scripts for expensive or stateful tests.
---

# Go Integration Test

Use this skill to structure Go integration tests so they are cheap by default, realistic when needed, and survivable when external systems are flaky.

Read:

- `references/testcontainers-go.md` when the dependency is MySQL, Redis, or another Docker-friendly service.
- `references/hybrid-daemon-patterns.md` when the dependency is a custom Go daemon, external client, or hybrid mock/live scenario distilled from a production-style private codebase.

## Recommended layout

```text
tests/
├── go.mod
├── main.go
├── features/
├── step_definitions/
├── internal/testenv/
├── .env.example
└── run-live-tests.sh
```

Use a dedicated `tests/` module when the integration harness has different dependencies from the main application or needs its own runner.

Put reusable MySQL/Redis/Testcontainers setup helpers under `internal/testenv/` so the same container bootstrap logic is not duplicated across tests.

## Workflow

### 1. Split test modes up front

Define at least these four layers:

1. **unit** — pure Go helper tests with no network/process side effects
2. **mock integration** — full scenario flow, but with simulated service behavior
3. **container integration** — ephemeral local dependencies managed by Testcontainers for Go
4. **live integration** — real RPC/service/process interaction behind explicit env flags

Default to mock mode or container mode. Live mode must be opt-in.

### 2. Prefer Testcontainers for Docker-friendly dependencies

If the dependency is infrastructure-like and already has a stable image, prefer Testcontainers for Go over ad-hoc local setup.

Good fits:

- MySQL
- Redis
- Postgres
- Kafka
- LocalStack
- app + dependency combinations that can live on the same Docker network

Default pattern:

- use the module packages, e.g. `modules/mysql` and `modules/redis`
- start containers in test setup, not in shell docs the developer must manually follow
- register cleanup immediately with `testcontainers.CleanupContainer(t, c)` or `Terminate(ctx)`
- expose connection info through helper methods so tests use DSNs/addresses, not raw container internals

### 3. Centralize environment-gated config

Create one config struct with:

- safe defaults
- env overrides
- timeout values
- toggles for real queries / real writes / dry-run
- IDs and endpoints for the live target

Pattern:

```go
type TestConfig struct {
    RPCURL              string
    TimeoutSeconds      int
    QueryRealData       bool
    CreateRealResources bool
    DryRunMode          bool
}
```

Rules:

- keep defaults offline-friendly and deterministic
- let env vars enable live reads and live writes separately
- allow `dry-run=true` even when using real infrastructure
- do not use env flags to wire local MySQL/Redis if Testcontainers can provision them automatically

### 4. Fail fast only when live mode is requested

When live mode is enabled:

- initialize the real client early
- run a health check with timeout
- return a wrapped error immediately if the dependency is unavailable

When live mode is disabled:

- skip client initialization
- log that the suite is running in mock mode or container mode
- keep the same scenario semantics so features still document behavior

### 5. Use subprocesses only for custom daemons

If the system under test depends on another Go binary or background worker that is not naturally managed as an off-the-shelf container:

- build it once with `sync.Once`
- start it from the test harness with explicit config args
- wire stdout/stderr pipes
- scan logs for domain events you can assert on
- stop it gracefully in cleanup, then kill on timeout

For MySQL/Redis-like services, prefer Testcontainers instead.

### 6. Keep scenario state isolated

For Godog/Cucumber-style tests:

- register steps once in `InitializeContext`
- reset mutable state in `BeforeScenario`
- close clients and stop subprocesses in `AfterScenario`
- terminate any per-scenario containers in cleanup
- treat cleanup failures as visible test diagnostics

Never let one scenario leak positions, IDs, process state, or persistent container data into the next one.

### 7. Use dual-path or tri-path step implementations

Each important step should work in the modes you actually support:

- **mock path**: calculate or simulate the expected outcome deterministically
- **container path**: talk to ephemeral MySQL/Redis/etc. provisioned by Testcontainers
- **live path**: call the real client, wait for a bounded result, and capture the returned IDs

If the live backend is eventually consistent, allow a controlled fallback that preserves test progress while making the limitation explicit in logs.

### 8. Assert business outcomes, not incidental transport details

Prefer assertions like:

- rows are persisted and queryable after migration
- cache invalidation reaches Redis
- records become eligible for background processing
- highest-priority work item is processed first
- reward/fee math still holds under integration conditions
- circuit breaker or retry logic pauses execution when needed

Avoid overfitting to unstable details unless they are part of the contract.

### 9. Add a human-safe live runner

For tests that spend funds, mutate shared state, or hit public shared environments:

- provide `run-live-tests.sh`
- print the exact env-derived config
- require confirmation before execution
- explain required balances / credentials
- allow selecting a single feature file or scenario subset

Do not require this script for local MySQL/Redis container tests; those should run via normal `go test`.

### 10. Keep a small unit-test layer around helpers

Even if the main suite is BDD/integration-heavy, add normal `go test` coverage for:

- threshold math
- config parsing
- sorting/priority logic
- “mock mode skips subprocess” behavior
- fee/reward calculations
- DSN/address helper generation for Testcontainers-backed dependencies

This catches regressions without waiting for live infrastructure.

## Minimal implementation skeleton

```go
func main() {
    opts := godog.Options{Format: "pretty", Paths: []string{"features"}}
    status := godog.TestSuite{
        Name:                "Integration Tests",
        ScenarioInitializer: steps.InitializeContext,
        Options:             &opts,
    }.Run()
    os.Exit(status)
}
```

```go
func InitializeContext(sc *godog.ScenarioContext) {
    cfg := LoadConfigFromEnv()
    ctx := NewTestContext(cfg)

    sc.BeforeScenario(func(*godog.Scenario) {
        ctx.ResetScenarioState()
    })

    sc.AfterScenario(func(*godog.Scenario, error) {
        _ = ctx.Close()
    })
}
```

## When to read the reference files

Open `references/testcontainers-go.md` when you need:

- MySQL/Redis setup with `testcontainers-go`
- `CleanupContainer` / `Terminate` cleanup patterns
- container networking between app and dependency
- a reusable `TestEnv` helper for DSN/address wiring

Open `references/hybrid-daemon-patterns.md` when you need:

- an env-flag matrix for mock/live mode
- a subprocess manager pattern for another Go service
- a Godog context lifecycle example
- a safe fallback strategy for live systems that do not return stable IDs immediately
- examples of a confirmation-gated live test runner
