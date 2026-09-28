# Go workspace

The root `go.work` lets you build and test the monorepo's Go modules together
instead of `cd`-ing into each one and tracking its toolchain by hand.

## Members

```
protocols/fractal-demail/bridge
protocols/fractal-demail/client-go
protocols/fractal-demail/gas-station-adapter
runtime/claude-code-go
runtime/fractalbot
runtime/fractalmind-envd
```

`go.work` sets `go 1.26.0`, the highest version any member requires
(`runtime/claude-code-go`). Go workspace mode uses one toolchain for every
member, but each module keeps its own `go` directive as its minimum — nothing
here forces the lower modules up to 1.26.

## `runtime/fractalmind-envd/desktop` is excluded

That module requires `github.com/pion/ice/v4 v4.0.10`, which still imports
`pion/transport/v3`. `runtime/fractalmind-envd` (the main module, unrelated to
desktop) directly requires `github.com/pion/turn/v4 v4.1.4`, which moved to
`pion/transport/v4`.

A Go workspace selects one version per module path across every member it
includes. Adding desktop to the workspace would force it to build against
`turn v4.1.4` too — even though its own `go.mod` only needs `v4.0.0` — and its
build fails with a type mismatch between `transport/v3.Net` and
`transport/v4.Net` inside `pion/ice`'s own source. Both modules build and test
fine on their own; this is a pre-existing tension between their pinned
dependencies, not something introduced here.

Resolving it for real means either bumping desktop's `pion/webrtc`/`pion/ice`
to a release built against `transport/v4`, or moving envd off `turn v4.1.4` —
both are dependency changes to evaluate on their own, not something to do as
a side effect of adding workspace tooling.

### Building desktop directly

`go.work` covers every directory under the repository root by walking up from
the current directory, exactly like `go.mod` discovery — this applies even to
directories, like desktop's, that `go.work` does not `use`. Plain `go build`
inside `runtime/fractalmind-envd/desktop` fails with "directory prefix .
does not contain modules listed in go.work", not because desktop is broken,
but because Go finds the ancestor `go.work` and refuses to operate on a
non-member module under it. Set `GOWORK=off` to fall back to desktop's own
`go.mod`, exactly as if `go.work` did not exist:

```bash
cd runtime/fractalmind-envd/desktop
GOWORK=off go build ./...
GOWORK=off go vet ./...
GOWORK=off go test ./...
```

`make test-go MODULE=runtime/fractalmind-envd/desktop` does this
automatically — every Makefile Go target sets `GOWORK=off` for any module
that is not one of `go.work`'s members.

## Commands

From the repository root, with `go.work` present, commands run against a
single member from inside its own directory:

```bash
cd runtime/fractalbot
go build ./...
go vet ./...
go test ./...
```

`go build`/`vet`/`test ./...` cannot be run for every module at once from the
repository root — the pattern is always relative to a module's own directory,
even under workspace mode. `go build all` / `go test all` do work root, but
they also cover every third-party dependency in the combined module graph, so
running that is slow and its output is not scoped to this repo's own code.
Use `make test-go` (see below) or `docs/ci.md`'s per-module CI jobs to run or
test every module.

### `go work sync`

`go work sync` pushes the workspace's unified dependency versions into each
member's own `go.mod`, so a module still resolves correctly when built outside
the workspace. It can leave `go.sum` incomplete for module graph pruning, so
follow it with `go mod tidy` in each affected module — `make work-sync` does
both.
