# Root build/test entry point for the fractalmind-os monorepo.
#
# Run `make help` for the full target list. Most targets accept MODULE=<path>
# to operate on a single subproject instead of every one, e.g.:
#
#   make test-go MODULE=runtime/fractalbot
#   make test-python MODULE=skills/coordination/agent-manager-skill
#
# Go modules are listed in go.work; this file's GO_MODULES mirrors it.
# runtime/fractalmind-envd/desktop is intentionally excluded from both — see
# the comment in go.work.

SHELL := /bin/bash
.DEFAULT_GOAL := help

GO_MODULES := \
	protocols/fractal-demail/bridge \
	protocols/fractal-demail/client-go \
	protocols/fractal-demail/gas-station-adapter \
	runtime/claude-code-go \
	runtime/fractalbot \
	runtime/fractalmind-envd

# Go modules whose CI also enforces `gofmt -l` cleanliness.
GOFMT_MODULES := runtime/claude-code-go runtime/fractalbot

PYTHON_PROJECTS := \
	skills/coordination/agent-manager-skill \
	skills/coordination/team-manager-skill \
	skills/interfaces/team-chat-skill \
	.

NODE_PROJECTS := \
	apps/explorer \
	apps/agent-console \
	docs/site \
	protocols/fractalmind-protocol/sdk

.PHONY: help
help:
	@echo "Targets:"
	@echo "  test          Run every test suite (Go, Python, Node)"
	@echo "  test-go       go test ./... in each Go module (MODULE= for one)"
	@echo "  test-python   Run each Python project's test suite (MODULE= for one)"
	@echo "  test-node     npm test/build in each Node project (MODULE= for one)"
	@echo "  vet           go vet ./... in each Go module (MODULE= for one)"
	@echo "  lint          gofmt -l (fractalbot, claude-code-go) + SDK typecheck"
	@echo "  fmt-check     gofmt -l only (MODULE= for one; used by CI per module)"
	@echo "  build-go      go build ./... in each Go module (MODULE= for one)"
	@echo "  work-sync     go work sync, then go mod tidy in every Go module"
	@echo ""
	@echo "See docs/go-workspace.md and docs/ci.md for details."

.PHONY: test
test: test-go test-python test-node

# go.work covers every directory under the repo root, so a module it does not
# `use` (runtime/fractalmind-envd/desktop, or any future non-member module
# passed via MODULE=) still needs GOWORK=off to fall back to its own go.mod
# instead of failing with "directory prefix . does not contain modules listed
# in go.work". Member modules must NOT set it, since that would also disable
# the local-path replace resolution fractalbot/bridge rely on. This check
# runs per module inside the shell loop, not as a Make macro, since it needs
# each iteration's $$m at runtime.
gowork_off = case " $(GO_MODULES) " in *" $$m "*) w= ;; *) w=GOWORK=off ;; esac

.PHONY: build-go
build-go:
	@modules="$(if $(MODULE),$(MODULE),$(GO_MODULES))"; \
	for m in $$modules; do \
		$(gowork_off); \
		echo "==> go build ./... ($$m)"; \
		(cd "$$m" && env $$w go build ./...) || exit 1; \
	done

.PHONY: vet
vet:
	@modules="$(if $(MODULE),$(MODULE),$(GO_MODULES))"; \
	for m in $$modules; do \
		$(gowork_off); \
		echo "==> go vet ./... ($$m)"; \
		(cd "$$m" && env $$w go vet ./...) || exit 1; \
	done

.PHONY: test-go
test-go: build-go vet
	@modules="$(if $(MODULE),$(MODULE),$(GO_MODULES))"; \
	for m in $$modules; do \
		$(gowork_off); \
		echo "==> go test ./... ($$m)"; \
		if [ "$$m" = "protocols/fractal-demail/bridge" ]; then \
			(cd "$$m" && env $$w go test -race ./...) || exit 1; \
		else \
			(cd "$$m" && env $$w go test ./...) || exit 1; \
		fi; \
	done

# MODULE= must be one of GOFMT_MODULES (the modules whose CI enforces this).
.PHONY: fmt-check
fmt-check:
	@modules="$(if $(MODULE),$(MODULE),$(GOFMT_MODULES))"; \
	status=0; \
	for m in $$modules; do \
		echo "==> gofmt -l ($$m)"; \
		files=$$(cd "$$m" && gofmt -l .); \
		if [ -n "$$files" ]; then \
			echo "gofmt needed on:"; echo "$$files"; status=1; \
		fi; \
	done; \
	exit $$status

.PHONY: lint
lint: fmt-check
	@echo "==> npm run typecheck (protocols/fractalmind-protocol/sdk)"; \
	(cd protocols/fractalmind-protocol/sdk && npm run typecheck)

# Python projects: agent-manager and team-manager have their own scripts/
# and tests/ layout; team-chat and the skills CLI layout tests run directly
# with unittest. MODULE= narrows to one project path.
.PHONY: test-python
test-python:
	@modules="$(if $(MODULE),$(MODULE),$(PYTHON_PROJECTS))"; \
	for m in $$modules; do \
		case "$$m" in \
			skills/coordination/agent-manager-skill) \
				echo "==> agent-manager unit tests"; \
				(cd "$$m" && python3 -m unittest discover -s agent-manager/scripts/tests -p 'test_*.py') || exit 1 ;; \
			skills/coordination/team-manager-skill) \
				echo "==> team-manager unit tests"; \
				(cd "$$m" && python3 -m unittest discover -s team-manager/tests -p 'test_*.py') || exit 1 ;; \
			skills/interfaces/team-chat-skill) \
				echo "==> team-chat unit tests"; \
				(cd "$$m" && python3 -m unittest discover -s tests) || exit 1 ;; \
			.) \
				echo "==> skills CLI layout tests"; \
				python3 -m unittest discover -s skills/tests -p 'test_*.py' || exit 1 ;; \
			*) \
				echo "unknown Python project: $$m" >&2; exit 1 ;; \
		esac; \
	done

.PHONY: test-node
test-node:
	@modules="$(if $(MODULE),$(MODULE),$(NODE_PROJECTS))"; \
	for m in $$modules; do \
		case "$$m" in \
			apps/explorer) \
				echo "==> explorer test + build"; \
				(cd "$$m" && npm ci && npm test && npm run build) || exit 1 ;; \
			apps/agent-console) \
				echo "==> agent-console checksum test + build"; \
				(cd "$$m" && pnpm install && bash scripts/test-release-macos-checksum.sh && pnpm build) || exit 1 ;; \
			docs/site) \
				echo "==> docs site build"; \
				(cd "$$m" && npm ci && npm run docs:build) || exit 1 ;; \
			protocols/fractalmind-protocol/sdk) \
				echo "==> SDK typecheck + test + build"; \
				(cd "$$m" && npm ci && npm run typecheck && npm test && npm run build) || exit 1 ;; \
			*) \
				echo "unknown Node project: $$m" >&2; exit 1 ;; \
		esac; \
	done

# Pushes the workspace's unified dependency versions into every member's own
# go.mod/go.sum (so each module still resolves correctly outside the
# workspace), then reconciles go.sum fully with `go mod tidy`. `go work sync`
# alone can leave go.sum missing entries under module graph pruning.
.PHONY: work-sync
work-sync:
	go work sync
	@for m in $(GO_MODULES); do \
		echo "==> go mod tidy ($$m)"; \
		(cd "$$m" && go mod tidy) || exit 1; \
	done
