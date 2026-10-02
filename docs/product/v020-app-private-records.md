# v0.2.0 App：原生加密正文读取

这是整体实现中的读取增量，界面继续以[原型 v2](fractalmind-app-prototype-v2/README.md)为基准。
`PrivateRecordView` 在“记忆与成果”增加加密记录目录与当前正文入口；读取正文不代表 Agent 结果已验证或已验收。

## 读取路径

1. 本机加载已有设备凭据，不静默生成新钥。每次操作重新核验真实 chain identifier、
   IdentityRegistry、共享 Human/Grant 的类型、UID、代次、当前设备签名与加密公钥、read 权限和链上到期时间。
2. 独立核验目标 Organization 的共享来源、UID、活动状态及 Human 的链上 OrgRole。
   Grant 的组织范围必须匹配，角色必须活动，角色 owner Human 地址必须等于组织 admin。
   核验前后固定 Human、Grant、Registry、组织版本和角色内容；持钥证明不代替组织权限。
3. 从链上组织目录取得当前不可变 EncryptedRecord，核对组织、类型、logical ID、revision 与 key version。
   仅精确匹配的组织目录不存在可显示空列表，子记录丢失或 RPC 失败保留错误状态。
4. 原生侧加载设备 X25519 私钥，解封当前 Grant 的 FMW1 密钥包，在内部解析历史内容密钥。
   按记录上下文认证并解密 FME1，或对 command checkpoint 派生 HKDF 命令结果密钥后解密 FME2。
   缺少指定历史密钥版本会拒绝，不回退到最新密钥。
5. 返回正文后，控制器再次核验授权及当前目录头。撤销、恢复代次变化、权限或目录更新会拒绝向界面释放正文，
   并清零返回的字节缓冲区。当前页面只展示 UTF-8 正文；二进制内容不伪装为可读文本。
6. 页面切到后台或展示 60 秒后隐藏正文，可主动隐藏。正文不进入本地业务缓存、日志或证据报告。
   隐藏是界面清理，不承诺 JavaScript 字符串的物理擦除。

## 原生边界与当前限制

- 新增本地 main 窗口命令 `fm_device_decrypt_record`，只返回认证正文，不返回内容密钥或解封后的 keyring。
  组织/类型/logical ID/revision/key version 的认证上下文由原生代码构造，不允许任意上下文解密或私钥导出。
- 原生核心是密码原语，**不自行查询 Sui 或声称完成链上授权**。正式 App 的 `PrivateRecords` 控制器负责前后授权检查；
  原生命令仅允许受信本地窗口。已获知的历史密钥和正文不能被链上撤销物理收回，撤销后的新读取由客户端权限检查阻止。
- 兼容 `format:1/contentKey/historicalKeys` 密钥包；后续[原生恢复增量](v020-app-native-recovery.md)已增加
  `format:2/organizations` 的指定组织/历史版本读取与恢复准备时独立轮换。多人重新分发、正式恢复控制器/界面与全流程验收仍待完成。
- 本增量只读当前正文；历史版本选择、通用正文写入、自动把 OKR 正文解锁到导航、完整配对/消费式恢复尚未接通。
  运行导航、Host 接入/发现、Agent 沟通与自主执行、真实云 Host 和五平台安装等仍保留在完整 v0.2.0 范围。

## 证据

- App **38/38** 测试、类型检查及生产构建通过。新增测试覆盖组织角色与范围、外组织记录替换、目录更新、读取中撤销、
  角色版本变化、精确缺失目录与网络错误。竞态测试发现目录头被可变引用修改后可能漏检，已改为保留独立快照。
- Rust 核心 **7/7**、Tauri 来源限制 **1/1** 通过；macOS debug App 打包通过。
- [真实 localnet 报告](evidence/v020-app-native-records-localnet.json)：**12 项检查、6 笔真实交易**。
  新原生恢复钥创建 Human，独立原生设备创建组织、保存 JS 独立加密的 FME1 正文及 FME2 命令结果；
  正式读取控制器从链上解封/解密并重建正文；第二个独立原生设备获授权后撤销第一设备，旧控制器继续读取被拒绝。
  密文篡改及网络/组织/logical ID/revision/key version 错配均被原生拒绝。全部使用隔离生成的 test-* 凭据，结束已清理。
- 第二设备授权后的目录可能晚于交易回执可见；测试只读等待对应索引，不重放授权或正文交易。
  合约不能将同一 Grant 同时借用为不可变授权者和可变撤销目标，所以撤销由独立第二设备完成。
- 实际浏览器检查：记忆页展示加密正文入口和独立已验收成果；网页没有凭据输入、目录读取或正文解密操作。
  英文/夜间主题沿用 v2。原生窗口仍被 Mac 锁屏阻挡，**完整 UI/IPC 正向读取、60 秒隐藏实际走查尚未验证**。
  链测试采用隔离子进程原生传输与内存 journal，不等于安装后完整旅程或五平台验收。

复现（先准备同版本隔离部署、RPC 29000 / faucet 29123；测试只用新生成的凭据）：

```sh
cd apps/fractalmind-app
cargo build --locked --manifest-path native/Cargo.toml --example device-test-helper
node --import tsx scripts/native-records-localnet.ts <isolated-deployment-report.json> <public-output-report.json>
```
