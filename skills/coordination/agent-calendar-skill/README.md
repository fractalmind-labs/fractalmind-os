# agent-calendar-skill

Agent availability calendar system — like Google Calendar for your AI agents.

## What it does

- Tracks agent availability states: **free**, **busy** (working), **unavailable** (quota exhausted / "on vacation")
- Monitors API quota usage and estimates remaining capacity
- Detects idle/stalled agents via output pattern analysis
- Helps team leads optimize task scheduling and assignment

## Installation

This skill follows the [agent-os-spec](https://github.com/fractalmind-ai/agent-os-spec) skill contract.

From the workspace where your agent will use it:

```bash
npx skills add https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/coordination/agent-calendar-skill --skill agent-calendar -a codex -y
```

The project installation lives in `.agents/skills/agent-calendar/`. Replace
`codex` with `claude-code` for Claude Code.

### As a git-sourced skill

In your ROM manifest:

```yaml
skills:
  - name: agent-calendar
    source:
      type: git
      repo: https://github.com/fractalmind-ai/agent-calendar-skill.git
      ref: v0.1.0
      path: agent-calendar
```

### Manual installation

Copy the `agent-calendar/` directory to `.agent/skills/agent-calendar/` in your workspace.

## Structure

```
agent-calendar/
├── SKILL.md              # Skill entry point and usage instructions
├── scripts/
│   ├── main.py           # Calendar CLI (check, block, free, status)
│   ├── status_detector.py # Agent activity detection via tmux output
│   └── quota_tracker.py  # API quota tracking and estimation
└── references/
    ├── DETECTION_MECHANISM.md  # How agent status detection works
    ├── QUICKSTART.md           # Quick start guide
    └── QUOTA_ESTIMATION.md     # Quota estimation methodology
```

## License

MIT
