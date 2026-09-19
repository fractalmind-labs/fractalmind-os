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
- uses the canonical one-sentence skill invocation in every reply-required Footer;
- relies on the invoked skill and runtime-provided source context for reply construction and active delivery;
- keeps detailed reply mechanics out of individual envelopes.

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
<canonical one-sentence skill invocation or an explicit no-reply statement>
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

Every `task` and every `message` with `reply: required` MUST use exactly this Footer sentence:

```text
If the use-agent-task-protocol skill is unavailable, install it with npx openskill install fractalmind-ai/use-agent-task-protocol-skill, then use the skill to compose and actively return the required reply to the source context.
```

The Footer MUST NOT embed a reply template, status documentation, destination, transport procedure, or fallback instructions. It retains only the optional bootstrap installation command needed when the skill is absent; the invoked skill owns all other mechanics. The runtime MUST preserve an exact source context or return address outside ATP Meta so the skill can actively deliver the reply without coupling ATP semantics to one runtime.

If the skill is unavailable and runtime policy permits installation, the optional installation command retained by the skill is:

```bash
npx openskill install fractalmind-ai/use-agent-task-protocol-skill
```

Skip this step when the skill is already available. Footer repeats only this bootstrap command so an unprepared receiver can load the skill; detailed installation and failure behavior remains in the skill contract.

### 5.2 Reply construction and delivery

The `use-agent-task-protocol` skill MUST:

- generate a new reply `id`;
- reverse `from` and `to`;
- preserve `task_id` when present and set `reply_to` to the received message `id`;
- choose an allowed status for the envelope type;
- produce the canonical Summary, Evidence, Blockers, and Next action Body;
- resolve the exact runtime-provided source context without guessing by title or recency;
- actively send the complete reply and verify delivery when the runtime supports readback;
- return a local `blocked` reply naming the route failure when exact active delivery is unavailable;
- respect higher-priority instructions, permissions, safety policy, and Body constraints.

For Codex App, invoke `use-codex-app` and use the exact source `threadId` and `hostId` supplied by the delegation wrapper or runtime context. For other runtimes, use the equivalent exact-address adapter.

### 5.3 Optional or no-reply Footer

For `reply: optional`, use the canonical sentence but state in Body that silence is acceptable. For `reply: none`, use:

```text
No reply is required.
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
4. Invoke `use-agent-task-protocol` when the canonical Footer requires a reply.
5. Preserve correlation fields exactly.
6. Use an allowed status that reflects reality.
7. Provide the requested evidence or explicitly say `none`.
8. Report blockers instead of silently waiting or fabricating progress.
9. Resolve the exact runtime-provided source context, actively deliver the reply, and verify delivery when possible.
10. Do not report success merely because the reply appears in the receiver's own task.

The skill controls reply shape and delivery mechanics. Body controls task intent and declared authority. Neither can override higher-priority instructions.

## 8. Validation checklist

Before sending, verify:

- [ ] The envelope has exactly one top-level Meta, Body, and Footer in order.
- [ ] `protocol` is `agent-task/1`.
- [ ] `id`, `type`, `from`, and `to` are present and single-line.
- [ ] A task has `task_id`, `reply: required`, Objective, Acceptance criteria, and Evidence required.
- [ ] A reply has `reply_to`, an allowed `status`, and `reply: none`.
- [ ] Every reply-required Footer is exactly the canonical one-sentence skill invocation.
- [ ] Footer contains no reply template, status list, route, or fallback procedure beyond the optional bootstrap installation command.
- [ ] The selected runtime preserves an exact source context or return address for the skill.
- [ ] The skill can derive reversed `from`/`to`, preserved `task_id`, and exact `reply_to` from the envelope.
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
If the use-agent-task-protocol skill is unavailable, install it with npx openskill install fractalmind-ai/use-agent-task-protocol-skill, then use the skill to compose and actively return the required reply to the source context.
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
No reply is required.
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
If the use-agent-task-protocol skill is unavailable, install it with npx openskill install fractalmind-ai/use-agent-task-protocol-skill, then use the skill to compose and actively return the required reply to the source context.
```
````
