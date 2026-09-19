.PHONY: lint test coverage ci

COVERAGE_MIN ?= 45
COVERAGE_CMD ?= python3 -m coverage

lint:
	python3 -m compileall -q agent-manager

test:
	python3 -m unittest discover -s agent-manager/scripts/tests -p 'test_*.py' -v

coverage:
	@$(COVERAGE_CMD) --version >/dev/null 2>&1 || ( \
		echo "Missing coverage tool. Install with: python3 -m pip install coverage"; \
		echo "Or use: COVERAGE_CMD=\"uvx --with pyyaml coverage\" make ci"; \
		exit 2; \
	)
	$(COVERAGE_CMD) run -m unittest discover -s agent-manager/scripts/tests -p 'test_*.py' -v
	$(COVERAGE_CMD) report --show-missing --fail-under=$(COVERAGE_MIN)

ci: lint test coverage
