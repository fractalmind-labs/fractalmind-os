# v0.2.0 命令预留与执行检查点

对应 #28、#29、#30、#33；[完整验收记录](fractalmind-app-v020-validation.md) 仍是 v0.2.0 的交付门槛。本页说明已经通过真实链集成的命令切片，尚不代表 Agent 任务已实际执行。

## 当前流程

1. 管理设备签名 NodeCommand，SDK 验证签名和载荷摘要。使用链上结果存储时，在同一 PTB 内封装并登记命令专用结果密钥，再提交 `prepare_agent_command` 或 `prepare_host_command`；失败会原子回滚密钥登记和预留。
2. 合约验证当前 Human/DeviceGrant、组织、Host 成员和实例权限，原子消费一次有界能力并创建 QUEUED 检查点。能力私有索引按签名意图 SHA-256 定位；相同意图重试返回原检查点。
3. envd 使用原生 gRPC 和严格 BCS 核对意图、目标、时间、预算及链上绑定。未预留的命令不能执行。
4. 目标 Host 签署 `begin_*_command`，合约原子重验当前权限，记录独立随机尝试标识，并将检查点推进到 RUNNING。两个执行端不能同时获得资格。
5. Go 校验交易 digest 和检查点中的本次尝试标识。ledger 短暂滞后时仅查询该检查点；无回执或无法确认归属时返回 `execution_needs_confirmation`，包含 execution ID 和原 digest。已确认的链上拒绝返回 `execution_start_rejected`。
6. 执行器先核对结果密钥与 Host Gas，取得并再次确认本次启动归属后才调用适配器。Host 使用 `finish_command_with_budget` 原子结算已知支出并保存加密结果，检查点引用规范的链上 EncryptedRecord，记录密文摘要、终态与递增游标。结果摘要用于完整性检查；任务是否达成仍需后续证据验证及人工验收。

精确重试、RUNNING 或需要确认的检查点都不能授权第二次执行。排队停止直接取消；运行中的停止请求只记录 `stop_requested`，须由实际运行时停止后确认终态。权限过期或撤销后允许 Host 补交已经开始的历史执行结果，该入口不能启动新动作。

## 时间、预算与加密边界

- 命令有效期最多 5 分钟，启动前以 Sui Clock 检查到期和当前能力版本。
- 能力使用次数和最大预算在准备时原子预留。能力的预算占用为已支出 + 在途预留；两者连同已委托额度不得突破能力上限。逐笔账本绑定签名意图，已知成功、失败或已确认停止按显式支出结算，支出不能超过原预留。
- 排队取消按零支出释放预留；运行中请求停止继续保留预留，须等 Host 确认终态。未知结果保持全部预留，不能将“支出尚不确定”当作零支出释放。已结算命令不能修改费用；释放预算不会返还使用次数、nonce 或幂等记录。
- 私有动态字段保存总账和逐笔账本，保持原 RemoteCapability / CommandExecution 对象布局。旧 `finish_command` / `request_stop` ABI 保留但拒绝调用（9310），避免绕过结算；SDK 改用显式传入 capability 的入口。没有逐笔账本的旧已用能力不会被猜测为已支出或可释放，需明确迁移方案，当前返回 8320。
- SDK 可读取两类预算；Go 读取核验账本类型、父对象、金额、结算与检查点状态一致性，并重新读取依赖版本，拒绝混合快照。真实费用计量及 OKR/常驻权限整体预算联动仍待接入；本轮真实链测试中的 7/3 单位费用是显式测试输入，不是实际 Agent 消耗。
- 新执行器结果使用 FME2 AES-GCM 封装，AAD 绑定组织、checkpoint 类型、意图逻辑 ID、修订和密钥代次。结果密钥由组织密钥、组织 ID、签名意图和代次经 HKDF 派生，再用 HostMembership 的 X25519 公钥封装；Host 只取得该命令的结果密钥。恢复设备可用备份中的历史组织密钥重新派生，不需要另存每条命令密钥。旧 FME1 根密钥正文仍可经 SDK 读取，链上结果存储不向 Host 分发组织根密钥来兼容它。
- 结果密钥动态字段绑定 capability、组织、Host 成员、Host 地址和密钥代次；只能由当前设备授权登记，精确重试保留原封装。FME2 写入须有对应密钥登记，不允许给已经准备的旧命令静默切换密钥方案。
- 新 `ChainExecutionStore` 已接入执行器接口，持久事实读写 Sui，正文和密钥不写文件。重复命令从链上结果恢复；正文中的命令、目标、终态、确认状态和费用必须与链上检查点一致。已接入 envd 生产工厂；生产 agent-manager 目前仅支持观察，控制仍须实际受约束适配器。
- 结果写入 Gas 默认上限为 2 SUI，可通过存储选项调整；这是上限而非实际费用。真实链测试发现原固定 0.1 SUI 上限不足以保存约 32 KiB 结果，已修正。启动前检查 Host 余额覆盖启动和结果写入上限，启动后调用适配器前再检查；余额不足与 RPC 无法读取分别返回 `host_gas_insufficient` / `host_gas_unavailable`。这不是链上资金锁定，并发交易仍可能消耗 Gas。
- 组织密钥轮换后的在途命令尚需明确的结果密钥重新授权流程；缺少当前代次密钥时拒绝启动/写入，不能回退旧代次或重新执行。Host OS 存储已接入，macOS Keychain 实测通过；其他平台原生存储、受约束适配器以及轮换后的结果补交仍需验收。
- 执行器并发键新增完整签名意图摘要，避免同一展示 ID 的不同命令串用结果。Phase 0 旧文件缓存路径因此不再匹配；旧授权预留仍阻止重放，缺少可核验结果时保持需要确认，不自动重新执行。生产迁移以链上检查点为准。

## 真实链证据与复现

[本地链报告](evidence/v020-node-execution-localnet.json) 包含 64 笔 SDK 交易：44 笔成功、20 笔预期拒绝；另有 2 笔 Go 发起的启动交易，摘要记录在 `host.executions.goChecks`。6 次 Go 命令检查覆盖未预留拒绝、两次启动归属、运行中与终态重复查询。Host 授权的原有 6 次真实 Go 读取仍通过。

检查点测试覆盖错误 Host、重复启动、终态早于启动、排队取消、次数耗尽及预留后 Host 撤销。两份终态正文明确声明测试未调用 Agent 适配器；清空 SDK 状态并使用恢复码取得历史密钥后，两份正文均可重建、解密。

后续[预算结算报告](evidence/v020-node-budget-localnet.json) 包含 74 笔 SDK 交易（50 笔成功、24 笔预期拒绝）、3 笔 Go 启动交易、8 次 Go 命令检查及 13 个预算断言。验证超额支出拒绝、结果写入失败原子回滚结算、重复结算拒绝、排队取消释放、在途预算超限拒绝、停止请求保留及确认后结算、未知结果保留额度。

恢复后 3 份终态正文可解密；另用新建 SDK 只读核对 6 个选定检查点的逐笔预算及 3 份总账，记录在 `recoveredExecutionBudgets`。选定对象 ID 来自测试报告，这证明链上账本可独立重读，不代表 App 的目录发现或完整缓存重建已完成。

执行端新增 `ReadExecutionResult`，直接核验不可变正文的原始包类型、UID、组织、命令逻辑 ID、修订、Host/Human/Grant 及版本、写入时间与密文摘要。3 次真实 Go 结果读取记录于报告的 `authenticatedResultReads`；原设备已经恢复失效，历史密文仍可核验，读取不授予新执行权限。

Go `productcrypto` 与 SDK 双向 FME1 AES-256-GCM 互操作已测试，包括中文/Unicode 正文、AAD 不匹配、篡改、nonce 随机性和 64 KiB 链上正文上限。互操作 fixture 只包含公开的合成测试密钥。新增 FME2/HKDF/FMW1 互操作覆盖命令密钥隔离、超过 JS 安全整数的代次、错误 Host/上下文及低阶 X25519 公钥。

最新 [结果存储集成报告](evidence/v020-runtime-result-store-localnet.json) 包含 80 笔 SDK 交易（53 成功、27 预期拒绝）、3 笔 Go 校验器启动及 8 次校验器检查，另有 Go 执行器的 2 笔启动与 2 笔结果写入。每个合成子进程适配器仅被调用一次，新建执行器从链上恢复结果而不重复调用；两份约 33 KiB 密文由同一 PTB 分块组装。已知合成费用 3 单位结算，未知费用保留 20 单位预留；14 个预算断言通过。

Human 恢复后，5 份终态正文可解密，8 个选定检查点的账本和 4 份总账可重读。运行时输出、费用均为 fixture；此测试不证明实际 Agent 执行、物理停止或云端 envd 部署。资金前置检查另有余额不足、分页及 RPC 失败回归；首次空分页 token 的真实链错误已经修复。丢失回执时只查询原检查点，不重新发送写入。

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

生产 AuthorityStore/结果存储已接线，[Host 身份与执行器增量](v020-host-identity-runtime.md) 记录生产工厂和 macOS 安全存储验证。真实受约束适配器、物理停止确认、其他平台原生存储、在途结果密钥轮换/补交、真实费用计量及 OKR/常驻权限预算联动、未知费用的人工核实与结算、OKR/审批/直接对话及 App 全流程继续按里程碑实现。单元测试中的并发和丢失回执不替代真实多 Host 部署验收。
