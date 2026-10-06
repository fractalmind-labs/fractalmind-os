# v0.2.0 App：原生加密与 OKR 候选创建

界面继续基于[原型 v2](fractalmind-app-prototype-v2/README.md)，在 OKR 列表增加“创建 OKR 候选”。
正式创建控制器为 `apps/fractalmind-app/src/okr-draft.ts`，表单为 `CreateOkr.tsx`。
这是创建草稿的增量，不代表激活、自主运行及完整 OKR 验收旅程已完成。

## 已接通

- 表单包含 Objective、总体成功标准、优先级、截止时间、1–3 个 KR、单位、小数位、基线、目标、权重、观测有效期和独立证据规则。
  KR 使用非负、最多六位小数的精确固定点整数；允许下降型目标，不接受基线等于目标、越界 u64、科学计数法或隐式舍入。
- 候选约束包含项目内相对路径、禁止动作和 TOOL_CALLS 预算。它们保存在加密规格中，保存候选不启动 Agent，
  也不代替激活时真实工作区/Host/实例/能力/预算/约定的校验。当前是结构校验，完整技能质量校验仍待接入。
- 每次准备/提交重新验证设备持钥、Human/Grant 代次、read/approve 权限、到期、组织范围与活动管理员角色。
  有 read 权限不自动获得 approve 权限；非管理员不能创建规范 OKR 正文。
- 原生 `fm_device_encrypt_record` 解封链上设备 keyring，选择指定历史内容密钥，构造记录认证上下文并用随机 nonce 生成 FME1。
  内容密钥不进入 JS signer，也没有秘密文件降级或密钥导出。原生加密是密码原语，链上角色由 App 控制器检查。
- 使用正式 SDK `okr::create_draft`：指标与规格正文在同一笔自付交易中创建，组织目录指向不可变规格记录。
  规格为 `fractalmind.okr-spec.v1`；敏感名称、单位、证据规则与约束加密，组织/截止时间/优先级/指标整数/交易元数据仍公开。
- 使用 `SelfPayTransactionManager` 与正式 UI 的 `IndexedDbTransactionJournal`。准备报价不签名或提交；用户明确确认费用才广播。
  每次草稿保存 Gas 上限为 0.2 SUI，报价和实际费用以模拟/链结果为准，TOOL_CALLS 预算与 SUI Gas 分开。
- 请求 UUID、公开连接和本机配置名是按网络/chain identifier/Human/组织分隔的可丢弃技术元数据，不保存正文。
  先查原请求，未知结果不能自动重放；已确认请求返回原摘要。技术缓存丢失时链上 logical ID 仍阻止重复创建。
  原交易确定终结后，用户可以明确建立另一候选；原 journal 保留。正文只存在当前表单，关闭未保存表单会清除它。
- 报价固定授权及组织版本；并发修改后需要重新检查/报价，旧版本写入也由合约拒绝。
  本机配置名默认读取已有创建配置的技术偏好，减少新建身份后仍输入 `primary` 导致的缺钥错误；偏好不是授权。

## 当前证据

- App **43/43** 单元测试、TypeScript 和生产构建通过。新增覆盖精确大整数/下降指标、完整字段和路径/预算边界、
  read/approve 与管理员分离、准备不提交、原摘要优先、加密期间撤销以及提交前版本变化。
  控制器在异步查询前保留输入快照，调用者修改原输入不会改变正在报价的规格。
- Rust 核心 **8/8**、Tauri 来源限制 **1/1** 通过；macOS debug App 打包通过。
- [真实 localnet 报告](evidence/v020-app-native-okr-draft-localnet.json)：**16 项检查、8 笔真实交易**。
  其中创建草稿和并发规格更新均使用原生加密与独立原生设备签名；正文由正式原生读取控制器及独立 JS 路径分别验证。
  指标 `12.50 → 2.25`、精度 2 在链上为 `1250 → 225`；草稿 state=0、无 Agent、agreement_version=0。
  重建控制器查询原交易，清空技术缓存后拒绝重复 logical ID；真实规格更新使旧报价、旧正文指针与旧版本修改失败。
  报告还包括此前 FME1/FME2、无缓存重建与实际第二设备撤销测试。生成的隔离 test-* 凭据已清理，不使用用户 keystore。
- 浏览器实际填写检查：空表单报缺失项、有效小数候选生成精确预览、第 4 个 KR 无法添加、英文夜间表单可读。
  网页保存入口保持禁用，不导入私钥或伪造链上创建。
- 原生窗口仍受 Mac 锁屏阻挡，**安装后 UI 的报价确认/实际 IPC/IndexedDB 恢复整条旅程尚未走查**。
  链测试使用隔离子进程传输和内存 journal，不等于原生界面或五平台安装验收；远端 CI 尚未执行。

## 仍需完成

当前 keyring 兼容初始 `format:1/contentKey/historicalKeys`；多组织独立内容密钥/轮换与完整配对/消费式恢复仍未完成。
OKR 草稿的编辑/激活、正文自动解锁到导航、技能质量门槛、Agent 方案/Host 选择、持续自主运行、介入/验证/独立验收，
以及费用历史和完整显式失败重试旅程仍需接通。真实云 Host、默认安装运行时和五平台验收保持原 v0.2.0 范围。

复现（同版本隔离部署、RPC 29000 / faucet 29123；只使用新生成的测试凭据）：

```sh
cd apps/fractalmind-app
cargo build --locked --manifest-path native/Cargo.toml --example device-test-helper
node --import tsx scripts/native-okr-draft-localnet.ts <isolated-deployment-report.json> <public-output-report.json>
```
