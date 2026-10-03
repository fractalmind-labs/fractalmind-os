# v0.2.0 里程碑验收映射

更新：2026-10-03。范围依据 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40) 及其 21 个子 Issue；原始增量和失败记录见[实现与验证记录](fractalmind-app-v020-validation.md)。安装版缓存恢复已通过；最后一笔独立单次写入等待具体用户授权，当前不宣告整个版本完成。

## 状态口径

- **实现已验证**：该子项已有对应实现与测试证据；平台、UI 和真实链的证明范围分别保留。
- **单次写入待验收**：真实审批与部分写入已验证，尚需完整成功的单次写入；原失败不能算通过。

GitHub Issue 是否关闭不替代验收。历史报告中的限制按后续证据逐项补足；真实链控制器、安装 UI、真实模型和合成接口的证明范围分别保留。

## 21 项映射

| Issue | 当前状态 | 已验证范围与证据 | 当前剩余 |
| --- | --- | --- | --- |
| [#22 Clock](https://github.com/fractalmind-labs/fractalmind-os/issues/22) | 实现已验证 | 关键授权使用 Clock，旧 public 入口拒绝绕过，SDK／envd 迁移、到期前后 1 ms 与 main 兼容升级：[协议说明](../../protocols/fractalmind-protocol/README.md#v020-时间入口迁移)、[实际升级](v020-main-upgrade.md)。 | 新交接期限的专项回归见[窗口记录](v020-review-window-and-approval-queue.md)；最终 CI 另验。 |
| [#23 Human／设备](https://github.com/fractalmind-labs/fractalmind-os/issues/23) | 实现已验证 | 稳定 Human、组织迁移、独立设备授权／数据分享／撤销、只读拒绝、旧设备直达 Host 仍拒绝：[配对](evidence/v020-upgraded-device-pairing-localnet.json)、[独立撤权](evidence/v020-recovery-host-authority-localnet.json)。 | 当前安装 UI 纳入 #38；不将同机独立设备凭据表述为两台实体手机。 |
| [#24 单码恢复](https://github.com/fractalmind-labs/fractalmind-os/issues/24) | 实现已验证 | 两次单码定位与恢复、稳定 Human／组织、38 份正文及 9 条消息、旧码／旧设备拒绝、密钥轮换和自付恢复：[实际恢复](evidence/v020-workload-recovery-localnet.json)、[恢复实现](v020-app-recovery.md)。 | [两候选并发](v020-recovery-race.md)已通过：独立 Gas、各广播一次，一胜一拒 9005，代次恰加一，败方没有授权；原失败费用保留。 |
| [#25 邀请／成员](https://github.com/fractalmind-labs/fractalmind-os/issues/25) | 实现已验证 | 发送者绑定、失效／撤销、真实并发兑换一胜一拒、失败不消费、成员与动作授权分开、原摘要不重放：[准入](evidence/v020-host-admission-localnet.json)、[真实云接入](evidence/v020-remote-host-acceptance.json)。 | 原云历史回执裁剪为 unknown 的事实保留；不以重新兑换代替原回执。 |
| [#26 密文持久化／成本](https://github.com/fractalmind-labs/fractalmind-os/issues/26) | 实现已验证 | 正文字节在 Sui，存储候选／Gas／容量／PTB 限制、多设备解密／轮换边界：[ADR](adr-v020-identity-storage.md)、[工作历史恢复](evidence/v020-workload-recovery-localnet.json)。 | 安装版＋Coordinator 组合缓存恢复通过：33 份密文记录、69 个对象元数据及原预算完全一致，零新派发。见[缓存证据](evidence/v020-work-cache-reconstruction.json)。 |
| [#27 OKR／KR／约定](https://github.com/fractalmind-labs/fractalmind-os/issues/27) | 实现已验证 | 最多 3 个 ACTIVE、1–3 个定量 KR、顺序游标、版本与累计预算、测量／验证／最终验收分开：[模型](v020-okr-model.md)、[真实云两 KR 达成](evidence/v020-cloud-preflight-acceptance.json)。 | 安装版操作和组合缓存恢复统一纳入 #38。 |
| [#28 审批／证据／检查点](https://github.com/fractalmind-labs/fractalmind-os/issues/28) | 实现已验证 | 来源／版本／Clock、单次审批、原 Run 与密文恢复、失效拒绝、未知保留预留：[预算与检查点](evidence/v020-node-budget-localnet.json)、[完整工作历史](evidence/v020-mixed-origins-app-envd-localnet.json)。 | 安装版审批／Capability／Run 弹窗保持稳定，失败与未知均保留；完整成功单次写入仍见 #45。 |
| [#29 签名命令](https://github.com/fractalmind-labs/fractalmind-os/issues/29) | 实现已验证 | 未签名旧写入口关闭，目标／动作／范围核验，受保护读鉴权，原 Run 查询不重发：[执行协议](v020-node-execution.md)、[实际直接执行](evidence/v020-direct-message-localnet.json)。 | 最终回归及 CI；更多运行时适配器不在当前范围。 |
| [#30 链上授权](https://github.com/fractalmind-labs/fractalmind-os/issues/30) | 实现已验证 | 生产 ChainAuthorityStore、RPC 不可验证即拒绝、逐执行／工具重验、预算预留与去重，绕过 Coordinator 的旧命令仍被拒：[Host 独立撤权](evidence/v020-recovery-host-authority-localnet.json)、[原生进程重启](v020-native-host-process-restart.md)。 | 安装版组合缓存恢复统一纳入 #38。 |
| [#31 签名观测](https://github.com/fractalmind-labs/fractalmind-os/issues/31) | 实现已验证 | Host 原文签名、成员／入口／nonce／时序校验；篡改／撤销拒绝，陈旧观测保持未知：[签名心跳](evidence/v020-host-signed-localnet.json)、[本地／云 Host](evidence/v020-remote-host-acceptance.json)。 | CPU／内存趋势属于 #51。 |
| [#32 发现／导入](https://github.com/fractalmind-labs/fractalmind-os/issues/32) | 实现已验证 | tmux 观察和有限文件 Agent；稳定实例／工作区／能力、导入幂等、同名异 Host 隔离；同一 Android App 发现并导入本地及云实例：[导入](evidence/v020-agent-import-localnet.json)、[实际远程验证](evidence/v020-remote-host-acceptance.json)。 | 不承诺接管任意既有 Agent；新物理实例需要独立导入和明确交接，旧实例的未知交易保留。 |
| [#33 Run／停止／幂等](https://github.com/fractalmind-labs/fractalmind-os/issues/33) | 实现已验证 | 同一 Run 状态／游标／来源、重复不执行；运行中停止由 Host 确认，已用工具保留，新 Run 不重复写；丢缓存保持未知：[运行中停止](evidence/v020-running-stop-localnet.json)、[重启及故障范围](v020-native-host-process-restart.md)。 | 物理断电后无缝自动续跑未验证；原要求是未知副作用保持需要确认、不盲目重放。 |
| [#34 自主推进／导航](https://github.com/fractalmind-labs/fractalmind-os/issues/34) | 实现已验证 | 真实模型选择工具、顺序两 KR、心跳去重、Sui 预授权投递、暂停／修改／重审／新 Run 恢复：[真实模型](evidence/v020-ollama-model-localnet.json)、[控制器关闭后执行](evidence/v020-mixed-origins-scheduled-localnet.json)。 | 安装版已完成交接、继续、云文件核验、KR 1/1 与最终验收；缓存后从原链记录恢复规格和证据。见[UI 记录](evidence/v020-installed-ui-acceptance.md)。 |
| [#35 Coordinator](https://github.com/fractalmind-labs/fractalmind-os/issues/35) | 实现已验证 | 逐设备与组织鉴权、链上目录、固定目标路由；实际 Coordinator 重启后 worker 重认证，旧设备挑战仍 403：[安装版 Host 流程](evidence/v020-app-android-host-flow.json)、[独立撤权](evidence/v020-recovery-coordinator-authority-localnet.json)。 | 实际 Settings 清连接、HTTP 缓存、App 冷启动和 Coordinator 进程重启已通过；Host 重新认证，完整原历史恢复，派发仍为 6。 |
| [#37 SDK／自付交易](https://github.com/fractalmind-labs/fractalmind-os/issues/37) | 实现已验证 | 增量 SDK／BCS 类型来源；四类交易状态、同 digest 查询、余额／模拟／费用／充值、自付恢复、明确失败后的新尝试：[交易管理器](evidence/v020-selfpay-manager-localnet.json)、[升级](evidence/v020-main-upgrade-localnet.json)、[创建重试修复](v020-review-window-and-approval-queue.md)。 | 最终提交 CI；Gas 赞助属于 #36／v0.3.0。 |
| [#38 V2 App](https://github.com/fractalmind-labs/fractalmind-os/issues/38) | **单次写入待验收** | V2 页面与地图、真实链读写、系统密钥库／CSP；macOS 原生界面和 Android APK／Keystore；身份组织 UI 两笔交易、清缓存冷启动恢复：[安装版记录](evidence/v020-app-android-installed.json)、[Host 流程](evidence/v020-app-android-host-flow.json)。 | 当前核心界面、中英／明暗、离线草稿、状态消息和完整历史缓存恢复已通过；完整成功的单次审批写入仍见 #45。 |
| [#39 技能投影](https://github.com/fractalmind-labs/fractalmind-os/issues/39) | 实现已验证 | KR／HEARTBEAT 契约、原生导出／磁盘导入、显式费用签名、旧版本拒绝、ACTIVE 编辑须暂停重审，达成后来源／预算／人审重建：[实际投影](evidence/v020-okr-projection-localnet.json)、[实现范围](v020-app-okr-projection.md)。 | 最终核心 UI 走查；不要求通用双向自动同步。 |
| [#41 常驻权限](https://github.com/fractalmind-labs/fractalmind-os/issues/41) | 实现已验证 | 白名单／范围／累计预算／期限与版本，旧审批失效，单次批准不扩大常驻权限；直接消息／结果独立预算和密文恢复：[真实模型与审批](evidence/v020-ollama-model-localnet.json)、[双次历史恢复](evidence/v020-workload-recovery-localnet.json)。 | 当前安装版 direct 共同验收见 #45；日配额和渠道不在范围。 |
| [#43 定向消息执行](https://github.com/fractalmind-labs/fractalmind-os/issues/43) | 实现已验证 | 固定实例签名消息经 Coordinator 到 envd、逐工具检查、一次执行与加密回执；问答／文件操作／超限审批、失效拒绝和未知查询：[实际执行](v020-direct-message-execution.md)、[真实模型](evidence/v020-ollama-model-localnet.json)。 | 当前安装版按钮闭环见 #45；范围限于实际支持的适配器。 |
| [#45 对话／审批 UI](https://github.com/fractalmind-labs/fractalmind-os/issues/45) | **单次写入待验收** | 对话／权限换版／单次审批／来源 OKR 草稿已实际回链；工作台审批队列和加密本机未发送草稿已补，direct 组 **82/82** 通过；[对话](v020-app-direct-communication.md)、[来源草稿](v020-message-okr.md)、[队列](v020-review-window-and-approval-queue.md)、[本机草稿专项](../../apps/fractalmind-app/tests/direct-draft.test.ts)。 | 审批流程与弹窗已实测；云写入已发生但第三次复读前到期，FAILED／支出 2，不能算完整通过。独立新文件测试两次被自动审批要求具体用户授权；确认项已发出。 |
| [#48 纳管身份／能力](https://github.com/fractalmind-labs/fractalmind-os/issues/48) | 实现已验证 | 纳管记录绑定组织／有效成员／稳定实例；公开注册、自报、管理确认和实际适配器能力分开，观察不授权；幂等／跨 Host／撤销／明确重绑定：[准入](evidence/v020-host-admission-localnet.json)、[实际导入](evidence/v020-agent-import-localnet.json)。 | 安装版组合缓存恢复见 #38；跨 Host Agent 自主协作属于 #47。 |

## 组合缓存恢复已通过

实际 Settings 清除公开连接、HTTP 缓存并冷启动 App；保留原生密钥及技术日志。本机隔离 Coordinator **45233→22160**，配置与 profile 不变，原云 worker 重新认证。通过真实公开表单恢复原 Human／组织，再从产品页面读取原消息、失败结果、OKR 规格、KR 验证与最终验收正文。

- 前后各两次独立 fresh 链读取一致：1 个组织／Host、2 个纳管 Agent、2 个 OKR、2 个权限、5 条消息、4 条审批、6 个 Run；未结控制执行 **0**。
- **33 份密文记录、26 个当前指针、69 个对象元数据**及预算完全一致；42 条技术交易日志逐条保持，原请求 ID／digest 不丢失。
- 云端命令数 **6→6**；两份现有测试文件的字节／哈希不变，新授权待测试文件仍不存在。
- 原最终验收交易回执已被节点裁剪，验收面板仍显示 unknown；原正文通过现有 Memory 只读页成功解密。没有把当前对象伪称为历史交易回执。

详见[组合证据](evidence/v020-work-cache-reconstruction.json)和[安装 UI 记录](evidence/v020-installed-ui-acceptance.md)。本记录覆盖清缓存时的全部既有历史，不包含尚未授权执行的新写入。

## 剩余验收

1. **完整成功的单次批准写入**：上一笔真实写入因第三次复读前到期而失败，支出 2／预留 0，实际副作用保留。另一笔测试脚本在 Run 报价失败后误查询旧授权，已过期且无 Run，未重放。严格脚本已修正；新的独立目标和本地测试 Gas 上限已列明，但自动审批两次要求用户明确授权具体操作，当前保持停止。
2. **最终提交检查**：当前源码的 38 项检查已通过；每次文档提交仍以 [PR #53 的最新检查](https://github.com/fractalmind-labs/fractalmind-os/pull/53/checks)为准。PR 保持草稿，不能把剩余写入标为通过。

## 当前回归与 CI

- #24 的[并发恢复](v020-recovery-race.md)已完成：一胜一拒，代次与恢复版本恰加一，只有赢家获得有效设备授权。
- 当前完整 App **337/337**、完整 APK 构建与签名验证通过，r8 APK 摘要 `17743588aaf2c5a14cad9c1cc15386da2713e3626739534545d81d04496fe010`，覆盖安装已保留原数据，新版本独立暂停已通过实际 UI。
- 草稿增量：direct 组 **82/82**（含 9 项新草稿测试）、严格 TypeScript、生产前端构建及差异格式检查通过。复用原生 record 加解密，未新增 native API；测试用生成的测试密钥验证真实密码算法，不冒充当前 APK 的 OS 凭据验收。localStorage 的版本检查可检测已观察到的修改，不保证跨窗口原子 CAS；交易日志及链上检查继续负责执行防重。
- [PR #53](https://github.com/fractalmind-labs/fractalmind-os/pull/53) 首轮提交 **`f00e307cf324239ac87a64827299efc3b0581a5b`** 的 38 项检查均为 `COMPLETED / SUCCESS`，包括 App、SDK、三个协议 Move 包、envd、三个桌面设备核心及 Android APK：[CI](https://github.com/fractalmind-labs/fractalmind-os/actions/runs/37152500717)、[原型回归](https://github.com/fractalmind-labs/fractalmind-os/actions/runs/37152500718)。下述当前源码提交已独立复验；最终文档提交继续单独检查。

- 当前源码提交 `f81567841cd9fe2aacb48fcc0e1ef1f50a0b7a3f` 已通过 **38 项 CI**，包括原请求保留、审批弹窗稳定、云端授权读取、按物理实例隔离导入和较新 OKR 独立暂停的修复；最终文档提交仍另验。

## 平台与范围限制

当前证据包含本地真实 macOS Keychain Host、真实 Ubuntu 云进程、Android 模拟器中的实际 APK，以及 localnet／SSH 测试连接。它们不证明实体手机、蜂窝网络或五平台生产发行。

[#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40) 明确按收敛切片验收，[#38](https://github.com/fractalmind-labs/fractalmind-os/issues/38) 不要求同时完成五平台生产发布。[PRD §4、§9、§11](fractalmind-app-prd.md) 的“首版”指 P2 五平台 MVP；对应真机和发行要求仍保留在该阶段，不追加为当前 v0.2.0 的硬件门槛。特定 Mac mini 尚待 Keychain 授权，应作为该目标环境的证据限制，不推翻已有本地 Host 验证。

运行中未知副作用必须保持需要确认，停止由 Host 确认，重试不盲目重复；已验证运行中停止、完成后 Host 进程重启及丢结果缓存的防重。物理断电后的无缝自动续跑没有被声明为已通过。公共主网迁移、任意 Agent 适配器、多 Agent 编排、自动双向投影、赞助、渠道、日配额、完整 Memory 与资源趋势按对应后续范围交付。
