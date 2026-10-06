# v0.2.0 App：组织 Host 邀请与管理

界面来源：[原型 v2 的主机页](fractalmind-app-prototype-v2/js/view-hosts.js)。正式客户端的“主机与算力 → 接入主机”已连接实际 Sui 合约与自付交易控制器。Host 兑换 CLI 已实现，生成的 Go Host 测试钥完成真实链兑换与丢失回执恢复；安装后原生钥／UI 联合验收及实际本地／云端运行仍待完成。

## 管理设备的操作

1. 登记组织入口：核对 Coordinator Ed25519 公钥及 HTTPS origin，公钥派生入口地址；仅 loopback 允许 HTTP。输入地址不证明 Coordinator 正在运行。
2. 创建单次邀请：选择链上入口与 15 分钟／1 小时／24 小时有效期，明确兑换后的成员期限（1–90 天）和观察能力期限。当前合约只发放最多 10000 次有限观察能力；执行 OKR、写文件及桌面控制仍需具体授权。
3. 每个写操作重新核验原生持钥、Human／Grant 代次、read／manage_hosts、组织范围和管理员角色。实际模拟报价，展示付款地址、余额、预计 Gas 与上限，经明确确认再签名和提交。
4. 确认交易 effects 的输出版本已可读取后才显示邀请码。链上保留证明公钥，邀请码中的 256 位秘密只在当前窗口内存；不进入 localStorage、IndexedDB、报告、日志或 URL。关闭／刷新／重启后无法恢复。遗失未用码可撤销链上邀请，再明确创建新的。
5. 已消费邀请无法用于撤销 Host；单独选择成员记录、核对并支付撤销交易。撤销拒绝新的受保护操作，不表示已结束在途工作。

公开链连接只能读取目录。网页入口不会初始化私钥或获得管理授权。原生 Host 与管理设备是不同地址，Host 自己的兑换／结果交易也需要 Gas。接入指导在生成码之前即可查看，提供公开配置及真实 `--init-host`、`--join-host`、`--host-join-status --host-address` 命令；配置中的 `protocol_registry_id` 与旧 peer discovery 的 `registry_id` 分开。启动 envd 不等于入组。接入后按指导启用独立链连接模式，使用当前成员指针选择入口并认证；实际 loopback 连接与撤销证据见[Host 连接说明](v020-host-chain-connection.md)。

## 交易与来源约束

`src/host-admission.ts` 使用正式 SDK、`NativeDeviceSigner`、`DeviceIdentityVerifier` 和 `SelfPayTransactionManager`。业务目录从链上重建，校验协议类型包、shared 所有权、对象 UID、组织归属、入口公钥／地址，以及目录动态字段来源。仅确切缺失的 HostIndex 是空列表；RPC 故障继续表示未知。

Host 管理报价存于当前控制器；权限和目标记录变化会拒绝提交。取消／替换报价会使原报价失效，并清零其邀请秘密。费用确认之后的签名与广播由原生 signer 和正式自付管理器完成，合约再次核验权限。

IndexedDB 只存原交易摘要及 Gas 元数据。可丢弃的本机尝试提示仅保存 UUID、设备配置名、Grant ID 和操作种类；不保存邀请码或业务正文。已有结果优先查询原交易，结果未知不能开始替代提交。成功回执早于查询可见时，等待该回执的精确输出版本；不重放交易。

撤销会删除 `active_hosts` 的当前指针。App 将该精确字段缺失表达为“无当前成员资格”，历史记录继续保留；缺失其他对象和 RPC 故障仍是读取失败。当前资格与在线观测分别展示。

## 本次证据

- [真实本地链控制器报告](evidence/v020-app-host-controller-localnet.json)：8 项检查、10 笔成功交易，包括入口登记、App 邀请、独立 Host 兑换、有限观察能力、已消费码撤销拒绝、成员撤销、无秘密重建、遗失码撤销、报价后管理授权撤销拒绝。
- [浏览器报告](evidence/v020-app-host-browser.json)与[中文白天截图](evidence/v020-app-host-browser.png)：真实公开目录、中英文／明暗主题、入口表单、权限确认后网页仍不能报价、已消费／已撤销记录按钮禁用，以及撤销后的当前目录缺失修复。
- App 单元测试 **60/60**、TypeScript、生产构建和本地链脚本类型检查通过。测试覆盖来源错误、未知原交易优先、权限／期限变化、报价替换、秘密清零和不可从公开记录恢复邀请码。

本次链报告使用新生成的内存夹具钥、注入的 NativeInvoke 传输和内存技术 journal；没有访问用户钱包。它验证生产控制器与真实链协议，不证明 OS 存储、安装后 UI／IPC／IndexedDB 全旅程、实际 envd 兑换、在线 Coordinator、云 Host 或五平台验收。原生 App 现有测试会话仍等待系统 Keychain 授权；没有因观察超时重启它。完整 v0.2.0 继续按[验收映射](fractalmind-app-v020-validation.md)推进。

### envd 邀请核验与真实报价增量

Go envd 已增加 `InspectHostJoin`、邀请码证明签署、`ReadHostAdmission` 与 `PrepareHostJoin`。预检从 Sui 读取协议／身份注册表、组织、入口、邀请、Human、Grant、管理员角色及目录，核对动态字段来源、网络、单次使用、链上时钟和权限版本。历史资格可以重建，但已删除的当前指针或已撤销资格不会被显示为有效入组。

报价在本机编码纯参数，通过 gRPC 解析共享对象与 Gas 后逐项核对实际 BCS；拒绝改变目标／参数／付款人、附加命令、超预算、非规范长度及尾随字节。选中的 Gas coin 必须是该 Host 当前持有的 SUI，BCS 与 RPC 投影的 ID、版本和摘要必须一致。地址余额支付使用与当前 Sui SDK 一致的 `ValidDuring`：链标识、epoch 区间和随机 nonce；证明短时有效期由 Move 合约检查。真实验证器拒绝了时间戳形式的交易过期，已修正为 SDK 的 epoch 形式，没有广播该次模拟的交易。

- [Go 包测试](evidence/v020-envd-host-join-unit.json)：跨语言 HKDF／JoinIntent 签名、独立 Mysten SDK 交易字节与摘要、权限失效、来源篡改、成员重建，以及 Gas coin 的归属、类型和版本检查。
- [App → Go envd → 真实本地链报价](evidence/v020-envd-host-join-quote-localnet.json)：9 项联合检查、10 笔 App／SDK 夹具交易；Go 接收当前窗口的邀请码，通过 stdin 传递，成功验证组织并模拟兑换报价，**没有广播 Go 兑换交易**。

上述报告记录的是仅报价阶段。后续已接到生产 `--join-host` CLI：隐藏输入、完整组织与费用确认、签名前后核验、原摘要磁盘持久化、单次广播和只读恢复均已实现。

### envd CLI 兑换与原交易恢复增量

- [真实链 CLI 报告](evidence/v020-envd-host-cli-localnet.json)：9 项检查、10 笔成功交易。App 创建的单次码经 stdin 交给独立 Go Host；实际兑换后测试丢弃回执，重建 runner 从真实磁盘 journal 查回同一交易，广播计数为 1，实际费用为 11450292 MIST。公开地址查询原交易无需私钥；随后 App 撤销成员，恢复报告中的有效资格是撤销前的快照。
- [Go 测试](evidence/v020-envd-host-cli-unit.json)四包通过，覆盖原交易优先、互斥与持久化、未知结果阻止替代提交、签名／回执／费用及输入保护。[独立伪终端报告](evidence/v020-envd-host-cli-tty.json)确认隐藏读取关闭 echo，凭据未出现在捕获输出。
- [指导浏览器报告](evidence/v020-app-host-cli-guide.json)覆盖未生成码时的指导、完整公开配置、中英文／明暗主题与公开连接权限保护；[截图](evidence/v020-app-host-cli-guide.png)展示中文白天指导上半部。

链夹具只在测试二进制注入新生成的内存 Host 钥；正式入口仍只加载 OS NativeStore。该测试重建 runner，没有证明进程重启和原生钥恢复。App 的技术 journal 为内存夹具，Go journal 是真实磁盘文件，二者分别记录。Windows 断电持久性、安装后 CLI／NativeStore、实际本地／云 Host、Coordinator 在线、Agent 发现／导入及五平台继续验收。命令与恢复约束详见[envd 接入说明](v020-envd-host-join.md)。

## 复现

先运行隔离 localnet、faucet 并发布当前合约。复用只含公开 package／registry／chain ID 的部署报告，从 `apps/fractalmind-app` 运行：

```sh
node --import tsx scripts/host-admission-localnet.ts /tmp/deployment.json /tmp/new-host-report.json
```

脚本只接受固定 loopback 本地链和对应部署；输出路径必须不存在，避免把未知操作当成重新提交。`.progress.json` 保留准备摘要及交易结果，不包含生成的恢复码、邀请码或私钥。

联合 Go 报价验收时，先在 `runtime/fractalmind-envd` 执行 `go test -c -o /tmp/fm-envd-hostquote-tests ./internal/sui`，再为上述命令设置 `FM_ENVD_JOIN_QUOTE_BIN=/tmp/fm-envd-hostquote-tests`，并选择新的报告路径。这个测试助手仅允许固定隔离 localnet，不是生产入组命令。
