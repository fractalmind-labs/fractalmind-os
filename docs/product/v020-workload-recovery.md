# v0.2.0：真实执行历史的双次身份恢复验收

依据 [#24](https://github.com/fractalmind-labs/fractalmind-os/issues/24)、[#26](https://github.com/fractalmind-labs/fractalmind-os/issues/26) 和 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40)。本次补齐已有正式恢复控制器与实际 Agent 工作历史的联测，生产恢复算法、合约和界面没有改版。

## 实际旅程

沿正式 App 控制器、OS 测试密钥库、现有三包 Sui localnet 和生产 envd／Coordinator，先完成两个 KR、独立 Human 验证及最终验收，再执行固定实例消息、单次超权审批和对话转 OKR 草稿。随后执行两次恢复：

1. 每次在新的 `test-*` OS 配置导入仅存在内存中的备份恢复码。控制器只接收恢复码对应的原生凭据和公开部署配置，Human ID 从链上恢复目录定位。旧 Human／组织 ID 只用于测试比较。
2. 原生生成独立设备和替换恢复凭据。未确认备份不能报价，重新加载不再次显示新码。每次分别审阅 Gas、通过旧恢复地址原生签名并广播一次。
3. Human ID、组织、Host 成员／绑定和受管理 Agent 保持原对象；Human 代次和组织当前密钥版本分别从 1 推进到 2、再到 3。旧设备的当前权限核验及预先准备的客户端读请求被拒绝。旧码和空 journal 的消费后恢复不能重放。
4. 使用新控制器和空技术 journal，从链上索引重建当前目录。两次均核对原 **38 份当前及历史正文 SHA-256**、**9 条原消息**、原 Run／加密结果、两个已验证 KR 和独立最终验收，以及原对话来源和版本 2 的未执行草稿。
5. 第一次恢复的新设备余额为零，费用管理器拒绝新草稿报价；夹具明确领取测试 SUI 后，再独立确认费用／签名，写入 key v2 的新 DRAFT。原设备即使保留历史密钥封装也不能解密这份新正文；正式 App bridge 返回 `invalid_envelope`。第二次恢复仍可读取这份 v2 草稿，当前内容钥为 v3。
6. 第二台新设备也先验证自付费用不足，再由夹具明确领取测试 SUI。该设备另行报价、签名撤销原 Host；实际路由和 worker 心跳拒绝撤销后的访问，当前 Human 仍能读取原历史结果。

旧设备凭据仅用于独立负向检查，不参与恢复交易授权；检查后实际删除旧 OS 测试凭据，结尾清理全部测试配置。新恢复码／密钥和正文不写入报告。

## 证据

- [R4 原生／实际链／envd 报告](evidence/v020-workload-recovery-localnet.json)：**22 项检查、59 笔 App 确认交易**，两次恢复各广播一次，测试凭据清理确认。Host 测试二进制开启 Go race，实际联测退出 0；每笔 App 回执记录摘要和实际 Gas，Host 自己提交的链交易不计入这 59 笔。
- 两次恢复保留原工作，不产生新的 Agent 派发或模型请求；原 OKR 工具预算 **6 已用／0 预留**。对话常驻预算 **4／0**、单次批准累计 **6／0** 保持；新草稿仍 DRAFT、没有 Run。
- [类型／编译／回归记录](evidence/v020-workload-recovery-validation.json)：两个 TypeScript 脚本的严格类型、Go 普通与 race 二进制构建、四包 race 回归、格式检查通过。App／SDK／Move／Rust 生产源码未变；此前 App **229/229** 仍引用原证据，没有计作本轮重跑。
- [R1–R3 原失败及只读复查](evidence/v020-workload-recovery-prior.json)保留原状态、确认摘要／费用与关键对象，没有重放原请求。R1 的联测 Host 仅在连接时发送一次心跳，超出 **60 秒**观测期限后在线断言失败；夹具加入实际周期签名观测，生产有效期不变。R2 恢复成功后因新设备零余额停止。R3 已写入新 v2 草稿且原生拒绝旧密钥，测试却直接比较未规范化的错误字符串；R4 通过正式 App bridge 检查明确错误类型。前三轮均未完成最终 Host 撤销，不把后续成功归属给它们。

## 复现

使用已发布的隔离三包部署报告和运行中的 localnet（RPC `127.0.0.1:29000`，faucet `127.0.0.1:29123`）。从仓库根目录构建原生测试辅助程序：

```sh
cargo build --offline --manifest-path apps/fractalmind-app/native/Cargo.toml --example device-test-helper
```

在 `runtime/fractalmind-envd` 中：

```sh
go test -race -c ./cmd/envd -o /tmp/fm-envd-workload-recovery-race-app-tests
```

在 `apps/fractalmind-app` 中，输出路径必须是新的；已有输出／进度文件会拒绝启动，不能覆写或重放未知请求：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-workload-recovery-race-app-tests \
node --import tsx scripts/native-app-execution-localnet.ts \
  /tmp/fm-scheduled-queue-three-package-deployment-r1.json \
  /tmp/fm-native-workload-recovery-new.json \
  --human-sequence --direct-permission --direct-dispatch --direct-app \
  --model-fixture --message-okr --workload-recovery
```

`--workload-recovery` 强制包含前面的已验收 OKR、真实直接执行和消息来源草稿，不允许单独运行空身份恢复后冒充业务恢复通过。测试 Host 仅在该选项下每 10 秒重新扫描并沿生产 WebSocket 路径发送新签名心跳；没有延长观测、消息或 Capability 期限。

## 仍未证明的要求

本次是正式控制器与原生子进程的真实链联测，技术 journal 为内存；没有操作安装后 WebView 的 IndexedDB／localStorage 清空，也没有验证窗口／物理主机重启。Computer Use 本轮读取原生窗口仍返回 Mac 锁定。

Host 钥为隔离内存提供方，Human 钥使用实际 OS 测试服务；审批决定由脚本明确给出。模型是合成 Messages HTTP 夹具。安装后完整交互、真实模型、云 Host、手机、实际清缓存重启恢复，以及原 main 发布包升级／对象迁移仍待验收。旧设备在客户端预检时被拒绝的事实不单独证明绕过客户端后的 Coordinator HTTP 拒绝。

完整 v0.2.0 目标保持未完成，见[实现与验证记录](fractalmind-app-v020-validation.md)。
