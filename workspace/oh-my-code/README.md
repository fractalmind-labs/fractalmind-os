# oh-my-code

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Python 3](https://img.shields.io/badge/python-3-blue.svg)](https://www.python.org/downloads/release/python-38/)
[![Stars](https://img.shields.io/github/stars/fractalmind-ai/oh-my-code?style=social)](https://github.com/fractalmind-ai/oh-my-code/stargazers)
[![Forks](https://img.shields.io/github/forks/fractalmind-ai/oh-my-code?style=social)](https://github.com/fractalmind-ai/oh-my-code/network/members)

`oh-my-code` is a turnkey, process-oriented multi-agent setup for automated development workflows.

It vendors `agent-manager` under `.claude/skills/agent-manager`, so a plain `git clone` is enough (no `openskills install` required).

## 📋 Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quickstart](#quickstart)
- [Quality Gates](#quality-gates)
- [Team](#team)
- [Agents](#agents)
- [OKR-Driven Heartbeat](#okr-driven-heartbeat)
- [Personality Files](#personality-files)
- [Contributing](#contributing)
- [License](#license)

## ✨ Features

- **Turnkey Setup**: Clone and go - no external dependencies
- **Multi-Agent Orchestration**: Automated task distribution and execution
- **Agent Personality System**: Configurable identity, soul, and memory files for persistent agent behavior
- **Quality Gates**: Automated code quality checks
- **Scheduled Work Cycles**: 15-minute automated work cycles
- **OKR-Driven Heartbeat**: Periodic heartbeat loop that reads OKR state, identifies blockers, and advances objectives
- **Process-Oriented**: GitHub issues-driven workflow

## 📦 Requirements

- `python3`
- `tmux`

## 🚀 Quickstart

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
python3 .claude/skills/agent-manager/scripts/main.py start coder-b
python3 .claude/skills/agent-manager/scripts/main.py start coder-a
python3 .claude/skills/agent-manager/scripts/main.py assign coder-a <<'EOF'
Task:
- <what you want done>
EOF
python3 .claude/skills/agent-manager/scripts/main.py monitor coder-a --follow
```

## 🔍 Quality Gates (Default)

Run on the repo you changed (often a `workspace/<repo>` submodule):

```bash
# auto-detect gates in that repo
bash scripts/quality-gates.sh --repo workspace/<repo>

# verify without allowing file changes
bash scripts/quality-gates.sh --repo workspace/<repo> --mode check
```

## 👥 Team

Team membership and roles: `TEAM.md`.

Workflow: follow `workflows/github_issues.md`.

## 🤖 Agents

Agents live in `agents/EMP_*.md`:
- `coder-a` (EMP_0002): Team Lead + QA; drives `workflows/github_issues.md` + quality gates
- `supervisor`: watchdog that keeps the Team Lead alive
- `coder-b` (EMP_0003): developer (implementation)

To switch CLIs, edit `agents/EMP_0001.md`, `agents/EMP_0002.md`, `agents/EMP_0003.md` `launcher:` fields.

## 🎯 OKR-Driven Heartbeat

The coordinator agent runs a periodic heartbeat that keeps work aligned with objectives:

1. **Read** `OKR.md` to find active objectives and their blocked key results.
2. **Check** progress via `gh` CLI and agent status (`tmux capture-pane`).
3. **Advance** — take the smallest action to unblock (assign agent, check CI, label PR).
4. **Update** `OKR.md` when a key result status changes.
5. **Notify** (optional) — send a summary to Slack or Telegram.

If no OKRs are active, the heartbeat replies `HEARTBEAT_OK` and idles.

### Key Files

| File | Purpose |
|------|---------|
| [`HEARTBEAT.md`](HEARTBEAT.md) | Coordinator's heartbeat runbook |
| [`OKR.md`](OKR.md) | Active and archived OKRs |
| [`memory/heartbeat-state.json`](memory/heartbeat-state.json) | Persistent heartbeat state |
| [`workflows/github_issues.md`](workflows/github_issues.md) | Tactical issue-to-PR workflow |

## 🧠 Personality Files

These files give your agent a persistent identity and memory across sessions. Fill them in to customize behavior:

| File | Purpose |
|------|---------|
| [`SOUL.md`](SOUL.md) | Core values, boundaries, and behavioral principles |
| [`IDENTITY.md`](IDENTITY.md) | Agent name, role, and avatar |
| [`USER.md`](USER.md) | Info about the human operator (timezone, preferences) |
| [`MEMORY.md`](MEMORY.md) | Curated long-term memory (people, workflows, lessons) |
| [`TOOLS.md`](TOOLS.md) | Environment-specific notes (SSH hosts, endpoints, devices) |

All files are templates with placeholder comments — fill in your details and delete the comments.

## 🤝 Contributing

Contributions are welcome! Please read our [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [FractalMind AI](https://github.com/fractalmind-ai)
- [Agent Manager](https://github.com/fractalmind-ai/agent-manager-skill)
- [Team Manager](https://github.com/fractalmind-ai/team-manager-skill)
