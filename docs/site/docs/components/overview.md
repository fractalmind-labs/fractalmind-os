# Components Overview

FractalMind AI consists of 13 repositories organized into four categories.

## Core Components

These are the essential building blocks of the FractalMind stack.

| Component | Repo | Language | Role | Status |
|-----------|------|----------|------|--------|
| [fractalmind-protocol](/components/protocol) | [GitHub](https://github.com/fractalmind-ai/fractalmind-protocol) | Move + TS | On-chain org/agent/task/governance | Stable |
| [agent-manager](/components/agent-manager) | [GitHub](https://github.com/fractalmind-ai/agent-manager-skill) | Python | Agent lifecycle (tmux) | Stable |
| [team-manager](/components/team-manager) | [GitHub](https://github.com/fractalmind-ai/team-manager-skill) | Python | Team orchestration | Stable |
| [fractalbot](/components/fractalbot) | [GitHub](https://github.com/fractalmind-ai/fractalbot) | Go | Multi-channel messaging | Active |
| [okr-manager](/components/okr-manager) | [GitHub](https://github.com/fractalmind-ai/okr-manager-skill) | Skill | OKR lifecycle | Stable |
| [team-chat](/components/team-chat) | [GitHub](https://github.com/fractalmind-ai/team-chat-skill) | Python | File-backed messaging | Stable |

## Tool Skills

Optional skills that extend agent capabilities.

| Component | Repo | Description |
|-----------|------|-------------|
| use-fractalbot | [GitHub](https://github.com/fractalmind-ai/use-fractalbot-skill) | Agent-side message sending |
| agent-browser | [GitHub](https://github.com/fractalmind-ai/agent-browser-skill) | Headless browser automation |
| use-phone | [GitHub](https://github.com/fractalmind-ai/use-phone-skill) | ADB Android device control |

## Applications

End-user products built on the FractalMind stack.

| Component | Repo | Description |
|-----------|------|-------------|
| [oh-my-code](/components/applications) | [GitHub](https://github.com/fractalmind-ai/oh-my-code) | Reference AI agent workspace |
| [typemind-android](/components/applications) | [GitHub](https://github.com/fractalmind-ai/typemind-android) | Android AI keyboard |

## Planned

| Component | Role | Phase |
|-----------|------|-------|
| fractalmind-envd | Remote agent environment daemon | Phase 3 |
| Gateway Service | On-chain ↔ off-chain bridge | Phase 3 |

## How They Connect

See the [Architecture Overview](/architecture/overview) for dependency diagrams and data flow.

## Installation

All skills are distributed via openskills:

```bash
npx openskills install fractalmind-ai/<skill-name>
```

The protocol SDK is available via npm:

```bash
npm install @anthropic-ai/fractalmind-sdk
```
