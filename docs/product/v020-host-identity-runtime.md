# v0.2.0 Host 密钥与生产执行器

此增量对应 #25/#30/#32/#48。链上授权和加密结果存储已接入 envd 生产工厂；agent-manager 仅用于观察，可显式选择 [原生受约束文件 Agent](v020-bounded-file-agent.md)。通用模型 Agent、完整 OKR 与云端部署仍待交付。

## Host 本机身份

`envd --config sentinel.yaml --init-host` 显式生成独立的 Ed25519 签名密钥和 X25519 加密密钥。输出只有 Host 地址、两种公钥、格式及配置档名称；私钥只保存于操作系统凭据库。组织、成员资格、授权、命令与结果继续保存于 Sui。

- macOS：Keychain，只在设备本机保存、不同步，使用时须可访问 Keychain；构建需要 CGO 和 Xcode command-line tools。
- Windows：Credential Manager。
- Linux：Secret Service，需要可用的 D-Bus session 和 Secret Service。无该服务的无界面 Ubuntu 云主机目前不能通过此存储提供者启动；云端部署与合适的系统密钥存储仍需真实验收。
- 不回退明文文件或临时内存身份。凭据库锁定、不可用、格式损坏都会拒绝初始化/启动。正常启动只加载已有密钥，不自动生成。

同一 `identity.key_profile` 重复初始化保留原身份；跨进程初始化用不包含密钥或产品状态的本机锁串行化。改变 profile 会选择另一个 Host 身份，不能静默沿用原成员资格。只有独立生成的测试条目用于原生存储验收，测试后删除。

## 配置与启动

```yaml
identity:
  key_profile: default
runtime:
  enabled: true
  adapter_kind: observation
  adapter_command: python3
  adapter_args: [/absolute/path/agent-manager/scripts/main.py]
  result_gas_budget: 2000000000
sui:
  enabled: true
  rpc: http://127.0.0.1:29000
  org_id: "0x<organization>"
  protocol_package_id: "0x<current-package>"
  protocol_original_package_id: "0x<original-type-package>"
```

占位值须替换为真实链对象；没有升级时原始包可留空。初始化密钥只创建本机身份，不完成 Host 入组，也不提供 Gas。后续须使用该公钥接入组织并向对应 Host 地址提供交易 Gas。

```sh
envd --config sentinel.yaml --init-host
envd --config sentinel.yaml
```

生产工厂使用 `ChainAuthorityStore`、`ChainReservations` 与 `ChainExecutionStore`。控制通道和 Sui 客户端复用同一安全 Host 身份；显式 `identity.host_id` 必须与签名地址一致。原始包用于 BCS 类型来源校验，当前包用于事务调用。启动和结果交易的回执未知时只查询，不能重发命令。

旧 `FRACTALMIND_RUNTIME_STATE_DIR` 不再启用文件授权生产路径；启用链上执行器时拒绝 `FRACTALMIND_NODE_COMMAND_AUTHORITY_FILE`。可用配置的 `adapter_command`/`adapter_args` 指定观察进程，也可使用已有 `FRACTALMIND_AGENT_MANAGER_COMMAND`/`FRACTALMIND_AGENT_MANAGER_ARGS`；旧 `FRACTALMIND_AGENT_MANAGER_MAIN` 应迁移为显式参数。兼容测试可以独立构建文件执行器，生产工厂不能选择它。

## 能力与结果

现有 tmux/agent-manager 未提供执行沙箱。默认观察适配器仅支持 inventory、status、monitor、logs、health、availability；start、stop、assign 和直接执行消息在校验/预留/调用进程之前拒绝。每个并发请求都要检查实际适配器能力，管理设备确认的链上标签不能替代执行边界。`native-file-agent` 可执行明确的文件目标，设置、授权和限制见其 [说明](v020-bounded-file-agent.md)。

结果用命令专用密钥写入 Sui；重启从链上读取并解密原结果，不建立文件结果缓存。Host 不持有组织根密钥。原生文件工具的实际执行、步骤间停止和工具调用计数已通过增量验证；组织轮换后的在途结果补交、通用 Agent、进程停止和模型费用计量仍待完成。

## 验证证据

[生产工厂本地链报告](evidence/v020-production-factory-localnet.json) 含 84 笔 SDK 交易：57 成功、27 预期拒绝；另有 3 笔 Go 校验器启动、2 个独立 fixture 执行器各自的启动/结果交易，以及生产工厂的 1 笔启动/1 笔结果交易。

生产构造路径使用注入的独立测试凭据库和合成观察子进程。验证了真实链授权、加密结果写入、重启后同一身份和结果复用、控制请求保持 QUEUED、取消后释放预算。观察进程仅调用一次。Human 恢复后 6 份终态正文可解密，10 个选定检查点与 5 份预算总账一致。此测试不证明实际 Agent 自主执行、原生存储与链路联合部署或云端 Host 已部署。

[原生 Host 存储证据](evidence/v020-host-native-storage.json) 单独记录 macOS Keychain 创建、重载和拒绝覆盖的真实测试。Linux/Windows 的跨平台编译不等于原生凭据库运行验收。全量 Go 回归和 Host/执行器 `-race` 检测通过。完整 v0.2.0 仍按 [验收映射](fractalmind-app-v020-validation.md) 推进。

后续[实际原生 Host 进程重启](v020-native-host-process-restart.md)把生产 macOS Keychain、原成员资格和 ChainExecutionStore 联合验证：两 KR 与独立验收后原进程退出，新进程加载同一身份、解密原 Sui 结果，文件／原 Run／预算不变；独立撤销后当前连接与原命令拒绝。此增量为 **12 项检查、17 笔 App 确认交易**，生成的测试凭据已清理；没有证明运行中重启后的继续执行、Coordinator 重连、物理重启或云端部署。
