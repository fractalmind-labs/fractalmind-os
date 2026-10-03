# App 原生 Host 审阅票据与恢复

依据 PRD v0.11／原型 v2，承接[原生审批控制器](v020-app-handover-approval.md)。本增量将确切审阅请求、计划和原 Run 保存到 Sui，并接通只读恢复及原接受证明读取。完整审阅／费用／继续 UI 仍需完成。

## 原子准备与明确派发

`HandoverReview` 固定组织、设备授权及公开 attempt UUID。输入为本设备签署的 `status`／`observation` 命令、确切成员／入口／实例和原生文件计划。当前能力必须是组织与设备绑定的单次 status 观察能力，具备匹配的 Human 世代、授权／成员／实例版本；不能使用未绑定设备、已消费、委托、控制或带工具预算的能力。此能力的发行费用界面尚未接通。

控制器核对当前 read／operate／approve／manage_hosts 权限，完整执行目录与零未结控制执行，原生实例／工作区、OKR 及当前规格版本、指标、路径、预算和期限。范围检查复用[原生计划校验](v020-app-handover-approval.md)。原请求过期后不能自动更新 nonce／签名／提案；需要新的明确请求。

通过 OS 密钥库加密 `fractalmind.handover-review-ticket.v1`，保存原签名命令、具体计划及规格对象 ID。同一 PTB 完成单条结果密钥授予、原 Run 预留和 checkpoint 票据保存；任何一步失败则不留下部分业务准备。报价、提交、原生签名前与返回后都复核当前固定状态。JS 不取得组织密钥；quote 只在内存，同一控制器并发提交同一 quote 合并为一次操作。

`prepare`／`submit` 先查原技术交易请求；原 confirmed／failed／unknown 均优先返回，不因当前输入或权限变化而重建请求。`send(true)` 是单独明确的观察派发入口，要求当前原 Run 排队且未停止、原设备／授权仍匹配；再次核验当前规格、能力与 Host 指针后使用设备鉴权 Coordinator 通道。同一控制器的派发入口只允许一次；丢失响应继续查原 Run。此方法尚未完成实际 envd 联测或安装后 UI 验收，不代表跨重启派发决策已交付。

新增 `NativeCommandResults.preflight` 只核验既有命令的当前权限和指针，不封装新的结果密钥、不构建交易、不预留新 Run。它供派发前检查使用，避免以新的准备操作代替原请求查询。

## 票据恢复与来源

`restore` 默认只读。保留公开 attempt UUID、使用空技术 journal 重建控制器后，通过精确链上记录键定位原票据，再由当前获授权设备调用 OS 密钥库解密。核验票据 schema、原签名、计划／提案边界、作者、完整执行目录及唯一匹配的 Run；命令指纹、能力、Human／Grant／版本、成员、目标、时间、nonce／幂等键及零工具预算必须一致。

准备摘要仅来自原不可变票据对象的 `previousTransaction`，不能来自正文或替代 Run。若技术 journal 提供原摘要，它必须与票据创建摘要相同。重新读取当前票据指针及当前读取权限后才返回。恢复不会生成命令、重新报价、派发、审批或继续。未读取到票据返回 `ticket_not_observed`，不证明原请求未发生。

`readRecordPointer` 通过已核验 RecordIndex 内的确切 RecordKey 读取，分页为空不决定票据是否存在。只有派生 UID 完全匹配的缺失子字段可作为暂未观察到指针；缺失根目录、其他对象错误、类型／指针／密钥版本异常和读取期间索引变化均拒绝。完整 Run 目录仍须通过 SDK 总数校验，不完整分页保持错误，不能当作无旧任务。

`readAcceptance` 从恢复出的原票据读取原 Run 的不可变结果，使用正式 NativeExecutionResults 验签及新鲜度检查。原接受证明可供审批控制器使用；恢复票据不授予执行权，审批后的继续仍需独立动作。

## 证据与前序记录

- [App 回归与构建](evidence/v020-native-review-ticket-unit.json)：**125/125** 通过，新增 9 组覆盖原请求优先、并发／伪造 quote、加密／报价／签名期间变化、票据／Run／作者／摘要替换、精确缺失与目录变化、无新增交易的既有命令 preflight。补齐最终票据字段核验后，5 组专项及类型检查再次通过。控制器单测的权限／上下文、费用及正文服务为受控夹具。
- [最终实际 OS＋localnet](evidence/v020-native-review-ticket-localnet.json)：**14 项检查、13 笔确认交易与费用**。正式控制器原子保存票据／结果密钥／原 Run；同一公开 attempt UUID、空 journal 重建后读取同一原命令和计划，从原不可变对象获得准备摘要。正式控制器恢复票据后读取 Host 夹具原接受证明，并完成原生原子审批／加密约定读取；没有 Host 派发或继续 Run。测试凭据已清理。
- 原票据 `0x83164c32d6dab2711f490744519eb0f0ed02581752b39f72e027d25ef176a291`，准备摘要 `EPtXQGM6sLRKqTy59dtNZSGUZNtUMk8xwa98eeZD3zQN`。后续历史裁剪后 query 为 unknown，原成功费用回执与链上业务对象分别保留，无重放。
- [三份前序记录](evidence/v020-native-review-ticket-prior.json)：第一次按目录分页找票据，交易确认后未观察到行而终止；第三次完整 Run 目录总数 1／分页 0，SDK 拒绝后终止。两次均保留 9 笔原确认交易并清理测试凭据，后续只读证实原票据／原 Run 存在且排队、无结果／无派发，未取消或结清这些原 Run。第二次中间实现 14 项／13 笔通过。最终使用精确票据键，并在 harness 对同一恢复对象作有时限只读等待；不重放原请求。

App 目录复现，必须使用全新报告路径：

```sh
node --import tsx scripts/native-command-results-localnet.ts DEPLOYMENT.json NEW_REPORT.json --review-ticket
```

本专项使用隔离原生子进程及内存 journal，Host 接受证明由夹具签署／发布，没有真实物理预约或 Coordinator 派发；不能代替安装后 IPC／费用确认／持久日志恢复／Human 审批旅程。清空 journal 仍保留公开 attempt UUID，不等于已完成完全清空客户端缓存后的票据发现与选择 UI。

仍需接通观察能力发行、原票据发现与选择、审阅请求／费用／审批 UI 和独立明确继续，合并实际 envd＋原生 App 联测；继续原生 runner、持续自主／对话／人验收、云 Host、历史升级迁移及五平台。v0.2.0 整体保持未完成。
