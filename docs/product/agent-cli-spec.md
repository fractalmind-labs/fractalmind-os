# Agent CLI：让授权的 AI Agent 辅助管理组织（规格草案）

2026-11-04 起草。属于应用层（Application plane），与 App 并列，是 PRD §3 原则 6「CLI/API 仍可使用」的落地。需求来源：负责人 2026-11-04「Application plane 需要增加一个 cli，给授权的 AI Agent 来辅助管理组织」。

## 1. 用户与任务

- **使用者**：一个 AI 编程/运营 Agent（Claude Code、Codex 等），运行在负责人的电脑或某台已授权 Host 上，通过 shell 调用命令。
- **委托人**：组织负责人（Human）。他把“看全局、起草、跟进、催办、整理证据”这类日常管理交给 Agent，自己只做确认和审批。
- **要完成的事**：
  1. 读组织全貌：OKR/KR/证据、主机、Agent 实例、Run、费用、待处理事项。
  2. 起草和推进：写 OKR 草稿；给 KR 补证据和进展；创建、改派任务；直接对话某个 Agent；暂停异常 Run。
  3. 把需要人拍板的事整理成审批请求，交给负责人在 App 里一键处理。
- **不做**：替人审批，扩大任何授权，花超出预算的钱，接入主机，管理设备，恢复身份。

## 2. 不变式（每条都由链或执行端强制，不靠 CLI 自觉）

1. **Agent 有自己的身份和钥匙**，不借用负责人的设备钥匙。钥匙在 Agent 所在机器的系统安全存储里生成，从不打印或导出。
2. **权限在链上**：Agent 的授权是一份 `DeviceGrant`，并带「Agent 操作员」标记。
   - 授权只限一个组织。动作最多 `READ` + `OPERATE`，**永远不含 `APPROVE`、`MANAGE_HOSTS`**；期限最长 30 天。
   - 由新增的合约入口强制，App 只是界面。本地配置不是权限来源。
3. **审批永远是人**：OKR 确认/激活、成果验收、授权变更、超预算、新建组织、主机接入，CLI 只能发「审批请求」。审批请求用现有 `product_record` 的 approval 类型存链上，负责人在 App 里用自己的设备签名处理。
4. **花的钱有硬上限**：Agent 地址自付手续费，负责人在 App 里给它充值，余额就是上限。每次写入前报价，超过 `--max-fee` 或剩余余额就拒绝。执行类花费仍受 `RemoteCapability` 的次数和预算约束。
5. **可追溯**：Agent 的每次链上写入都能从它的授权追到委托人。App 和浏览器标注「由 Agent xxx 代为操作」。
6. **撤销立即生效**：负责人在 App 撤销授权后，下一次写入即被合约拒绝；只读请求也拒绝，不用缓存兜底。
7. **离线失败即关闭**：链不可达时所有写入失败并给出原因。只读可以返回缓存，但必须带 `stale_since`。
8. **不依赖 Coordinator**：远程执行命令只走链上命令队列（`node_execution::queue_command`）。发现和状态只读链上数据和主机签名的观测记录。

## 3. 授权流程（复用 FR-11 配对，加 Agent 标记）

1. Agent 在自己机器上运行 `fm auth login --org <组织名或ID>`：生成钥匙，向链上创建配对请求（`create_device_pairing`，类型为 agent），终端显示 6 位配对码和一个 App 链接。
2. 负责人在 App「组织 › 成员与 Agent › Agent 操作员」看到请求，核对配对码。勾选动作（默认只读，可加「推进」），选期限（7/30 天），设初始充值额（默认 0.5 SUI），用自己的设备签名批准。
3. 合约新入口 `approve_agent_operator`：
   - 校验批准设备有 `APPROVE`；
   - 强制动作 ⊆ {READ, OPERATE}、期限 ≤ 30 天、`org_scope` = 该组织；
   - 在 grant 上挂动态字段 `AgentOperator { label, approved_by_grant }`。
4. App 里同一页可看到每个 Agent 的最近操作、余额，以及撤销、续期和充值按钮。

## 4. 命令（第一版）

全部 `fm <名词> <动作>`。stdout 非终端时默认输出 JSON，退出码稳定，写入命令都支持 `--dry-run`（只报价）和 `--request-id`（幂等，重试不重放）。

| 组 | 命令 | 需要 |
|---|---|---|
| 身份 | `fm auth login / status / logout`；`fm whoami` | 无 / READ |
| 组织 | `fm org show`；`fm org activity --since` | READ |
| OKR | `fm okr list / show`；`fm okr draft create / update`；`fm kr progress`；`fm kr evidence add` | READ / OPERATE |
| 任务与 Run | `fm run list / show / logs`；`fm run pause`；`fm task create / assign` | READ / OPERATE |
| Agent | `fm agent list / show`；`fm agent message <agent> <text>`（直接对话，FR-41） | READ / OPERATE |
| 主机 | `fm host list / show` | READ |
| 审批 | `fm approval request <kind> ...`；`fm approval list / show` | OPERATE |
| 事件 | `fm events --follow`：订阅组织相关链上事件（新审批结果、Run 状态、OKR 变化），供 Agent 反应 | READ |
| 自描述 | `fm schema`：输出机器可读的命令目录和错误码 | 无 |

同时提供 `skills/fractalmind-cli/SKILL.md`，告诉 Agent 何时用哪个命令，以及哪些事必须发审批请求。

## 5. 实现形态

- TypeScript，直接复用 `@fractalmind-labs/fractalmind-sdk` 和 App 中已有的纯逻辑（`chain.ts`、`organization-create.ts` 等抽成共享包，不复制）。
- 打包成单文件可执行（`bun build --compile`），作为 App 的 sidecar 随 App 安装（满足 FR-01：无需预装 Node），并在 App 设置里提供「安装命令行工具」。
- 钥匙存储：macOS 钥匙串 / Windows DPAPI / Linux Secret Service；CI 与无桌面 Host 用加密文件 + 环境变量口令（明确标注弱于前者）。

## 6. 分期

| 期 | 内容 | 验收 |
|---|---|---|
| P0 | 合约：`AgentOperator` 标记 + `approve_agent_operator`，含 Move 测试（拒绝 APPROVE/MANAGE_HOSTS、超 30 天、跨组织；撤销后拒绝） | localnet 测试通过 |
| P1 | CLI 骨架：`auth login`/配对、`whoami`、全部只读命令、`schema`、`events`；App「Agent 操作员」页（批准、撤销、续期、充值） | localnet 端到端：配对 → 只读 → 撤销后被拒 |
| P2 | 写入：OKR 草稿、KR 进展/证据、任务、直接对话、暂停、审批请求；App 的审批请求收件箱 | localnet + 测试网各一遍 |
| P3 | 经链上命令队列的远程执行，受 `RemoteCapability` 约束 | 一条命令端到端 + 越权被拒 |

## 7. 待核实的风险

- **同一系统用户的威胁**：Agent 与 App 以同一系统用户运行。必须确认 App 的设备钥匙签名需要用户在场（Touch ID / 系统密码），否则 Agent 进程可直接调用负责人的钥匙绕过一切。代码里暂未找到 user presence 设置，P0 一并核查并补上。
- 合约升级在测试网由协调人执行。主网需负责人单独确认。
- `product_record` 的 approval 类型目前用于 OKR 审批，需要确认能承载通用审批请求，否则在 P2 扩一个子类型。
