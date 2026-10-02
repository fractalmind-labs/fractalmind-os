# v0.2.0：设备配对接线与验证

界面来源是[原型 v2](fractalmind-app-prototype-v2/README.md)的欢迎页与我的身份。
这是实现增量；完整 v0.2.0 门禁继续以[验证记录](fractalmind-app-v020-validation.md)为准。

## 实际流程

1. 新设备在原生 App 的“我已有身份”入口生成独立签名／加密钥。公开连接资料定位已有 Human 和组织，不构成登录。
2. 新设备自行支付 Gas 创建链上 `DevicePairingRequest`，绑定 Human、组织、当前代次、两份公钥、设备地址、名称、平台和 10 分钟 Clock 有效期。名称和平台是自报信息。
3. 已有设备在“我的身份 → 批准新设备”输入请求 ID。两端比较完整 SHA-256 指纹；默认授予当前组织 7 天 read 权限。批准设备必须当次满足 approve、组织角色和原生持钥证明。
4. 批准只产生组织范围 Grant，内容密钥为空，没有 Human 根权限。向此设备分享组织及历史数据另有一次确认、原生封装、报价和交易。
5. 新设备再次核验当前链上授权后进入组织。链上出现封装只说明封装已发布；正文读取仍需当次权限检查和真实解密，不自动显示“数据已解锁”。

每笔交易都有独立费用确认，Gas 上限为 0.2 SUI。申请、批准、拒绝、取消和分享使用稳定技术请求 ID；原结果未知时先查原摘要，不自动重新授权或提交。
IndexedDB 只保存交易技术日志，公开连接提示可丢弃。请求、Grant、密文和身份仍以链上对象为准。
回执先于查询可见时，只读等待 effects 指定的对象版本；旧对象不会作为本次操作后的当前状态。

## 密钥范围与链上竞态

- 原生 `fm_device_wrap_organization_keys` 只将选定组织的历史钥封装给请求所绑定的独立 X25519 公钥。根恢复材料和明文 keyring 不进入 WebView。
- legacy 全局 keyring 仅在 Human 只有一个组织时允许分享；多组织共享同一历史密钥的情形拒绝分享。已有多组织全局历史需要迁移，不能用组织标签掩盖实际密钥重用。
- 同一分享 PTB 先执行 `product_record::assert_key_version` 再写 Grant。原生签名期间版本轮换会原子失败，旧封装不会覆盖当前权限。
- 合约拒绝复制其他设备的公钥身份、重复批准、已拒绝／已取消／Clock 到期／恢复代次失效的请求。原有 Human、Registry、Grant 对象布局没有改变；新增请求对象与函数仍需在目标部署升级后使用。

## 可复现证据

[正式控制器 localnet 报告](evidence/v020-app-native-pairing-localnet.json)：14 项检查、10 笔交易，其中 9 成功、1 次预期失败。
使用 macOS 隔离系统密钥库和真实 Sui；验证实际批准响应丢失后的原摘要查询、只读授权、独立数据封装和解密、撤销后拒绝，以及签名期间版本轮换的真实 `9102` 失败。该脚本使用子进程桥与内存 journal，不能替代完整安装后 UI 验收。

从 `apps/fractalmind-app` 执行：

```sh
cargo build --manifest-path native/Cargo.toml --example device-test-helper
node --import tsx scripts/native-pairing-localnet.ts /tmp/deployment.json /tmp/pairing-report.json
```

部署必须包含新增配对函数和原子 key-version guard。脚本只用指定本地链及隔离 `test-*` 配置，并在 finally 清理凭据。

实际 macOS debug 窗口也已走查创建身份、零余额、恢复码确认隐藏、取消／过期报价、两笔原生注册交易、批准和独立组织数据分享；第二设备通过原生持钥核验。
原生管理端使用真实 Tauri IPC 和 IndexedDB；第二设备请求／最终持钥证明由隔离子进程夹具执行，不宣称两台实体设备完整 UI 验收。
见[原生界面报告](evidence/v020-app-native-pairing-ui.json)及[截图](evidence/v020-app-native-pairing-ui.png)。
生产网页预览的中文／英文配对入口、英文夜间主题均已实际点击检查：只显示原生 App 指导，没有网页设备初始化／授权操作，见[截图](evidence/v020-app-pairing-browser.png)。
重建后的公开 Human／组织／Grant 读取已通过。重新构建后的系统密钥库访问正在等待 macOS 授权，原摘要的重启后 UI 查询尚未验收；隔离 UI 配置钥暂保留用于继续验收。
Computer Use 禁止操作 SecurityAgent，不能自动确认系统授权或将等待记作成功。

debug 隔离启动：

```sh
FM_NATIVE_ACCEPTANCE=isolated ./src-tauri/target/debug/bundle/macos/FractalMind.app/Contents/MacOS/fractalmind-app
```

隔离模式仅在 debug 生效；使用独立 Keychain service、仅允许 `test-*` 配置、独立持久 WebView store。
macOS 隔离 WebView store API 需要 macOS 14+；这条限制属于测试模式，不代表已完成生产最低系统版本决策。
`native-pairing-ui-fixture.ts create/verify/remove` 用于准备／核验／清理第二测试设备，批准和分享必须实际操作 App。

## 公共网络测试币

[官方水龙头说明](https://faucet.sui.io/how-to-use/)提供无需私钥的 v3 PoW API。
SDK 的 `scripts/faucet-pow.ts` 在固定算法参数和官方向量验证后计算证明，提交前保存原请求，丢失响应时复用原证明／摘要；不会自动生成另一笔领取。

```sh
cd protocols/fractalmind-protocol/sdk
node --import tsx scripts/faucet-pow.ts testnet 0x完整公开地址 /tmp/payout.json
```

重跑使用相同地址和报告路径。有摘要时只查询原交易。实际已领取并由 Testnet gRPC 确认 1 SUI，见[公开证据](evidence/v020-testnet-faucet.json)。
这是公共测试网络充值证据，不证明协议部署或完整 App 在 Testnet 上已经验收。localnet 仍使用隔离 `/v2/gas` 测试水龙头。

## 尚待完成

- 配对 QR／公开连接自动配置／请求目录与审批队列；当前 Alpha 手动输入部署、组织和请求 ID。
- 已知失败后的明确新尝试、完整设备撤销／权限管理界面、多组织 legacy 历史迁移。
- 两台实体设备的申请到解密 UI 全旅程、安装后完整恢复、断网／进程中断／所有 journal 恢复场景及五个平台。
- Host 接入、云 Host、Agent 对话与介入、持续自主推进和最终人工验收等完整产品闭环。
