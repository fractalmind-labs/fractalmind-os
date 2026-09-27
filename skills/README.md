# Install FractalMind skills

Use the [skills CLI](https://github.com/vercel-labs/skills) to install a skill from
this monorepo into a project. Run the command from the project where your agent
will use the skill:

```bash
npx skills add fractalmind-labs/fractalmind-os --skill agent-manager
npx skills list
```

The CLI detects supported agents automatically. Use `-a claude-code` or
`-a codex` only when you want to select a specific target, `-g` for a user-level
installation, and `-y` for non-interactive CI installs.
The CLI installs project skills under `.agents/skills/`; agent-specific links may
also be created. Restart an already-running agent session so it discovers the
new skill. There is no `skills read` command: ask the agent to use the installed
skill or open its `SKILL.md` directly.

The repository shorthand points to this monorepo; `--skill` selects one skill:

| Skill | Source path | CLI skill name |
| --- | --- | --- |
| Agent Manager | `skills/coordination/agent-manager-skill` | `agent-manager` |
| Team Manager | `skills/coordination/team-manager-skill` | `team-manager` |
| OKR Manager | `skills/coordination/okr-manager-skill` | `okr-manager` |
| Team Chat | `skills/interfaces/team-chat-skill` | `team-chat` |
| FractalBot | `skills/interfaces/use-fractalbot-skill` | `use-fractalbot` |
| Browser | `skills/interfaces/agent-browser-skill` | `use-agent-browser` |

For a direct source URL, point at one skill directory and omit `--skill` because
each directory here contains one skill. Preview discovery without installing:

```bash
npx skills add https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/interfaces/agent-browser-skill --list
```

Some older instructions use `npx openskills install` and `.agent/skills/`.
Existing installations can continue to use those paths; new project installs
should use `npx skills add` and `.agents/skills/`.
