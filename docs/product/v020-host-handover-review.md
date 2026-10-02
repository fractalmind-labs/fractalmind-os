# v0.2.0 Host 接管约束审阅

依据 PRD v0.11、J11 与唯一界面基线 `fractalmind-app-prototype-v2`。本增量完成 Host 对精确提案的审阅和签名证据；完整 App 安全接管与 v0.2.0 仍未完成。

## 已实现的链路

1. 设备签名的 `status`／`observation` 命令携带 `handover_review`。提案固定 ManagedAgent／OKR／规格版本、工作区、工具路径、工具预算、执行截止时间、一次性 nonce 及最长 60 秒的审阅窗口。既有一次性 HTTP 挑战绑定完整请求。
2. Host 直接读取正式类型和当前 Sui 对象：组织、Human、DeviceGrant、管理角色、Host 成员／入口、实例、草稿或暂停 OKR 和执行目录。设备须同时具备 read、operate、approve、manage_hosts。缺失目录保持覆盖未知；任何未结控制拒绝审阅。
3. 原生适配器核实当前实例连续性和物理空闲，打开实际工作区根及允许的路径，拒绝不存在的目录、越界和符号链接，随后关闭句柄。**审阅没有调用工具。** 同一配置名称和发现别名共用短期内存预约，在来源二次核验及后续确认窗口内阻止新任务开始。
4. 正式结果存储器再次核对精确签名命令／Run、Host 和链 Clock，再用 Host 密钥签署限定 BCS 域的确认。确认作为原状态命令结果的一部分加密写入 Sui，不写业务缓存或独立服务。
5. SDK 独立验证 Go 的 BCS 字节／提案哈希及 Host Ed25519 签名。历史结果恢复保留原签名、观察时间和有效期。验签历史证据不表示当前可执行；过期确认必须拒绝用于后续授权。

原生状态带出 `review_pending` 和原 `review_expires_at_ms`，与物理 `idle` 分开。历史结果中的这些值只是当时快照。预约仅在内存中，按单调时钟过期；失败只释放本次预约，不能释放后来替换它的预约。Host 重启不会从链结果恢复物理承诺。

## 确认格式与后续审批要求

提案域为 `fractalmind.handover-proposal.v1`；确认域为 `fractalmind.handover-acceptance.v1`。确认覆盖执行 ID、组织、Human、Grant、Host 成员／入口、Host 地址、原生实例 ID、完整提案哈希、执行目录版本及观察时间。版本和预算采用完整 u64 十进制字符串；时间必须是 JS 可精确表示的正整数。

当前合约完成状态命令会推进执行目录版本一次。实测审阅时版本 **10**，发布已结状态结果后版本 **11**。后续审批须匹配这个确定的结算增量及精确已成功 Run，不能拿旧版本当作当前版本，也不能忽略期间其他执行目录变化。

本轮**没有新增消费确认的 Move 审批入口，没有激活 OKR，没有授权用户继续执行**。后续必须同时核验 Host 确认、当前目录、原生连续性、各逻辑版本与 Clock，并通过链上原子审批和用户明确继续。当前原始 `control_confirmed` SDK 测试入口依然不能作为完整产品安全接管的证明。

## 实测证据

- [实际链报告](evidence/v020-handover-review-localnet.json)：**24 项检查、29 份成功交易回执／实际费用，另有 4 份原结果对象确认**。四笔原交易查询已被小型 localnet 裁剪，费用保持未知，没有重放或补造费用。
- 新审阅经过实际 Coordinator HTTP、认证 envd、完整链读取和工作区核验；SDK 读取、解密原不可变结果并独立验签。新 OKR 保持 Draft，ManagedAgent 版本未改变，重复 `send` 在第二次 HTTP 前拒绝。
- 审阅执行：`0xd8a596ab45d3ff71ab4547d7344d3548ab86fb471ea11a15bd2bffe4dfff12e9`；原结果摘要：`AaoULDaP9iktiRAyo7Wd8qiSwij7MDmFedxCQPN6r5wj`。摘要与对象确认记录保存在上述报告。
- [回归记录](evidence/v020-handover-review-unit.json)：SDK **114/114**、App **98/98**，Go 五包 race、SDK 类型／构建、App 生产构建和实际链脚本类型通过。公共非生产测试向量由 Go 生成，SDK 独立核验，覆盖各约束和来源字段篡改。
- 负向测试包括目录缺失／未结控制／来源变化、错误成员与绑定、管理权限不足、物理忙、替换工作区、unsafe／missing／symlink 路径、发布时过期或缺失 Clock、伪造设备／Host 证明及加密正文持钥者篡改。

链验收使用隔离生成的内存测试钥和注入的 NativeInvoke，不能替代 OS 密钥库、安装后 UI、云 TLS Host、五平台及完整自主／对话／人工验收门禁。HTML／界面本轮未更改。

## 复现

在既有独立 localnet 与当前部署上构建生产测试辅助程序：

```sh
# runtime/fractalmind-envd
go test -c -o /tmp/fm-envd-handover-review-tests ./cmd/envd
```

随后从 `apps/fractalmind-app` 运行，参数必须是现有隔离部署文件和**全新**证据路径：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-handover-review-tests \
FM_ENVD_CHAIN_CONNECTION=1 FM_ENVD_AGENT_DISCOVERY=1 FM_ENVD_AGENT_IMPORT=1 \
FM_ENVD_NATIVE_DISCOVERY=1 FM_ENVD_NATIVE_EXECUTION=1 FM_ENVD_DEVICE_COMMAND=1 \
FM_ENVD_HANDOVER_REVIEW=1 FM_ENVD_HOST_REJOIN=0 FM_ENVD_AGENT_REBIND=0 \
node --import tsx scripts/host-admission-localnet.ts DEPLOYMENT_JSON NEW_REPORT_JSON
```

报告存在时拒绝覆盖。已发送但结果未知时先查询原 Run／摘要；不能以再次运行新夹具掩盖原结果。
