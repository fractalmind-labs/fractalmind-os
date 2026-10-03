# v0.2.0 Android 安装版：Host 接入、发现与 Coordinator 重连

基线 `5aef584`，继续[安装版身份与组织验收](v020-app-android-installed.md)。本增量复用原 Android 设备钥、Human 和组织，使用正式 envd CLI、两个独立 macOS Keychain Host 配置及实际本地 Sui。完整版本仍按 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40) 验收。

## 修复

- Coordinator 客户端把 `fetch` 保存为局部函数后调用。原先的 `this.transport()` 在真实 Android WebView 报 `Illegal invocation`，请求未发出。HTTP 测试改用普通函数检查调用上下文，覆盖读取、命令及失败路径。
- Host 入组确认后，在原 20 秒重建期限内等待缺失的成员／目录对象；每次重新读取当前来源。其他来源错误立即返回并保留原因，原摘要和费用保持，没有再次兑换或广播。
- 新 Host／执行运行时仅启用 `sui.enabled` 时不触发旧 mesh Peer／AgentCertificate 登记。只有显式配置旧 `package_id` 和 `registry_id` 两项才启用；部分配置拒绝启动。链模式复用原生 Host 签名身份。
- 主机观测分别显示 tmux 与原生文件实例数。只统计当前已核验、完整且未过期的扫描；失败或缺失显示未知，避免有原生 Agent 时显示总数为零。
- 新增显式启用的 `TestHostAdmissionReadLive`：只读已有链上资格／连接，输入仅公开部署及 Host 公钥，零初始化／签名／广播。

## 实际结果

[公开报告、前序失败及源码指纹](evidence/v020-app-android-host-flow.json)：

| 验收项           | 结果与范围                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装版登记入口   | 正式 Android UI 核验原设备管理权限，确认自付费用并签名；链目录刷新成功。独立 SDK 核对精确入口类型、地址和原 `previousTransaction`                                          |
| 单次邀请及入组   | 正式 Android UI 确认限时、单次、1 天成员及观察期限；正式 envd 从 stdin 读取内存中的邀请码，核对组织／入口公钥／权限／Gas 后明确 `JOIN`。原入组交易确认，首次随后重建待同步 |
| 原资格只读核对   | SDK 和生产 Go 来源解析器核对原邀请 `uses = 1`、精确 Host 公钥／成员／入口及当前指针；原成员 `previousTransaction` 保持入组摘要。未重新兑换                                 |
| 安装版观测与发现 | 原 Android 设备完成挑战证明，验证 Coordinator 及 Host 签名；显示正式 worker 的原生文件 Agent、实例 ID 和工作区指纹                                                         |
| 仅观察导入       | 实际 UI 核对已有登记、重新验证当前扫描、确认费用并原生签名。独立 SDK 核对原 ManagedInstance、原成员资格、`control_confirmed = false` 及精确导入摘要                        |
| Coordinator 重启 | 原进程退出后以同一原生钥和链上绑定启动新正式进程。worker 检测断线、再次完成身份校验和登记；实际 App 读取新签名观测，Host 地址及原生实例 ID 一致                            |
| 自测             | App **234/234**；Go `hostjoin`／`cmd/envd` 两包 race 通过，覆盖延迟可见、撤销、来源失败、期限及零重放；严格 TypeScript、完整 APK／签名／升级安装通过                       |

原事务摘要：

- Coordinator 入口：`Fj2GEqVnHsWff8AHrFYLHTAiwMurS4CU2oiq4hVnj4vG`。
- 邀请：`83FfqwmAc8D3ZVMJQyenFdMxMq5gcBYXJBuuwzeRtF24`。
- Host 入组：`7AK74u2s3m8mkvGz6LFXFTMGcdKNXrvpRrVc2BXvNmqo`。
- 仅观察导入：`HrvfDhizhMMPCuYWUP1zaTHNZSB3wACRCcjmnx547EGC`。

## 前序失败与限制

- 原正式 CLI 的入组交易已成功，但随后成员读取返回待同步；原错误没有暴露来源原因，无法反推其精确分类。之后独立 SDK／生产 Go 读取通过。新增有限等待和错误原因经 race 测试验证；不能声称原交易已由修改后的 CLI 再次执行通过。
- 任务 localnet 已裁剪原入组交易历史，正式只读状态命令保持原摘要／unknown。以原确认输出与当前对象的精确 `previousTransaction` 核对，不以裁剪后的未知结果允许重放。
- 旧 worker 启动误触发一笔旧 AgentCertificate 登记，组织旧 Agent 数为 1，公开对象及原摘要保留在报告中。修复后的正式 worker 重启／重连没有这条自动登记路径；未删除或把该旧证书计作新的受管理 Agent。
- 观测夹具 R1 提前把「待重新核验」断言成已消费，R2 暴露真实 fetch 上下文错误。重连夹具 R1 错误预期日志词组；保留失败，R2 只读复查原已重连进程成功。最后一次计数构建因可选扫描的 TypeScript 类型失败，在广播／安装前停止；类型修正后重新构建。
- 新 Host 仍是同一 Mac 上的进程；Android 是独立模拟器和实际 debug 安装版，使用 ADB 端口映射访问本地链与入口。没有证明云端 Host、实体手机、蜂窝网络、五平台生产发布或隐藏 TTY 新验收。
- 原生实例处于仅观察；本轮未验证交接、ACTIVE OKR 执行、运行中 Host 重启续跑、手机对话／审批、完整客户端缓存重建或历史未结 Run。Coordinator 重连证明限定于当前观察流程。
- 单独 Coordinator 仍按现有角色模型运行 worker 循环，未自身入组时提示资格不可用；这不影响已入组 worker 的经过验证的入口读取，后续需要改善该角色状态表达。
- Android GitHub CI／PR 及完整 #40 门禁仍需完成，整体目标保持进行中。

## 复现入口

准备独立[Android 工具链与模拟器](v020-app-android-native.md)，构建 debug APK。保留同一本机配置和匹配原始包 ID 的公开部署资料，在主机页登记真实 Coordinator 地址、公钥并确认费用。

创建单次邀请，向新 Host 初始化输出的地址充值测试 Gas，执行正式 `envd --config sentinel.yaml --join-host`；在隐藏 TTY 或专用 stdin 输入邀请码，读取预览后输入完整 `JOIN` 确认。接入成功后启动正式 envd，由 App 读取签名观测，在团队页明确导入为仅观察。

只读原资格测试：编译 `go test -c ./cmd/envd`，使用 `FM_HOST_ADMISSION_READ_LIVE=1` 和 `-test.run '^TestHostAdmissionReadLive$'`，从 stdin 提供 `ConfigPath`、`InviteID`、`MembershipID`、`SigningPublicKey`、`EncryptionPublicKey` 的公开 JSON 行。该夹具固定在任务 localnet `127.0.0.1:29000`，必须核对链标识。

Coordinator 重启时保留原 Host、入口绑定、组织和公钥；重新读取实际 App 观测，核对原实例及链上记录。观察流程成功不能代替运行中任务恢复验收。
