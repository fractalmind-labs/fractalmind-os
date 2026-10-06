# v0.2.0：原生 Host 进程重启与原结果恢复

对应 [#33](https://github.com/fractalmind-labs/fractalmind-os/issues/33)、[#34](https://github.com/fractalmind-labs/fractalmind-os/issues/34)、[#38](https://github.com/fractalmind-labs/fractalmind-os/issues/38) 和总验收 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40)。基线 `180270c`，复用 [main R8 隔离升级部署](v020-main-upgrade.md)。本增量修复 App 目录读取的一致性问题，补充实际 OS Host 身份与进程重启的联测。

## 生产修复

原子保存继续执行票据后，RecordIndex 可能在一次点查询的前后两次读取之间变为可见。原目录读取正确地返回 `snapshot_changed`，但 runner 随即退出，未能读取已经确认的原票据。

runner 现在最多尝试 **6 次只读查询**，间隔 **50 毫秒**，只重查 `snapshot_changed`。每次读取前后及等待前核验调用范围；错误类型、缺失根对象、RPC 错误、失效上下文和持续变化仍拒绝。其他原有严格读取调用保持。此路径不签名、不提交交易、不派发命令，也不把查询不到的记录当作执行许可。

三项回归分别覆盖一次变化后稳定、来源／RPC／上下文错误，以及持续变化达到上限。首次修复遗漏了其他调用使用的严格读取导入，导致构建与 R2 联测失败；已保留导入并修正，失败记录没有计作通过。

## 实际重启验证

[R3 原生联测](evidence/v020-native-host-process-restart-localnet.json)：**12 项检查、17 笔 App 确认交易，退出 0**。Human 与 Host 使用隔离生成的 OS 配置；Host 使用生产 macOS Keychain 提供者和生产执行器工厂，没有注入内存 Host 身份。

1. 正式 App 控制器创建 Human／组织、登记实际 Coordinator 和单次邀请，生产 envd 兑换邀请。丢失兑换响应后只查原摘要，Host 准入广播 **1 次**。
2. 从实际 Host 发现并导入原生文件 Agent，完成审阅、独立审批、两个 KR 的顺序执行／验证和单独 Human 最终验收。Human 决定由脚本明确作出，未计作安装后 UI 操作。
3. 原 Host 进程退出 **0** 后启动新进程，PID 不同。新进程使用相同 OS profile，签名／加密公钥和地址保持；从原链与组织重建同一成员资格，没有新邀请或重新入组。
4. 新进程通过生产 ChainExecutionStore 解密原不可变结果，原结果 digest 和正文 SHA-256 一致。实际进程实例 ID 改变，原 Run／文件内容与纳秒修改时间保持，预算仍为 **6 已用／0 预留**。
5. 原已完成 OKR 命令被拒绝。App 另行签名撤销原 Host 成员后，新进程的当前连接查询与原命令均拒绝；Human 仍能读取原历史结果。两个进程退出，生成的 Host／Human 测试凭据清理并确认不可读取，临时工作目录删除。

[独立零广播复查](evidence/v020-native-host-process-restart-validation.json)确认原成功结果 Run、完整目录中 **3 个成功 Run／0 个未结控制执行**、已人工验收 OKR、预算 **6／0** 和已撤销原成员资格。回归包含 App **234/234**、App 类型／生产浏览器构建、当前夹具严格类型，以及 Go 三个包 race。实际 helper 编译后仅修改了 Go 夹具的说明注释，执行行为没有变化；源码与实际二进制哈希分别记录。SDK／Move／Rust 生产源码未改，未计作本轮全量重跑。

## 失败场景与清理

[前序记录](evidence/v020-native-host-process-restart-prior.json)保留每轮原进度、错误、摘要和独立清理：

- **R1**：原继续票据交易已确认，目录快照变化使夹具退出。只读重建同一票据与 QUEUED Run，确认 **0 已用／3 预留**；另行签名取消原 Run 后变为 CANCELLED／**0／0**，再撤销该轮 Host 并清理测试凭据。
- **R2**：漏导入使继续票据加密前失败。完整目录只有原成功审阅 Run，无继续 Run，预算 **0／0**；另行撤销该轮 Host 并清理测试凭据。
- 临时清理／只读验证器的 ESM、字段选择和 u64 类型断言失败也保留；这些失败没有广播。修正后只读原对象，未重放原请求。

失败时保留原 Host／Human 测试配置和工作目录，直至原执行与成员资格确认清理。R3 使用新的独立场景，没有以更换输出文件的方式重发失败轮次的请求。本次清理没有处理其他历史夹具遗留的 QUEUED Run。

## 复现与证明范围

在 `runtime/fractalmind-envd` 构建专用 race 测试二进制：

```sh
go test -race -c ./cmd/envd -o /tmp/envd-native-restart-tests
```

在 `apps/fractalmind-app` 使用公开升级部署 JSON 和不存在的输出／进度路径：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/envd-native-restart-tests node --import tsx scripts/native-app-execution-localnet.ts /tmp/upgraded-deployment.json /tmp/new-host-restart-report.json --human-sequence --host-restart
```

固定隔离 RPC `127.0.0.1:29000`／faucet `127.0.0.1:29123`。实际重启发生在最终验收之后，证明同机的进程退出、原生身份重载、链上历史结果恢复与当前权限拒绝；**没有证明运行中任务重启后继续、重启后的 Coordinator WebSocket 重连、新实例重绑定执行、物理机器重启或云 Host**。

安装后 UI／IndexedDB 清空重建、真实模型、手机沟通审批、云 Host 和公共旧部署升级仍待验收。原生 GUI 的原钥匙串读取没有被取消或重启，当前 `.app` 未随本次 runner 修复重建。完整 v0.2.0／#40 继续进行。
