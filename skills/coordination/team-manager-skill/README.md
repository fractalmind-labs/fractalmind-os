# Team Manager Skill

Team orchestration system for managing multi-agent teams with lead-based coordination.

## Installation

### via openskills (recommended)

```bash
openskills install fractalmind-ai/team-manager-skill
```

### Requirements

This skill depends on **agent-manager**:

```bash
openskills install fractalmind-ai/agent-manager-skill
```

## Features

- 👥 **Multi-Agent Teams**: Group agents into coordinated teams
- 🎯 **Lead-Based Coordination**: Designated lead agent orchestrates work
- 📊 **Visual Workflows**: Define collaboration patterns with mermaid diagrams
- 📈 **Progress Monitoring**: Track all team members' output in real-time
- 🔧 **Installation-Agnostic**: Works from any location

## Quick Start

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

## Documentation

See [SKILL.md](team-manager-skill/SKILL.md) for complete documentation.

## License

MIT
