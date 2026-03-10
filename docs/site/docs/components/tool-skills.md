# Tool Skills

Optional skills that extend AI agent capabilities.

## use-fractalbot-skill

**Repo**: [fractalmind-ai/use-fractalbot-skill](https://github.com/fractalmind-ai/use-fractalbot-skill)

Allows AI agents to send outbound messages through fractalbot. When an agent needs to notify a human or post to a channel, it uses this skill to interface with the fractalbot gateway.

```bash
npx openskills install fractalmind-ai/use-fractalbot-skill
```

## agent-browser-skill

**Repo**: [fractalmind-ai/agent-browser-skill](https://github.com/fractalmind-ai/agent-browser-skill)

Headless browser automation for AI agents. Browse web pages, take screenshots, fill forms, and audit UI — all without a visible browser window.

```bash
npx openskills install fractalmind-ai/agent-browser-skill
```

## use-phone-skill

**Repo**: [fractalmind-ai/use-phone-skill](https://github.com/fractalmind-ai/use-phone-skill)

Control Android devices via ADB (Android Debug Bridge). Tap, swipe, type, take screenshots, and interact with mobile apps — useful for mobile testing and automation.

```bash
npx openskills install fractalmind-ai/use-phone-skill
```

## turbo-frequency-skill

**Repo**: [fractalmind-ai/turbo-frequency-skill](https://github.com/fractalmind-ai/turbo-frequency-skill)

Dynamic heartbeat frequency adjustment for AI agents — like CPU turbo boost. Automatically scales agent check-in intervals based on workload: faster when tasks are active, slower when idle.

```bash
npx openskills install fractalmind-ai/turbo-frequency-skill
```

## Creating Your Own Skill

Any skill that follows the openskills format can be published and shared:

```bash
# Use the skill-creator to bootstrap a new skill
npx openskills read skill-creator
```

A skill is fundamentally a `SKILL.md` file with:
- YAML frontmatter (name, description)
- Markdown body with instructions for the AI agent
- Optional bundled resources (scripts, references, assets)

See the [openskills documentation](https://github.com/anthropics/claude-code) for the full specification.
