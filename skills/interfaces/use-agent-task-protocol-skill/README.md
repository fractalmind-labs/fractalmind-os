# use-agent-task-protocol-skill

Runtime-neutral protocol for exchanging agent tasks, messages, and replies with
portable envelope semantics and explicit reply routes.

## What this skill does

- Define portable `agent-task/1` envelopes for work assignments and responses.
- Keep protocol fields (meta/body/footer semantics) separated from transport routing.
- Include self-contained reply capsules so a receiver can respond without reading
  external docs.
- Support both one-time information updates and task lifecycle replies.

## Use this skill when

- You need stable task handoff between agents or runtimes.
- Receivers may not have a shared ATP parser installed.
- You need explicit, operationally actionable return routes in every
  reply-required envelope.

## Repository layout

- `SKILL.md`: canonical protocol instructions and send/receive workflow.
- `references/protocol-v1.md`: normative v1 protocol specification and examples.
- `agents/openai.yaml`: agent metadata used by the OpenAI skill registry.

## Quick usage

Include `--- Meta ---`, `--- Body ---`, `--- Footer ---` sections in that order.
Use the template from `SKILL.md` / `references/protocol-v1.md` and always require
an executable reply route for tasks and `reply: required` messages.
