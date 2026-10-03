# v0.2.0 Host 确认的链上审批

依据 PRD v0.11、J11 及唯一界面基线 `fractalmind-app-prototype-v2`。本增量将已经实现的 Host 审阅签名接到 Sui 原子审批。完整 App 安全交接与 v0.2.0 尚未完成。

后续已实现[运行时政策复核与签名继续](v020-reviewed-continuation.md)，并验证原实际文件任务；下文剩余项对应本次审批提交的历史范围，App 完整旅程及其他总目标门禁仍待完成。

## 实现

`handover::confirm_okr` 在同一交易中完成以下检查与更新：

1. 重新核验 Human／DeviceGrant 的当前 read、operate、approve、manage_hosts 权限，以及组织、Host 成员、Coordinator 入口、ManagedAgent 和观察 Capability 的绑定。
2. 要求当前实例有完整执行目录、零未结控制；目录版本必须恰好等于 Host 审阅版本加一，包含原状态结果的结算，不能忽略期间其他命令造成的变化。
3. 核对精确 ManagedAgent／OKR／规格版本、原成功状态 Run、其结果记录及来源。Sui Clock 必须仍在原审阅窗口内，最长 60 秒；执行期限受 OKR 截止时间与 DeviceGrant 到期时间限制。
4. 使用链上 Host 公钥验签 Go／SDK 相同的 BCS 域。签名固定路径边界哈希、工作区、总预算、工具上限、一次性 nonce、各主体、原 Run、目录版本和观察时间。
5. 消费原审阅，推进 ManagedAgent 版本并确认控制，保存加密协议正文、激活／恢复 OKR 并推进协议版本。创建不可变 `handover::Approval` 与当前 `okr::HandoverPolicy`。任何步骤失败，整笔交易回滚。

重复消费在当前旧 Capability 的 ManagedAgent 版本核验处先被拒绝，审批也另有按原 Run ID 记录的消费标记。审批不派发工具，不能表示用户已经明确继续。

### 旧入口与预算

- 保留已发布 `host::import_agent`／`rebind_agent` ABI，但直接传入 `control_confirmed=true` 返回 `9211`；普通导入／重新关联仍为仅观察。
- 保留 `okr::activate` ABI，但新合约返回 `9410`；必须通过 Host 确认审批。SDK 原 builder 标记弃用，保留用于历史包。
- `okr::issue_capability` 要求当前 HandoverPolicy 的协议／实例版本匹配，以已审阅 `max_calls` 作为 Capability 预算上限。实测总 OKR 预算 **10**、能力上限 **3**；没有把总预算直接扩大为单次工具权限。
- SDK 增加 `handover.confirmOkr`、`getApproval`、`getPolicy`，分别用于构建审批与类型化读取。builder 验证历史 Host 签名，但不签名／广播，不证明来源仍有效；当前权威由合约核验。

既有对象布局未改变，新状态使用新类型／动态字段。本轮采用**隔离 localnet 新发布**，并未证明旧部署升级兼容、迁移或新类型的 upgrade origin 映射。旧 raw SDK 执行夹具需要改为新的审批流程，不能据其历史报告声称新包执行已经通过。

## 验证

- [实际链报告](evidence/v020-handover-approval-localnet.json)：**18 项检查、17 笔确认交易及原实际费用**。设备签名状态请求经过真实 Coordinator HTTP、认证 envd、原生工作区审阅、加密 Sui 结果；SDK 解密原结果并独立验签。审批后 Draft 变为 ACTIVE，ManagedAgent 版本从 1 变为 2，协议版本为 1。
- 审批对象 `0x326e08603c2dda71d13ef5919d183b1e69fe0d30af0e277fc6c2b05ea58eda67`；原审批摘要 `FrHWhiDgVAifYLLinPWE4kohaAVZNVDeK6evSbp4sgbX`。审批后实际签发 Capability，并读取确认其 `max_budget=3`。
- 五项负向预检由 validator 返回精确 MoveAbort：目录版本 `9503`、Host 签名 `9504`、直接控制 `9211`、旧激活 `9410`、签名重放 `9203`。测试分别核对包、模块、实际内部函数与错误码，不把 RPC／解析失败视作通过，也没有签名广播这些负向交易。
- [回归与构建](evidence/v020-handover-approval-unit.json)：SDK **115/115**、App **98/98**、Move **122/122**，Go 五包 race、类型检查及 SDK／App 构建通过。Move 独立核对 Go／SDK 公开测试向量的 BCS 字节和 Ed25519 签名。
- [部署记录](evidence/v020-handover-approval-deployment.json)保留包、注册表、发布／初始化摘要和实际费用。生产网络及用户钱包未改变，所有私钥均为隔离生成的测试钥。

### 前序失败保留

[原 Run 查询记录](evidence/v020-handover-approval-original-checks.json)保留六个独立夹具的原 Run、结果指针、审批状态、交易及后续只读核查：

1. 第一次漏开测试辅助程序的 HTTP 命令处理器，App 返回未知结果。原 Run 仍为排队、无结果；未重放。
2. 第二次 Host 审阅成功，但负向预检传入 TransactionKind，gRPC 要求完整 TransactionData，审批未广播。
3. 第三次构建器已返回预期 `9503`，测试没有处理构建阶段的 typed SimulationError，审批未广播。
4. 第四次两个篡改请求正确拒绝，直接控制 `9211` 出自内部 `rebind_agent`，测试错误要求外层函数名，审批未广播。
5. 第五次审批已确认，重放 `9203` 出自 `host::assert_agent_authority`，测试错误要求 `handover` 模块。原审批对象与 ACTIVE 状态保留，未重放审批。
6. 修正精确错误来源断言后，完整专项通过。各次使用新隔离实例，不续期旧确认，不从后一次结果推断前一次状态。

原审阅交易因小型 localnet 裁剪而查不到时，保留原摘要和成功 Run／原结果对象，费用明确未知；不能计入已核实的 17 笔费用回执。

[前序发布记录](evidence/v020-handover-approval-publication-prior.json)另保留第一次发布已返回确认、但解析失败前未保存完整回执的事实。原摘要后来被裁剪，费用未知。第二次为独立测试发布；其初始化先因可见性延迟在广播前失败，随后复用同一个包与注册表完成初始化，没有重新发布第二个包。

## 复现

先按 `sdk/scripts/prepare-localnet-package.py` 构建并发布当前隔离包、初始化身份注册表，保存对应部署 JSON。不能将本轮包 ID 用作新链或用户生产部署。然后：

```sh
# runtime/fractalmind-envd
go test -c -o /tmp/fm-envd-handover-approval-tests ./cmd/envd

# apps/fractalmind-app；使用独立部署与全新证据路径
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-handover-approval-tests \
FM_ENVD_CHAIN_CONNECTION=1 FM_ENVD_AGENT_DISCOVERY=1 FM_ENVD_AGENT_IMPORT=1 \
FM_ENVD_NATIVE_DISCOVERY=1 FM_ENVD_NATIVE_EXECUTION=0 FM_ENVD_DEVICE_COMMAND=0 \
FM_ENVD_HANDOVER_APPROVAL=1 FM_ENVD_HANDOVER_REVIEW=0 \
FM_ENVD_HOST_REJOIN=0 FM_ENVD_AGENT_REBIND=0 \
node --import tsx scripts/host-admission-localnet.ts DEPLOYMENT_JSON NEW_REPORT_JSON
```

专项开关启用正式命令处理器与生产原生执行器，但本专项没有派发 assign 或工具。报告存在时拒绝覆盖。

## 完整目标仍需完成

- App 安全交接控制器／UI：当前旧任务处理、精确约束与费用确认、原 Run 未知结果查询、原子审批及用户明确继续。
- 运行时读取当前 HandoverPolicy，并将 nonce／提案哈希与物理预约及后续执行关联；审批不能自动释放预约或开始工具。还需要检查未绑定 OKR 的控制入口与历史 Capability，避免绕过已审阅边界。
- 历史实例执行覆盖迁移、既有 ACTIVE OKR／旧能力失效、真实升级与类型来源映射。
- 连续自主推进、对话／偏航介入、独立证据验证与 Human 验收。
- OS 密钥库与安装后 UI、云 TLS Host、Mac／Windows／Ubuntu／iOS／Android 安装验收。

本轮没有修改界面，注入的 NativeInvoke 与内存 App journal 不替代上述门禁；完整目标保持不变。
