# v0.2.0 Host 与 Coordinator：当前链资格和连接身份

入口继续依据[原型 v2 主机页](fractalmind-app-prototype-v2/js/view-hosts.js)及 [PRD J7/J11](fractalmind-app-prd.md)。本增量接通邀请码兑换之后的 Host 连接；Agent 发现／导入和执行授权仍需继续完成。

## 启动与连接

App 的 Host 接入指导提供 `sui.host_connection_enabled: true`，与执行适配器的 `runtime.enabled` 分开。接入后运行 `envd --config sentinel.yaml`，加载 `--init-host` 明确建立的 OS NativeStore 身份，不生成另一份 legacy 钱包作为该 Host 的连接身份。没有原生钥则拒绝启动；配置里的 Host ID 必须匹配公钥派生地址。名称只用于展示。

每次重连先核验完整 Chain ID，再读取指定组织的当前 `active_hosts` 动态字段、HostMembership 和 CoordinatorBinding。对象来源、shared UID、动态字段父对象／类型／名称、目录关联、公钥／地址、成员期限、组织有效性与版本均核验；未知 RPC 或缺失当前指针不授予连接权。精确读取本机加密公钥，防止签名身份与数据身份混用。

Host 用链上 origin 构造 `/ws`，只允许 HTTPS 或明确 loopback HTTP；不使用配置里的任意 gateway 地址或首次信任。双方进行随机 nonce Ed25519 认证，Coordinator 的身份由当前链上公钥固定。绑定／成员版本或入口改变时中断旧连接，下一次拨号重新读取和认证。

组织的 Coordinator 启动时设置：

```yaml
roles:
  coordinator: true
coordinator:
  binding_id: "0xFULL_COORDINATOR_BINDING_ID"
sui:
  host_connection_enabled: true
```

还需合并接入指导的完整公开链、类型包、组织和 RPC 配置。Coordinator 的签名钥必须匹配该组织索引中的 binding。允许名单只能额外收紧访问；名单为空也不能绕过当前链资格。Coordinator 可以独立提供连接入口，其 worker 角色仍须自己的 Host 成员资格才会上报为执行主机。

## 连接后的校验

- Coordinator 保留实际认证地址与公钥。注册与心跳的 `host_id` 必须匹配它；主机名不能充当链上路由身份。
- 握手、注册、心跳、消息、命令／桌面转发及周期 ping 重新查询当前资格。撤销、到期、绑定变化或读取失败关闭连接／拒绝转发；历史邀请回执不替代当前指针。
- 命令与桌面回执绑定原连接，其他 Host 不能完成该请求。旧连接断开不会删除另一条当前连接；重复活动连接拒绝替换。
- Host 收发时也核验当前链资格和连接版本。关闭取消正在进行的链读取、拨号与重连等待；重复关闭不崩溃。
- 链连接模式不调用旧扫描器的自动重启，保留原有 Agent 进程与任务。观察资格不是控制权；旧桌面信令不能携带设备授权，正式 Host 在该模式拒绝其控制转发。完整远程桌面仍需接入绑定具体动作的设备权限。

持久成员资格由 Sui 保存；Coordinator 的 socket／心跳目录只是可丢弃观测，不新增业务数据库。直接 HTTP API 的设备读取鉴权已在[后续增量](v020-device-http-read.md)接通；当前 loopback 测试不作为公开部署验收。通过握手认证的心跳也不等于可由 App 独立核验的 Host 签名观测正文。

## 实际测试

- [真实链与 loopback 报告](evidence/v020-host-chain-connection-localnet.json)：App 创建组织／入口／单次邀请，独立 Go Host 兑换；仍覆盖实际广播后丢失回执、真实磁盘原摘要恢复和一次广播。使用保留的随机 loopback 端口，Host 从链上选择入口，双向认证并上报真实心跳。App 链上撤销成员后，Coordinator 路由明确因当前指针缺失而拒绝，Host 也拒绝后续心跳。**10 项检查、10 笔成功交易**。
- [四包 race 测试](evidence/v020-host-chain-connection-unit.json)：来源、期限、撤销、变更期间读取、Host ID 伪造、错误入口、其他连接冒领回执、清理与取消重连等通过。生产 envd 编译、App 类型与生产构建、联合脚本类型检查通过。

测试 Host／Coordinator 钥在 Go 测试二进制内生成；App 管理设备仍为注入的内存夹具钥。它验证实际 socket 和生产连接函数，不证明正式 `main` 的 NativeStore 启动、进程重启、安装后 App、TLS 公网部署、云 Host、五平台或已有 Agent 导入。Host 签名观测、桌面授权和完整 Agent 闭环继续实现；设备 HTTP 读取的后续证据见上述增量。完整 v0.2.0 未完成，见[验收映射](fractalmind-app-v020-validation.md)。

## 复现

在 `runtime/fractalmind-envd` 构建：

```sh
go test -c -o /tmp/fm-envd-chain-connection-tests ./cmd/envd
```

复用已有隔离 localnet 的公开部署，在 `apps/fractalmind-app` 运行：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-chain-connection-tests FM_ENVD_CHAIN_CONNECTION=1 node --import tsx scripts/host-admission-localnet.ts /tmp/deployment.json /tmp/new-chain-connection-report.json
```

报告路径须新建；邀请码仅经 stdin，公开结果不含邀请码、私钥、签名交易或恢复码。该夹具的 RPC／faucet 固定 loopback，不访问用户钱包或云主机。默认单元测试跳过显式真实链助手。
