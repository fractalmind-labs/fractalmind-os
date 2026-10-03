# v0.2.0 设备身份与 Coordinator 运行观测读取

产品基准仍是[原型 v2 主机页](fractalmind-app-prototype-v2/js/view-hosts.js)和 [PRD](fractalmind-app-prd.md)。该增量连接已关联设备到组织 Coordinator 的只读 API，及 App 的“主机与算力 → 运行观测”。完整 v0.2.0 未完成。

本文记录设备读取增量 `8d43406` 及其当时证据。后续已接入 [Host 独立签名](v020-host-signed-observations.md)，最新页面和可信边界以该记录为准。

## 身份和状态归属

设备钥继续保留在原生 OS 密钥库。App 使用现有 `fm_device_prove` IPC，不导出钥，不在浏览器创建替代钥。Sui 的 Human、当前 DeviceGrant、OrgRole、组织和 CoordinatorBinding 决定读取权；公开 ID、Host 成员资格和 Bearer token 不代表设备持钥或读取授权。

`sui.host_connection_enabled` 的 Coordinator 读取入口要求 `protocol_registry_id`，从绑定当前链的注册表定位 IdentityRegistry。每次检查 shared 对象来源／类型／UID、Human 网络／代次／目录、Grant 的设备／read／组织范围／期限／版本，以及组织有效性和角色。RPC 失败或来源变动不返回私有目录。没有业务后端；socket 目录、一次性挑战及页面观测是可丢弃内存状态。

## 一次读取

1. App 重新验证设备与组织；从该组织的链上目录读取 Coordinator origin 和公钥。只接受 HTTPS 或明确 loopback HTTP，禁止重定向、URL 凭据及任意客户端输入的入口。
2. `POST /api/device-challenge` 请求绑定 Human／Grant／设备／组织／binding 和具体 GET 路径。服务端先验证当前链权限，再生成 16 字节随机 nonce 和 60 秒期限。挑战含 Coordinator 签名；最多保留 256 个待用挑战，不落盘，重启即失效。
3. App 用链上公钥验证挑战及期限，再重读 binding；随后原生设备钥签署受限的 Sui PersonalMessage `FM-DEVICE-PROOF:1:...`。签名只在该次操作内存中使用。
4. App 以 `Authorization: FractalMind <base64url proof>` 发出绑定的 GET。Go 校验规范序列化签名、Sui PersonalMessage intent／BCS／blake2b 摘要及公钥派生地址；有效证明只消费一次。路径、查询参数、方法、期限、签名或授权改变均拒绝。
5. 服务端重读权限，先在有大小上限的内存缓冲中生成数据，释放前再次重读版本和期限。对精确正文 SHA-256 和 chain／org／binding／nonce／方法／路径／状态码签名。App 核验响应签名，并再次读取当前设备与 binding 后才显示正文。

只读路径为 `/api/sentinels`、`/api/health`、`/api/sentinels/<完整 Host 地址>` 和其 `/agents` 子路径。HTTP 写入和桌面控制尚未接通本协议，不能借 read 证明执行命令。无 cookie／缓存登录，旧 Bearer token 不回退为设备权限。失败不自动重放；用户重新读取会准备新挑战。

## App 交互

链上入口加载可在网页查看；签名读取只在安装后 App 开启，先匹配本机设备钥的唯一当前 read Grant，再走上述生产客户端。按组织范围优先选择授权；重复可用授权保持错误，不任意挑选。

返回内容经过大小和结构检查：完整稳定 Host 地址且不重复、计数一致、有限整数资源、有效心跳时间。显示主机、系统／CPU、实例数和心跳时间；超过一分钟或未来时间显示未知／陈旧。读取失败、改设备、改入口时清除旧观测，切换组织重新挂载，不显示另一个组织的数据。没有观测业务缓存。

**该阶段的可信边界：数据由 Coordinator 签名，当时尚无 App 可独立验证的 Host 签名正文。** 当时页面标为“入口观测”，不提升为 Host 在线凭据、独立 Agent 控制证明或执行权限。后续 Host 签名已实现，见首节链接；链上成员目录依然单独展示，正在运行的 Agent 不因读取自动导入或重启。

## 验证

- [真实 localnet 报告](evidence/v020-device-http-localnet.json)：12 项检查、10 笔确认交易。实际 Go Host 从 App 邀请加入并连接真实 loopback Coordinator；生产 App 客户端经设备证明读取实际心跳与 CPU，列表通过页面使用的格式校验。未签名／旧 token 拒绝；挑战准备后由链上真实交易撤销设备，实际 HTTP 读取拒绝。仍覆盖 Host 成员撤销和原摘要一次广播恢复。
- [单元／race 摘要](evidence/v020-device-http-unit.json)：Go 三包全部通过，覆盖 read-only 设备、权限来源、期限／代次、scope、变动与未知读取、签名／重放／请求范围、生成正文期间撤销、容量及体积限制。App 64/64 通过，包含未信任挑战不触发原生签名、响应正文篡改、响应期间授权／binding 改变及格式拒绝；生产构建通过。
- [浏览器证据](evidence/v020-device-http-browser.json)及[英文夜间截图](evidence/v020-device-http-browser-en-dark.jpg)：真实旧组织链目录可读；新入口显示；网页签名按钮禁用，中英文／深浅主题走查。它不证明安装后原生签名页面全流程。

链联调使用隔离生成的内存夹具钥和注入的 NativeInvoke。证明格式、实际 Sui 权限、Go HTTP／WebSocket、生产控制器和列表结构已验证；OS 密钥库、正式 main 启动／进程恢复、安装后 App、公开 TLS／云 Host、Host 独立签名和五平台仍需验收。现有原生 App 等待系统密钥库授权，相关用户提示已发出。

## 复现

在 `runtime/fractalmind-envd` 构建 `go test -c -o /tmp/fm-envd-device-http-tests ./cmd/envd`，再在 `apps/fractalmind-app` 运行：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-device-http-tests FM_ENVD_CHAIN_CONNECTION=1 node --import tsx scripts/host-admission-localnet.ts /tmp/deployment.json /tmp/new-device-http-report.json
```

复用隔离 localnet 的公开部署，报告路径须新建。邀请码秘密仅通过 stdin，报告不含邀请码、恢复码、钥或设备证明；每次运行只使用新的测试身份。
