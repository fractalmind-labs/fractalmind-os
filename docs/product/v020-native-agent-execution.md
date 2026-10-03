# v0.2.0：原生别名执行与物理状态

基于 PRD v0.11 及 `fractalmind-app-prototype-v2`。本增量验证此前发现／仅观察导入的原生文件 Agent 执行引擎，完整 v0.2.0 仍未完成。

## 生产行为

原生适配器为 `status`／`availability` 返回实际物理状态：实例 ID、工作区指纹、`idle`／`running`，以及运行中的命令 ID、链执行 ID 与开始时间。查询不启动 Agent、不调用 agent-manager，也不授予控制权限；生产 Executor 仍要求设备签名、当前链授权与该命令检查点。

原配置名称与发现出的 `native-*` 别名共享同一个适配器执行槽和规范工作区。一次任务在开始权限核验前取得槽，覆盖全部工具操作，关闭工具根句柄后释放。第二条任务返回 `instance_busy`，工具支出明确为 0；它在 Executor 中已取得的权限使用与检查点不被自动重试。原路径变成替换目录、实例创建身份不可核验或库存不可用时拒绝执行。

物理槽仅在当前适配器内存中保存。`idle` 表明当前文件操作结束，不代表旧链检查点已终结、结果已发布或可以接管；后续接管必须同时核对当前实例、链检查点和约束。执行器重建测试发生在首条执行终结后，没有证明两个独立执行器或两个 envd 进程之间的共享锁。

## 原摘要恢复修复

加密结果明文在交易构建之前生成，因此原交易摘要不能从该明文可靠恢复。gRPC 读取链对象时附带 `previous_transaction`；结果解析先核对精确类型、不可变 owner、组织、命令绑定、内容 hash 与检查点，再使用该不可变结果的创建交易摘要。重建结果覆盖运行时明文里的摘要，原数据提供者未提供链摘要时保持空值，不凭空补值，也不因此再次执行。

## 实际链验证

[公开报告](evidence/v020-native-execution-localnet.json)包含 **19 项检查、23 份完整成功交易回执／费用，以及 2 份不可变结果原摘要确认**。执行前后两个状态结果的原交易查询不可用，但结果对象 owner／类型与 `previous_transaction` 匹配；费用为 `null`，不算作完整费用回执。执行开始的 Host 内部交易未全部汇入此报告，以上数量不是总广播量。

流程使用现有隔离部署与真实本地链，不更换现有链进程：

1. envd 生产工厂加载生成的 Host 测试身份，实例化原生适配器、真实临时工作区及内核进程身份。发现经 Host 原文签名、设备 HTTP 挑战及 App 独立核验，App 登记仍为仅观察。
2. 在仅观察记录下发送签名只读 `status`，实际物理状态为 `idle`，结果加密保存链上；核对没有因此授予控制。
3. **测试夹具通过 raw SDK 显式设置控制权限**，创建一个已约定的 ACTIVE OKR：同一原生实例、固定工作区、两份文本文件、读写路径和 6 次工具预算。这不替代 App 安全交接流程。
4. 同一发现别名沿生产 Executor 执行。Go 读取真实文件核对两份内容；链上执行成功、权限使用一次、预算支出 6／预留 0、KR 观测 2，`verified=false`，OKR 仍 ACTIVE。
5. 同进程重建生产工厂，重复原签名命令恢复原结果与同一原交易摘要；随后新的签名状态查询确认物理空闲。原成员／设备撤销与拒绝旧资格的基础验收继续通过。

首轮独立夹具在只读状态的原交易查询返回 `notFound` 后结束，没有发送文件执行阶段。[原摘要记录](evidence/v020-native-execution-prior-query.json)保存该查询不可用状态，不将其认定失败，也不从第二个独立组织的成功推断旧状态；没有重放原交易。

[单元／集成验证](evidence/v020-native-execution-unit.json)包含 Go 五包 race、gRPC 元数据专项与链脚本类型。新增并发测试阻塞实际签名任务的链权限核验，再读取真实实例状态、从两种名称拒绝第二条任务，确认未触碰文件／observer；释放后首条任务完成真实写入并恢复空闲。目录替换、未知实例拒绝与明文摘要不得覆盖链摘要均有验证。

## 重现

在 `runtime/fractalmind-envd`：

```sh
go test -race ./internal/runtimeadapter ./internal/boundedrun ./internal/nodecommand ./internal/sui ./cmd/envd
go test -c -o /tmp/fm-envd-native-execution-tests ./cmd/envd
```

在 `apps/fractalmind-app`，使用包含 `host::rebind_agent_at_version` 的现有隔离部署及新报告路径：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-native-execution-tests \
FM_ENVD_CHAIN_CONNECTION=1 FM_ENVD_AGENT_DISCOVERY=1 \
FM_ENVD_AGENT_IMPORT=1 FM_ENVD_NATIVE_DISCOVERY=1 \
FM_ENVD_NATIVE_EXECUTION=1 FM_ENVD_HOST_REJOIN=0 FM_ENVD_AGENT_REBIND=0 \
node --import tsx scripts/host-admission-localnet.ts DEPLOYMENT.json NEW_REPORT.json
```

此夹具的 Host 密钥为注入内存钥，App 传输／技术 journal 为注入内存实现，envd Host 接入摘要 journal 为真实磁盘。重建为同进程工厂重建，不是 OS 密钥库、安装后 UI 或进程重启验收。文件 Agent 支持明确的 1–3 个文本文件目标，不据此声称完成通用模型规划。

仍需完成 App 安全交接与旧执行停止、检查点终结、约束确认、明确继续、直接对话／介入与人验收闭环，以及真实云 Host、原生身份旅程和五平台安装运行。现有原生 App 的系统密钥库提示继续等待用户处理，没有使用替代存储或重启绕过。完整目标保持不变。
