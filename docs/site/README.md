<div align="center">

# FractalMind AI — Documentation Site

**Three-plane infrastructure for governed AI agent teams.**

*SUI authority, target-side P2P execution, user-facing applications, and a heartbeat-driven local operating loop.*

[![Docs](https://img.shields.io/badge/docs-fractalmind--ai.github.io-4DA2FF)](https://fractalmind-ai.github.io)
[![GitHub Org](https://img.shields.io/badge/GitHub-fractalmind--ai-181717?logo=github)](https://github.com/fractalmind-ai)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VitePress](https://img.shields.io/badge/VitePress-1.6-646CFF?logo=vite)](https://vitepress.dev)

</div>

---

## What is FractalMind?

FractalMind AI combines a heartbeat-driven local operating system with a canonical three-plane model for privileged remote control.

The current operating core is not just an on-chain protocol. It is a heartbeat-driven control loop that turns messy multi-agent work into a repeatable system:

```
signal -> memory -> candidate OKR -> governance -> execution -> outcome -> evolution
```

That loop is currently realized through:

- **`oh-my-code`** — reference workspace where the control loop runs
- **`fractalmind-protocol`** — Control / Authority Plane on SUI
- **`fractalmind-envd`** — P2P Data / Execution Plane with target-side verification
- **Agent Console + envd-desktop** — Application Plane
- **`agent-manager`** — typed local tmux execution adapter
- **`fractalbot`** — multi-channel application adapter
- **`fractalmind-okrs`** — shared candidate-OKR publication surface
- **skills** — installable distribution packages, not authority owners

## Current Focus

FractalMind has moved beyond a pure **protocol-first** story. The current focus is:

- **heartbeat-driven coordination**
- **structured memory and durable runtime state**
- **governed autonomy through human–AI co-creation, not human bottlenecks**
- **reviewable delivery with evidence, QA, and outcome tracking**
- **target-scoped signed authority for privileged remote actions**
- **off-chain logs, media, input, and high-frequency telemetry**

## Public Surfaces

| Surface | URL | Purpose |
|--------|-----|---------|
| Documentation | https://fractalmind-ai.github.io | Public docs for the stack and operating model |
| GitHub Org | https://github.com/fractalmind-ai | Source of truth for the 18 public repos |
| Explorer | https://fractalmind-ai.github.io/explorer | Visualization / trust surface |
| Candidate OKRs | https://github.com/fractalmind-ai/fractalmind-okrs | Shared publication surface for candidate OKRs |
| Protocol (SUI Testnet) | `0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24` | Existing identity/task/governance package; remote-capability migration is not yet published |

## Repository Map

The repositories are classified as:

1. **Control / Authority Plane** — `fractalmind-protocol`
2. **P2P Data / Execution Plane** — `fractalmind-envd` plus local adapters such as `agent-manager`
3. **Application Plane** — Agent Console, envd-desktop, channel and automation clients
4. **Supporting roles** — heartbeat/OKR/team tooling, relays, caches, explorers, documentation, and skill distribution

See [tracker #6](https://github.com/fractalmind-ai/.github/issues/6) for current migration status.

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
