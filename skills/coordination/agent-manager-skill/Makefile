.PHONY: lint test ci

lint:
	python3 -m compileall -q agent-manager

test:
	python3 -m unittest discover -s agent-manager/scripts/tests -p 'test_*.py' -v

ci: lint test
