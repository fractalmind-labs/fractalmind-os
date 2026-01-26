# Contributing to oh-my-code

Thank you for your interest in contributing to oh-my-code! This document provides guidelines and instructions for contributing to the project.

## 📋 How to Contribute

### Reporting Bugs

Before creating bug reports, please check the existing issues as you might find that the problem has already been reported. When creating a bug report, please include:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected behavior vs. actual behavior
- Environment details (OS, Python version, tmux version)
- Any relevant logs or error messages

### Suggesting Enhancements

Enhancement suggestions are welcome! Please:

- Use a clear and descriptive title
- Provide a detailed explanation of the suggested enhancement
- Explain why this enhancement would be useful
- Provide examples if applicable

### Pull Requests

Pull requests are welcome! To ensure your PR is accepted:

1. Fork the repository
2. Create a new branch for your feature (`git checkout -b feature/amazing-feature`)
3. Make your changes and write clear commit messages
4. Ensure your code passes quality gates
5. Update documentation as needed
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## 🛠️ Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/oh-my-code.git
cd oh-my-code

# Run preflight checks
bash scripts/preflight.sh

# List available agents
python3 .claude/skills/agent-manager/scripts/main.py list
```

## 📝 Coding Standards

- Follow PEP 8 for Python code
- Write clear, descriptive variable and function names
- Add docstrings for functions and classes
- Keep functions small and focused
- Always run quality gates before submitting

## 🧪 Testing

Before submitting a PR, ensure:

- All quality gates pass (`bash scripts/quality-gates.sh --repo .`)
- The code works as expected
- No new linting errors are introduced
- Changes are well-tested

## 📖 Documentation

- Keep documentation up-to-date
- Add docstrings to new functions
- Update README if needed
- Document any breaking changes

## 💬 Communication

- Be respectful and constructive
- Ask questions if anything is unclear
- Participate in discussions on issues and PRs
- Follow the guidelines in TEAM.md

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## 👥 Team

See [TEAM.md](TEAM.md) for team structure and roles.
