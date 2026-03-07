# Fractal Model

The fractal model is the core architectural idea behind FractalMind AI.

## What Makes It Fractal?

A fractal is a structure where each part is a scaled copy of the whole. In FractalMind:

- A **single agent** (L0) has: heartbeat, tasks, state, identity
- A **team** (L1) has: heartbeat (via lead), tasks, state, identity
- An **organization** (L2) has: heartbeat (via envd), tasks, state, identity
- A **federation** (L3+) has: heartbeat (via gateway), tasks, state, identity

Every level implements the same interface. The primitives are identical — only the scale changes.

## The Four Layers

```
┌─────────────────────────────────────────────────────────────┐
│  L3+  Inter-Org Federation    DAO cross-org governance       │
│       (multiple independent    Joint proposals · Resource     │
│        orgs collaborating)     sharing · Federated reputation │
├─────────────────────────────────────────────────────────────┤
│  L2   Organization            fractalmind-protocol (SUI)     │
│       (on-chain org)          Org registration · Agent       │
│                               identity · Task lifecycle ·    │
│                               Sub-orgs · DAO governance      │
├─────────────────────────────────────────────────────────────┤
│  L1   Agent Team              team-manager + team-chat       │
│       (multi-agent team)      Lead coordination · Task       │
│                               assignment · Async messaging   │
├─────────────────────────────────────────────────────────────┤
│  L0   Single Agent            agent-manager                  │
│       (individual agent)      Lifecycle · Heartbeat ·        │
│                               Skills · OKR                   │
└─────────────────────────────────────────────────────────────┘
```

## Self-Similarity in Practice

### Heartbeat

| Layer | Who beats? | What it checks |
|-------|-----------|----------------|
| L0 | Agent itself | Am I alive? Tasks pending? |
| L1 | Team lead | Are members healthy? Team tasks progressing? |
| L2 | envd daemon | Are teams operational? Org goals on track? |
| L3+ | Gateway | Are member orgs responsive? Federation objectives met? |

### Task Lifecycle

Every layer follows the same cycle: **Created → Assigned → Submitted → Verified → Completed**

At L0, this is an individual agent completing a coding task. At L2, this is recorded on-chain in the SUI protocol. The lifecycle is identical.

### Governance

| Layer | Governance Model |
|-------|-----------------|
| L0 | Agent follows instructions from manager |
| L1 | Lead decides task assignments |
| L2 | DAO proposals + voting (on-chain) |
| L3+ | Cross-org DAO federation |

## Max Depth

The protocol supports organizations up to **depth 8**. This allows:

```
L0: Agent
L1: Team (depth 0)
L2: Department (depth 1)
L3: Division (depth 2)
...
L8: Top-level federation (depth 7)
```

Each sub-organization is a full Organization object on-chain with its own admin, agents, tasks, and governance — nested inside its parent.

## Why Fractals?

The fractal model provides two key advantages:

1. **Tool Reuse**: Management tools built for L0 (single agent) work at every level. You don't need separate tools for teams, departments, and organizations — the same primitives compose upward.

2. **Emergent Capability**: As the fractal structure grows deeper and wider, organizational intelligence emerges from the interactions between levels — not from any single component being "smart."
