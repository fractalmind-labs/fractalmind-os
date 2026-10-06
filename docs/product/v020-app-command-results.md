# App 原生命令结果密钥与链上预留

依据 PRD v0.11／原型 v2，承接[设备签名命令](v020-app-device-commands.md)与[审批后的继续](v020-reviewed-continuation.md)。本增量补齐正式 App 读取 Host 审阅结果的必要原生密钥接口；完整安全交接控制器和 UI 仍需接通。

## 原生密钥边界

- `fm_device_wrap_command_result_key` 在系统密钥库解封设备持有的加密组织 keyring，按组织／命令 intent hash／key version 派生单条结果密钥，并使用独立 Host 的 X25519 公钥封装。返回 132 字节 FMW1 密文；组织密钥、keyring 明文和派生密钥不返回 JS。
- 请求固定网络、组织、Capability、成员、命令指纹、密钥版本及 Host 签名／加密公钥。严格字段、长度、规范编码、Host 地址与签名公钥关系、低阶 X25519 点和密文头检查先于 OS 密钥读取。该原语不查询链，也不授予执行权。
- Tauri 新接口复用本地 main 窗口和来源限制；没有远程权限、秘密文件降级或任意原始密钥导出。封装与既有原生 FME2 解密复用同一 HKDF 域。

## App／SDK 接线

`NativeCommandResults.prepare` 接收已经签名的指定实例命令，核验独立设备持钥、当前组织角色、Grant／动作及期限、当前 Host 成员与 Coordinator、活跃 Host 指针、精确纳管记录／工作区及当前组织密钥版本。审阅状态命令要求 read／operate／approve／manage_hosts，并核验审批角色。

原生封装返回后以及 SDK 构建完成后重新读取全部来源。返回的 `assertCurrent` 必须在费用确认、交易签名返回后及广播前运行；测试中的正式自付交易管理器按此接线。业务来源只在内存和 Sui，结果密钥接口不持久化业务状态或派发 Host 命令。

SDK `prepareCommand` 新增 `WrappedCommandResultKey`，独立核对命令、组织、Capability、成员、Host 和当前加密公钥；封装密钥授权与跟踪 Run 预留处于同一 PTB。异步读取前复制命令和输入，旧 organizationKey 模式保持兼容并清零内部副本。密文格式和元数据匹配不能替代 Host 解包、当前链权限或人工批准。

协议／规格／目录／旧执行、物理空闲和 Host 签名审阅仍是接管控制器的额外检查。此通用结果准备原语不替代它们，也不消费 Host 审阅预约或授予继续权。新版 SDK runner 的原生加解密接线也尚未完成。

## 实际验证

[实际 OS 密钥库与 localnet 报告](evidence/v020-native-command-results-localnet.json)：**8 项检查、11 笔确认交易及实际费用**。

1. 真实 macOS 系统密钥库的恢复／设备签名创建 Human 与唯一组织，原生加密草稿建立当前数据目录。
2. 正式 App 控制器读取当前链资格并调用原生封装，原生设备确认费用与签署结果授权／Run 预留交易。原准备摘要 `3jTeXb4ZM9bKoaGZjuTii5ZvRHsqYc5bgoA8DW98r8rQ`，原 Run `0x7d4c6b81f4461fad7259f7ce0aa6d9ed97e0f4885bbc4ecc43548c6abc05ac90`。
3. 测试 Host 从 Sui 读取封装，仅解出该命令的派生密钥；另一个 Host 和错误指纹上下文被拒绝。独立 JS 加密的 FME2 测试正文可由原生层用链上设备 keyring 解密，错误指纹／版本／修订被拒绝。
4. 查询同一原准备摘要，没有再次提交或派发。原排队观察 Run 显式取消，状态 5、无结果记录；随后真实链撤销 Host，原准备的当前资格检查拒绝。
5. 测试凭据删除后再次读取返回 NotInitialized。

测试 Host／实例由夹具登记，**未启动真实 envd、没有物理发现或 Host 派发**；FME2 是互操作夹具，未作为真实 Run 结果提交。这是原生密码学与实际交易接线证据，不是安全接管、Host 空闲或安装后 UI 的验收。技术 journal 为内存、原生传输为独立测试子进程；主窗口来源限制单测与安装后交互分别对待。

[回归证据](evidence/v020-native-command-results-unit.json)：SDK **121/121**、App **103/103**、Rust 核心 **19/19**、Tauri 来源 **1/1**、类型／构建及脚本类型通过。本增量未修改 Go／Move。保留既有构建体积和依赖注释警告。

## 检查发现与修正

[前序记录](evidence/v020-native-command-results-prior.json)完整保留五次独立夹具的原回执、费用、终止位置及凭据清理，未覆盖或重放原请求：

- 绑定交易已确认但下一模拟暂不可读，改为只读等待原 ObjectWrite 效果。
- 组织创建模拟只保留泛化错误，SDK 现保留类型化 validator cause。第四次明确命中组织名重复 `3002`；第二次原具体错误未归档，后来使用另一名称的只读模拟成功不能证明其原错误原因。
- 可见性门禁曾等待所有 Created UID，包括未单独写出的 UID；修正为只等待 ObjectWrite，不将嵌入 UID 的不可读误判为 RPC 失败。
- 实际链发现 App 将 `Table<address, ID>` 的活跃 Host 键错误写成 `object::ID`。已修复为 address，并加强单测对键类型和 BCS 地址的断言。
- 身份创建页对精确同包 `organization::new_organization`／`3002` 提示名称已用，保留原身份，要求用户改名并重新确认费用。不会自动改名或重建身份；仅错误数字／文本、其他包／函数不触发该提示。提示分类和构建已验证，安装后错误页面交互尚未验收。

## 复现与剩余门禁

在 App 目录先构建隔离原生测试辅助程序，再对当前已有独立部署运行：

```sh
cargo build --manifest-path native/Cargo.toml --example device-test-helper
node --import tsx scripts/native-command-results-localnet.ts DEPLOYMENT.json NEW_REPORT.json
```

报告或进度文件存在时拒绝覆盖。未知结果查询原请求，禁止因读取失败重放；测试隔离创建不复用用户钱包或 keystore。

仍需：完整 App Host 审阅／约定加密／费用审批／明确继续 UI、未知旧执行处理；原生 runner 与持续自主推进；对话／介入／独立人工验证与验收；历史迁移／旧包升级；安装后实际 IPC／持久 journal／密钥库旅程、云 TLS Host 与五平台验收。完整 v0.2.0 目标保持未完成。
