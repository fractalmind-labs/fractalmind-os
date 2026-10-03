# v0.2.0：真实远程 Host 接入与观察验收

基线 `aad4400`。使用用户提供的 ARM64 Mac mini 与 Ubuntu 24.04 云主机，复用原 Android 安装版设备、Human、组织、Coordinator 和任务 Sui 链。本增量按 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40) 推进，完整版本保持未完成。

后续[真实云 OKR 尝试与 RPC 修复](v020-cloud-okr-rpc.md)保留原草稿／未确认审阅、只读复查和网络测量；它尚未完成云 KR 执行，不改变本轮接入证据的证明范围。

再后续[停止结算与 envd 升级](v020-cloud-review-stop.md)已取消原审阅并更新隔离云 worker，原身份／成员保持，新实例仅发现，完整云 OKR 仍未验收。

## 本次修复

Linux 的 Secret Service collection 可以通过 `identity.secret_service_collection` 显式选择。初始化、邀请码兑换、观察连接和正式执行工厂均使用同一配置；省略保留 `fractalmind`。选项仅适用于 Linux，名称限制为 1–64 个 ASCII 字母、数字、连字符或下划线；其他平台的非空配置拒绝。不可用、锁定或读取失败时不切换凭据库，也不生成替代身份。

```yaml
identity:
  key_profile: my-cloud-host
  secret_service_collection: login
```

这项配置选择已经准备好的系统密钥库，不授予组织权限。成员、邀请、纳管记录与授权仍保存在 Sui；Host 私钥保存在本机系统凭据库。部署必须先准备并解锁选定 collection，再在相同 D-Bus 会话中初始化／启动 envd。

## 实际结果

[公开报告、源码／夹具指纹及前序失败](evidence/v020-remote-host-acceptance.json)：

| 项目         | 结果                                                                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac mini     | SSH、macOS ARM64、Go／Node／tmux／Ollama 工具与隔离目录核对通过。正式初始化返回 Keychain `-25308`，等待本机用户解锁／授权，尚未入组                                                                   |
| Ubuntu 凭据  | 初始无 Secret Service，明确拒绝。安装依赖后使用独立 D-Bus、XDG 目录与仅启用 `secrets` 的 GNOME Keyring；非空解锁口令只在会话内存，原生密钥写入权限 `0600` 的加密 collection                           |
| 云 Host 入组 | 原 Android Keystore 签名器通过正式 App 接入控制器创建新单次邀请；正式云 envd 核对组织、入口、公钥及费用后确认原兑换。独立 SDK 验证邀请已消费、原成员及精确入组摘要，R4 **5 项检查**通过               |
| 安装版观察   | 实际 Android UI 同时验证原本地 macOS worker 与真实 Ubuntu 云 worker 的心跳／扫描，显示 Linux／AMD64 和原生 Agent；独立 tmux socket 未运行时显示未知。重启前、后各 **3 项检查**通过                    |
| 云进程重启   | 原 PID `2323604` 正常退出，退出码 **0**；同一加密库加载同一签名／加密身份，新 PID `2325124` 重新认证。精确原成员及 `previousTransaction` 不变，重启前、后各 **3 项只读检查**通过                      |
| 实例连续性   | 工作区指纹保持；实例从 `native-c129…bee46` 变为 `native-5fa1…be2c5`，后续读取要求新实例，未把旧扫描当作新进程                                                                                         |
| 云实例导入   | 正式导入控制器通过原 Android IPC 签名，明确导入重启后的云实例为仅观察。SDK 核对原 ManagedAgent／成员／摘要；`control_confirmed = false`，重复选择返回原登记，没有新报价／签名／广播。**4 项检查**通过 |
| 回归         | Host 身份、入组、WebSocket、正式 CLI 四包 `go test -race` 通过；Linux AMD64 正式二进制构建通过。部分包复用本轮较早的成功测试缓存，App／SDK／Move／Rust 未计作全量重跑                                 |

R4 原事务摘要：

- 入组：`7cWW8UBdhMzy43WXfL73o9K6HrCPsDbtHQHjTDS8fY5s`。
- 原成员：`0xc39e7a5840abc858eeaebe8e0a66cd64a5ef6459fd8eeba32e4d716713d7d66d`。
- 仅观察导入：`GHUz15nVc38tDXHMoUDwkRzSUH5v3t5hEmhnMFUZKiD3`。
- 原登记：`0x88148f91a547e54750132d9442627c1ea6eefb89540ef1f78ef0f48f9f374140`。

## 前序失败与环境变更

- Mac mini 的 SSH 免密登录未提供 Keychain 解锁／应用访问授权。正式程序输出 `User interaction is not allowed (-25308)`，没有提供 Host 公钥或组织准入；已请求用户在本机初始化并授权。
- 云端 R1 入组成功后，夹具错误地把加密格式算法编号 `0` 当作明文，导致会话退出。[GNOME 的实际二进制格式实现](https://raw.githubusercontent.com/GNOME/gnome-keyring/46.2/pkcs11/secret-store/gkm-secret-binary.c)使用编号 `0` 表示其支持的 AES128 格式。原成员独立撤销，保留原交易；新轮次使用独立新身份，未重放原邀请码。
- R3 真实 UI 观察通过；停止时夹具的 20 秒等待到期，原 worker 随后退出。精确原成员独立撤销。R4 调整为 45 秒，记录原退出码、新 PID、同一密钥库指纹和重新认证；没有把前轮超时算作通过。
- R1 UI／R4 首次 SDK 读取在首个可信扫描可见前等待失败；后来只读查询成功。导入与 UI 读取并行时一次 UI 等待失败，未单独定位原因；随后导入完成后的只读 UI 核对通过。原失败报告保留。
- 实际云日志包含一次 heartbeat RPC deadline 和目录变化期间的拒绝／重新认证；后续新签名观察通过。未将暂时不可用展示为成功，也未修改 RPC／权限期限来规避拒绝。
- 云端安装了 `gnome-keyring` 依赖。系统 `needrestart` 重启了 chrony、coturn、cron、fwupd，部分服务延后重启；最终只读核对用户既有 envd PID `1872983`／`2244585` 均仍运行。测试没有替换这两个 envd 的程序或配置。

## 证明范围与后续工作

- 网络经过真实互联网 SSH 通道；远端测试 Sui／Coordinator 端口只监听回环地址。使用的是原任务 localnet，没有证明公共 testnet、生产 TLS／VPN 或链部署升级发布。
- Android 是实际 APK／JNI／Keystore 的任务模拟器，仍需实体手机。远程交易采用脚本控制正式 App 控制器和原安装版 IPC，费用确认不是完整可见 UI 付款走查。
- 云 Agent 只获得观察登记，本轮未验证交接、OKR／对话实际执行、审批、运行中的 Run 重启续跑或完整恢复。安装版显示的本地 worker 是此前任务的 Mac Host，不是尚待 Keychain 授权的新 Mac mini。
- 证明的是 envd 进程重启，加密库服务仍运行；没有证明云主机重启或无人值守的开机解锁。临时解锁口令未保存到配置、参数、日志或仓库，测试会话退出后须独立清理／撤销测试资格。
- 后续继续用本地／云 Host 验收实际 OKR、沟通审批和运行恢复；完整交付仍依据 [验收映射](fractalmind-app-v020-validation.md)。
