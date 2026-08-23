# use-agent-task-protocol-skill

Runtime-neutral protocol for exchanging agent tasks, messages, and replies with
portable envelope semantics and skill-managed reply delivery.

## What this skill does

- Define portable `agent-task/1` envelopes for work assignments and responses.
- Keep protocol fields (meta/body/footer semantics) separated from transport routing.
- Use a one-sentence Footer that bootstraps the skill when needed.
- Keep reply templates, statuses, routing, readback, and failure fallback in the
  skill instead of repeating them in every envelope.
- Support both one-time information updates and task lifecycle replies.

## Use this skill when

- You need stable task handoff between agents or runtimes.
- Receivers may need to install the ATP skill before replying.
- The delivery runtime preserves an exact source context for active return.

## Repository layout

- `SKILL.md`: canonical protocol instructions and send/receive workflow.
- `references/protocol-v1.md`: normative v1 protocol specification and examples.
- `agents/openai.yaml`: agent metadata used by the OpenAI skill registry.

## Quick usage

Include `--- Meta ---`, `--- Body ---`, `--- Footer ---` sections in that order.
For tasks and `reply: required` messages, use the canonical one-sentence Footer
from `SKILL.md`; the skill composes and actively returns the reply through the
runtime-provided source context.
