# FractalMind App：v2 身份恢复旅程

界面继续使用[原型 v2](fractalmind-app-prototype-v2/README.md)的欢迎入口与步骤结构。
本增量接通原生恢复与正式控制器；完整 v0.2.0 和安装后原生 UI 全旅程仍未验收。

后续已补齐[实际 OKR／对话历史的双次恢复联测](v020-workload-recovery.md)：两次恢复保留 38 份历史正文、9 条消息、原证据／独立验收和来源草稿，并验证新设备自付费用及组织密钥轮换。安装后 UI、真实客户端清缓存及物理重启仍待验收；以下原控制器增量的历史证明范围保持。

## 操作与责任

1. 原生 App 输入恢复码和公开部署资料。无需输入 Human ID；原生校验网络／校验和，
   派生原恢复地址并生成独立新设备钥。已有配置拒绝覆盖。
2. 控制器从 Sui 定位原 RecoveryRecord／Human，验证包来源、UID、共享所有权、网络、
   公钥、代次、活动状态与组织目录。原生只负责密码学，不自行判断链上权限。
3. 原生认证解封链上备份，保留历史钥、准备活动自有组织的新钥与新恢复码。
   系统密钥库保存准备态；新码仅首次返回供用户备份。重载不重新显示或生成新码。
4. 用户确认已保存新码，再查看旧恢复地址余额和恢复报价。恢复由旧恢复地址支付 Gas，
   上限为 0.2 SUI；新设备地址需另有余额才能继续执行后续交易，不自动划款。
5. 显式确认后，控制器再次校验来源，原生签名，单个 PTB 执行快照检查、组织轮换、恢复。
   旧码在确认恢复前有效；新码在恢复确认后有效。恢复失败不会消费旧码。
6. 确认后重新验证新设备的独立持钥证明和当前链上 Grant，再进入组织。
   人的稳定 ID 与组织 ID 保留；旧设备代次失效。未知结果只查询同一原摘要，不自动重发。

`RecoverIdentity.tsx` 使用 IndexedDB 技术交易日志；公开恢复连接配置可以丢弃。
恢复码／密钥环／私钥不写入浏览器业务存储。网页入口只显示原生 App 指引，不出现秘密输入框。
失败后的新配置尝试要求先查询原交易，仅无交易或已知失败允许重新开始；旧 OS 条目不会被静默覆盖。

## 并发保护

报价和提交前分别比较当前来源指纹与对象版本，任何变化都要求显式重新准备／报价。
合约新增 `identity::assert_recovery_snapshot`，校验当前 Human 代次、备份版本和原始组织目录，
并在同一 PTB 内先于钥轮换和 `recover_identity` 执行。
因此，在客户端最后检查之后、实际执行之前更新备份，也会使整笔恢复失败。
失败交易仍支付实际 Gas，但 Human、恢复记录和组织钥版本不会部分更新。

当前 App 要求部署包含该快照入口；旧包不会自动退回无快照的恢复流程。
组织钥轮换继续由合约校验所有者、活动状态与预期版本。外部成员／非活动组织不取得新的管理权限。

## 实际证据与复现

- [真实 localnet 报告](evidence/v020-app-native-recovery-controller-localnet.json)：20 项检查，
  9 笔真实交易，其中 8 笔成功、1 笔按预期被快照检查拒绝。
- 包括两次恢复、历史 v1/v2 正文、新码定位同一 Human、旧设备／旧码拒绝、旧报价失效、
  执行响应丢失后仅查询原摘要，以及签名过程中备份更新的原子拒绝。
- 使用生产 `NativeImportedRecoverySigner` 和 `IdentityRecovery`；原生密码学使用隔离测试密钥库。
  子进程只替代命令传输，恢复签名不使用 JS 私钥。报告无恢复码或明文密钥；凭据在 finally 清理。
- 交易 effects 确认与查询索引可见不同步。夹具等待已确认交易的对象版本，
  不以固定睡眠代替实际状态，也不重发写入。生产控制器对来源变化保持拒绝。
- 浏览器中文白天／英文夜间入口走查通过：恢复入口显示原生指引，没有恢复码输入框。
  [英文夜间截图](evidence/v020-app-v2-recovery-web.png)。macOS debug App 打包通过；这不替代原生 UI 验收。

先构建 SDK 与原生 `device-test-helper`，再在 `apps/fractalmind-app` 执行：

```sh
node --import tsx scripts/native-recovery-controller-localnet.ts <isolated-deployment-report.json> <public-report.json>
```

报告必须使用包含 `assert_recovery_snapshot` 的隔离 localnet 部署。
`scripts/recovery-deployment-localnet.ts` 可用零地址编译的 bytecode 发布临时包，
使用新生成的测试发布者，不读取用户 wallet／keystore。

## 剩余验收

真实链证据使用子进程传输和内存 journal，尚未覆盖安装后的恢复 IPC、IndexedDB 重启全旅程、
备份丢失处理与系统密钥库残留诊断、全部多组织／密钥分发场景及五平台原生 UI。
当前 Mac 锁屏限制原生界面走查，不能把构建或子进程测试算作安装后验收。
完整目标与其他门禁见[验证记录](fractalmind-app-v020-validation.md)。
