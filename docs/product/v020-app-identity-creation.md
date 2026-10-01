# v0.2.0 App：原生身份创建与运行费准备

界面基于[原型 v2](fractalmind-app-prototype-v2/README.md)的“创建我的身份”入口。
正式创建控制器是 `apps/fractalmind-app/src/onboarding.ts`；
`CreateIdentity.tsx` 将原生凭据、运行费与链上确认接入欢迎页。

## 已接通的创建路径

1. 检查公开部署和真实 chain identifier。开发部署资料只需要 RPC、Package、ProtocolRegistry，
   不要求用户预先拥有 Human。正式网络的默认部署配置尚未发布。
2. 用户明确选择“准备设备与恢复码”。生成独立 Ed25519／X25519 设备密钥、256 位恢复熵和初始内容密钥；
   密钥材料写入系统密钥库。原生侧构造恢复备份及设备密钥包，只返回公开密钥与认证密文。
3. 新恢复码显式显示一次，由用户保存。确认保存前不能准备／提交创建交易；确认后页面隐藏码。
   加载已有创建配置只返回公开密钥和新包装的密文，不重新显示恢复码，也不覆盖已有凭据。
4. 页面分别显示恢复地址与独立设备地址、当前余额和充值说明。
   现有合约要求恢复地址签名创建 Human；个人组织随后由独立设备签名创建，故是两笔自付交易。
   每笔的 Gas 上限为 0.2 SUI，模拟报价给出预计费用，链上结果给出实际费用；这是上限，不是固定费用。
   充值／检查余额不会自动提交，不需要用户原有钱包的私钥。
5. 每笔操作先模拟并报价，用户明确确认才签名并广播。
   使用正式 `SelfPayTransactionManager` 与 `IndexedDbTransactionJournal`；日志只存技术请求 ID、摘要和 Gas 元数据。
   响应未知先查原摘要；目录索引晚于回执可见时只读等待，不重放。
6. 创建后用公开恢复地址定位 Human，检查 Registry／BCS UID／共享所有权／网络／版本／公钥绑定，
   再由原生独立设备证明持钥与当前 Grant。创建个人组织后可以打开真实组织视图。
   组织角色、正文解密和其他管理动作仍需各自接通，创建成功不默默开启这些操作。

恢复地址与设备私钥均没有进入 JS signer。浏览器仅有一次供用户备份的恢复码、公开资料、密文和签名。
公开部署与本机配置名是可丢弃的连接偏好；持久 Human／Grant／组织／恢复密文在 Sui，私钥保存在系统凭据库。
当前创建备份兼容 SDK 的初始 `format:1/contentKey/historicalKeys` 包装，后续组织密钥及权限轮换还需接入原生解密／管理流程。

## 协议与原生边界

- 恢复码沿用 SDK 的 `FM1:<network>:<256-bit entropy hex>:<SHA-256 checksum>` 格式；
  HKDF-SHA256 的盐与 info 分别为 `fractalmind.recovery.v1`、`signing`／`encryption`。
- 加密包装沿用 `FMW1 + ephemeral X25519 public key + salt + FME1 + nonce + AES-256-GCM ciphertext/tag`，
  拒绝低阶共享秘密，随机 nonce，认证上下文绑定网络和接收地址。
- 依赖为 [RustCrypto AES-GCM 0.10.3](https://docs.rs/aes-gcm/0.10.3/aes_gcm/)、
  [HKDF 0.12.4](https://docs.rs/hkdf/0.12.4/hkdf/)及现有 X25519／Ed25519 实现。
  原生包装与派生结果由独立 JS 验证，不依赖只有 Rust 自己能解密的测试。
- 新增三个 main 窗口的本地原生命令：创建、读取公开创建资料、恢复地址签署自付 PTB。
  私钥不导出；原生签名检查 canonical BCS、sender、Gas owner 及 programmable transaction。
- 开发构建可用 `FM_NATIVE_ACCEPTANCE=isolated` 选择独立测试密钥库，窗口明确标识 local acceptance，
  并且仅接受 `test-*` 配置名。release 构建不启用此模式。它不改变链上权限或引入业务后端。

## 当前测试证据与限制

- App **33/33** 单元测试、TypeScript 及生产构建通过；原生核心 **6/6**，Tauri 来源限制 **1/1**通过；
  macOS debug `.app` 构建／打包通过。生产网页实际点击创建入口显示需原生 App，未出现密钥生成／恢复秘密输入。远端 CI 与 Windows／Ubuntu 系统凭据实际操作尚未验证。
- [真实 localnet 报告](evidence/v020-app-native-onboarding-localnet.json)：**7 项检查、2 笔真实交易**。
  原生生成代码与 SDK 派生公钥一致；原生密文由 JS 解密；跨进程只读加载；重复创建与错网络拒绝；
  零余额阻止准备；原生恢复签名创建 Human；独立设备创建组织；重建控制器查询同一摘要；
  删除技术交易缓存后从链上重建同一 Human／组织，并拒绝重复创建。
- 该链测试使用隔离子进程传输和内存 journal；实际界面连接了持久 IndexedDB，
  但本次原生窗口走查被系统锁屏阻挡，**未验证安装后 UI 的整条创建旅程**。
  所有测试凭据已删除；报告不保存恢复码或私钥，不使用用户 keystore。
- 仍未完成：失败后显式新尝试／费用历史界面、完整配对／消费式恢复、原生正文解密与数据同步、
  Host 接入／发现／导入、沟通与自主运行、真实云端 Host，以及五平台安装和完整流程验收。
  这些要求保留在整体 v0.2.0 范围中，不因创建增量通过而标记完成。

复现（仓库中已部署的隔离 localnet 需在 29000／29123；仅使用生成测试凭据）：

```sh
cd apps/fractalmind-app
cargo build --locked --manifest-path native/Cargo.toml --example device-test-helper
node --import tsx scripts/native-onboarding-localnet.ts <isolated-deployment-report.json> <public-output-report.json>
```
