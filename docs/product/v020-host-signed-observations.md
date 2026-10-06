# v0.2.0 Host 独立签名心跳与 App 核验

基准：[原型 v2 主机页](fractalmind-app-prototype-v2/js/view-hosts.js)、[PRD](fractalmind-app-prd.md) 的 Host 观测及 J11 前置条件。该增量接在[设备读取鉴权](v020-device-http-read.md)之后；完整 Agent 发现／导入与 v0.2.0 仍需继续完成。

## 从 Host 到 App

链连接模式的 Host 每次签名前重新读取当前成员和 Coordinator 入口。在原有 `Send("heartbeat", ...)` 路径上构造 `host_observation`，由同一原生 Host 签名钥签署，不能回退为 unsigned heartbeat。普通 legacy 模式继续兼容原有协议。

签名 envelope 包含：

- 完整 Chain ID、组织、Host 地址、成员 ID／逻辑版本及 binding ID／逻辑版本。
- 本次双向握手的 Coordinator 随机 nonce、该连接内单调递增的序号。
- Host 观测时间、最多 60 秒且不超过成员期限的有效期。
- 精确原始心跳 JSON 字节的规范 base64；Ed25519 签名绑定前述字段及正文 SHA-256。版本使用规范 u64 十进制字符串，序号受 JS 安全整数上限约束；正文最多 256 KiB，字段／类型／期限／编码与未知字段均校验。

Coordinator 先验证握手地址、公钥、nonce 和序号，再验证 Host 签名及当前链范围；释放到目录前再次检查新鲜度。重放、另一连接的 nonce、换组织／链／成员／入口版本、无签名或撤销资格均拒绝。保留原始 signed envelope，HTTP 读取响应另以 Coordinator 签名绑定具体设备读取。这两个签名分别证明入口回应和 Host 的观测来源。

本流程是 Host 主动报告的观测；不会预约、消费或扩大 RemoteCapability 的远程动作执行权，也不创建业务状态。成员、授权及后续导入关联仍以 Sui 为准，连接和观测均为可丢弃内存数据。

## App 的独立判断

`CoordinatorReadClient.readHosts` 完成设备读取鉴权后，从链上重建 Host 目录、精确查询 `active_hosts[Host address]`，匹配当前成员、Host 公钥／地址、组织、binding 和版本。用该 Host 公钥验证精确正文；资源和心跳时间取自 Host 原文，Coordinator 的汇总字段不提升为 Host 证据。

释放结果前重读目录／binding 和当前指针，再重核设备读取权。RPC 失败、签名或范围异常只将相关 Host 标为未知，隐藏其资源值；不会把另一个有效 Host 一并隐藏。入口整体变动则整次读取失败。使用 Sui Clock 校准本机内存有效期；不能因为设备壁钟不同延长可信窗口。

“主机与算力 → 运行观测”显示当前有效的 **已验证 Host 签名**、心跳时间、系统／CPU 与实例数；期限到了变为过期，资源值和实例数隐藏。改设备／入口、切组织或读取失败清除结果。父页面的设备授权、Human 代次、成员指针／版本、binding 或连接可用性发生变化时，也清除结果并拒绝旧请求的迟到返回。没有观测业务缓存。

**签名心跳证明 Host 在有限窗口内作出了该报告，不是物理硬件证明、持续可达承诺、独立 Agent 身份或约束控制能力。** 当前 Agent 描述仍来自 legacy 扫描器；稳定实例连续性、工作区、适配器能力、仅观察导入和实际交接需继续实现。页面不会因为发现计数自动导入／重启 Agent，或授予 OKR 执行权。

## 实际证据

- [真实 localnet 报告](evidence/v020-host-signed-localnet.json)：**14 项检查、10 笔确认交易**。实际 Go Host 的系统心跳经真实 WebSocket、设备鉴权 HTTP 和生产 App 客户端读取，App 独立核验原始 Host 签名及当前成员指针；篡改正文变为未知。Sui 撤销成员后，同一保留签名不再可信。仍覆盖设备撤销、路由拒绝和原摘要一次广播恢复。
- [测试摘要](evidence/v020-host-signed-unit.json)：Go heartbeat／ws／Coordinator／envd 四包 race 通过；签名字段／原文、期限、nonce／序号重放、旧 unsigned 消息、注册与资格检查均覆盖。App **67/67**，包含双 Host 独立结果、汇总篡改、来源变化／指针替换、RPC 故障、过期、目录替换及 Clock 校准；生产 App 与 envd 构建通过。
- 同一摘要记录 envd 的 darwin/arm64 原生构建、windows/amd64 与 linux/amd64 交叉编译产物和 SHA-256。它们仅证明可构建，不证明对应 Host／App 的安装后运行，更不替代 iOS／Android 验收。
- [浏览器证据](evidence/v020-host-signed-browser.json)与[中文白天截图](evidence/v020-host-signed-browser-zh-light.jpg)：实际链入口可读、网页签名按钮禁用、中英文／明暗与新可信说明走查。未注入模拟可信主机，不作为安装后正向签名 UI 验收。

真实链报告使用生成的测试 Host／Coordinator 内存钥和 App 注入 NativeInvoke，不访问用户钱包。它证明生产签名与核验函数及实际链／socket 协议互通，尚不证明 OS Keychain／正式 main 的安装后旅程、TLS／真实云主机或五平台。现有原生 App 等待系统密钥库授权；完整验收映射见[验证记录](fractalmind-app-v020-validation.md)。

## 复现

在 `runtime/fractalmind-envd` 运行：

```sh
go test -c -o /tmp/fm-envd-host-observation-tests ./cmd/envd
go test -race ./internal/heartbeat ./internal/ws ./internal/coordinator ./cmd/envd
```

再在 `apps/fractalmind-app` 复用隔离 localnet 公开部署并新建报告路径：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-host-observation-tests FM_ENVD_CHAIN_CONNECTION=1 node --import tsx scripts/host-admission-localnet.ts /tmp/deployment.json /tmp/new-host-signed-report.json
```

报告不保存邀请码、恢复码、设备持钥证明、签名交易或私钥。每次使用新测试身份，未知交易先查询原摘要，不重放。
