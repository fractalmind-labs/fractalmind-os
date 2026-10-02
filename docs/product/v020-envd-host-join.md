# v0.2.0 envd：Host 邀请兑换与原交易恢复

产品入口依据[原型 v2](fractalmind-app-prototype-v2/js/view-hosts.js)。App 创建单次链上邀请；新 Host 用独立本机钥确认组织、入口和有限权限，再自行支付兑换 Gas。组织成员资格由 Sui 保存与校验，Coordinator 在线路由、envd 运行和 Agent 导入继续独立验收。

## 已实现的命令

1. 从 App 接入指导复制公开连接配置。`protocol_registry_id` 是 ProtocolRegistry，与旧 peer discovery 的 `registry_id` 分开；升级后的类型来源用 `protocol_original_package_id`。
2. `envd --config sentinel.yaml --init-host` 明确初始化 OS 原生存储中的独立签名／加密钥，只输出公钥与地址。普通启动不会替换已有身份。
3. 给该 Host 地址充值 Gas，运行 `envd --config sentinel.yaml --join-host`。邀请码通过终端隐藏输入读取，管道输入也有行长度限制；不接受命令行参数或配置里的邀请码。
4. 查看网络、完整组织 ID／名称、Coordinator 公钥／地址／origin、邀请与成员期限、有限观察期限、付款地址、预计 Gas 和最大 Gas。输入 `JOIN <完整组织 ID>` 才继续；其他文本取消，不签名或广播。当前邀请码授予最多 10000 次观察能力，不授予文件写入、OKR 执行或桌面控制。
5. 结果未知时运行 `envd --config sentinel.yaml --host-join-status --host-address <完整 Host 地址>`。该路径不访问私钥；重复普通接入命令也先查询原交易，不要求重新输入码。

接入配置是公开、可丢弃的连接提示。邀请码 FHI1 的 256 位秘密只在当前进程内存；证明绑定具体邀请、组织、入口版本、Host 签名／加密公钥和短时有效期。私钥不进 JS、日志、argv 或报告。

## 提交约束

- 从 Sui 最新 typed shared 对象／UID、精确动态字段 owner／type／name，核对注册表、组织、入口、邀请、发行 Human／Grant、管理员角色、当前目录和 Clock。网络、组织、单次使用、代次、权限版本或期限改变都拒绝接入。
- 参数在本机编码，模拟后核对实际 BCS，只允许一次 `host::redeem_invite`，其对象、参数顺序和证明必须匹配。Gas coin 必须是本机地址当前持有的 SUI，版本和摘要与 BCS 一致；地址余额支付使用官方 SDK 的 epoch `ValidDuring` 与随机 nonce。
- 费用确认后、签名前后重新核对授权；签名后模拟精确原字节，不选择新 Gas。签名必须来自本机 Host 钥并覆盖原字节；同一报价最多广播一次。
- 广播前原子准备并 flush 技术记录；文件仅有原摘要、Chain ID、付款地址／Gas 上限与价格、公开 package／组织／邀请 ID。按链与 Host 的命名空间互斥，未确定的原摘要不能被替换；记录损坏也不会自动生成新尝试。
- 查询原交易时核对 BCS 摘要、发送者、Gas 付款人／价格／预算、effects 摘要／状态及实际费用。费用按计算＋存储－返还计算，保留负值，不重复添加 non-refundable 部分。失败也保留费用；RPC 缺失、不可查询或回执不完整保持未知。
- 只有原回执已确定且明确使用 `--new-host-join-attempt`，才预检新码；新确认完成后归档旧摘要。取消或权限改变不会归档。记录成功交易不等于当前资格；成员状态从链上重建，撤销后拒绝新受保护操作。

## 实际证据与范围

- [CLI 联合真实链报告](evidence/v020-envd-host-cli-localnet.json)：App 创建邀请，独立 Go Host 兑换；测试故意在实际广播后丢弃回执，首次返回 unknown，重建 runner 从磁盘原摘要恢复同一交易、费用与成员资格，广播次数为 **1**。无私钥公开查询通过；随后 App 撤销该成员，完整夹具 **9 项检查、10 笔成功交易**。
- [Go 测试](evidence/v020-envd-host-cli-unit.json)：持久化与互斥、记录篡改／损坏、原交易优先、费用／摘要／签名校验、单次广播，以及取消、输入上限和输出无秘密等通过。
- [伪终端](evidence/v020-envd-host-cli-tty.json)：真实终端接口读取时关闭 echo，捕获输出没有输入凭据，完整组织确认可继续。
- [App 指导页面](evidence/v020-app-host-cli-guide.json)与[中文白天截图](evidence/v020-app-host-cli-guide.png)：公开配置包含当前完整 Chain ID 和独立协议注册表；真实命令、查询路径、中英文／明暗主题可见。未生成邀请码也能查看指导；公开浏览器没有管理签名权限。

真实链夹具仅在测试二进制中注入新生成的内存钥，正式 `envd` 入口只打开 OS 原生存储。磁盘技术 journal 是真实文件；恢复是重新创建 runner，**未证明进程重启后的原生钥恢复**。伪终端与真实链测试是两个分别记录的测试。App **60/60**、类型和生产构建通过。

仍需完成安装后 NativeStore／CLI 联测、实际本地／云 Host 与 Coordinator、发现／导入和五平台。Windows journal 目前 flush 文件；原生断电／重命名持久性门禁未验收。原生 App 的 Keychain 访问还等待用户授权，未重启现有进程绕过。完整 v0.2.0 继续依据[验收映射](fractalmind-app-v020-validation.md)，未标记完成。

## 复现

复用只含公开部署信息的隔离 localnet 报告，在 `runtime/fractalmind-envd` 构建测试助手：

```sh
go test -c -o /tmp/fm-envd-hostjoin-cli-tests ./cmd/envd
```

在 `apps/fractalmind-app` 运行：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-hostjoin-cli-tests node --import tsx scripts/host-admission-localnet.ts /tmp/deployment.json /tmp/new-envd-host-cli-report.json
```

邀请码和确认只经 stdin，报告路径必须是新的。`.progress.json` 和 `.journal` 保留原摘要与公开元数据；不重跑未知报告覆盖原交易。普通 Go 单元运行跳过显式真实链／伪终端助手。
