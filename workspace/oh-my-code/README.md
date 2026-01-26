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
- [Contributing](#contributing)
- [License](#license)

## ✨ Features

- **Turnkey Setup**: Clone and go - no external dependencies
- **Multi-Agent Orchestration**: Automated task distribution and execution
- **Quality Gates**: Automated code quality checks
- **Scheduled Work Cycles**: 15-minute automated work cycles
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

## 🤝 Contributing

Contributions are welcome! Please read our [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [FractalMind AI](https://github.com/fractalmind-ai)
- [Agent Manager](https://github.com/fractalmind-ai/agent-manager-skill)
- [Team Manager](https://github.com/fractalmind-ai/team-manager-skill)
