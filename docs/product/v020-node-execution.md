# v0.2.0 命令预留与执行检查点

对应 #28、#29、#30、#33；[完整验收记录](fractalmind-app-v020-validation.md) 仍是 v0.2.0 的交付门槛。本页说明已经通过真实链集成的命令切片，尚不代表 Agent 任务已实际执行。

## 当前流程

1. 管理设备签名 NodeCommand，SDK 验证签名和载荷摘要，向 Sui 提交 `prepare_agent_command` 或 `prepare_host_command`。
2. 合约验证当前 Human/DeviceGrant、组织、Host 成员和实例权限，原子消费一次有界能力并创建 QUEUED 检查点。能力私有索引按签名意图 SHA-256 定位；相同意图重试返回原检查点。
3. envd 使用原生 gRPC 和严格 BCS 核对意图、目标、时间、预算及链上绑定。未预留的命令不能执行。
4. 目标 Host 签署 `begin_*_command`，合约原子重验当前权限，记录独立随机尝试标识，并将检查点推进到 RUNNING。两个执行端不能同时获得资格。
5. Go 校验交易 digest 和检查点中的本次尝试标识。ledger 短暂滞后时仅查询该检查点；无回执或无法确认归属时返回 `execution_needs_confirmation`，包含 execution ID 和原 digest。已确认的链上拒绝返回 `execution_start_rejected`。
6. Host 使用 `finish_command_with_budget` 原子结算已知支出并保存加密结果，检查点引用规范的链上 EncryptedRecord，记录密文摘要、终态与递增游标。结果摘要用于完整性检查；任务是否达成仍需后续证据验证及人工验收。

精确重试、RUNNING 或需要确认的检查点都不能授权第二次执行。排队停止直接取消；运行中的停止请求只记录 `stop_requested`，须由实际运行时停止后确认终态。权限过期或撤销后允许 Host 补交已经开始的历史执行结果，该入口不能启动新动作。

## 时间、预算与加密边界

- 命令有效期最多 5 分钟，启动前以 Sui Clock 检查到期和当前能力版本。
- 能力使用次数和最大预算在准备时原子预留。能力的预算占用为已支出 + 在途预留；两者连同已委托额度不得突破能力上限。逐笔账本绑定签名意图，已知成功、失败或已确认停止按显式支出结算，支出不能超过原预留。
- 排队取消按零支出释放预留；运行中请求停止继续保留预留，须等 Host 确认终态。未知结果保持全部预留，不能将“支出尚不确定”当作零支出释放。已结算命令不能修改费用；释放预算不会返还使用次数、nonce 或幂等记录。
- 私有动态字段保存总账和逐笔账本，保持原 RemoteCapability / CommandExecution 对象布局。旧 `finish_command` / `request_stop` ABI 保留但拒绝调用（9310），避免绕过结算；SDK 改用显式传入 capability 的入口。没有逐笔账本的旧已用能力不会被猜测为已支出或可释放，需明确迁移方案，当前返回 8320。
- SDK 可读取两类预算；Go 读取核验账本类型、父对象、金额、结算与检查点状态一致性，并重新读取依赖版本，拒绝混合快照。真实费用计量及 OKR/常驻权限整体预算联动仍待接入；本轮真实链测试中的 7/3 单位费用是显式测试输入，不是实际 Agent 消耗。
- 终态采用已有 FME1 AES-GCM 正文格式，AAD 绑定组织、checkpoint 类型、意图逻辑 ID、修订和密钥代次。Host 正文密钥分发与生产端写入尚待实现；测试显式使用生成的测试组织密钥。
- 本地文件不作为当前授权事实。生产工厂与结果存储尚未接线，仍保留 Phase 0 路径；不得据此声称清空 envd 缓存后的真实 Agent 执行已经验收。

## 真实链证据与复现

[本地链报告](evidence/v020-node-execution-localnet.json) 包含 64 笔 SDK 交易：44 笔成功、20 笔预期拒绝；另有 2 笔 Go 发起的启动交易，摘要记录在 `host.executions.goChecks`。6 次 Go 命令检查覆盖未预留拒绝、两次启动归属、运行中与终态重复查询。Host 授权的原有 6 次真实 Go 读取仍通过。

检查点测试覆盖错误 Host、重复启动、终态早于启动、排队取消、次数耗尽及预留后 Host 撤销。两份终态正文明确声明测试未调用 Agent 适配器；清空 SDK 状态并使用恢复码取得历史密钥后，两份正文均可重建、解密。

后续[预算结算报告](evidence/v020-node-budget-localnet.json) 包含 74 笔 SDK 交易（50 笔成功、24 笔预期拒绝）、3 笔 Go 启动交易、8 次 Go 命令检查及 13 个预算断言。验证超额支出拒绝、结果写入失败原子回滚结算、重复结算拒绝、排队取消释放、在途预算超限拒绝、停止请求保留及确认后结算、未知结果保留额度。

恢复后 3 份终态正文可解密；另用新建 SDK 只读核对 6 个选定检查点的逐笔预算及 3 份总账，记录在 `recoveredExecutionBudgets`。选定对象 ID 来自测试报告，这证明链上账本可独立重读，不代表 App 的目录发现或完整缓存重建已完成。

在已经启动的隔离本地网络上，从仓库根目录运行：

```sh
FM_TEST_PACKAGE=$(python3 protocols/fractalmind-protocol/sdk/scripts/prepare-localnet-package.py)
sui move build --path "$FM_TEST_PACKAGE" --dump-bytecode-as-base64 > /tmp/fractalmind-v020-node-bytecode.json
cd protocols/fractalmind-protocol/sdk
FM_HOST_ACCEPTANCE=1 FM_HOST_AUTHORITY_VERIFY=1 FM_NODE_CHECKPOINT_ACCEPTANCE=1 node --import tsx scripts/identity-localnet.ts /tmp/fractalmind-v020-node-bytecode.json /tmp/fractalmind-v020-node-results.json
```

默认 RPC 为 `http://127.0.0.1:29000`，faucet 为 `http://127.0.0.1:29123`，可由 `FM_LOCALNET_RPC`/`FM_LOCALNET_FAUCET` 指定 loopback 地址。测试生成自己的钱包，不读取用户 keystore，不保存恢复码、邀请码或私钥。Go 子测试只在进程环境中接收生成的测试 Host seed。

交易证据先写入 `.progress.json`，完整报告仅在全部断言通过后生成。确认使用 ExecuteTransaction 返回的 effects 及 ledger 当前对象版本；不会依赖本地网络保留交易历史。Gas 从 coin 索引选择后再读取 ledger 当前对象引用，避免索引滞后造成旧版本提交。

## 剩余交付

真实受约束适配器、物理停止确认、Host 密钥分发、链上结果存储、生产 AuthorityStore 接线、真实费用计量及 OKR/常驻权限预算联动、未知费用的人工核实与结算、OKR/审批/直接对话及 App 全流程继续按里程碑实现。单元测试中的并发和丢失回执不替代真实多 Host 部署验收。
