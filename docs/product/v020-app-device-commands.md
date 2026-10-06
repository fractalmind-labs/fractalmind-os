# v0.2.0：App 原生命令签名与设备命令传输

依据 PRD v0.11、J11 和 `fractalmind-app-prototype-v2`。本增量接通安全交接所需的状态命令通道；完整交接与 v0.2.0 仍未验收。

## 生产行为

App 的 `NativeDeviceSigner` 支持 SDK `NodeCommandSigner`。原生接口 `fm_device_sign_node_command` 在读取 OS 密钥前，解析并严格重新序列化 NodeCommand v1 签名字节：限定域、动作与范围、规范完整 ID、ASCII 标识、u64 十进制字符串、有效期和大小。只签本机设备地址；返回直接 Ed25519 签名，不能用于任意原始数据或钱包消息签名。JS 再核对返回字节并独立验签；私钥不进入 WebView。

`CoordinatorReadClient.prepareCommand` 接受已签名命令，固定快照并获取一次性挑战。挑战采用独立 `FM-COORDINATOR-COMMAND` 域，绑定链、组织、Coordinator、Human、DeviceGrant、设备、POST 路径、命令范围和整份 HTTP 请求 SHA-256。准备不派发；调用方在明确确认后调用 `send()`。原 GET 读取域保持兼容，GET 证明不能改为 POST。

准备、发送前、响应返回后均重查链上设备权限与绑定。控制请求需要当前 `read` 和 `operate`；只读手机不能取得控制挑战。Coordinator 验证持钥证明、请求哈希、NodeCommand 签名、设备／组织／目标 Host／范围／载荷绑定，再消费挑战并转发精确字节。Host 仍独立检查 Capability、当前实例、预算和准备好的链上 Run；传输资格不是执行许可。

执行结果会正常更新 Organization 对象版本。每次读源仍要求精确类型、UID、所有权与稳定版本快照；跨请求比较具体身份、Grant、角色、组织 active/admin、Coordinator 的授权字段，避免把正常执行目录／证据写入当作撤销。权限或绑定实际变化仍拒绝。

每个准备对象只能发送一次。命令 HTTP 超时、错误响应、签名不可信或发送后的权限变化统一标记 `command_outcome_unknown`，不自动重新派发。调用方须查询原 Run／原交易，不能把 Coordinator 回复直接当作副作用或验收证明。

## 验证证据

- 同一公开测试向量由 SDK 生成签名字节，Rust 真正签名并精确比对，envd 生产验签器独立验证；修改实例后验签拒绝。原生畸形输入测试调用生产接口并证明拒绝发生在 OS 查询前。
- [测试记录](evidence/v020-device-command-unit.json)：App **98/98**、Rust **17/17**，Coordinator／NodeCommand／envd 三包回归和 race 通过；App 类型／构建、真实链脚本类型与桌面原生编译通过。覆盖错误域、签名类型、异步字节修改、请求／目标／范围篡改、只读设备、撤销、绑定变化、一次性消费及未知响应。
- [实际链报告](evidence/v020-device-command-localnet.json)：**22 项检查、27 份成功交易回执与实际费用**，沿现有隔离本地链、新测试身份、真实 Coordinator HTTP、互相认证的 Worker 和生产原生执行器运行。只读 `status` 经 App 原生命令接口形状、精确请求挑战和签名响应传输，原 Run 与结果确认后，第二次 `send` 在 App 阻止，没有第二次 HTTP 派发。Go 随后显式验证已知终结命令的原结果重建。
- 同一独立夹具仍验证两个文件目标、6 次工具支出、KR 实测 2、完整实例目录和排队取消。四条命令均通过 App 的签名桥接；只有本轮状态查询经新增 HTTP 通道，文件控制执行仍用既有 Go 测试协议。`control_confirmed` 仍由 raw SDK 测试设置，不能据此声称 App 安全交接完成。
- [前序检查](evidence/v020-device-command-prior-checks.json)完整保留：第一轮返回未知，随后只读查询原 Run 确认状态 2、结果对象存在、预算结算且控制未授予；原交易被本地节点裁剪，未补造回执或重发命令。第二轮命令传输／实际工具成功，最终撤销测试仍期待旧的服务端错误，实际 App 已在 HTTP 前以 `invalid_grant` 拒绝。修正测试后第三轮完整通过，各独立组织的结果不互相替代。

测试用原生传输注入内存测试钥，Rust 验签核心与该注入传输分开验证。本轮没有证明 OS 密钥库新命令调用、安装后交互、云 TLS Host 或五平台运行；没有更改 UI，也没有把数据移出 Sui。

## 重现

App `npm test`／`npm run build` 在 `apps/fractalmind-app` 执行。仓库根目录用 `cargo test --manifest-path apps/fractalmind-app/native/Cargo.toml` 和 `cargo check --manifest-path apps/fractalmind-app/src-tauri/Cargo.toml` 验证原生层。Go 三包测试在 `runtime/fractalmind-envd` 执行。

真实链需保留当前链与兼容部署，使用不存在的新报告路径。在 Go runtime 下先构建辅助程序：

```sh
go test -c -o /tmp/fm-envd-device-command-tests ./cmd/envd
```

然后在 `apps/fractalmind-app` 执行：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-device-command-tests \
FM_ENVD_CHAIN_CONNECTION=1 FM_ENVD_AGENT_DISCOVERY=1 \
FM_ENVD_AGENT_IMPORT=1 FM_ENVD_NATIVE_DISCOVERY=1 \
FM_ENVD_NATIVE_EXECUTION=1 FM_ENVD_DEVICE_COMMAND=1 \
FM_ENVD_HOST_REJOIN=0 FM_ENVD_AGENT_REBIND=0 \
node --import tsx scripts/host-admission-localnet.ts DEPLOYMENT.json NEW_REPORT.json
```

后续仍需 Host 接受精确约束、旧执行安全结束／未知结果处理、链上 OKR 授权和用户明确继续的完整 App 页面与控制器，以及直接对话／人验收、历史覆盖迁移、升级类型来源、云 Host、原生安装和五平台验收。
