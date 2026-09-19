# Hybrid daemon integration-test patterns to reuse

Source basis: anonymized patterns extracted from a private production-style Go test harness.

## 1. Keep the BDD harness tiny

Files:

- `main.go`
- `features/*.feature`
- `step_definitions/*.go`

Pattern:

- `main.go` is only responsible for Godog options and exit code.
- All real behavior lives under `step_definitions/`.
- Feature files remain business-readable.

Why it matters:

- the runner stays stable while the domain logic evolves
- engineers can run a feature file directly with `go run main.go features/...`

## 2. Safe defaults, live mode via env flags

File shape: `step_definitions/config.go`

Use one config struct to separate:

- network endpoint
- target IDs or resource names
- signer/credential configuration
- live read toggle
- live write toggle
- dry-run toggle
- timeout budget

Important lesson:

- **live reads and live writes should not share one switch**
- you often want real reads with simulated writes first
- defaulting to mock mode keeps CI and local iteration cheap

## 3. Fail fast on live connectivity, noop in mock mode

File shape: `step_definitions/steps.go`

A setup step should do two different things:

- mock mode: log the mode and skip real client setup
- live mode: build the real SDK/client and immediately run a health check with timeout

Reuse this rule:

- do not half-initialize live clients
- if live mode is requested and health check fails, abort early with a wrapped error
- if live mode is not requested, preserve scenario flow with deterministic values

## 4. Subprocess-managed dependencies are worth the ceremony

File shape: `step_definitions/subprocess.go`

Useful patterns:

- detect paths relative to the `tests/` working directory
- `sync.Once` around `make build`
- start the daemon with `exec.Command`
- inject env like credentials and test mode
- scan stdout/stderr in goroutines
- extract domain events from logs into typed structs
- graceful shutdown via interrupt, with hard kill fallback after timeout

This is a good default when the integration test depends on another Go binary that should behave like production.

For Docker-friendly infra such as MySQL or Redis, prefer `testcontainers-go` instead of this subprocess pattern. Reserve subprocesses for custom daemons.

## 5. Mock mode should preserve semantics, not just skip work

File shape: `step_definitions/steps.go`

A setup step may avoid spawning a real subprocess in pure mock mode, but it should still mark the daemon as "running" if that preserves scenario semantics.

This is a subtle but important pattern:

- avoid breaking feature wording just because the backend is mocked
- keep the same Given/When/Then contract across execution modes

## 6. Real-path fallbacks are necessary for eventually consistent systems

Files:

- `step_definitions/steps.go`
- a helper near the real-resource creation section

In some live systems, a real write may not immediately yield a stable resource ID. The harness can therefore:

- prefer the final canonical ID when present
- fall back to an intermediate request/order/task ID when the system has not materialized the final object yet
- log the fallback explicitly

Reuse this when the external system is asynchronous.

The key is not to hide the limitation; log it and keep the scenario moving with a bounded fallback.

## 7. BeforeScenario / AfterScenario are the reliability core

File shape: `step_definitions/steps.go`

Reset per-scenario maps, flags, and current objects in `BeforeScenario`, then stop subprocesses and close clients in `AfterScenario`.

Carry this over directly:

- all mutable scenario state resets before each scenario
- all I/O handles are closed after each scenario
- cleanup errors are printed, not silently swallowed

## 8. Add a human-confirmed runner for expensive tests

File shape: `run-live-tests.sh`

Good operator patterns:

- refuse to run without credentials
- inherit one standard credential env var into a test-specific variable when needed
- print the full effective config
- warn that the run creates or mutates real resources
- require explicit `y/N` confirmation
- let the operator narrow to one feature file

This pattern generalizes well to any integration suite that spends money, creates cloud resources, or mutates shared environments.

## 9. Keep helper behavior under normal `go test`

File shape: `step_definitions/*_test.go`

Add fast unit coverage for:

- threshold math
- cost/fee expectation matching
- highest-priority-first ordering
- mock-mode subprocess skipping

This is the easiest way to stop your integration harness from rotting.

## 10. Practical scaffold you can copy

```text
tests/
├── main.go
├── go.mod
├── features/
│   └── domain.feature
├── step_definitions/
│   ├── config.go
│   ├── steps.go
│   ├── subprocess.go
│   └── steps_test.go
└── run-live-tests.sh
```

Use this scaffold when your Go project needs:

- scenario-style integration tests
- mock/live dual mode
- subprocess-managed custom daemons
- explicit operator gating for real mutations
