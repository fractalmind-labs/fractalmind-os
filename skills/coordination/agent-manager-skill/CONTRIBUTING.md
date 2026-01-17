# Contributing to Agent Manager

Contributions are welcome! This skill is part of the FractalMind AI organization.

## Getting Started

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit with clear messages
5. Push and create a Pull Request

## Development

The agent-manager skill is designed to be installation-agnostic and work from any location.

### Key Components

- **scripts/repo_root.py**: Repo root + skills directory resolution
- **scripts/main.py**: CLI entry point
- **scripts/agent_config.py**: Agent configuration parser
- **scripts/tmux_helper.py**: Tmux session management
- **scripts/schedule_helper.py**: Crontab integration

### Testing

Test your changes locally:
```bash
# Install from local path
openskills install /path/to/agent-manager-skill

# Test basic functionality
python3 ~/.claude/skills/agent-manager/scripts/main.py list
```

## Code Style

- Follow PEP 8 for Python code
- Use type hints where appropriate
- Add docstrings to functions and classes
- Keep functions focused and modular

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
