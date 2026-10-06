# v0.2.0 Host 接入与链上授权

范围与验收：[里程碑总览 #40](https://github.com/fractalmind-labs/fractalmind-os/issues/40)、[实现验证记录](fractalmind-app-v020-validation.md)。本文件记录已经实现的接入协议与验证边界，不代替完整 Issue 验收。

## 实现职责

| 组件 | 当前实现 |
| --- | --- |
| Sui 合约 | Human/DeviceGrant 权限交集、组织入口绑定、限时单次邀请、Host 成员资格、有限观察能力、受管理实例与版本绑定 |
| SDK | 本地生成邀请码秘密、构建邀请证明与交易、读取资格、分页重建实例，使用原始类型包 ID 支持后续包升级 |
| envd 授权读取 | 原生 gRPC + 严格 BCS；新请求核验当前能力、主机、设备、角色、实例及各依赖版本 |
| Coordinator | 路由及鉴权仍待迁移；链上绑定不是在线或路由成功的证明 |

链上保存邀请证明公钥。邀请码包含网络、邀请对象 ID 与随机 256 位秘密，秘密不上链。SDK 派生邀请证明密钥，签署包含 Host 公钥/地址、加密公钥、组织、入口版本及期限的 BCS 意图。Host 用自身密钥签署 Sui 兑换交易。复制证明无法换成另一 Host，拥有完整邀请码的两个 Host 竞争时仅第一笔成功。

邀请发放时钉住发行 Human、设备及授权版本；撤销、换版或身份恢复使尚未兑换的旧邀请失效。兑换成功后 Host 属于组织，其观察资格不再依赖邀请发行设备持续有效。撤销已消费邀请码不能踢出 Host，须撤销其成员资格。

## Agent 发现与重新纳管

公开 Agent 注册与组织纳管是两类记录。管理设备确认有效 Host 上的稳定实例标识、运行时与工作区摘要。`tmux-observe` 只能观察，`bounded-process-v1` 的管理确认不能替代适配器在实际执行前的能力核验。

同 Host + 稳定实例 ID 的重复导入返回原记录；不允许悄悄改变工作区、成员资格或控制状态。同名但不同 Host 各自保留记录。Host 重新接入后，由管理设备显式 `rebind_agent` 沿用原记录并提升版本，先前能力因成员或实例版本不符失效。

目前最多 24 小时的邀请有效期、最多 90 天的成员期限、能力期限不超过成员与设备授权期限。SDK 默认邀请兑换后的成员期 30 天、观察能力期 1 天；App 已接通[管理端邀请与费用确认](v020-app-host-access.md)，续期和 envd 兑换入口仍须完成。

## 执行端授权读取

`ChainAuthorityResolver` 不信任自报 Host ID、公开注册、标签或本地 authority.json。所有保护依赖必须来自配置的原始协议类型包，shared 对象 UID 与元数据一致，动态字段归属及名称一致。读取以下状态：

1. RemoteCapability 与其私有 AuthorityBinding。
2. Organization、HostMembership、CoordinatorBinding 及当前 Host 成员索引。
3. 对设备能力读取 Human、DeviceGrant 与组织角色，校验动作、组织、代次、撤销、版本及期限。
4. 对实例能力读取 ManagedAgent，校验 Host/实例归属、当前成员与版本；执行能力需要实际受约束的运行时。
5. 重读所有依赖的最新对象版本，读取期间变化则拒绝；预留前再次读取，避免使用过期投影。

读取结果仅是授权投影。命令和预算通过 `node_execution` 原子预留并创建检查点；`ChainReservations` 只接受与签名意图完全一致、由设备事先创建的排队记录。Host 启动事务在链上再次核验当前依赖，并记录本次随机尝试标识。执行端确认该标识后才能调用适配器，回执未知时保留 digest，不重发启动。完整说明见 [命令检查点](v020-node-execution.md)。

生产工厂已接入链上 AuthorityStore、启动预留和加密结果存储，Host 密钥由 OS 凭据库加载；真实链观察及重启查询已验证，见 [Host 身份与执行器](v020-host-identity-runtime.md)。当前 agent-manager 仅观察，真实受约束执行和完整 #30 验收仍待完成。

## 可复现验证

使用隔离的本地 Sui 网络与 faucet，RPC 默认 `127.0.0.1:29000`、faucet 默认 `127.0.0.1:29123`。脚本会生成独立测试签名及加密密钥，不读取用户 keystore，不写出私钥或恢复/邀请码；仅接受 loopback RPC/faucet，并用本地测试 SUI。

从仓库根目录：

```sh
FM_TEST_PACKAGE=$(python3 protocols/fractalmind-protocol/sdk/scripts/prepare-localnet-package.py)
sui move build --path "$FM_TEST_PACKAGE" --dump-bytecode-as-base64 > /tmp/fractalmind-v020-host-bytecode.json
cd protocols/fractalmind-protocol/sdk
FM_HOST_ACCEPTANCE=1 FM_HOST_AUTHORITY_VERIFY=1 node --import tsx scripts/identity-localnet.ts /tmp/fractalmind-v020-host-bytecode.json /tmp/fractalmind-v020-host-results.json
```

Go 工具链须可用。独立网络地址可用 `FM_LOCALNET_RPC`、`FM_LOCALNET_FAUCET` 指定。脚本发布零地址临时包，不更改仓库 published-at/命名地址，不升级真实已部署包。事务执行结果及 digest 先落到 `.progress.json`；确认中断不能推断原事务失败，更不能自动重放。完整报告只有所有断言通过后写出。

Host 基础证据：[真实本地链报告](evidence/v020-host-admission-localnet.json)，包含 48 笔交易与 6 次真实 Go gRPC 权限核验。加入 `FM_NODE_CHECKPOINT_ACCEPTANCE=1` 可同时运行命令预留、启动、终态及恢复测试；扩展证据见 [命令报告](evidence/v020-node-execution-localnet.json)。

尚待：已发布包实际升级、邀请码兑换 CLI 与安装后 App 联测、真实本地/云端 envd、运行时能力核验、签名心跳、设备鉴权路由、完整费用及 OKR 预算联动与完整 OKR/App 闭环。
