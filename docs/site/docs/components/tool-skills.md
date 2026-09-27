# Tool Skills

Installable distribution packages that extend AI agent capabilities.

Skills package bounded tools and workflows. Installing a skill does not grant remote node authority; privileged remote operations still follow signed-intent and target-verification policy.

## use-fractalbot-skill

**Source**: [use-fractalbot-skill](https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/interfaces/use-fractalbot-skill)

Allows AI agents to send outbound messages through fractalbot. When an agent needs to notify a human or post to a channel, it uses this skill to interface with the fractalbot gateway.

```bash
npx skills add https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/interfaces/use-fractalbot-skill --skill use-fractalbot -a codex -y
```

## agent-browser-skill

**Source**: [agent-browser-skill](https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/interfaces/agent-browser-skill)

Headless browser automation for AI agents. Browse web pages, take screenshots, fill forms, and audit UI — all without a visible browser window.

```bash
npx skills add https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/interfaces/agent-browser-skill --skill use-agent-browser -a codex -y
```

## use-phone-skill

**Source**: [use-phone-skill](https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/interfaces/use-phone-skill)

Control Android devices via ADB (Android Debug Bridge). Tap, swipe, type, take screenshots, and interact with mobile apps — useful for mobile testing and automation.

```bash
npx skills add https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/interfaces/use-phone-skill --skill use-phone -a codex -y
```

## turbo-frequency-skill

**Source**: [turbo-frequency-skill](https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/coordination/turbo-frequency-skill)

Dynamic heartbeat frequency adjustment for AI agents — like CPU turbo boost. Automatically scales agent check-in intervals based on workload: faster when tasks are active, slower when idle.

```bash
npx skills add https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/coordination/turbo-frequency-skill --skill turbo-frequency -a codex -y
```

## Creating Your Own Skill

Any skill that follows the Agent Skills format can be published and shared:

```bash
# Create a new skill source directory
npx skills init my-skill
```

A skill is fundamentally a `SKILL.md` file with:
- YAML frontmatter (name, description)
- Markdown body with instructions for the AI agent
- Optional bundled resources (scripts, references, assets)

See the [skills CLI documentation](https://github.com/vercel-labs/skills) for installation options.
