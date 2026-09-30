# FractalMind interactive prototype

A self-contained HTML prototype based on the [product PRD](../fractalmind-app-prd.md)
and [okr-manager skill](../../../skills/coordination/okr-manager-skill/SKILL.md).
Styles, icons, sample data and interactions are embedded in `index.html`.
No package installation, external assets, model keys or backend services are required.

From the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs/product/fractalmind-prototype
```

Open <http://127.0.0.1:4173>. A new browser starts at identity onboarding; an existing signed-in profile opens the workbench. Direct review entries:
`?prototype=workbench` (or the existing `?prototype=navigation`) opens the workbench,
`?prototype=okr` opens the OKR list, `?prototype=hosts` opens host management,
and `?prototype=identity` opens My identity.
The HTML can also be opened directly; browser storage
availability for `file:` URLs may vary.

## Language and appearance

The top bar and **组织设置 → 语言与外观 / Organization settings → Language & appearance**
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

Other flows remain available: onboarding, organizations, Agent details, task evidence,
memory, identity-based device enrollment with separate read/operate scopes, and organization
browsing. Desktop/mobile preview changes layout only; use **Review as this device**
on My identity to change the simulated operator and permissions. **模拟设备离线** in settings pauses autonomous execution and disables remote
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
4. **Host 接入指导** offers a one-use invitation with prior administrator approval,
   atomic membership plus execution grant, and an automatic first heartbeat. See
   the organization enrollment review below. **管理连接** lists existing organization
   bindings with isolated disconnect/reconnect; arbitrary URLs cannot grant membership.
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

## My identity and multiple devices (prototype 11)

Open `?prototype=identity`, the user avatar, or **我的身份 / My identity**. Organization
settings and the first-use walkthrough also link here. The existing Yubing identity
is an explicit fixture: upgrading does not replace organizations, OKRs, evidence,
conversations or host invitations. Any legacy paired phone migrates once to an
organization-scoped device grant.

This flow borrows the unlock, device-linking and recovery-kit experience researched
in 1Password. The production proposal uses Sui for a stable HumanIdentity, device
grants, recovery policy and trust history; a Coordinator only transports encrypted
messages. These contract extensions, wallet signing and encryption are **not**
implemented by this HTML.

1. **Add my device** → choose iOS, Android, macOS, Windows or Ubuntu and a device
   name → inspect the pairing card → simulate a trusted-device scan. The QR image
   is explicitly illustrative and cannot be scanned. Requests expire after five
   minutes and bind the proposed device, identity generation and current organization.
2. Confirm this organization's read/operate permissions, whether to sync encrypted
   data, and a 7/30-day grant. New devices cannot manage identities, add devices,
   recover identities or access other organizations. Confirmation is simulated;
   a pending or failed transaction grants nothing. Failure can be retried; expired
   requests must be started again. Pending transactions survive a reload and can
   be reconciled under **Review scenarios & implementation scope**.
3. Authorization and encrypted data access are separate. **Sync encrypted data**
   explicitly completes the simulated key handoff. Closing the success dialog
   retains the unsynced device and its resume-sync button. A device with withheld
   data access cannot display protected organization content.
4. **Review as this device** changes the simulated operator. A read-only device can
   inspect synchronized content, but cannot advance OKRs, send Agent messages,
   approve actions, edit memories, issue Host invitations or administer devices.
   Return to the management device using the same review selector. Choosing another
   organization does not grant access. Viewport size never grants permissions.
5. **Lock this app** hides protected organization content. Local unlock methods
   are interaction concepts only: no password, passkey, biometrics or native keychain
   is read or created. Unlocking cannot reactivate a revoked/expired device.
6. **Set up recovery kit** generates a clearly marked `DEMO-RECOVERY-…` token and
   downloads a plain-text **demo** kit. The raw token stays only in session memory
   and the explicitly downloaded file; browser state and normal exports contain
   only a SHA-256 comparison digest and mock recovery metadata. Confirm it is saved
   before simulating total device loss. Reload loses the in-memory copy; the downloaded
   token remains usable against the same browser's persisted mock chain.
7. **Simulate losing all devices** → use a wrong token to inspect validation → enter
   the saved demo token (or fill this session's demo token). Recovery preserves the
   identity ID, organization roles and all work, revokes old devices, cancels pending
   device grants and creates a new management device. Restore encrypted data as a
   separate step, then save a new recovery kit; the old recovery authority is consumed.
8. **Revoke device** requires a management device and chain confirmation. Already
   acquired plaintext/keys cannot be recalled. **Rotate keys for future data** changes
   the simulated data-key version for active devices only. Recovery encryption,
   historic ciphertext and key distribution remain production engineering work.

The prototype is a public-state simulation, **not a security boundary**: developer
access to browser storage can alter it. No data is actually encrypted, no real Sui
transactions or cross-device connections occur, and no production recovery keys are
created. Do not enter real secrets. The example kit is excluded from ordinary JSON
exports but is intentionally downloadable through its dedicated action.

## Data and limitations

The review bar labels the entire prototype as demo data. All measurements, evidence,
verification, costs, execution, approvals, devices and organizations are simulated.
No repository files are modified, messages sent, services purchased, production credentials
created or chain transactions submitted by these workflows. The external service
request is a fixed sample scenario. Free-text constraints are interaction concepts,
not a policy engine. The verification simulator assumes the user-confirmed success
criteria are covered by the configured KRs; production must implement explicit
criteria mapping, real measurements, verifiers and authority checks.

Changes persist in `fractalmind.product-prototype.v2` local storage. The earlier v1
entry is left untouched; this demo does not migrate it. **重置演示** restores sample
OKRs and stops all pending simulation timers. **导出演示数据** downloads the complete
v2 state as JSON. The prototype does not implement the PRD's native platform,
security, complete native localization, file synchronization, background runtime or protocol features.

Navigation state and its event history are stored within the existing v2 demo state.
Older v2 entries initialize navigation lazily; no user metrics are reset on reload.

## Organization and Host enrollment (PRD v0.8)

Production uses **Organization** as the boundary, including personal use. All durable
product state is authoritative on Sui; there is no business backend/database. App
signs with the relevant identity, Sui validates persistent decisions, Coordinator
reconstructs discovery/routing state, and envd verifies authority before execution.
Private keys remain device secrets; liveness/CPU/WebRTC are transient observations.
The HTML's localStorage is a **simulation cache**, not this production architecture.

1. Open the top-left organization switcher. Existing v2 OKRs, evidence, conversations,
   memories and six host fixtures migrate to **Yubing / DEMO-ORG-YUBING**. **FractalMind
   Labs / DEMO-ORG-LABS** starts without goals or hosts. Search, workbench, OKRs, memories,
   hosts and grants follow the selection; switching back preserves earlier work.
   The demo pauses active timers on switch with a notice; it does not revoke grants.
2. **主机与算力 → Host 接入指导** defaults to one-use invitations. As administrator,
   select 15 minutes / 1 hour / 24 hours, inspect the fixed seven-day execution grant,
   optionally include desktop access, then **签名创建邀请码**. Confirmation is automatic
   in the simulation; the invitation cannot be used while its transaction is pending.
3. Copy the invitation or choose **在新主机使用（演示）**. The device sees its target
   organization, expiry and grant. Confirm local consent and **加入组织并连接**. A single
   simulated transaction consumes the invitation and creates membership plus the
   capped grant; connection and the first heartbeat follow automatically. No second
   administrator approval is required. Device details are optional review inputs.
4. **演示故障与人工审核 → 模拟下一笔交易失败** tests retry without consumption. RPC
   failures retain pending transactions; **查询兑换结果** reconciles the same transaction.
   Disable the Coordinator to get **已加入组织，等待连接**; retry the connection without
   spending the code again. Previously consumed codes cannot enroll another host.
5. **管理已有邀请码** lists active, consumed, expired, revoked and pending invitations.
   An unused invitation can be revoked. After redemption, revoke the actual host's
   membership/authority through host details; revoking an invitation is not a substitute.
6. Raw invitation secrets remain in session memory and are excluded from localStorage
   and ordinary exports. Reload retains the invitation's public verification key and
   transaction records, but cannot recover the code. Revoke and regenerate if it was
   not saved. This browser's mock chain is not available on another browser/device.
7. The prototype demonstrates Ed25519 proofs bound to the invitation and target device;
   it never places the raw invitation key in a transaction. Its JSON signing format,
   local clock and local state commit are **not a deployed Sui protocol**. Production
   needs domain-separated BCS, Sui Clock, atomic shared-object consumption, verified
   authority, gas handling and the device's actual transaction signature.
8. **演示故障与人工审核 → 改用设备申请与人工审核** retains the previous device-request,
   fingerprint approval and separate grant flow. Existing requests remain available
   under **全部接入记录**. Chinese/English, light/dark and mobile review remain supported.

Original fixture hosts have explicitly simulated confirmed membership and grants.
Older user-added hosts receive no implicit authority and must use the new flow.
Actual Organization creation, Sui contracts, encrypted payload persistence, chain
reconstruction, identity binding and live authority resolution remain implementation
work identified in PRD §8.4–8.5. A personal organization is not itself encryption or
proof of restricted membership. UI deletion cannot erase public chain history.

Run the simulation's organization/admission/invitation/identity regression checks with Node.js 22 or later:

```sh
node docs/product/fractalmind-prototype/verify.cjs
```

These checks validate the embedded state machine, not deployed contract security.

### 首次使用与未连接身份（原型 14 更新）

评审入口：<http://127.0.0.1:4173/?prototype=welcome>。全新浏览器默认显示此页；已有会话可点击顶部「首次使用」，或「我的身份 → 评审场景与实现边界 → 退出此设备」。退出后不展示组织侧栏、目标或主机内容。

- **创建身份**：填写称呼、个人组织名称、设备平台和本机解锁偏好 → 运行费准备（自付或已有赞助方）→ 核对并提交 → 模拟链上确认身份、设备与个人组织 → 保存单份身份恢复码 → 工作台。自付前先保存无密钥的临时备份示例；到账不会自动提交。新身份使用独立本地演示档案，不继承旧身份的角色、OKR、主机或记忆。
- **已有身份**：新设备显示配对请求 → 明确切换到旧管理设备视角核对并批准 → 独立同步加密数据 → 进入组织。默认仅授予当前组织的 7 天只读权限；可显式允许任务和审批，不授予身份管理权限。
- **恢复码（原型 15）**：未登录时只输入演示恢复码，自动查找身份并展示名称、Human ID 与组织供核对；确认后撤销旧设备，再单独恢复加密数据。不需要另外保存或输入身份 ID。查询范围是此浏览器当前评审目录的已保存演示档案，不查询真实 Sui。
- **评审工具**：页面底部可「载入已有身份演示」恢复原有 Yubing 评审档案，再「模拟返回原设备」查看此前 OKR / Host 数据。此按钮明确模拟可信旧设备，并非产品的免验证登录入口。新建身份档案保留在独立 localStorage key 中。
- **刷新**：未连接状态持久保存；未完成的登记与配对可从入口继续。新身份的费用草稿与待确认交易会自动恢复，已完成创建的新身份不会因为保留 `?prototype=welcome` 而被再次退出；顶部「首次使用」可明确退出预览。

此版延续中英文、浅色/深色主题和移动布局。未实现真实身份合约、系统凭据存储、密码、生物识别、扫码连接或加密。组织成员邀请尚待合约支持，不复用 Host 邀请码登录 Human。

### 从 Host 发现与导入已有 Agent（原型 13）

入口：「团队与 Agents → 从 Host 发现 Agent」，或「主机与算力 → 主机详情 → Agent 实例 → 发现已有 Agent」。

独立评审链接：<http://127.0.0.1:4173/?prototype=agents&review=discovery>，使用独立演示档案，保留当前 Human 的组织和数据，也不改变普通入口的活动档案。

1. 选择已授权 Host 并扫描，查看会话、来源主机、工作区、适配器能力和扫描时间。可评审离线、无会话、仅有观察适配器等情况。
2. 核对后「导入为仅观察」，再模拟链上确认或失败。确认前不写入导入关系；确认后保留原运行和任务，不创建第二个执行进程。同名不同主机不会合并，重复实例不能重复导入。
3. 支持约束的演示适配器可「授权纳入 OKR」：选择工作区匹配的 ACTIVE OKR，核对预算、期限、工具与升级边界，确认原任务安全检查点和旧执行暂停。确认交易后切换 OKR 责任实例，保留成果、暂停自主循环，等待明确继续。
4. tmux 观察适配器不能进入控制模式。已授权实例的 OKR 边界变化会阻断后续执行，需重新确认；观测超过 5 分钟或再次扫描不见实例时，显示状态未知并要求重新发现。组织管理员角色与当前设备管理授权都必须有效。

技术边界：真实 envd 目前只扫描特定命名的 tmux 会话。此 HTML 使用固定演示观测、身份核验与协作适配器，未连接真实主机或提交 Sui 交易。持久导入/绑定/授权模拟链上权威状态；扫描快照模拟可重建观测。运行时实例标识为演示定位键，真实实现还需要可信身份与实例连续性证明。


### 全流程走查修复（原型 14）

- 常规入口仍使用你的原有身份；`?prototype=workbench&review=qa` 使用隔离的样例档案，
  `?prototype=welcome&review=onboarding` 使用隔离的首次使用档案。首次使用页的「原型评审工具」
  可切回已保存的身份。重置新身份的评审场景会另建样例档案，保留原身份数据。
- 首次运行费覆盖不足额到账、自付、赞助方离线/额度不足、Sui 不可用、失败扣费和重试。
  待确认交易保留原交易编号并固定资料；已失败交易重试时生成新编号。所有 SUI 数额均为
  演示值（预计 0.003、预算 0.010、失败费 0.0006），不是实时估价或充值建议。
  地址明确无效，不提供真实收款码；后续 Host、Agent、OKR 的费用尚未接入。
- 空组织首次接入 Host 会引导绑定 Coordinator 连接入口，再进入一次性邀请码流程。
  绑定前、待确认和确认后的状态分开，输入的地址不会被访问。
- 未部署、暂停或失联的 Agent 不再统一显示就绪。新建/激活 OKR 时检查工作区、
  责任 Agent、主机可达性和授权；不可执行的目标可以保存为候选。
- 锁定和缺少数据访问授权时，组织设置、内容与导出均受保护；只读设备能查主机状态，
  不能发起执行操作。完整导出只包含当前组织；「导出记忆」仅包含记忆。
- 同一档案被另一窗口更新时，旧窗口停止模拟计时器和写入，并持续提示刷新。
  这是防覆盖措施，不是多窗口实时同步或真实链上事务。
- 手机顶部「全部功能」可访问 Agents、记忆、审批、身份和费用；首次使用的手机布局
  优先显示当前步骤。补齐新增页面中英文，保留主题和用户输入语言。

本轮检查范围与结果见 [QA-REPORT.md](QA-REPORT.md)。`verify.cjs` 的七组回归检查已接入
`.github/workflows/prototype.yml`，针对原型改动运行；浏览器交互走查仍需单独执行。


### 单恢复码找回身份（原型 15）

入口：「我的身份 → 设置恢复码」；未登录时选择「使用恢复码找回」。

1. 生成并离线保存一份恢复码；复制即可，下载备份文件可选，不需要另存 Human ID。
2. 粘贴恢复码查找身份，显示身份名称、稳定 Human ID 和关联组织；查找不会授予设备权限。
3. 核对后选择新设备平台，明确确认撤销旧设备，再恢复当前设备授权。
4. 单独恢复加密数据访问；旧码被消费，提示保存新的恢复码。身份、组织和原有工作保留。

演示码带版本、LOCAL 网络标记和校验字段；支持换行/大小写规范化，旧版 UUID 演示码仍可用。
格式错误、校验失败、版本/网络不支持、失效码、Sui 不可用、确认前状态变化会拦截恢复。
取消确认后不会继续应用异步恢复结果。恢复秘密仅保留在页面内存，不写入缓存或普通导出。

实现边界：浏览器用恢复码摘要索引模拟链上恢复记录，从记录查找 Human ID；这不是从秘密直接
计算 Sui 对象 ID，也没有实现真实密钥派生、签名或加密数据解密。真实产品还需链上恢复目录、
可恢复的加密备份与对应合约校验。清除本浏览器所有演示档案后，仅凭演示码无法找回原型数据。
