# PR #1 Recovery Plan

Date: 2026-04-13
Owner: main
Scope: `fractalmind-ai/claude-code-go#1`

## Current blockers

Reviewer `yubing744` requested changes on 2026-04-09 with 3 blocking points:

1. No CI / status checks are reported on the branch
2. PR is too large for safe review / merge
3. Validation evidence is not visible enough in the PR itself

Current PR status:

- PR: `#1`
- Head: `7585d5709c85aaba51b9b6aab79cc5be91a50360`
- State: `OPEN`
- Review: `CHANGES_REQUESTED`
- Merge state: `CLEAN`

## Recovery principle

Do **not** continue treating the current giant PR as mergeable.
First recover the merge path:

1. define a smaller reviewable first slice
2. wire minimum CI / reproducible checks
3. attach visible validation evidence

## Slice plan

### Slice 1 — bootstrap + CI

Goal:

- make the repo reviewable again
- land the smallest credible slice around CLI bootstrap / config surfaces

Target scope:

- `cmd/claude-code-go/main.go`
- minimal modules for:
  - `auth`
  - `config`
  - `doctor`
  - `install`
  - `update`
- docs:
  - `README.md`
  - `docs/command-gap-analysis.md`
- CI:
  - minimum automated checks for `go test ./...`, `go build ./...`, formatting / diff cleanliness

Done when:

- slice 1 diff is materially smaller than PR #1
- CI is visible on branch / PR
- validation evidence can be quoted directly in PR body / comment

### Slice 2 — direct-connect session lifecycle

Target:

- `server/open` ready / control / session lifecycle baseline

### Slice 3 — streaming / control parity

Target:

- streaming message/control compatibility

### Slice 4 — attachment / tool-result parity

Target:

- remaining high-frequency parity slices

## Immediate execution order

1. dev starts Slice 1 implementation
2. main tracks branch / evidence / CI
3. once slice 1 reaches commit-ready + validation-ready, main sends boss a short recovery receipt
