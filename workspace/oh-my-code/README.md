# oh-my-code

`oh-my-code` is a turnkey, process-oriented multi-agent setup.

It vendors `agent-manager` under `.claude/skills/agent-manager`, so a plain `git clone` is enough (no `openskills install` required).

## Requirements

- `python3`
- `tmux`

## Quickstart

If your agent CLI supports `.claude/commands`, use:
- `/oh-my-code/quickstart`

To enable/disable the 15-minute scheduled work cycle:
- `/oh-my-code/startup`
- `/oh-my-code/shutdown`

Or run directly from the repo root:

```bash
bash scripts/preflight.sh

python3 .claude/skills/agent-manager/scripts/main.py list
python3 .claude/skills/agent-manager/scripts/main.py start supervisor
python3 .claude/skills/agent-manager/scripts/main.py start developer
python3 .claude/skills/agent-manager/scripts/main.py start qa
python3 .claude/skills/agent-manager/scripts/main.py assign supervisor <<'EOF'
Task:
- <what you want done>
EOF
python3 .claude/skills/agent-manager/scripts/main.py monitor supervisor --follow
```

## Quality Gates (Default)

Run on the repo you changed (often a `workspace/<repo>` submodule):

```bash
# auto-detect gates in that repo
bash scripts/quality-gates.sh --repo workspace/<repo>

# verify without allowing file changes
bash scripts/quality-gates.sh --repo workspace/<repo> --mode check
```

## Agents

Agents live in `agents/EMP_*.md`:
- `supervisor`: drives `workflows/github_issues.md` and monitors `developer` + `qa`
- `developer`: development + task management
- `qa`: quality assurance (quality gates + edge cases)

To switch CLIs, edit `agents/EMP_0001.md`, `agents/EMP_0002.md`, `agents/EMP_0003.md` `launcher:` fields.
