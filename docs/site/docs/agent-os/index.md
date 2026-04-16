# Agent OS

Choose the right AI Agent operating system for your workspace.

Agent OS is a layered system that gives AI agents **persistent memory, goal-driven execution, and structured coordination**. Each OS distribution is called a **ROM** — a pre-configured package of templates, skills, and operating principles that you install into your workspace.

## How It Works

```
agent-os-spec (contracts)     What every OS must satisfy
        ↓
agent-os-roms (distributions)  Concrete OS packages you install
        ↓
your workspace                 Where your AI agent lives and works
```

## Available ROMs

<div class="rom-grid">

### [manager-heavy-core](/agent-os/roms/manager-heavy-core)
**Production-ready** &middot; v0.5.0

Manager-first coordination OS with full template set, 40+ battle-tested operating principles, OKR control plane, and multi-agent team management.

**Best for:** Multi-agent teams, OKR-driven execution, delegation-first coordination

**Skills:** agent-manager, team-manager + 2 optional

---

### [trinity](/agent-os/roms/trinity)
**Draft** &middot; v0.1.0

AI employee OS tuned for watched threads, evidence-driven delivery, and strict follow-up discipline. Designed for agents that must act like accountable operators.

**Best for:** Owner-facing AI employees, Slack/IM-heavy execution, strict accountability

**Skills:** agent-manager, use-fractalbot, turbo-frequency

---

### [mentor-coordinator-core](/agent-os/roms/mentor-coordinator-core)
**Draft** &middot; v0.1.0

Mentor-led coordination OS with surface-first delivery and post-send verification. Optimized for owner-side coordination with Slack and Sentry integration.

**Best for:** Mentor-led workspaces, GitHub + Slack execution tracking

**Skills:** agent-manager, planning-with-files, slack-workspace-inspector, sentry-event-query, use-fractalbot

</div>

## Quick Comparison

| Feature | manager-heavy-core | trinity | mentor-coordinator-core |
|---------|-------------------|---------|------------------------|
| Status | Production | Draft | Draft |
| Version | v0.5.0 | v0.1.0 | v0.1.0 |
| Template files | 14 | 13 | 5 |
| Required skills | 2 | 3 | 5 |
| Optional skills | 2 | — | — |
| OKR control plane | Full (max 3 active + candidate parking) | Full (max 3 + candidate) | Basic |
| Memory system | Daily notes + topic index + long-term | Daily notes + topic index + watched threads | Daily notes |
| Heartbeat mode | Proactive | Proactive | Proactive |
| Multi-agent | Yes (team-manager) | No | No |
| Persona | Coordinator-first | Coordinator-first | Coordinator-first |

## Getting Started

Ready to install? See the [Installation Guide](/agent-os/install).

## Learn More

- [agent-os-spec](https://github.com/fractalmind-ai/agent-os-spec) — the contract layer that defines what every OS must satisfy
- [agent-os-roms](https://github.com/fractalmind-ai/agent-os-roms) — ROM manifests, templates, and release notes
- [Skills catalog](https://github.com/fractalmind-ai/skills) — all available skills organized by category

<style>
.rom-grid h3 a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.rom-grid h3 a:hover {
  text-decoration: underline;
}
.rom-grid hr {
  margin: 1.5rem 0;
  border-color: var(--vp-c-divider);
}
</style>
