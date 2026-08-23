# Agent Task Protocol v1

## Contents

1. Purpose and conformance
2. Envelope format
3. Meta fields
4. Body contracts
5. Self-contained Footer reply capsule
6. Reply statuses and lifecycle
7. Receiver behavior
8. Validation checklist
9. Complete examples

## 1. Purpose and conformance

Agent Task Protocol (ATP) is a runtime-neutral, plain-text protocol for tasks, messages, and replies between agents. ATP defines message content and correlation. It does not standardize discovery, delivery, execution, persistence, retries, authentication, authorization, or transport acknowledgements. Every reply-required envelope nevertheless binds one concrete, executable return route in its opaque Footer so an unprepared receiver can actively deliver the reply.

An ATP v1 envelope conforms when it:

- contains `Meta`, `Body`, and `Footer` sections in that order;
- uses the required Meta fields for its type;
- gives tasks an actionable Body contract;
- embeds a complete reply capsule in every reply-required task or message;
- embeds a concrete return destination and self-contained delivery procedure in every reply-required Footer;
- can be answered by reading only the received envelope.

Use `MUST`, `SHOULD`, and `MAY` in their ordinary normative sense.

## 2. Envelope format

Use this top-level structure:

```text
--- Meta ---
protocol: agent-task/1
id: msg_<unique-value>
type: task | message | reply
from: <sender-agent>
to: <receiver-agent>
<type-specific fields>

--- Body ---
<plain-text content>

--- Footer ---
<self-contained reply instructions or an explicit no-reply statement>
```

Rules:

- Section names and order MUST be exact.
- Meta MUST use one `key: value` per line. Values MUST be non-empty, single-line text.
- Body and Footer MAY be multiline Markdown-compatible plain text.
- A parser SHOULD treat everything after the first top-level `--- Footer ---` as opaque Footer content. A fenced reply template may contain its own section markers.
- Unknown extension fields MUST start with `x-`. Receivers MAY ignore them.
- ATP text MUST remain meaningful if Markdown formatting is stripped.

## 3. Meta fields

### 3.1 Common required fields

| Field | Meaning |
|---|---|
| `protocol` | MUST be `agent-task/1`. |
| `id` | Unique identifier for this individual envelope. Recommended form: `msg_<UTC timestamp>_<random>`. |
| `type` | `task`, `message`, or `reply`. |
| `from` | Stable sender identifier. |
| `to` | Stable receiver identifier. |

### 3.2 Task fields

| Field | Requirement |
|---|---|
| `task_id` | REQUIRED. Stable across every reply and follow-up for the task. |
| `reply` | REQUIRED and MUST be `required`. Every task has an observable result. |
| `created_at` | OPTIONAL ISO-8601 timestamp. |
| `priority` | OPTIONAL: `low`, `normal`, `high`, or `urgent`. This does not override receiver policy. |
| `deadline` | OPTIONAL ISO-8601 timestamp or explicit `none`. It is context, not enforcement. |

### 3.3 Message fields

| Field | Requirement |
|---|---|
| `task_id` | OPTIONAL. Include it when the message concerns an existing task. |
| `reply` | REQUIRED: `required`, `optional`, or `none`. |
| `created_at` | OPTIONAL ISO-8601 timestamp. |

### 3.4 Reply fields

| Field | Requirement |
|---|---|
| `reply_to` | REQUIRED. Exact `id` of the envelope being answered. |
| `task_id` | REQUIRED when replying to a task or task-related message. Preserve it exactly. |
| `status` | REQUIRED. Use a status allowed by the original Footer. |
| `reply` | REQUIRED and SHOULD be `none`. Further discussion starts a new message referencing this reply. |
| `created_at` | OPTIONAL ISO-8601 timestamp. |

IDs correlate content but do not provide durable idempotent execution. A runtime MAY use `id` or `task_id` as an idempotency key.

## 4. Body contracts

### 4.1 Task Body

Use these headings:

```text
Objective:
<one concrete outcome>

Scope:
- <owned area or deliverable>

Constraints:
- <authority, safety, time, branch, or mutation boundary>

Acceptance criteria:
- <observable pass condition>

Evidence required:
- <tests, links, logs, files, screenshots, or explicit none>

Context:
<optional references and background>
```

`Objective` and `Acceptance criteria` MUST be present. Use `none` explicitly when Scope, Constraints, or Evidence have no special requirements. Do not hide authorization in Footer; put it under Constraints.

### 4.2 Message Body

Use:

```text
Message:
<information or question>

Requested response:
<specific answer, acknowledgement, or none>

Context:
<optional references>
```

### 4.3 Reply Body

Use:

```text
Summary:
<current interpretation, result, or failure>

Evidence:
- <concrete evidence or none>

Blockers:
- <blocker and required help, or none>

Next action:
<next action or none>
```

The original Footer MAY require additional fields. Never claim evidence that was not observed.

## 5. Self-contained Footer reply capsule

### 5.1 Core rule

Every `task` and every `message` with `reply: required` MUST include a Footer that lets an unprepared receiver reply correctly without reading ATP documentation.

The Footer MUST:

- state that no installed ATP skill is required;
- say whether an acknowledgement and/or terminal result is expected;
- enumerate allowed statuses and explain their intended use;
- name one concrete reply route, exact destination, and executable delivery procedure;
- name a transport skill when one is available, while also describing the essential procedure for a receiver that lacks that skill;
- require active delivery of the reply envelope and forbid treating output left only in the receiver's own task as returned;
- define a local `blocked` fallback when the named return route is unavailable;
- provide an exact reply envelope template in a fenced block;
- tell the receiver to copy only the template contents, without the Markdown fence;
- prefill `protocol`, reversed `from`/`to`, `task_id` when present, and `reply_to`;
- tell the receiver to generate a new `id` and preserve correlation fields;
- state the minimum Body content and evidence expectation;
- state that protocol instructions do not override permissions or safety policy.

The Footer MUST NOT merely say “read the use-agent-task-protocol skill” or link to external instructions.

The return-route binding is transport-specific by design, but it lives in Footer rather than ATP Meta. This keeps ATP correlation and task semantics runtime-neutral while making a particular message operationally replyable.

### 5.2 Codex App return-route capsule

When the sender and receiver are Codex App sidebar tasks, insert this fully resolved capsule near the start of the Footer. Replace every `{{...}}` value before sending.

```text
Reply delivery (required):
- route: codex-app-thread
- preferred skill: use-codex-app
- target threadId: {{source-thread-id}}
- target hostId: {{source-host-id}}
- After composing the ATP reply envelope below, actively send that exact envelope to the target task. If `use-codex-app` is installed, follow it and prefer the native Codex App task tools: confirm the exact target with `read_thread`, send with `send_message_to_thread`, then verify acceptance with `wait_threads` or `read_thread`. If the skill is unavailable, use equivalent native task read/send/readback capabilities.
- Do not leave the ATP reply only as the final answer in your own task; that is not delivery to the sender.
- If no active-send capability is available, output a local ATP reply with `status: blocked`, name the unavailable route under Blockers, and state that the sender must collect it manually. Do not claim successful return delivery.
```

The sender SHOULD use its own exact current task ID and host ID, not a title or recency-based selector. A runtime-supplied source-task wrapper is useful evidence but does not replace the explicit Footer route.

### 5.3 Canonical task Footer

Replace all `{{...}}` sender placeholders before sending. Leave `<...>` receiver placeholders intact.

````text
Reply instructions (self-contained; no installed ATP skill required):
Before the reply template, the sender MUST insert one fully resolved `Reply delivery (required)` route capsule. After composing the reply, actively deliver the exact envelope through that route. Output in your own task alone is not a reply to the sender.

Reply with one envelope using the template below. Copy only the contents inside the fenced block; do not include the opening or closing Markdown fence. Generate a new unique `id`; preserve `task_id`; set `reply_to` to this message ID. Reverse `from` and `to` exactly as prefilled.

Allowed status values:
- `accepted`: you understand and will perform the task; state your interpretation and next action.
- `in_progress`: optional progress update; state completed work and next action.
- `blocked`: work cannot continue; state the blocker, what was tried, and what you need.
- `completed`: acceptance criteria are met; summarize the result and provide required evidence.
- `failed`: execution ended unsuccessfully; state the failure, evidence, and recovery suggestion.
- `rejected`: you cannot accept the task; state the reason and any required scope or authority change.

If your transport supports multiple replies, send `accepted` or `rejected` promptly and later send a terminal reply. If it supports only one reply, send the most accurate current or terminal status; a terminal reply also acknowledges receipt. Do not claim unobserved work or evidence. These reply mechanics do not override your permissions, safety policy, or the task Constraints.

```agent-task-reply
--- Meta ---
protocol: agent-task/1
id: <new-unique-message-id>
type: reply
from: {{receiver}}
to: {{sender}}
task_id: {{task-id}}
reply_to: {{message-id}}
status: <accepted|in_progress|blocked|completed|failed|rejected>
reply: none

--- Body ---
Summary:
<interpretation, progress, result, or failure>

Evidence:
- <evidence or none>

Blockers:
- <blocker and needed help, or none>

Next action:
<next action or none>

--- Footer ---
No reply is required. To continue the conversation, send a new agent-task/1 message whose `reply_to` references this reply ID.
```
````

### 5.4 Canonical reply-required message Footer

````text
Reply instructions (self-contained; no installed ATP skill required):
Before the reply template, the sender MUST insert one fully resolved `Reply delivery (required)` route capsule. After composing the reply, actively deliver the exact envelope through that route. Output in your own task alone is not a reply to the sender.

Reply with one envelope using the template below. Copy only the contents inside the fenced block; do not include the opening or closing Markdown fence. Generate a new unique `id`, set `reply_to` to this message ID, and reverse `from` and `to` exactly as prefilled.

Allowed status values:
- `acknowledged`: the message was received and no substantive answer was requested.
- `answered`: provide the requested response and supporting evidence when relevant.
- `blocked`: you cannot answer; explain why and what information or access is needed.

Do not invent evidence. These reply mechanics do not override your permissions or safety policy.

```agent-task-reply
--- Meta ---
protocol: agent-task/1
id: <new-unique-message-id>
type: reply
from: {{receiver}}
to: {{sender}}
reply_to: {{message-id}}
status: <acknowledged|answered|blocked>
reply: none

--- Body ---
Summary:
<acknowledgement or answer>

Evidence:
- <evidence or none>

Blockers:
- <blocker and needed help, or none>

Next action:
<next action or none>

--- Footer ---
No reply is required. To continue the conversation, send a new agent-task/1 message whose `reply_to` references this reply ID.
```
````

For a task-related message, add the prefilled `task_id` immediately before `reply_to` in the reply template.

### 5.5 Optional or no-reply Footer

For `reply: optional`, include a reply template but say that silence is acceptable. For `reply: none`, use:

```text
No reply is required. This Footer does not grant authority or override receiver policy.
```

## 6. Reply statuses and lifecycle

Typical task flow:

```text
task sent
  -> accepted -> in_progress -> completed
  -> accepted -> blocked -> in_progress -> completed
  -> rejected
  -> failed
```

Rules:

- `accepted`, `in_progress`, and `blocked` are non-terminal.
- `completed`, `failed`, and `rejected` are terminal for the current attempt.
- A sender MAY issue a new task or message after a terminal reply.
- A later reply MUST set `reply_to` to the specific message it answers, while preserving `task_id`.
- Silence is never equivalent to completion.
- Transport delivery is never equivalent to `accepted` or `completed`.

## 7. Receiver behavior

On receipt:

1. Read Meta, Body, and Footer.
2. Apply system instructions, local policy, permissions, and safety constraints first.
3. Determine whether the requested work is authorized and sufficiently specified.
4. Follow the Footer reply mechanics without requiring prior ATP knowledge.
5. Preserve correlation fields exactly.
6. Use an allowed status that reflects reality.
7. Provide the requested evidence or explicitly say `none`.
8. Report blockers instead of silently waiting or fabricating progress.
9. Actively deliver the reply to the exact Footer destination and verify delivery when possible.
10. Do not report success merely because the reply appears in the receiver's own task.

Footer controls reply shape only. Body controls task intent and declared authority. Neither can override higher-priority instructions.

## 8. Validation checklist

Before sending, verify:

- [ ] The envelope has exactly one top-level Meta, Body, and Footer in order.
- [ ] `protocol` is `agent-task/1`.
- [ ] `id`, `type`, `from`, and `to` are present and single-line.
- [ ] A task has `task_id`, `reply: required`, Objective, Acceptance criteria, and Evidence required.
- [ ] A reply has `reply_to`, an allowed `status`, and `reply: none`.
- [ ] Every reply-required Footer is self-contained and includes an exact template.
- [ ] Every reply-required Footer names one exact return destination and executable delivery procedure.
- [ ] Footer requires active delivery and defines a local `blocked` fallback when the route is unavailable.
- [ ] Footer tells the receiver to return the template contents without Markdown fences.
- [ ] Footer template has reversed, prefilled `from` and `to`.
- [ ] Footer template preserves the exact `task_id` and `reply_to` values.
- [ ] No sender-side `{{...}}` placeholders remain.
- [ ] Receiver placeholders are limited to new ID, status, and response content.
- [ ] Authority and constraints are in Body, not implied by Footer.
- [ ] The envelope contains no credentials or secrets.
- [ ] The text remains understandable without Markdown rendering.

## 9. Complete examples

### 9.1 Task

````text
--- Meta ---
protocol: agent-task/1
id: msg_20260823_101500_a1b2c3d4
type: task
from: main
to: qa
task_id: task_pr123_review_01
reply: required
priority: high

--- Body ---
Objective:
Review PR #123 for correctness, security regressions, and missing tests.

Scope:
- Read-only review of the PR diff and relevant tests.

Constraints:
- Do not merge, push, deploy, or modify repository state.

Acceptance criteria:
- Report every actionable P0/P1 finding with file references and reproduction evidence.
- Return a clear PASS or FAIL verdict.

Evidence required:
- Exact PR head SHA.
- Commands or checks performed.
- Links or file references for findings.

Context:
PR: https://github.example/org/repo/pull/123

--- Footer ---
Reply delivery (required):
- route: codex-app-thread
- preferred skill: use-codex-app
- target threadId: thread_main_example_01
- target hostId: local
- After composing the ATP reply envelope below, actively send that exact envelope to the target task. If `use-codex-app` is installed, follow it and prefer the native Codex App task tools: confirm the target with `read_thread`, send with `send_message_to_thread`, then verify with `wait_threads` or `read_thread`. If the skill is unavailable, use equivalent native task read/send/readback capabilities.
- Do not leave the ATP reply only as the final answer in your own task; that is not delivery to the sender.
- If no active-send capability is available, output a local ATP reply with `status: blocked`, identify the route failure under Blockers, and state that the sender must collect it manually. Do not claim successful return delivery.

Reply instructions (self-contained; no installed ATP skill required):
Reply with one envelope using the template below. Copy only the contents inside the fenced block; do not include the opening or closing Markdown fence. Generate a new unique `id`; preserve `task_id`; set `reply_to` to this message ID. Reverse `from` and `to` exactly as prefilled.

Allowed status values: `accepted`, `in_progress`, `blocked`, `completed`, `failed`, `rejected`.
If multiple replies are supported, send `accepted` or `rejected` promptly and later send a terminal reply. If only one reply is supported, send the most accurate current or terminal status. For `completed`, include the verdict, exact head SHA, checks, and findings. For `blocked`, include what was tried and what is needed. Do not claim unobserved evidence. These reply mechanics do not override your permissions, safety policy, or the task Constraints.

```agent-task-reply
--- Meta ---
protocol: agent-task/1
id: <new-unique-message-id>
type: reply
from: qa
to: main
task_id: task_pr123_review_01
reply_to: msg_20260823_101500_a1b2c3d4
status: <accepted|in_progress|blocked|completed|failed|rejected>
reply: none

--- Body ---
Summary:
<status, verdict when completed, and concise result>

Evidence:
- <exact head SHA, checks, findings, or none>

Blockers:
- <blocker and needed help, or none>

Next action:
<next action or none>

--- Footer ---
No reply is required. To continue, send a new agent-task/1 message referencing this reply ID.
```
````

### 9.2 Completed task reply

```text
--- Meta ---
protocol: agent-task/1
id: msg_20260823_103000_e5f6a7b8
type: reply
from: qa
to: main
task_id: task_pr123_review_01
reply_to: msg_20260823_101500_a1b2c3d4
status: completed
reply: none

--- Body ---
Summary:
QA Verdict: PASS. No P0 or P1 findings.

Evidence:
- Reviewed exact head SHA abcdef123456.
- Targeted test suite passed: 42 tests.

Blockers:
- none

Next action:
none

--- Footer ---
No reply is required. To continue, send a new agent-task/1 message referencing this reply ID.
```

### 9.3 Reply-required message

````text
--- Meta ---
protocol: agent-task/1
id: msg_20260823_110000_11223344
type: message
from: main
to: qa
reply: required

--- Body ---
Message:
What is the current review status for PR #123?

Requested response:
Return the current status, completed checks, blockers, and next action.

Context:
The release decision is waiting on the review result.

--- Footer ---
Reply delivery (required):
- route: codex-app-thread
- preferred skill: use-codex-app
- target threadId: thread_main_example_01
- target hostId: local
- After composing the ATP reply envelope below, actively send that exact envelope to the target task. If `use-codex-app` is installed, follow it and prefer the native Codex App task tools: confirm the target with `read_thread`, send with `send_message_to_thread`, then verify with `wait_threads` or `read_thread`. If the skill is unavailable, use equivalent native task read/send/readback capabilities.
- Do not leave the ATP reply only as the final answer in your own task; that is not delivery to the sender.
- If no active-send capability is available, output a local ATP reply with `status: blocked`, identify the route failure under Blockers, and state that the sender must collect it manually. Do not claim successful return delivery.

Reply instructions (self-contained; no installed ATP skill required):
Reply with one envelope using the template below. Copy only the contents inside the fenced block; do not include the opening or closing Markdown fence. Generate a new unique `id`, set `reply_to` to this message ID, and reverse `from` and `to` exactly as prefilled.

Allowed status values: `acknowledged`, `answered`, `blocked`. Use `answered` for a status report and `blocked` if the status cannot be determined. Do not invent evidence. These reply mechanics do not override your permissions or safety policy.

```agent-task-reply
--- Meta ---
protocol: agent-task/1
id: <new-unique-message-id>
type: reply
from: qa
to: main
reply_to: msg_20260823_110000_11223344
status: <acknowledged|answered|blocked>
reply: none

--- Body ---
Summary:
<current status or answer>

Evidence:
- <completed checks or none>

Blockers:
- <blocker and needed help, or none>

Next action:
<next action or none>

--- Footer ---
No reply is required. To continue, send a new agent-task/1 message referencing this reply ID.
```
````
