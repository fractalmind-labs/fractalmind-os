<div align="center">

# FractalMind AI — Documentation Site

**Heartbeat-driven operating system for AI agent teams.**

*Open-source infrastructure for governed autonomy, structured memory, multi-channel execution, and optional on-chain trust surfaces.*

[![Docs](https://img.shields.io/badge/docs-fractalmind--ai.github.io-4DA2FF)](https://fractalmind-ai.github.io)
[![GitHub Org](https://img.shields.io/badge/GitHub-fractalmind--ai-181717?logo=github)](https://github.com/fractalmind-ai)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VitePress](https://img.shields.io/badge/VitePress-1.6-646CFF?logo=vite)](https://vitepress.dev)

</div>

---

## What is FractalMind?

FractalMind AI is an **OS-first stack for running AI agent teams**.

The current operating core is not just an on-chain protocol. It is a heartbeat-driven control loop that turns messy multi-agent work into a repeatable system:

```
signal -> memory -> candidate OKR -> governance -> execution -> outcome -> evolution
```

That loop is currently realized through:

- **`oh-my-code`** — reference workspace where the control loop runs
- **`agent-manager`** — execution plane for tmux-based agents
- **`fractalbot`** — multi-channel routing for humans and agents
- **`fractalmind-okrs`** — shared candidate-OKR publication surface
- **`fractalmind-protocol`** — optional SUI trust layer for identity and governance

## Current Focus

FractalMind has moved beyond a pure **protocol-first** story. The current focus is:

- **heartbeat-driven coordination**
- **structured memory and durable runtime state**
- **governed autonomy with human veto on irreversible actions**
- **reviewable delivery with evidence, QA, and outcome tracking**
- **public trust surfaces when on-chain guarantees matter**

## Public Surfaces

| Surface | URL | Purpose |
|--------|-----|---------|
| Documentation | https://fractalmind-ai.github.io | Public docs for the stack and operating model |
| GitHub Org | https://github.com/fractalmind-ai | Source of truth for the 18 public repos |
| Explorer | https://fractalmind-ai.github.io/explorer | Visualization / trust surface |
| Candidate OKRs | https://github.com/fractalmind-ai/fractalmind-okrs | Shared publication surface for candidate OKRs |
| Protocol (SUI Testnet) | `0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24` | Optional on-chain trust layer |

## Repository Map

FractalMind AI currently spans **18 repositories** across four surfaces:

1. **OS kernel & governance**
   - `oh-my-code`, `fractalmind-okrs`, `.github`, `agent-manager-skill`, `team-manager-skill`, `okr-manager-skill`
2. **Execution & collaboration interfaces**
   - `fractalbot`, `team-chat-skill`, `use-fractalbot-skill`, `agent-browser-skill`, `use-phone-skill`, `turbo-frequency-skill`
3. **Protocol & runtime**
   - `fractalmind-protocol`, `fractalmind-envd`, `explorer`, `openclaw-gateway-app`
4. **Applications & distribution**
   - `fractalmind-ai.github.io`, `typemind-android`

## Quick Start

```bash
# Clone and install
git clone https://github.com/fractalmind-ai/fractalmind-ai.github.io.git
cd fractalmind-ai.github.io
npm ci

# Start local dev server
npm run docs:dev

# Build for production
npm run docs:build
```

Then open http://localhost:5173 to browse the docs locally.

## Learn More

- [What is FractalMind?](docs/guide/what-is-fractalmind.md)
- [Architecture Overview](docs/architecture/overview.md)
- [Components Overview](docs/components/overview.md)
- [Roadmap](docs/roadmap/index.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
