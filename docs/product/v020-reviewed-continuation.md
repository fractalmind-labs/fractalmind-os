# v0.2.0 审批后的运行时继续与约束复核

依据 PRD v0.11、J11 与原型 v2；承接 [Host 审阅](v020-host-handover-review.md)和[链上审批](v020-host-handover-approval.md)。本增量使原生文件 Agent 在实际执行前消费匹配的物理预约，并在每次工具操作前读取当前审批政策。完整 App 安全交接仍未完成。

## 当前政策与明确继续

- envd 正式 Sui resolver 读取 `okr::HandoverPolicy`，核验动态字段的父对象、精确类型、UID／名称和版本。政策的协议／实例版本必须与当前 OKR／ManagedAgent 匹配，工具上限为 1–1000，Capability 预算不能超过它。缺失政策、读取异常和混合版本均拒绝。
- 原生 `assign` 不能使用没有 OKR 绑定的通用 Capability。旧结果／旧协议仍可作为历史读取与结算依据，但不能因此获得当前工具权限。
- 设备签名的任务增加 `handover_continue`：精确审批 ID、提案哈希、nonce。validator 和工具 guard 独立核对当前政策、协议、KR 游标、路径边界、预算及实例版本。工具 guard 要求存在 OKR 和政策，在每次工具操作前重新读取，并保持初始审批政策不变。
- 匹配的签名引用可以预约物理执行槽，但仅在 guard 验证当前链权限与本人 started Run 后才能消费原审阅预约。错误引用、授权变化、过期／被替换的预约不会开始工具；失败只释放本次执行槽，不消费另一条预约。配置名与原生别名仍共享物理槽。
- 审阅预约到期本身不授予执行权。到期后仍须有当前已审批 OKR、精确签名继续与当前链授权。Host 重启改变原生实例身份，不能从链上结果重建旧物理承诺。

SDK `NativeFileOkrRunner` 也读取当前政策，将同一引用加入签名票据，检查工具上限，在设备签名返回后及派发前重新核验。恢复出的排队票据保持原 Run，政策替换时停止派发；未知结果保持查询，不重发。

这是签名／运行时协议的明确继续。产品仍须通过 App 控制器／UI 展示精确任务、当前约束和费用，让用户完成继续操作。不能将注入测试 signer 当作安装后的 Human UI 验收。

## 实际链结果

[原请求实际链确认](evidence/v020-handover-continuation-localnet.json)包含 **9 项检查、14 笔已核实成功回执／实际费用、2 份不可变原对象确认**：

- 实际设备签名 → Sui 原子审批 → 当前政策工具上限 3 → 新 Run → Coordinator HTTP → 生产 envd → 原生工作区工具。
- 原 `APPROVED.md` 文件任务完成，3 次工具、实际内容哈希与预期一致；原 Run 状态 **SUCCEEDED**。
- OKR 全局预算 **spent=3、reserved=0**；原 Host 测量 **current=1** 保存到 Sui，OKR 仍为 ACTIVE、指标 **verified=false**。Host 工具验证不替代独立 Human 验证或最终验收。
- 继续 Run：`0x918fbdcda977b5b08e0d612472e43a456c5e127df013d13d402874801705035b`；原执行摘要 `pXZ3uQpkJFcttxztq3CsFvpg7wcsChgJYxJgp9TUSBU`；原测量摘要 `4xDHgWHvo4HvwEbLDENDV8TKeXLpy7k9XF7DhAHvnkfo`。
- SDK 在原请求期间解密核对原加密结果。后续只读核查原 Run／预算／指标及不可变结果、测量对象的 `previous_transaction`，未再次派发。

该报告明确 `harnessComplete=false`、`continuationValidationComplete=true`：原专项在立即读取测量目录时断言失败，未执行其尾部 Host／设备撤销回归。实际继续及原结果已通过后续只读核查；撤销门禁的既有独立证据见上一轮审批报告。不能称本轮完整 harness 正常退出或 v0.2.0 已完成。两份对象确认没有归档可核实的原费用，费用未知，未补造。

## 前序问题与测试

[前序记录](evidence/v020-handover-continuation-prior.json)保留两次独立夹具：

1. 首次缺少严格 runtime payload 解码器中的 `handover_continue` 字段。原继续 Run 最终 FAILED，预算 spent=0／reserved=0。响应正文未保存，未从原加密结果恢复错误文本；字段缺失来自代码检查，不冒称已经解密原错误。补齐字段后没有重放原命令。
2. 第二次已执行成功，Host 原响应与结果保存；立即读取观察列表为 0，断言失败。只读重查同一原 Run 后原测量可见，指标为 1、预算结算为 3／0。测试随后增加对同一原测量的有限只读等待；没有因为索引延迟重新派发或再创建第三个执行夹具。

[回归证据](evidence/v020-handover-continuation-unit.json)：SDK **118/118**、App **98/98**、Go 六包 race、SDK 类型／构建、App 构建及实际链脚本类型通过。本轮未修改 Move；使用上一轮已经验证的同一隔离包。

负向测试覆盖错误政策类型／父对象／名称、缺失／混合版本、政策和 Capability 上限、签名引用替换、每次工具前政策／权限／Clock／Run 改变、物理预约过期／替换、失败不消费另一条预约，以及签名等待／恢复票据期间政策替换。生产严格解码器通过实际链请求验证。

## 复现与剩余目标

沿用审批专项的独立部署 JSON 与全新证据路径，在 envd 目录编译当前辅助程序：

```sh
go test -c -o /tmp/fm-envd-handover-continuation-tests ./cmd/envd
```

在 App 目录按审批专项的环境开关运行，并增加 `FM_ENVD_HANDOVER_CONTINUE=1`、将 `FM_ENVD_JOIN_CLI_BIN` 指向上述二进制。报告存在时拒绝覆盖；收到未知结果／未可见目录先查原 Run 和原摘要。

仍需完成：App 交接／费用／明确继续 UI、旧任务停止及未知结果处理的完整旅程；新版 SDK runner 的实际链与持续自主推进；直接沟通／偏航调整、独立 Human 验证／最终验收；历史覆盖迁移、旧部署升级与类型来源；OS 密钥库／安装后 UI、云 TLS Host 及五平台。界面仍以原型 v2 为基线，本轮未改变界面。
