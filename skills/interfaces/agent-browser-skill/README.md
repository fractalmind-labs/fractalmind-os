# agent-browser-skill

AI agent skill for headless browser automation via [agent-browser](https://github.com/vercel-labs/agent-browser) CLI.

Token-efficient web browsing, screenshots, form filling, and UI auditing for AI agents.

## What is this?

An [openskills](https://github.com/nicepkg/openskills)-compatible skill that teaches AI agents how to use `agent-browser` — a fast headless browser CLI optimized for AI agent usage.

**Key features:**
- **Token-efficient**: Accessibility-tree snapshots produce 200-400 tokens vs 3,000-5,000 for raw HTML
- **Element references**: Interactive elements get temporary IDs (`@e1`, `@e2`) for easy interaction
- **Session management**: Named sessions persist browser state across commands
- **Full browser control**: Navigate, click, fill forms, take screenshots, extract content, run JavaScript

## Installation

### Install the skill

```bash
npx openskills install fractalmind-ai/agent-browser-skill
```

Or manually copy `SKILL.md` into your `.agent/skills/use-agent-browser/` or `.claude/skills/use-agent-browser/` directory.

### Install browser dependencies (one-time)

```bash
# Option A: agent-browser built-in installer
npx agent-browser install --with-deps

# Option B: manual
npx playwright install-deps chromium
npx playwright install chromium
```

## Quick Start

```bash
# Open a page
npx agent-browser open "https://example.com"

# See interactive elements
npx agent-browser snapshot -i
# Output: - link "Learn more" [ref=e1]

# Click an element
npx agent-browser click @e1

# Take a screenshot
npx agent-browser screenshot /tmp/page.png

# Fill a form field
npx agent-browser fill @e3 "hello world"
```

## Command Quick Reference

| Category | Command | Description |
|----------|---------|-------------|
| Navigate | `open "URL"` | Go to URL |
| Navigate | `back` / `forward` | History navigation |
| Inspect | `snapshot -i` | Interactive elements only |
| Inspect | `snapshot` | Full accessibility tree |
| Inspect | `screenshot PATH` | Save PNG screenshot |
| Interact | `click @e1` | Click element |
| Interact | `fill @e1 "text"` | Type into input |
| Interact | `select @e1 "opt"` | Select dropdown option |
| Keyboard | `press "Enter"` | Press key |
| Keyboard | `type "text"` | Type at cursor |
| Content | `innertext @e1` | Get element text |
| Content | `evaluate "js"` | Run JavaScript |
| Session | `open URL --session name` | Named session |
| Session | `close --session name` | Close session |

See `SKILL.md` for the complete reference.

## Examples

- [`examples/site-audit.md`](examples/site-audit.md) — Website visual QA and link checking
- [`examples/form-testing.md`](examples/form-testing.md) — Automated form testing workflow
- [`examples/content-extraction.md`](examples/content-extraction.md) — Extracting structured data from web pages

## Requirements

- Node.js 18+
- `agent-browser` (installed automatically via `npx`)
- Chromium browser dependencies (see installation above)

## License

MIT
