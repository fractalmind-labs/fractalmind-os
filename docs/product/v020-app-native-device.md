# App 原生设备密钥与身份核验

## 边界

Human、组织、DeviceGrant、恢复备份和产品正文保存在 Sui。App 原生层只保存
本机独立设备的 Ed25519 与 X25519 私钥；技术缓存目录只有初始化互斥锁。
浏览器不接收这两份私钥，没有秘密文件降级或静默重新初始化。

当前原生核心使用 macOS Keychain、Windows Credential Manager、Linux Secret
Service 的平台提供者。只有 macOS 的实际系统密钥库流程已有证据；其余平台
未进行原生运行验收。iOS/Android 提供者与移动原生壳仍需实现。

## 接线

- `apps/fractalmind-app/native`：显式初始化、系统密钥加载、公钥读取、Sui PTB
  签名以及限定格式的设备持钥证明。初始化持有进程锁，重复初始化加载原身份；
  缺失、损坏、锁定或不可用的已有条目不会由读取/签名操作自动替换。
  随后增加限定 NodeCommand v1 域的命令签名，见[设备命令传输](v020-app-device-commands.md)；新接口的 OS 安装验收仍待完成。
- `src/native-device.ts`：实现正式 SDK 自付交易管理器的 signer 接口；对返回的
  字节、签名类型、设备公钥及地址再次独立验签。复制调用方交易字节，避免异步
  边界前后的修改改变实际签名内容。
- `src/device-identity.ts`：核对链标识、包来源、对象 UID/共享所有权、Registry
  归属、Human/Grant 绑定、当前代次、链上到期时间与加密公钥。生成新的限定
  challenge，取得原生持钥证明并验签，再次读取版本；变化即拒绝。
- `src-tauri`：四个命令仅授予本地 `main` 窗口；注册应用命令权限清单，禁止
  远程导航。没有 shell、通用文件操作、秘密导出或测试条目删除的 IPC。
- App 身份页面：加载已有设备、显式准备独立设备密钥和核验选定链上 Grant。
  公开连接资料不是登录。核验快照不缓存为权限；独立设备仍需可信设备授权。

签名核心解析并重新序列化完整 Sui BCS Transaction，仅接受 PTB，要求 sender
与 gas owner 都是本机设备地址。费用模拟、明确确认、持久交易日志及未知结果
只读查询由正式 `SelfPayTransactionManager` 负责。持钥证明只接受
`FM-DEVICE-PROOF:1:<chain>:<human>:<grant>:<nonce>:<expiry>`，有效期最多两分钟，
不能用于任意钱包消息签名。

设备持钥核验不替代组织角色、动作权限、具体资源边界和当次交易的链上检查。
本增量尚未接通完整组织管理/费用操作界面、原生恢复码流程或加密正文解密。

## 实际验证

[macOS 原生与实际链报告](evidence/v020-app-native-device-localnet.json)记录十项
检查和四笔真实 Sui 交易：创建生成的 Human 测试夹具；原生设备自付创建组织；
显式授权另一测试设备；由其撤销原生设备。撤销后身份核验失败，新的组织交易
在模拟阶段被拒绝。Rust 签名由 Mysten JS 独立验证。

OS 测试条目处于独立的 `org.fractalmind.app.device.test` 服务及随机 `test-*`
配置名下，不读取用户密钥。每次命令是新的进程；重启与重复初始化保持同一
身份，畸形字节/外部 sender/Gas owner 被拒绝。测试结束后删除该条目，旧 signer
继续失败且不会自动重建。报告没有恢复码、私钥或明文密钥环。

此报告使用隔离测试进程传输、临时 JS 恢复夹具和内存交易日志；它不证明
安装后的 WebView 完整身份流程、持久日志接线或五平台验收。桌面壳编译和
窗口走查是独立证据，不与此签名流程合并为完整 App 验收。

```sh
cargo test --locked --manifest-path apps/fractalmind-app/native/Cargo.toml
cargo test --locked --manifest-path apps/fractalmind-app/src-tauri/Cargo.toml
```

实际 macOS Keychain 与本地链测试（已有隔离部署）：

```sh
cargo build --manifest-path apps/fractalmind-app/native/Cargo.toml --example device-test-helper
cd apps/fractalmind-app
node --import tsx scripts/native-device-localnet.ts /tmp/deployment-report.json /tmp/native-device-report.json
```

原生 IPC 权限设计依据 [Tauri 应用命令与能力说明](https://v2.tauri.app/security/capabilities/)。
系统凭据 API 依据 [keyring Entry](https://docs.rs/keyring/3.6.3/keyring/struct.Entry.html)；
Sui BCS 和交易 intent 摘要使用 [官方 Rust Transaction 类型](https://docs.rs/sui-sdk-types/0.4.0/sui_sdk_types/struct.Transaction.html)。
