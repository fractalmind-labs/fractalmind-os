# v0.2.0：升级后的 App／envd 执行与恢复

依据 [#23](https://github.com/fractalmind-labs/fractalmind-os/issues/23)、[#25](https://github.com/fractalmind-labs/fractalmind-os/issues/25)、[#30](https://github.com/fractalmind-labs/fractalmind-os/issues/30)、[#34](https://github.com/fractalmind-labs/fractalmind-os/issues/34)、[#35](https://github.com/fractalmind-labs/fractalmind-os/issues/35)、[#38](https://github.com/fractalmind-labs/fractalmind-os/issues/38) 和总验收 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40)。实现基线 `d4a9f81`，复用 [main 原包实际兼容升级](v020-main-upgrade.md) 的 R8 隔离 localnet 部署，没有操作已有公共部署或用户 UpgradeCap。

## 生产接线

App 的身份创建／恢复／配对、设备验证、组织与 Host 目录、Agent 导入、控制与交接权限、正文指针／历史、结果及人工验收，统一按具体 datatype 调用 SDK 的 `coreType`。回执／事件筛选先读取精确类型，再筛选同步集合；配对请求回执解析改为异步。原对象 ID、共享／不可变归属、BCS、组织、代次、版本、来源和权限检查保留。同步原包配置仍用于标识部署及传递调用配置，不再代表所有核心类型。

envd 新增 `NewChainAuthorityResolverForPackage` 和不可变包 BCS 读取：核对包元数据、ID／版本、不可变所有权、模块与类型表及原组织类型来源，成功后缓存精确调用包的来源表。当前类型加载失败不会缓存可用权限；后续明确读取可以重查。Host 准入、Coordinator／worker 连接、设备读取及执行工厂均接通当前调用包和原发布包。

动态字段同时解析键类型、值类型和用于 ID 推导的 BCS TypeTag。泛型字段中的核心 `FieldKey` 与独立扩展 `Witness` 分别保留各自来源；只改校验字符串仍会查错字段。原 `RemoteCapability` 与同模块新增预算／执行约定字段可以属于不同包。缺少某个类型来源直接拒绝，不能把它当作无目录、无权限约定或无预算。

核心／OKR／direct 的调用地址与类型配置保持分开；本增量覆盖 main 核心包升级，扩展在该部署首次发布，不声称已覆盖未来扩展包新增类型的多次升级。

## 实际升级部署联测

只读 Go 预检从原 R8 包确认 **132 个 datatype** 的实际来源，**0 交易**。

### 完整控制器、执行、恢复与撤权

[R2 原始报告](evidence/v020-mixed-origins-app-envd-localnet.json)：**26 项检查、65 笔 App 确认交易，退出 0**。使用真实 OS 测试密钥库、Sui 和开启 race 的生产 envd／Coordinator；独立新 Human／组织使用升级后保留原来源的 Organization／RemoteCapability 与新增身份／Host／Run 类型。

- 原生签名创建身份／组织、一次性 Host 邀请兑换、当前成员目录和有限 Agent 纳管通过。
- 两个文件 KR 由实际 envd 执行，独立测试 Human 验证与最终验收；工具 **6 已用／0 预留**。
- 直接消息、精确旧请求去重、常驻权限及单次审批、零工具状态／问题、加密原结果和消息转 DRAFT 来源通过；常驻 **4／0**、单次累计 **6／0**。
- 两次仅凭恢复码定位并恢复同一 Human，重建 **38 份正文哈希、9 条消息**、两个已验证 KR／最终验收及来源草稿。内容钥代次与设备资格推进；恢复阶段新增派发、模型调用及工具消耗为 **0**。
- 实际 Coordinator 独立拒绝仍未过期的旧设备签名读取及新挑战；绕过它提交同一旧设备 QUEUED 状态命令，生产 Host 独立返回 revoked，原 Run／Capability／零预算不变。新设备另行签名取消原 Run 并结算。
- 最终 Host 撤销、原历史读取及测试凭据清理确认。

这次联测没有拿 R8 已迁移旧组织的原内存密钥充当 OS 设备。旧组织的同 ID／BCS 与 Cap 迁移证据仍由原 R8 报告提供；本次证明同一升级部署的真实 App／Host 新工作流程。

### Sui 队列与预授权 KR

[独立队列报告](evidence/v020-mixed-origins-scheduled-localnet.json)：**17 项检查、19 笔 App 确认交易，退出 0**。预授权两个顺序 KR 后，执行上下文关闭，生产 Host 从 Sui 执行原命令；Coordinator 命令派发 **0**。独立 Human 验证推进下一 KR，最终另行验收；预算由 **0 已用／6 预留**变为 **6／0**。

空技术 journal 重建精确票据、Run、不可变派发表与验证事实，裁剪后的回执保留原 digest／unknown，不取得重发授权。最后撤销 Host 并清理测试凭据。

## 回归、构建与原生窗口

[验证记录](evidence/v020-mixed-origins-validation.json)：App **231/231**，App 类型／浏览器构建、三个相关 Go 包的 race、三个脚本严格类型及当前普通／race Host 测试二进制通过。新增检查覆盖三次版本的 App 字段来源、错误指针、缺失元数据；Go 原 Capability／新字段、泛型 witness、错误元数据不缓存、缺失类型拒绝及实际 SDK BCS 格式／篡改拒绝。

SDK／Move／Rust 生产源码本轮未改，未计作全量重跑。SDK 沿用 `d4a9f81` 的 **161/161** 来源固定证据。

[当前 macOS debug 包](evidence/v020-mixed-origins-native-bundle.json)已重建并本地 ad hoc 签名、严格验证通过，没有 Apple 发布签名或公证。[实际窗口与重启](evidence/v020-mixed-origins-native-restart.json)确认旧进程退出、新进程在隔离环境启动、公开连接配置保留，并从 Sui 重建原身份／组织。设备钥读取仍等待系统授权；Computer Use 拒绝访问 SecurityAgent，已请求用户手动处理，**不能计为钥匙串恢复或设备验证成功**。

## 原失败保留

[R1 与原 Run 只读复查](evidence/v020-mixed-origins-prior.json)：R1 的 **17 项检查／57 笔确认交易**在测试恢复助手的旧类型回执筛选处失败。原 QUEUED Run 已确认，测试钥已清理；没有重发或拿 R2 归属其未完成恢复／撤权。

只读复查 **0 广播**：原 Run 仍 QUEUED、预算 **0／0**、Human generation 1、Host 未撤销；当前回执已被节点裁剪，保留原 digest／unknown。前两次复查分别停在回执已裁剪和临时读取脚本误断言 BigInt，原日志保持。这个独立测试身份的原排队状态尚未结清，不能宣称已取消或已清理全部链上测试对象。

## 复现

在 `runtime/fractalmind-envd` 构建当前实际 Host 测试入口：

```sh
go test -race -c ./cmd/envd -o /tmp/fm-envd-mixed-origins-race-live
```

公开部署 JSON 必须包含原 R8 `chain`、当前 `packageId`、原 `originalPackageId`、`registryId` 与两个扩展包 ID，保留隔离 RPC `127.0.0.1:29000`／faucet `127.0.0.1:29123`。在 `apps/fractalmind-app` 使用两个新报告路径：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-mixed-origins-race-live \
node --import tsx scripts/native-app-execution-localnet.ts \
  /tmp/upgraded-deployment.json /tmp/new-upgraded-workload.json \
  --human-sequence --direct-permission --direct-dispatch --direct-app \
  --model-fixture --message-okr --workload-recovery --recovery-authority

FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-mixed-origins-race-live \
node --import tsx scripts/native-app-execution-localnet.ts \
  /tmp/upgraded-deployment.json /tmp/new-upgraded-queue.json \
  --human-sequence --scheduled-queue
```

已有报告／进度路径拒绝启动。审批仍是明确脚本测试决定；模型是合成接口，Host 凭据为隔离内存。本增量没有实际云 Host、手机或运行中任意工具回滚的证明。

## 整体剩余门禁

完整安装后 UI／清缓存恢复、系统授权后的设备验证、实际 Host／物理设备重启、真实模型、云 TLS Host、手机沟通审批、公共旧部署升级及旧开发单包历史迁移仍需验收。完整 v0.2.0／#40 保持进行中。
