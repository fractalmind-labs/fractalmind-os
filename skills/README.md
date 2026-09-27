# Install FractalMind skills

Use the [skills CLI](https://github.com/vercel-labs/skills) to install a skill from
this monorepo into a project. Run the command from the project where your agent
will use the skill:

```bash
npx skills add https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/coordination/agent-manager-skill --skill agent-manager -a codex -y
npx skills list
```

Replace `codex` with `claude-code` for Claude Code. Omit `-a codex` to let the
CLI detect supported agents, or omit `-y` to use prompts in an interactive
terminal. Add `-g` for a user-level installation.
The CLI installs project skills under `.agents/skills/`; agent-specific links may
also be created. Restart an already-running agent session so it discovers the
new skill. There is no `skills read` command: ask the agent to use the installed
skill or open its `SKILL.md` directly.

The URL should point to a single skill source directory. For example:

| Skill | Source path | CLI skill name |
| --- | --- | --- |
| Agent Manager | `skills/coordination/agent-manager-skill` | `agent-manager` |
| Team Manager | `skills/coordination/team-manager-skill` | `team-manager` |
| OKR Manager | `skills/coordination/okr-manager-skill` | `okr-manager` |
| Team Chat | `skills/interfaces/team-chat-skill` | `team-chat` |
| FractalBot | `skills/interfaces/use-fractalbot-skill` | `use-fractalbot` |
| Browser | `skills/interfaces/agent-browser-skill` | `use-agent-browser` |

For another skill, replace the path after `/tree/main/` with its source directory
under this repository's `skills/` tree. Check its `SKILL.md` frontmatter for the
CLI skill name. Preview discovery without installing:

```bash
npx skills add https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/interfaces/agent-browser-skill --list
```

Some older instructions use `npx openskills install` and `.agent/skills/`.
Existing installations can continue to use those paths; new project installs
should use `npx skills add` and `.agents/skills/`.
