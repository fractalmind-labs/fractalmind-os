# FractalMind interactive prototype

A self-contained HTML prototype based on the [product PRD](../../docs/product/fractalmind-app-prd.md)
and [okr-manager skill](../../skills/coordination/okr-manager-skill/SKILL.md).
Styles, icons, sample data and interactions are embedded in `index.html`.
No package installation, external assets, model keys or backend services are required.

From the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory apps/fractalmind-prototype
```

Open <http://127.0.0.1:4173> for the workbench. Direct review entries:
`?prototype=workbench` (or the existing `?prototype=navigation`) opens the workbench,
`?prototype=okr` opens the OKR list, and `?prototype=hosts` opens host management.
The HTML can also be opened directly; browser storage
availability for `file:` URLs may vary.

## Language and appearance

The top bar and **空间设置 → 语言与外观 / Space settings → Language & appearance**
provide Simplified Chinese / English and **Light / Dark / System** appearance.
System is the default and follows `prefers-color-scheme`, including changes while
this page is open. Explicit light or dark mode overrides the system choice.

Review both languages on the workbench map, OKR list/details, host console, settings
and dialogs, then use the mobile preview. Switch language/theme while composing a
host console command: its selected operation and draft remain intact. Reload to
check preference persistence. Resetting demo data leaves these preferences intact.

The dark palette covers surfaces, controls, SVG maps and status colors, with soft
backgrounds and restrained highlights. Reduced-motion preferences are respected.
The language catalog is embedded in the HTML; no translation service is called.
Interface text and known sample content are localized. Authored goals, agreements,
notes, form values and raw command output retain their source language; unmapped
content falls back to its original text. Exports preserve original records.
Presentation changes do not rebuild forms or alter execution/authorization state.

Preferences use `fractalmind.presentation.v1`, separately from the v2 execution
state. Storage failures fall back to in-memory preferences; the prototype remains
usable. The pre-paint theme initialization avoids a bright flash on dark startup.

## OKR review paths

1. **工作台** is the default entry: inspect the navigation map, current KR / simulated
   run, last verified checkpoint, metric gap, budget, constraints and next action.
   **查看 OKR** opens the selected objective's details. **OKR** in the sidebar opens
   only the goal list with lifecycle filters; click a card for weighted progress,
   trends, dependencies, evidence and the Agent's plan. **在工作台查看运行** returns to
   that same OKR's map. **返回 OKR 列表** preserves the lifecycle filter.
2. **查看约定** → inspect or change scope, allowed actions, escalation rules, deadline
   and budget. The user confirms these boundaries and the verification method.
3. In **工作台**, **演示自主推进** → the Agent advances KR2, records measurements, verifies evidence,
   then pauses before KR3's external service request. **审阅越界请求** → approve only
   this KR's verification, or reject and keep execution paused. After approval, the
   Agent continues autonomously through verification and final ACHIEVED status.
4. In **工作台**, **模拟一次 heartbeat** advances one step for close inspection. A target measurement
   without verified evidence does not complete a KR. Task completion does not change
   the OKR score. Decreasing metrics use the same baseline-to-target calculation.
5. **新建 OKR** → define an objective, quantified success criteria, 1–3 result-oriented
   KRs, metrics, weights, dependencies, deliverables, verification and constraints.
   Confirm to activate and open its workbench, or save in **候选** and inspect its
   details before activation. At most three OKRs can be ACTIVE.
6. **查看约定** → set the budget to the amount already spent → advance a heartbeat
   to see the budget blocker. Increase the limit and confirm before resuming.
7. **导出 OKR.md** downloads only ACTIVE OKRs using the skill's Markdown structure.
   Full JSON export in settings includes candidates, achievements and demo history.
8. Use **手机** in the review bar to inspect mobile status, evidence and decisions.
   **查看推进记录** and **查看约定** expose details on small screens.

Other flows remain available: onboarding, spaces, Agent details, task evidence,
memory, simulated phone pairing with separate read/operate scopes, and organization
browsing. **模拟设备离线** in settings pauses autonomous execution and disables remote
operations. Reconnection requires explicit resume. Reloading pauses demo loops.

## Navigation review paths

The **工作台 → 运行导航** view is an interactive schematic map. The blue arrow locates
execution, green checkpoints indicate verified results, dashed lines show the plan,
orange branches show drift/loops, and red hatched areas represent unauthorized
operations. Direction and authorization are reported separately. **全图 / 定位**
changes the map view; checkpoints open KR evidence and the destination opens the
OKR acceptance criteria. Positions are mapped from metrics, not physical distance,
time estimates, or probability of success.

- **注入演示场景 → 目标偏航**: inject two actions unrelated to any KR. The arrow leaves
  the planned route while remaining inside the authorized workspace. **纠偏并继续**
  replans under the same constraints; simulated heartbeats move the arrow, then
  verification lights the checkpoints. Unrelated retries cannot spend or advance.
- A metric at target does not light an unverified checkpoint. The destination is
  reached only after the entire OKR passes verification. Unknown observations retain
  the last location (including an off-route location) and gray out the map.

- **注入演示场景 → 疑似空转**: three equivalent unsuccessful attempts are recorded;
  a heartbeat keeps the metric and budget unchanged. Inspect **查看判断依据**, then
  **重新规划并推进** to test route B under the existing scope and verification rules.
- **路径阻断**: route A is stopped by a simulated code-upload restriction. **切换本地路线 B**
  abandons the external operation; it does not approve the original external request.
- **临近边界**: inject a next-action estimate that exceeds the remaining budget. No
  spend or metric change occurs; review the contract or choose a cheaper local route.
- **等待依赖**: a live test within its expected wait window is shown separately from
  a loop. **模拟依赖返回** resumes after constraints are checked.
- **失去观测**: location and spend are marked as historical/unknown. **恢复观测（演示）**
  reconciles the snapshot and leaves execution paused for explicit resumption.
- Workbench navigation and OKR details use the same OKRs, measurements and simulator. Only verified
  KRs unlock downstream work; sampling alone is not labeled as a verified checkpoint.
- Scenarios pause the selected OKR and inject labeled demo observations. They retain
  previous metrics and evidence. **正常推进** clears the injected scenario, while
  actual budget, deadline, dependency and authorization checks still apply.

## Run conversations and interventions

From **工作台 → 运行导航**, open **与 Agent 沟通 / Talk to agent** beside the map's
next action, or use the conversation card. Each OKR has its own conversation and
saved draft. Messages capture the responsible Agent, host/instance, KR, simulated
run, last verified checkpoint, recent evidence, and the current execution agreement.
Historical snapshots remain attached to their messages; sending a message does not
refresh the last telemetry timestamp.

1. Inject **目标偏航** or **疑似空转**, open the conversation, choose **询问原因**, and
   send. The demo reply explains the recorded reason and next step without advancing
   measurements or changing execution. Expand the attached snapshot for evidence.
2. **补充信息** records your direction against the current run. **请求新方案** pauses
   the current attempt and proposes a fixed local alternative with steps, expected
   next-step cost, and preserved constraints. Quick prompts fill the draft; press
   **发送消息** to send it.
3. **采用方案并继续** validates the current state, updates the map to route B and
   resumes the existing simulator. Measurements and independent verification still
   determine progress. An abandoned external request is superseded, never approved.
4. **暂停等待** stops the selected OKR's loop and retains checkpoints. New direction
   supersedes an unadopted proposal. Changes to the run, metrics or agreement make
   older proposals stale; they cannot resume execution.
5. Offline hosts, stopped Agents and read-only phones cannot send or acknowledge
   messages. Drafts remain local and are not automatically sent on reconnection.
   Missing observations, dependencies, insufficient budget and expired deadlines
   block plan execution. Reopen the conversation after restoring availability.
6. Switch Chinese/English and light/dark themes; check the drawer on mobile. Authored
   text stays in its original language. Reload and reopen the same OKR to inspect
   its saved history and draft. The header is a linked snapshot; new messages capture
   the latest available context at send time.

Replies, delivery receipts and plan proposals are explicit local demonstrations;
there is no LLM connection or natural-language execution. Custom instructions are
recorded but do not drive the fixed simulator. Chat cannot rewrite success criteria,
permissions or budgets; use the existing agreement/approval flows for such changes.

## Unified host console review paths

Open `http://127.0.0.1:4173/?prototype=hosts` or **主机与算力** in desktop/mobile
navigation. The initial fleet has four local hosts, two cloud hosts, nine Agent
instances and two simulated Coordinator connections.

1. Filter local/cloud, search name/location/system, or select **需要关注**. Offline
   metrics are unknown, with the last observation retained.
2. Open **Mac mini M4 → 远程控制台** to try status, logs, restart, kill and shell.
   Mutations confirm their target. Stopping an instance pauses only its assigned
   OKRs; restarting it retains results and requires explicit continuation.
3. Open **远程桌面**, start/release simulated control, adjust quality/zoom/stats,
   choose the mobile input mode and send example text. This is an HTML illustration,
   not a real stream. Headless cloud hosts report no desktop capability.
4. **接入主机** creates a pending record; **模拟主机上线** makes it available.
   **管理连接** supports multiple named endpoints and isolated disconnect/reconnect.
   No token is collected and no network request is sent.
5. From the workbench, open its host chip or **选择执行主机**. Assignment checks availability,
   admission, workspace and the responsible Agent. It pauses the old loop and retains
   metrics/evidence. An unreachable source must reconnect before reassignment.
6. **模拟失联** on the assigned host makes that OKR's map unknown; other hosts keep
   their own state. **暂停接收新任务** prevents new assignments while current work stays.

Host running-OKR links and runtime notifications open the corresponding OKR on the
workbench; list and search results open its definition and evidence.

These flows adapt the capabilities and labels from `apps/agent-console` into the
unified product prototype. The original React client and real coordinator/runtime
are not replaced or connected. Host data is initialized lazily inside v2 demo state;
existing OKR measurements and evidence survive the upgrade.

## Data and limitations

The review bar labels the entire prototype as demo data. All measurements, evidence,
verification, costs, execution, approvals, devices and organizations are simulated.
No repository files are modified, messages sent, services purchased, credentials
created or chain transactions submitted by these workflows. The external service
request is a fixed sample scenario. Free-text constraints are interaction concepts,
not a policy engine. The verification simulator assumes the user-confirmed success
criteria are covered by the configured KRs; production must implement explicit
criteria mapping, real measurements, verifiers and authority checks.

Changes persist in `fractalmind.product-prototype.v2` local storage. The earlier v1
entry is left untouched; this demo does not migrate it. **重置演示** restores sample
OKRs and stops all pending simulation timers. **导出演示数据** downloads the complete
v2 state as JSON. The prototype does not implement the PRD's native platform,
security, localization, file synchronization, background runtime or protocol features.

Navigation state and its event history are stored within the existing v2 demo state.
Older v2 entries initialize navigation lazily; no user metrics are reset on reload.
