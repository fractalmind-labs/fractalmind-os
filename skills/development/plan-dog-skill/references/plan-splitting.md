# Plan Splitting Reference

Use this reference when deciding how large each planning document should be.

## Goal

Keep each plan small enough that an LLM can execute it with stable attention and low context drift.

## Split when

Split a plan if one document would require the model to track:

- more than one major layer at once
- too many unrelated modules
- both migration and business logic and UI details together
- long file inventories across many directories
- many independent validation paths

Good signals for splitting:

- backend work includes both schema migration and multiple service domains
- frontend work includes both app shell/routing and many pages/components
- API work includes both auth contract changes and many unrelated resources
- the checklist starts feeling like a changelog instead of an execution sequence

## Preferred split order

Split in this order:

1. by layer: API, backend, frontend
2. by phase inside a layer: migration, contract, service, page, rollout
3. by subdomain only if still too large

## Plan size heuristics

Prefer a plan that:

- has one clear owner layer
- can be executed in one focused session
- has fewer than about 5-8 major steps
- references a coherent set of files/modules
- has one validation section, not many unrelated ones

## Examples

Small change:

- one master plan
- one backend plan
- one frontend plan

Medium change:

- one master plan
- one API plan
- one backend plan
- one frontend plan

Large change:

- one master plan
- one API plan
- two backend plans: migration + services
- two frontend plans: shell/state + pages

## Continuation rule

If the user asks to start from step 2, 3, or 4:

- do not recreate skipped documents unless needed to remove contradictions
- do read existing upstream docs before writing downstream plans
- explicitly note assumptions inherited from existing PRD or tech docs
