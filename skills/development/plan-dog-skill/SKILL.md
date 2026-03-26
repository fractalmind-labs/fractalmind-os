---
name: plan-dog
description: Build or refresh a structured planning package through a documentation-first workflow. Use when Codex needs to create or update PRD content, technical design docs, a master change plan, and split API/backend/frontend execution plans. Use this skill both for full planning from the beginning and for partial continuation starting from the PRD step, tech-doc step, or planning step.
---

# Plan Dog

Use this skill to turn a requirement change into a documented execution package before coding.

Default output set:

1. Update `PRD`
2. Record `PRD` version change
3. Update technical design doc
4. Create one master change plan
5. Create split execution plans for API, backend, and frontend

Do not assume every request starts from step 1. Detect the requested entry point and continue from there.

## Workflow

### 1. Build context first

- Read the existing `PRD`, technical plan, and relevant plan files before editing.
- Read only the sections related to the requested change.
- Identify current product wording, existing technical constraints, and existing plan naming style.
- If the repo already has a planning convention, follow it instead of inventing a new one.

### 2. Detect the entry point

Choose one of these modes from the user request:

- `full`: start from PRD, then tech doc, then master plan, then split plans
- `prd-first`: update PRD only, then continue if requested
- `tech-first`: skip PRD for now, update technical doc and downstream plans
- `planning-only`: skip docs and create or revise plans only
- `plan-refresh`: existing docs already changed; regenerate affected plans only

If the request is ambiguous, infer the safest mode from user wording and existing workspace state. Do not block unless ambiguity is genuinely risky.

### 3. Update PRD when PRD is in scope

- Add or revise product behavior, roles, boundaries, flows, and version-specific decisions.
- Keep product language user-facing and behavior-oriented.
- Update the version history in the PRD on every meaningful PRD change.
- Add a concise change summary under the new PRD version when the document uses version sections.
- Resolve conflicts with older wording in the same file. Do not leave both old and new product rules active.

Minimum PRD check:

- user problem
- target behavior
- scope and non-goals
- affected roles
- key flow changes
- changed navigation or page behavior
- version record updated

### 4. Update technical design doc when tech doc is in scope

- Translate product changes into architecture, schema, API, permission, routing, migration, and rollout implications.
- Remove outdated technical assumptions that conflict with the new requirement.
- Keep the tech doc implementation-oriented, not product-marketing oriented.
- Make cross-layer impacts explicit: data model, API contract, backend services, frontend routes/state, permissions, migration, observability.

Minimum tech-doc check:

- context and assumptions
- model/schema changes
- API surface changes
- auth/permission changes
- frontend structure impact
- migration/backfill impact
- rollout/compatibility notes

### 5. Create one master plan

The master plan should answer:

- what changed
- what must be done first
- what can run in parallel
- what is out of scope
- what risks must be controlled
- how to validate completion

The master plan should be short enough to guide execution without drowning the model in detail.

Recommended contents:

- goal
- scope
- non-goals
- work phases
- dependencies
- risks
- acceptance criteria

### 6. Create split execution plans

Create separate plans when the change affects those layers:

- API plan
- backend plan
- frontend plan

Skip a split plan only if that layer is truly unaffected, and say so in the master plan.

For each split plan:

- keep the scope single-layer and execution-oriented
- list concrete files/modules/routes/tables when known
- prefer phased steps over one huge checklist
- include validation specific to that layer

Read [references/plan-splitting.md](references/plan-splitting.md) for how to decide plan size and splitting.

### 7. Keep plans small enough for reliable execution

- Prefer multiple focused plan files over one oversized plan.
- Split when a plan would otherwise cover too many unrelated files, too many subsystems, or too many acceptance conditions.
- Each plan should usually support one execution pass by an LLM without requiring it to track the whole project at once.
- If a layer is still too large, split again by phase or subdomain, for example:
  - `api-contract`
  - `backend-migration`
  - `backend-auth`
  - `frontend-shell`
  - `frontend-feature-pages`

### 8. Final consistency pass

Before finishing:

- ensure PRD, tech doc, master plan, and split plans use the same terminology
- ensure role names and permission names are consistent
- ensure version history was updated if PRD changed
- ensure plan files do not contradict the latest PRD or tech doc
- ensure old single-phase plans are not still marked as current if replaced by the new plan set

## Naming guidance

Follow the repository's existing plan naming style when one exists.

If no strong convention exists, prefer:

- `plans/plan-<feature>-overview.md`
- `plans/plan-<feature>-api.md`
- `plans/plan-<feature>-backend.md`
- `plans/plan-<feature>-frontend.md`

If a layer is too large, extend with a suffix:

- `plans/plan-<feature>-backend-phase1.md`
- `plans/plan-<feature>-frontend-pages.md`

## Output standard

Unless the user asks otherwise, aim to leave behind:

- updated PRD
- updated tech doc
- one master plan
- up to three split plans

If starting from a later step, only create the documents that are in scope for that request.
