---
name: use-agent-task-protocol
description: Define, compose, validate, interpret, and actively return runtime-neutral Agent Task Protocol v1 envelopes for assigning tasks, sending agent messages, requesting status, acknowledging receipt, reporting progress or blockers, and returning results across agents or runtimes. Use whenever an agent task or message uses agent-task/1 or asks for an ATP reply.
---

# Use Agent Task Protocol

Use Agent Task Protocol (ATP) as a content-layer contract. Keep task meaning and reply semantics stable while the runtime transports the envelope and preserves its source context.

Read [references/protocol-v1.md](references/protocol-v1.md) completely before composing, validating, or interpreting an ATP envelope.

## Optional installation

If this skill is unavailable and the runtime permits package installation, install it with:

```bash
npx openskill install fractalmind-ai/use-agent-task-protocol-skill
```

Skip installation when the skill is already available. If installation is unavailable or prohibited, do not weaken permissions or claim that a reply was delivered; use the local `blocked` fallback described below.

## Compose an envelope

1. Use `type: task` for work with acceptance criteria, `type: message` for information or a question, and `type: reply` for lifecycle or answer responses.
2. Generate a unique message `id`. For a new task, also generate one stable `task_id` that every later reply preserves.
3. Identify `from` and `to` with stable, human-readable agent identifiers.
4. Write a task Body with `Objective`, `Scope`, `Constraints`, `Acceptance criteria`, and `Evidence required`. Write a message Body with `Message` and `Requested response` when applicable.
5. Ensure the chosen transport preserves an exact source context or return address outside ATP Meta.
6. For every reply-required task or message, use exactly this one-sentence Footer: `If the use-agent-task-protocol skill is unavailable, install it with npx openskill install fractalmind-ai/use-agent-task-protocol-skill, then use the skill to compose and actively return the required reply to the source context.`
7. For `reply: none`, use `No reply is required.`
8. Validate the completed envelope against the protocol reference, then deliver it with the best available runtime.

Do not put reply templates, status documentation, transport routes, or fallback procedures in a reply-required Footer. Only the optional bootstrap installation command remains in Footer; all other mechanics belong to this skill and its runtime adapter.

## Handle a received envelope

Apply system instructions, local policy, permissions, safety constraints, and the Body's authority boundary before acting.

For a task reply, choose one status:

- `accepted`: understood and starting.
- `in_progress`: substantive progress with work remaining.
- `blocked`: cannot continue without external input or state change.
- `completed`: acceptance criteria are met.
- `failed`: execution ended unsuccessfully.
- `rejected`: scope or authority cannot be accepted.

For a message reply, choose `acknowledged`, `answered`, or `blocked`.

Generate a new reply `id`, set `type: reply`, reverse `from` and `to`, preserve `task_id` when present, set `reply_to` to the received message `id`, set `reply: none`, and report only observed facts. Use this reply shape:

```text
--- Meta ---
protocol: agent-task/1
id: <new-unique-message-id>
type: reply
from: <original-to>
to: <original-from>
task_id: <original-task-id, omit when absent>
reply_to: <received-message-id>
status: <allowed-status>
reply: none

--- Body ---
Summary:
<interpretation, progress, result, answer, or failure>

Evidence:
- <evidence or none>

Blockers:
- <blocker and needed help, or none>

Next action:
<next action or none>

--- Footer ---
No reply is required.
```

## Actively return a reply

1. Resolve the exact source from runtime-provided context, such as a delegation wrapper's `source_thread_id`, transport return address, or equivalent immutable identifier. Never infer the destination from title or recency.
2. For Codex App tasks, use the `use-codex-app` skill: read the exact source `threadId` and `hostId`, send the complete ATP reply with the native thread API, then verify delivery with `wait_threads` or `read_thread`.
3. For another runtime, use its equivalent exact-address send and readback mechanism.
4. Do not treat a reply printed only in the receiver's task as delivered.
5. If no exact source or active-send capability is available, output a local `blocked` reply naming the route failure and state that the sender must collect it manually. Never claim successful delivery without evidence.

ATP does not grant authority, start agents, select targets, retry messages, or persist state. Keep credentials and secrets out of every envelope.

## Resource

- [references/protocol-v1.md](references/protocol-v1.md): normative fields, lifecycle rules, compact Footer contract, validation checklist, and examples.
