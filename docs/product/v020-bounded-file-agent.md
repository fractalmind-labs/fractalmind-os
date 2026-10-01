# v0.2.0 受约束文件 Agent 增量

此增量推进 #30/#33/#34/#48：生产 envd 可选择原生文件 Agent，观察现状、修复未满足的文本文件目标，再读取实际文件生成证据。它支持明确的文件目标；通用模型规划、命令工具、完整 OKR 状态机和 App 导航仍需交付。文件目标完成只产生待人工评审的 `submitted` 结果，不接受 KR 或关闭 OKR。

## 配置与纳管

在 [链上执行器配置](v020-host-identity-runtime.md) 中加入：

```yaml
runtime:
  enabled: true
  adapter_kind: native-file-agent
  workspaces:
    documentation-agent: /absolute/path/to/workspace
  adapter_command: python3
  adapter_args: [/absolute/path/agent-manager/scripts/main.py]
  result_gas_budget: 2000000000
```

`workspaces` 只提供实例与物理目录的本机映射，不授予权限。管理设备需在链上显式纳管该实例，runtime 为 `bounded-process-v1`，工作区摘要为本机绝对路径规范化后的 UTF-8 字节 SHA-256。当前授权读取核验 ManagedAgent、成员、设备、组织和能力版本，工作区摘要不匹配拒绝执行。Host 的签名/加密密钥仍在系统凭据库；使用记录与结果保存在 Sui。

省略 `adapter_kind` 时继续使用仅观察适配器。原生适配器支持 `assign` 文件目标和已有观察操作；不赋予 tmux/agent-manager 通用启动、停止或 shell 执行权限。文件写入完全由原生工具完成，不调用观察子进程。

## 签名目标与边界

`assign` 的 NodeCommand 载荷示例：

```json
{
  "task": "{\"kind\":\"ensure_text_files\",\"files\":[{\"path\":\"docs/result.md\",\"content\":\"Measured result\\n\"}]}",
  "bounds": {
    "paths": {"file.read": ["docs"], "file.write": ["docs"]},
    "max_calls": "3"
  }
}
```

- 目标为 1–3 个不同文本文件，按顺序推进；任务 JSON 总量不超过 16 KiB，每个文件不超过 16 KiB。
- `paths` 按动作声明已有目录根；`file.read`、`file.write`、`file.list` 分别授权。列表最多返回 256 项并标识截断。
- 命令预算必须使用 `TOOL_CALLS`，数量与 `max_calls` 相同，限制为 1–1000。此资源预算衡量工具调用，不代表模型费用或 SUI Gas；Host 仍需余额支付链上交易。
- 先由设备在链上原子预留使用次数、预算和命令检查点，再由目标 Host 确认属于自己的启动尝试。没有已确认的本次启动不能调用文件工具。
- 完整载荷由设备签名。每次工具调用读取当前链上能力、实例、执行状态与 Clock；写入临时文件后、发布前再次检查。撤销、停止、到期、RPC 失败或目标变化都会拒绝后续操作。
- 新文件目标通常需要三次尝试：读取不存在的文件、创建、读取测量。已有文件符合目标只需一次读取。已接受的文件操作即使发生文件系统错误也计数；越界/撤销拒绝和相同调用的精确重试不另计。

工具以独立 `os.Root` 锚定各动作的目录，禁止 `..`、绝对路径、Windows ADS/路径分隔变体、短名 `~`、尾随点/空格及设备名称。`.git`、`.claude`、`.codex`、`.agents` 和内部临时文件名称不区分大小写受保护。符号链接不能跨出对应目录根，末端符号链接、硬链接、非普通文件及非 UTF-8 正文拒绝读取/替换。

## 测量、停止与恢复

每个目标先读取当前内容；只有不匹配时才修改。修改要求原内容摘要一致，写入独立随机临时文件并同步，再检查权限和摘要后重命名。随后读取实际结果，与目标 SHA-256 比较，记录观测时间和证据，再进入下一目标。

链上停止请求阻止下一工具操作；本增量没有任意 shell 子进程需要终止。已知工具次数随加密终态在同一交易结算，未使用预留释放。未知结果保留待确认状态，不重放副作用。执行器重启从链上读取原结果；Human 恢复后可从历史 keyring 解密。

边界检查和文件发布不是链与文件系统之间的原子事务：撤销可能与已经获准的短操作交错，不能承诺撤销瞬间回滚文件。摘要复查能检测正常外部编辑变化，但不是与任意外部编辑器之间的原子 CAS。Host 操作系统、目录映射和挂载布局属于可信执行基础；该 Agent 没有创建挂载、硬链接或符号链接的工具。

当前本机绑定或任务无效的控制命令可能在链上确认启动后才失败，仍消费一次使用次数，但不产生文件副作用。完整 OKR/常驻权限的路径约束、版本修改与重新审批尚未贯通；原生文件目标不能替代这些验收要求。

## 已通过验证

[真实本地链报告](evidence/v020-native-file-agent-localnet.json) 包含 87 笔 SDK 交易：60 成功、27 预期拒绝；17 个预算断言。原有 Go 授权、预留和结果存储流程全部通过。新增原生文件流程使用真实链授权与检查点，成功流程产生两个真实文件并测量摘要；第二流程在链上停止后阻止下一文件，分别结算 6 和 1 次真实工具尝试，总账支出 7、预留 0。

测试调用生产构造路径，注入独立生成的测试凭据；文件工具没有合成效果。停止由测试触发器在两个目标之间提交真实设备交易，不能据此声称手机 UI 已完成。重启去重通过；Human 恢复后 8 份终态正文、12 个选定检查点和 6 份预算总账恢复并核对。报告保留交易、原生证据和恢复账本，大型合成测试正文只保留长度与摘要。

Go 全量回归、工具/执行器/授权 `-race`、SDK 66/66 回归及类型检查通过。越界、硬链接、FIFO、并发预算、精确重试、撤销和期限边界有独立工具测试。Linux/Windows/macOS 构建仅证明编译兼容；实际文件 Agent 和链路联合验证在 macOS 本地网络完成，云端与其他平台原生运行尚未验收。

复现：先启动独立本地 Sui 网络和 faucet，准备当前协议构建的 bytecode JSON，再在 SDK 目录执行：

```sh
FM_HOST_ACCEPTANCE=1 FM_HOST_AUTHORITY_VERIFY=1 FM_NODE_CHECKPOINT_ACCEPTANCE=1 \
  node --import tsx scripts/identity-localnet.ts /tmp/protocol-bytecode.json /tmp/native-file-agent-evidence.json
```

脚本只生成测试身份和临时工作目录，不使用用户 keystore；工作目录在测试后清理。整个 v0.2.0 继续按 [最终闭环与 Issue 映射](fractalmind-app-v020-validation.md) 验收，不关闭整体 Issue。
