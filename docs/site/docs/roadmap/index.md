# Roadmap

FractalMind is migrating to a three-plane architecture with explicit authority, execution, and application boundaries.

## Current Program: Three-Plane Migration

The canonical tracker is [fractalmind-ai/.github#6](https://github.com/fractalmind-ai/.github/issues/6), derived from [Architecture RFC Discussion #5](https://github.com/orgs/fractalmind-ai/discussions/5).

```text
Phase 0 contracts
    -> Authority Plane and Data/Execution Plane
    -> Applications
    -> legacy and duplicate-path retirement
    -> cross-repository closeout
```

## Phase 0: Contracts and Boundaries

- versioned signed-command and event contract
- target-scoped capability, delegation, revocation, replay, use, and budget semantics
- typed local agent-manager adapter
- canonical public terminology

Phase 0 is complete only after exact-head CI, independent QA, formal review, and merge. Draft or unmerged capability code is not a published package.

## Authority Plane

- make SUI capabilities the single remote authority source
- enforce target, action, scope, expiry, revocation, use, and budget bounds
- publish shared golden and rejection vectors across protocol and consumers
- keep high-volume/private operational data off-chain

## Data / Execution Plane

- require target envd verification before local mutation
- deliver durable pending/completed/result semantics across restart
- prove duplicate delivery and conflicting metadata fail safely
- make relay compromise incapable of obtaining node control
- keep agent-manager as a typed local adapter

## Applications

- migrate Agent Console and automation clients to signed intents
- separate envd-desktop view and control scopes
- classify fractalbot as channel ingress/egress, not authority
- remove privileged direct-local paths after parity and rollback evidence

## Simplification and Closeout

- retire duplicate coordinator, gateway, sponsor, and legacy authority paths
- define canonical skill sources and distribution mirrors
- align website, repository descriptions, diagrams, and runtime readback
- close all linked issues with CI, QA, migration, and rollback evidence

## Stable Local Operating Loop

Heartbeat, memory, OKR, team, and skill tooling remain the local governed operating system. They coordinate delivery but do not replace the remote authority contract.

## Safety Gates

Package publication, mainnet mutation, production credential migration, destructive legacy removal, and public production deployment require explicit approval and separate readback. Architecture documentation must not imply those steps occurred before their evidence exists.
