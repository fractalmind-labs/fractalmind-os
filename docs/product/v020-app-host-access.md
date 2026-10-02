# v0.2.0 App：组织 Host 邀请与管理

界面来源：[原型 v2 的主机页](fractalmind-app-prototype-v2/js/view-hosts.js)。正式客户端的“主机与算力 → 接入主机”已连接实际 Sui 合约与自付交易控制器。Host 的邀请码兑换 CLI、安装后原生 UI 联合验收及实际本地／云端运行仍待完成。

## 管理设备的操作

1. 登记组织入口：核对 Coordinator Ed25519 公钥及 HTTPS origin，公钥派生入口地址；仅 loopback 允许 HTTP。输入地址不证明 Coordinator 正在运行。
2. 创建单次邀请：选择链上入口与 15 分钟／1 小时／24 小时有效期，明确兑换后的成员期限（1–90 天）和观察能力期限。当前合约只发放最多 10000 次有限观察能力；执行 OKR、写文件及桌面控制仍需具体授权。
3. 每个写操作重新核验原生持钥、Human／Grant 代次、read／manage_hosts、组织范围和管理员角色。实际模拟报价，展示付款地址、余额、预计 Gas 与上限，经明确确认再签名和提交。
4. 确认交易 effects 的输出版本已可读取后才显示邀请码。链上保留证明公钥，邀请码中的 256 位秘密只在当前窗口内存；不进入 localStorage、IndexedDB、报告、日志或 URL。关闭／刷新／重启后无法恢复。遗失未用码可撤销链上邀请，再明确创建新的。
5. 已消费邀请无法用于撤销 Host；单独选择成员记录、核对并支付撤销交易。撤销拒绝新的受保护操作，不表示已结束在途工作。

公开链连接只能读取目录。网页入口不会初始化私钥或获得管理授权。原生 Host 与管理设备是不同地址，Host 自己的兑换／结果交易也需要 Gas。接入指导给出实际 `envd --config sentinel.yaml --init-host` 命令；当前不提供不存在的兑换命令，也不把启动 envd 当成入组。

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

## 复现

先运行隔离 localnet、faucet 并发布当前合约。复用只含公开 package／registry／chain ID 的部署报告，从 `apps/fractalmind-app` 运行：

```sh
node --import tsx scripts/host-admission-localnet.ts /tmp/deployment.json /tmp/new-host-report.json
```

脚本只接受固定 loopback 本地链和对应部署；输出路径必须不存在，避免把未知操作当成重新提交。`.progress.json` 保留准备摘要及交易结果，不包含生成的恢复码、邀请码或私钥。
