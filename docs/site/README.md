<div align="center">

# FractalMind AI — Documentation Site

**Open-source framework for organizing AI agent teams with structured workflows, goal tracking, and on-chain governance on SUI.**

[![Docs](https://img.shields.io/badge/docs-fractalmind--ai.github.io-4DA2FF)](https://fractalmind-ai.github.io)
[![GitHub Org](https://img.shields.io/badge/GitHub-fractalmind--ai-181717?logo=github)](https://github.com/fractalmind-ai)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VitePress](https://img.shields.io/badge/VitePress-1.6-646CFF?logo=vite)](https://vitepress.dev)

</div>

---

## What is FractalMind?

FractalMind helps teams organize AI agents into structured, collaborative workflows. It uses the same self-similar pattern at every level — from individual agents to multi-team organizations — with identity and governance recorded on SUI blockchain.

```
┌─────────────────────────────────────────────────┐
│                  Organization (SUI)              │
│                fractalmind-protocol              │
├────────────┬───────────────┬────────────────────┤
│  Team A    │    Team B     │     Team C          │
│  team-mgr  │   team-mgr   │    team-mgr         │
├────┬───────┼────┬──────────┼────┬───────────────┤
│ Agent│Agent │Agent│  Agent  │Agent│    Agent      │
│ a-mgr│a-mgr│a-mgr│  a-mgr │a-mgr│    a-mgr     │
└────┴───────┴────┴──────────┴────┴───────────────┘
        ▲              ▲              ▲
   fractalbot     okr-manager     envd (remote)
   (messaging)    (goal tracking) (WireGuard P2P)
```

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

## Links

| Resource | URL |
|----------|-----|
| Documentation | https://fractalmind-ai.github.io |
| Live Explorer | https://fractalmind-ai.github.io/explorer |
| GitHub Org | https://github.com/fractalmind-ai |
| Protocol (SUI Testnet) | `0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24` |

## Core Components

| Component | Description | Repo |
|-----------|-------------|------|
| **fractalmind-protocol** | SUI Move smart contracts | [GitHub](https://github.com/fractalmind-ai/fractalmind-protocol) |
| **fractalmind-envd** | Remote agent management (WireGuard + SUI) | [GitHub](https://github.com/fractalmind-ai/fractalmind-envd) |
| **fractalbot** | Multi-channel messaging bridge | [GitHub](https://github.com/fractalmind-ai/fractalbot) |
| **agent-manager** | Agent lifecycle management (tmux) | [GitHub](https://github.com/fractalmind-ai/agent-manager-skill) |
| **team-manager** | Multi-agent team orchestration | [GitHub](https://github.com/fractalmind-ai/team-manager-skill) |
| **okr-manager** | Goal tracking for AI teams | [GitHub](https://github.com/fractalmind-ai/okr-manager-skill) |
| **explorer** | On-chain org visualization (D3.js) | [GitHub](https://github.com/fractalmind-ai/explorer) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
