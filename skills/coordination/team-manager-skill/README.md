# Team Manager Skill

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Python 3](https://img.shields.io/badge/python-3-blue.svg)](https://www.python.org/downloads/release/python-38/)
[![Stars](https://img.shields.io/github/stars/fractalmind-ai/team-manager-skill?style=social)](https://github.com/fractalmind-ai/team-manager-skill/stargazers)

Team orchestration system for managing multi-agent teams with lead-based coordination.

## 📋 Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## ✨ Features

- 👥 **Multi-Agent Teams**: Group agents into coordinated teams
- 🎯 **Lead-Based Coordination**: Designated lead agent orchestrates work
- 📊 **Visual Workflows**: Define collaboration patterns with mermaid diagrams
- 📈 **Progress Monitoring**: Track all team members' output in real-time
- 🔧 **Installation-Agnostic**: Works from any location

## 📦 Installation

### Via skills CLI (recommended)

```bash
npx skills add fractalmind-labs/fractalmind-os --skill team-manager
```

### Requirements

This skill depends on **agent-manager**:

```bash
npx skills add fractalmind-labs/fractalmind-os --skill agent-manager
```

Python dependency:

```bash
python3 -m pip install pyyaml
```

## 🚀 Quick Start

```bash
# List all teams
python3 ~/.claude/skills/team-manager/scripts/main.py list

# Create a new team
python3 ~/.claude/skills/team-manager/scripts/main.py create backend \
    --lead EMP_0001 --members EMP_0001 EMP_0002

# Assign task to team
python3 ~/.claude/skills/team-manager/scripts/main.py assign backend <<EOF
Implement the API endpoint
EOF

# Monitor team progress
python3 ~/.claude/skills/team-manager/scripts/main.py monitor backend --follow
```

## 📖 Documentation

See [SKILL.md](team-manager/SKILL.md) for complete documentation.

## 🤝 Contributing

Contributions are welcome! Please read our [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [FractalMind AI](https://github.com/fractalmind-ai)
- [Agent Manager](https://github.com/fractalmind-ai/agent-manager-skill)
- [oh-my-code](https://github.com/fractalmind-ai/oh-my-code)
