# Components Overview

FractalMind AI currently spans **18 repositories** organized into four operating surfaces.

## 1. OS Kernel & Governance

These repositories define how the system discovers work, governs action, and records durable state.

| Component | Repo | Role |
|-----------|------|------|
| **oh-my-code** | [GitHub](https://github.com/fractalmind-ai/oh-my-code) | Reference workspace where the heartbeat-driven OS runs |
| **fractalmind-okrs** | [GitHub](https://github.com/fractalmind-ai/fractalmind-okrs) | Candidate OKR publication and review surface |
| **agent-manager** | [GitHub](https://github.com/fractalmind-ai/agent-manager-skill) | Execution plane for tmux-based agents |
| **team-manager** | [GitHub](https://github.com/fractalmind-ai/team-manager-skill) | Team orchestration and lead-based coordination |
| **okr-manager** | [GitHub](https://github.com/fractalmind-ai/okr-manager-skill) | Goal lifecycle and progress tracking |
| **.github** | [GitHub](https://github.com/fractalmind-ai/.github) | Shared org-level workflows and public profile surface |

## 2. Execution & Collaboration Interfaces

These repositories connect humans, agents, and tools.

| Component | Repo | Role |
|-----------|------|------|
| **fractalbot** | [GitHub](https://github.com/fractalmind-ai/fractalbot) | Multi-channel routing across Slack, Telegram, Discord, Feishu, etc. |
| **team-chat** | [GitHub](https://github.com/fractalmind-ai/team-chat-skill) | File-backed team collaboration and audit trail |
| **use-fractalbot** | [GitHub](https://github.com/fractalmind-ai/use-fractalbot-skill) | Agent-side outbound messaging skill |
| **agent-browser** | [GitHub](https://github.com/fractalmind-ai/agent-browser-skill) | Browser automation skill |
| **use-phone** | [GitHub](https://github.com/fractalmind-ai/use-phone-skill) | Android / ADB control skill |
| **turbo-frequency** | [GitHub](https://github.com/fractalmind-ai/turbo-frequency-skill) | Dynamic heartbeat frequency control |

## 3. Protocol & Runtime

These repositories extend FractalMind into public trust, distributed execution, and visualization.

| Component | Repo | Role |
|-----------|------|------|
| **fractalmind-protocol** | [GitHub](https://github.com/fractalmind-ai/fractalmind-protocol) | Optional on-chain trust layer on SUI |
| **fractalmind-envd** | [GitHub](https://github.com/fractalmind-ai/fractalmind-envd) | Runtime for remote / distributed agent execution |
| **explorer** | [GitHub](https://github.com/fractalmind-ai/explorer) | Public visualization surface |
| **openclaw-gateway-app** | [GitHub](https://github.com/fractalmind-ai/openclaw-gateway-app) | Gateway-facing application surface |

## 4. Applications & Distribution

These are end-user or public-facing surfaces built on top of the stack.

| Component | Repo | Role |
|-----------|------|------|
| **fractalmind-ai.github.io** | [GitHub](https://github.com/fractalmind-ai/fractalmind-ai.github.io) | Public documentation site |
| **typemind-android** | [GitHub](https://github.com/fractalmind-ai/typemind-android) | Android AI keyboard product surface |

## What Matters Most Right Now

The daily operating core today is:

```
oh-my-code + heartbeat + memory + fractalmind-okrs + agent-manager + fractalbot
```

That is the current center of gravity.

The protocol, envd, and explorer still matter — but they are now part of a broader **OS-first** story instead of the whole story by themselves.

## Installation

Skills continue to be distributed via openskills:

```bash
npx openskills install fractalmind-ai/<skill-name>
```

The protocol SDK remains available via npm when you need the trust layer:

```bash
npm install @anthropic-ai/fractalmind-sdk
```
