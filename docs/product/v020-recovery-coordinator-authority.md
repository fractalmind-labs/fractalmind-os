# v0.2.0：身份恢复后的 Coordinator 独立撤权验收

依据 [#24](https://github.com/fractalmind-labs/fractalmind-os/issues/24)、[#35](https://github.com/fractalmind-labs/fractalmind-os/issues/35) 与总验收 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40)；基线 `7afe3d7`。本增量补齐恢复后绕过 App 预检的实际 HTTP 验证，不修改生产鉴权逻辑。

## 检查方法

在实际 OKR／Agent 对话工作历史的双次恢复联测中，每一轮分别执行：

1. 恢复前，旧设备通过正式 `CoordinatorReadClient` 完成受保护读取，验证原 Host 签名观测仍有效。
2. 为另一条读取请求取得新挑战，正式控制器验证 Coordinator 签名与链上绑定。实际 OS 设备签名器生成并独立验证精确个人消息签名；挑战不发送到受保护读取入口。
3. 独立报价、确认费用及原生签名恢复身份，仅广播一次，等待同一 Human 的新 generation 和设备授权可见。
4. 绕过 App 授权预检，直接向实际 Coordinator 发送上述旧签名 HTTP 请求。检查请求发送及响应时间均早于原挑战过期，返回 **403 / device_read_rejected**。
5. 旧设备直接请求新挑战，返回 **403 / device_authority_unavailable**。新设备随后通过正式控制器完成受保护读取及 Host 观测验证。

两次恢复分别使用原设备和第一次恢复后的设备作为旧设备。有效期没有延长，没有复用已消费 nonce，没有通过客户端拒绝代替服务端结果。报告只保存公开权限定位、时间、请求哈希和结果，不保存证明签名、恢复码或私钥。

## 实际证据

- [原始联测报告与可追溯元数据](evidence/v020-recovery-coordinator-authority-localnet.json)：**24 项检查、59 笔 App 确认交易**，联测退出 0。实际 OS 测试密钥库、Sui localnet、生产 Coordinator／envd 和已开启 Go race 的原 Host 测试二进制；二进制及未修改 Go 夹具的哈希与前次记录一致。
- 两轮旧设备请求及新挑战均实际返回 403；拒绝发生时分别还剩约 **59 秒**挑战有效期。独立 OS 个人消息签名验证、未消费挑战和恢复前成功读取排除格式、重放及到期拒绝。
- 原有双次恢复检查仍通过：**38 份历史／当前正文哈希、9 条消息**、两个已验证 KR／最终验收、原 Run／证据与消息来源草稿均可重建；恢复新增派发及模型调用 **0**，原 OKR 工具账本 **6 已用／0 预留**。两轮各一笔恢复广播，最后实际撤销 Host，测试凭据全部清理确认。
- [严格类型、来源哈希与原生 UI 状态](evidence/v020-recovery-coordinator-authority-validation.json)保留本轮实际执行及证明范围；生产 App／SDK／Move／Rust／Go 未修改，没有把既有 App **229/229** 或 Go 回归计作本轮重跑。

## 复现

保持隔离 localnet 和三包部署运行，在 `apps/fractalmind-app` 中使用新的报告路径：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-workload-recovery-race-app-tests \
node --import tsx scripts/native-app-execution-localnet.ts \
  /tmp/fm-scheduled-queue-three-package-deployment-r1.json \
  /tmp/fm-native-recovery-coordinator-authority-new.json \
  --human-sequence --direct-permission --direct-dispatch --direct-app \
  --model-fixture --message-okr --workload-recovery
```

已有报告或进度路径会拒绝启动，不得重放未知原请求。若修改 Go 夹具，必须先重新构建所用测试二进制。

## 剩余验收

本增量证明 Coordinator 受保护读取及挑战签发独立撤权。**尚未证明**绕过 Coordinator 的实际 Host 对恢复前有效、未执行命令的独立拒绝，也未覆盖所有命令派发端点。

本轮 Computer Use 只读检查再次返回 Mac 锁定。安装后完整 UI／IndexedDB 清空、实际进程／物理 Host 重启、真实语言模型、云 TLS Host、手机沟通审批、main 旧包升级仍未完成。模型继续为合成 HTTP 夹具，Host 凭据和技术 journal 为隔离内存，Human 决定由脚本给出。完整 v0.2.0 及 #40 保持未完成。
