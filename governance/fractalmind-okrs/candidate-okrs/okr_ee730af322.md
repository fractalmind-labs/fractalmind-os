# Stage agent-manager rollout sync packet to clear vendored subtree drift

- Candidate ID: `okr_ee730af322`
- Objective: Use the just-validated agent-manager status rollout as a concrete sync packet: compare the vendored `.agent/skills/agent-manager` diff against `workspace/agent-manager-skill/agent-manager`, apply or stage the smallest local backport on the exact rollout files, and clear the reopened subtree drift without taking any external action.
- Governance: `L0`
- Status: `resolved`
- Score: `2.9`

## Sync Contract

- Source: FractalMind heartbeat state
- Repo target: `git@github.com:fractalmind-ai/fractalmind-okrs.git`

