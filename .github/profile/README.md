<div align="center">

# FractalMind AI

**ASI that no one owns.**

*FractalMind AI is building ASI as permissionless, decentralized public infrastructure — intelligence that grows through self-similar organizations of agents, with governance that happens openly on-chain.*

[![Docs](https://img.shields.io/badge/docs-fractalmind--labs.github.io%2Ffractalmind--os-4DA2FF)](https://fractalmind-labs.github.io/fractalmind-os)
[![Monorepo](https://img.shields.io/badge/monorepo-fractalmind--os-181717?logo=github)](https://github.com/fractalmind-labs/fractalmind-os)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/fractalmind-labs)

</div>

---

## Mission / Vision / Values

### Mission
Reach ASI through fractal, self-similar organizations of AI agents — the same primitives repeating from a single agent to teams, organizations, and federations, so capability composes upward instead of depending on any single model.

### Vision
ASI that no one owns: permissionless, decentralized public infrastructure rather than the private asset of a few companies. Anyone can create an organization and join in, and governance happens openly on-chain.

### Phase 1 Objective
The phase-1 objective is explicit: **move toward ASI / superintelligence** through a governed operating system where humans and AI can co-create capability, memory, execution, and trust without losing alignment, transparency, or human veto.

### Values
- **Evidence before assertion**
- **Human–AI co-creation over zero-sum control**
- **Long-term flourishing over short-lived hype**
- **Recursive self-improvement in service of wisdom, freedom, and abundance**
- **Alignment with life, nature, and the evolving universe**
- **Transparency, reversibility, and operational honesty**

## How To Read FractalMind

FractalMind should be read in **three layers**:

1. **Vision layer** — the long-range mission and north star stay stable; we do not rewrite the destination every time the implementation changes.
2. **OS layer** — the current executable system is an OS-first control loop:

   ```
   signal -> memory -> candidate OKR -> governance -> execution -> outcome -> evolution
   ```

3. **Repository layer** — the concrete repos expose the system as working surfaces for coordination, execution, trust, and distribution.

## What FractalMind Is Today

FractalMind is no longer only a protocol story.

Today, the live implementation is an **OS-first stack** for running AI agent teams through a repeatable control loop.

That loop currently runs through:

- **[`workspace/oh-my-code`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/workspace/oh-my-code)** — the reference workspace and heartbeat-driven OS core
- **[`skills/coordination/agent-manager-skill`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills/coordination/agent-manager-skill)** — tmux-based execution plane for agents
- **[`runtime/fractalbot`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/runtime/fractalbot)** — multi-channel routing between humans and agents
- **[`governance/fractalmind-okrs`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/governance/fractalmind-okrs)** — candidate OKR publication surface
- **[`protocols/fractalmind-protocol`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/protocols/fractalmind-protocol)** — optional SUI trust layer when on-chain guarantees matter

## Repository Surfaces

FractalMind AI is one public monorepo,
[`fractalmind-os`](https://github.com/fractalmind-labs/fractalmind-os):

- [`workspace/`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/workspace) — reference operating workspace and agent control loop
- [`governance/`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/governance) — OKR and governance surfaces
- [`spec/`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/spec) and [`roms/`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/roms) — Agent OS contracts and distribution manifests
- [`protocols/`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/protocols) — SUI and agent communication protocols
- [`runtime/`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/runtime) — daemons, gateways, and local runtimes
- [`apps/`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/apps) — user-facing applications and explorers
- [`skills/`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/skills) — installable agent skills and skill registries
- [`docs/`](https://github.com/fractalmind-labs/fractalmind-os/tree/main/docs) — public documentation site and architecture notes

Private repositories remain separate:
[`agent-console`](https://github.com/fractalmind-labs/agent-console),
[`fractalmind-gateway`](https://github.com/fractalmind-labs/fractalmind-gateway),
[`fractalmind-memory`](https://github.com/fractalmind-labs/fractalmind-memory).

## Current Direction

The public framing is now:

- **Phase-1 goal stays explicit**: ASI / superintelligence remains the strategic destination for this stage
- **Stable mission, evolving implementation**: the destination stays steady even as the operating model improves
- **OS-first execution**: heartbeat, structured memory, governed execution, and measurable outcomes are the live center of gravity
- **Protocol as a layer, not the whole story**: on-chain trust still matters, but it now sits inside a broader operating system

The protocol still matters. It is now one trust surface inside the larger FractalMind stack.

## Start Here

- **Docs**: https://fractalmind-labs.github.io/fractalmind-os
- **GitHub Org**: https://github.com/fractalmind-labs
- **Candidate OKRs**: https://github.com/fractalmind-labs/fractalmind-os/tree/main/governance/fractalmind-okrs
- **Explorer**: https://fractalmind-labs.github.io/fractalmind-os/explorer/
- **Protocol (SUI Testnet)**: https://github.com/fractalmind-labs/fractalmind-os/tree/main/protocols/fractalmind-protocol
