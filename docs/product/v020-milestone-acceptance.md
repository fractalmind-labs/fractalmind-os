# v0.2.0 里程碑验收映射

更新：2026-10-03（测试日志为 UTC 2026-10-04）。范围依据 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40) 及 21 个子 Issue。Android 单次审批写入、原结果解密、两个独立缓存恢复区间，以及 macOS／Android 投影均已通过。新增[桌面安装版 OKR 闭环](v020-desktop-core-acceptance.md)：实际受限执行、原证据解密、独立 KR 验证和最终验收通过，ACHIEVED、KR 1/1、预算 3／0。当前源码 4063bb0 的 App 375/375、38/38 CI 通过；桌面零工具状态消息与独立 0／0 结算／文件无变化也已通过；r16 正式恢复即时／刷新后确认、5／5 身份连续性和原历史解密均已通过，当前收敛范围内验收完成。最终提交以 [PR 当前 head 检查](https://github.com/fractalmind-labs/fractalmind-os/pull/53/checks)为准。旧阶段与失败记录见[实现记录](fractalmind-app-v020-validation.md)和[阶段证据](evidence/v020-authorized-ui-progress.json)。

## 状态口径

- **实现已验证**：该子项已有对应实现与测试证据；平台、UI 和真实链的证明范围分别保留。
- **单次写入验收已通过**：第三笔实际审批后的原 Run、精确文件、App 原结果解密及新增结果冷启动恢复均已验证；不代表整个 #38、#45 或版本已完成，原失败与取消保持历史事实。
- **桌面执行闭环已通过**：Host／Agent／OKR 交接到最终 Human 验收已有实际安装版与独立链／文件证明；桌面零工具状态消息和 r16 正式恢复／历史解密也已通过。

GitHub Issue 是否关闭不替代验收。历史报告中的限制按后续证据逐项补足；真实链控制器、安装 UI、真实模型和合成接口的证明范围分别保留。

## 21 项映射

| Issue | 当前状态 | 已验证范围与证据 | 当前剩余 |
| --- | --- | --- | --- |
| [#22 Clock](https://github.com/fractalmind-labs/fractalmind-os/issues/22) | 实现已验证 | 关键授权使用 Clock，旧 public 入口拒绝绕过，SDK／envd 迁移、到期前后 1 ms 与 main 兼容升级：[协议说明](../../protocols/fractalmind-protocol/README.md#v020-时间入口迁移)、[实际升级](v020-main-upgrade.md)。 | 新交接期限的专项回归见[窗口记录](v020-review-window-and-approval-queue.md)；最终 CI 另验。 |
| [#23 Human／设备](https://github.com/fractalmind-labs/fractalmind-os/issues/23) | 实现已验证 | 稳定 Human、组织迁移、独立设备授权／数据分享／撤销、只读拒绝、旧设备直达 Host 仍拒绝：[配对](evidence/v020-upgraded-device-pairing-localnet.json)、[独立撤权](evidence/v020-recovery-host-authority-localnet.json)。 | 当前安装 UI 纳入 #38；不将同机独立设备凭据表述为两台实体手机。 |
| [#24 单码恢复](https://github.com/fractalmind-labs/fractalmind-os/issues/24) | 实现已验证 | 两次单码定位与恢复、稳定 Human／组织、38 份正文及 9 条消息、旧码／旧设备拒绝、密钥轮换和自付恢复：[实际恢复](evidence/v020-workload-recovery-localnet.json)、[恢复实现](v020-app-recovery.md)。 | [两候选并发](v020-recovery-race.md)已通过：独立 Gas、各广播一次，一胜一拒 9005，代次恰加一，败方没有授权；原失败费用保留。另有 [r12 桌面正式恢复](evidence/v020-desktop-recovery-installed.json)：同 Human／组织、代次与恢复版本 2／2，旧设备按代次失效，OKR 与密文字节不变；独立公开链验证不替代历史密钥解密验证。 |
| [#25 邀请／成员](https://github.com/fractalmind-labs/fractalmind-os/issues/25) | 实现已验证 | 发送者绑定、失效／撤销、真实并发兑换一胜一拒、失败不消费、成员与动作授权分开、原摘要不重放：[准入](evidence/v020-host-admission-localnet.json)、[真实云接入](evidence/v020-remote-host-acceptance.json)。 | 原云历史回执在当时 RPC 查询为 notFound／unknown 的事实保留；不以重新兑换代替原回执。 |
| [#26 密文持久化／成本](https://github.com/fractalmind-labs/fractalmind-os/issues/26) | 实现已验证 | 正文字节在 Sui，存储候选／Gas／容量／PTB 限制、多设备解密／轮换边界：[ADR](adr-v020-identity-storage.md)、[工作历史恢复](evidence/v020-workload-recovery-localnet.json)。 | 安装版＋Coordinator 组合缓存恢复通过：33 份密文记录、69 个对象元数据及原预算完全一致，零新派发。见[缓存证据](evidence/v020-work-cache-reconstruction.json)。 |
| [#27 OKR／KR／约定](https://github.com/fractalmind-labs/fractalmind-os/issues/27) | 实现已验证 | 最多 3 个 ACTIVE、1–3 个定量 KR、顺序游标、版本与累计预算、测量／验证／最终验收分开：[模型](v020-okr-model.md)、[真实云两 KR 达成](evidence/v020-cloud-preflight-acceptance.json)。 | 安装版操作和组合缓存恢复统一纳入 #38。 |
| [#28 审批／证据／检查点](https://github.com/fractalmind-labs/fractalmind-os/issues/28) | 实现已验证 | 来源／版本／Clock、单次审批、原 Run 与密文恢复、失效拒绝、未知保留预留：[预算与检查点](evidence/v020-node-budget-localnet.json)、[完整工作历史](evidence/v020-mixed-origins-app-envd-localnet.json)。 | 安装版审批／Capability／Run 弹窗保持稳定，失败与未知均保留；完整成功单次写入仍见 #45。 |
| [#29 签名命令](https://github.com/fractalmind-labs/fractalmind-os/issues/29) | 实现已验证 | 未签名旧写入口关闭，目标／动作／范围核验，受保护读鉴权，原 Run 查询不重发：[执行协议](v020-node-execution.md)、[实际直接执行](evidence/v020-direct-message-localnet.json)。 | 源码 4063bb0 的回归及 38/38 CI 已通过；后续提交另验，更多运行时适配器不在当前范围。 |
| [#30 链上授权](https://github.com/fractalmind-labs/fractalmind-os/issues/30) | 实现已验证 | 生产 ChainAuthorityStore、RPC 不可验证即拒绝、逐执行／工具重验、预算预留与去重，绕过 Coordinator 的旧命令仍被拒：[Host 独立撤权](evidence/v020-recovery-host-authority-localnet.json)、[原生进程重启](v020-native-host-process-restart.md)。 | 安装版组合缓存恢复统一纳入 #38。 |
| [#31 签名观测](https://github.com/fractalmind-labs/fractalmind-os/issues/31) | 实现已验证 | Host 原文签名、成员／入口／nonce／时序校验；篡改／撤销拒绝，陈旧观测保持未知：[签名心跳](evidence/v020-host-signed-localnet.json)、[本地／云 Host](evidence/v020-remote-host-acceptance.json)。 | CPU／内存趋势属于 #51。 |
| [#32 发现／导入](https://github.com/fractalmind-labs/fractalmind-os/issues/32) | 实现已验证 | tmux 观察和有限文件 Agent；稳定实例／工作区／能力、导入幂等、同名异 Host 隔离；同一 Android App 发现并导入本地及云实例：[导入](evidence/v020-agent-import-localnet.json)、[实际远程验证](evidence/v020-remote-host-acceptance.json)。 | 不承诺接管任意既有 Agent；新物理实例需要独立导入和明确交接，旧实例的未知交易保留。 |
| [#33 Run／停止／幂等](https://github.com/fractalmind-labs/fractalmind-os/issues/33) | 实现已验证 | 同一 Run 状态／游标／来源、重复不执行；运行中停止由 Host 确认，已用工具保留，新 Run 不重复写；丢缓存保持未知：[运行中停止](evidence/v020-running-stop-localnet.json)、[重启及故障范围](v020-native-host-process-restart.md)。 | 物理断电后无缝自动续跑未验证；原要求是未知副作用保持需要确认、不盲目重放。 |
| [#34 自主推进／导航](https://github.com/fractalmind-labs/fractalmind-os/issues/34) | 实现已验证 | 真实模型选择工具、顺序两 KR、心跳去重、Sui 预授权投递、暂停／修改／重审／新 Run 恢复：[真实模型](evidence/v020-ollama-model-localnet.json)、[控制器关闭后执行](evidence/v020-mixed-origins-scheduled-localnet.json)。 | 安装版已完成交接、继续、云文件核验、KR 1/1 与最终验收；缓存后从原链记录恢复规格和证据。见[UI 记录](evidence/v020-installed-ui-acceptance.md)。 |
| [#35 Coordinator](https://github.com/fractalmind-labs/fractalmind-os/issues/35) | 实现已验证 | 逐设备与组织鉴权、链上目录、固定目标路由；实际 Coordinator 重启后 worker 重认证，旧设备挑战仍 403：[安装版 Host 流程](evidence/v020-app-android-host-flow.json)、[独立撤权](evidence/v020-recovery-coordinator-authority-localnet.json)。 | 实际 Settings 清连接、HTTP 缓存、App 冷启动和 Coordinator 进程重启已通过；Host 重新认证，完整原历史恢复，派发仍为 6。 |
| [#37 SDK／自付交易](https://github.com/fractalmind-labs/fractalmind-os/issues/37) | 实现已验证 | 增量 SDK／BCS 类型来源；四类交易状态、同 digest 查询、余额／模拟／费用／充值、自付恢复、明确失败后的新尝试：[交易管理器](evidence/v020-selfpay-manager-localnet.json)、[升级](evidence/v020-main-upgrade-localnet.json)、[创建重试修复](v020-review-window-and-approval-queue.md)。 | 源码 4063bb0 的 38/38 CI 已通过；最终证据提交另验，Gas 赞助属于 #36／v0.3.0。 |
| [#38 V2 App](https://github.com/fractalmind-labs/fractalmind-os/issues/38) | **范围内验收通过** | V2 页面与地图、真实链读写、系统密钥库／CSP；macOS 原生界面和 Android APK／Keystore；身份组织 UI 两笔交易、清缓存冷启动恢复：[安装版记录](evidence/v020-app-android-installed.json)、[Host 流程](evidence/v020-app-android-host-flow.json)。 | 核心界面、中英／明暗、离线草稿、历史缓存和投影已通过；[桌面安装版](v020-desktop-core-acceptance.md)已受限执行并最终验收，KR 1/1、3／0。桌面状态消息原回执解密／0／0 及 r16 正式恢复／原历史解密已通过；完整单次审批写入见 #45。 |
| [#39 技能投影](https://github.com/fractalmind-labs/fractalmind-os/issues/39) | 实现已验证 | KR／HEARTBEAT 契约、原生导出／磁盘导入、显式费用签名、旧版本拒绝、ACTIVE 编辑须暂停重审，达成后来源／预算／人审重建：[实际投影](evidence/v020-okr-projection-localnet.json)、[实现范围](v020-app-okr-projection.md)。 | macOS 实际导出／系统导入／签名及 fresh 链读 spec 2／agreement 1 已通过。Android r11 SAF 保存 4749 字节、取消不写、系统导入／新审阅／明确签名均通过，读回 PAUSED spec 5／agreement 4、预算 0／0；独立 fresh 链对象及原交易关联已核验。[安装投影证据](evidence/v020-android-projection-installed.json)保留 r9 无文件与 r10 ACL 遗漏。 |
| [#41 常驻权限](https://github.com/fractalmind-labs/fractalmind-os/issues/41) | 实现已验证 | 白名单／范围／累计预算／期限与版本，旧审批失效，单次批准不扩大常驻权限；直接消息／结果独立预算和密文恢复：[真实模型与审批](evidence/v020-ollama-model-localnet.json)、[双次历史恢复](evidence/v020-workload-recovery-localnet.json)。 | 当前安装版 direct 共同验收见 #45；日配额和渠道不在范围。 |
| [#43 定向消息执行](https://github.com/fractalmind-labs/fractalmind-os/issues/43) | 实现已验证 | 固定实例签名消息经 Coordinator 到 envd、逐工具检查、一次执行与加密回执；问答／文件操作／超限审批、失效拒绝和未知查询：[实际执行](v020-direct-message-execution.md)、[真实模型](evidence/v020-ollama-model-localnet.json)。 | 当前安装版按钮闭环见 #45；范围限于实际支持的适配器。 |
| [#45 对话／审批 UI](https://github.com/fractalmind-labs/fractalmind-os/issues/45) | **范围内验收通过** | 对话／权限换版／单次审批／来源 OKR 草稿已实际回链；工作台审批队列和加密本机未发送草稿已补，direct 组 **82/82** 通过；[对话](v020-app-direct-communication.md)、[来源草稿](v020-message-okr.md)、[队列](v020-review-window-and-approval-queue.md)、[本机草稿专项](../../apps/fractalmind-app/tests/direct-draft.test.ts)。 | 用户已明确授权。两次后续独立 Run：第一笔 FAILED／支出 2，VERIFIED 目标文件不存在；第二笔投递 unknown 后明确停止，CANCELLED／支出 0／预留 0。这是前两笔后的历史值。第三笔原 Run 已成功，文件 68 字节符合要求，单次累计 7／0、常驻 0／0；安装 UI 已解密原成功结果，新增结果缓存恢复也通过（47 密文／9 Run／96 对象、62 日志不变，零新派发）；源码 4063bb0 已通过 38/38 CI，最终证据提交另验。 |
| [#48 纳管身份／能力](https://github.com/fractalmind-labs/fractalmind-os/issues/48) | 实现已验证 | 纳管记录绑定组织／有效成员／稳定实例；公开注册、自报、管理确认和实际适配器能力分开，观察不授权；幂等／跨 Host／撤销／明确重绑定：[准入](evidence/v020-host-admission-localnet.json)、[实际导入](evidence/v020-agent-import-localnet.json)。 | 安装版组合缓存恢复见 #38；跨 Host Agent 自主协作属于 #47。 |

## 组合缓存恢复已通过

实际 Settings 清除公开连接、HTTP 缓存并冷启动 App；保留原生密钥及技术日志。本机隔离 Coordinator **45233→22160**，配置与 profile 不变，原云 worker 重新认证。通过真实公开表单恢复原 Human／组织，再从产品页面读取原消息、失败结果、OKR 规格、KR 验证与最终验收正文。

- 前后各两次独立 fresh 链读取一致：1 个组织／Host、2 个纳管 Agent、2 个 OKR、2 个权限、5 条消息、4 条审批、6 个 Run；未结控制执行 **0**。
- **33 份密文记录、26 个当前指针、69 个对象元数据**及预算完全一致；42 条技术交易日志逐条保持，原请求 ID／digest 不丢失。
- 云端命令数 **6→6**；两份现有测试文件的字节／哈希不变，新授权待测试文件仍不存在。
- 原最终验收交易回执在当时使用的 RPC 中不可用，验收面板仍显示 unknown；原正文通过现有 Memory 只读页成功解密。没有把当前对象伪称为历史交易回执。

详见[组合证据](evidence/v020-work-cache-reconstruction.json)和[安装 UI 记录](evidence/v020-installed-ui-acceptance.md)。本记录覆盖清缓存时的全部既有历史；下述授权后两次新尝试及新桌面对象均不在这个历史时间截面内，原比较结果不改写为当前总量。

### 第三笔成功结果的新增恢复已通过

这是独立的新恢复区间，未再次重启 Coordinator 或 Host。实际安装 UI 已先解密成功原 Run，再清公开连接／HTTP 缓存、冷启动并通过原公开表单重连，从工作台恢复完全相同的结果。前后各两次 fresh 链读比较 **47 份密文、9 个 Run、96 个对象元数据**，业务哈希及预算一致；**62 条技术日志**在 before→cold→after 逐行／哈希一致。云端命令 **8→8**，三份文件哈希和修改时间不变，新增链写入／派发 **0／0**。

HTTP cache 调用由操作代理确认：带 `--clear-http-cache` 的已记录哈希 runner 成功完成，其分支依次 await `Network.enable` 和 `Network.clearBrowserCache`；没有另存该 CDP 返回值，因此记录这一粒度限制，不补造回执。原 Run 的历史交易回执在当时 RPC 查询中仍为 unknown，App 通过原 Run 与密文结果恢复，没有重放。[新证据](evidence/v020-authorized-result-cache-reconstruction.json)与上方旧缓存／Coordinator 重启证明分别保留。

## 当前验收结论

- 收敛范围内的实现与安装版验收已通过：Android 审批写入、原结果与缓存恢复，双端投影，桌面 OKR 最终验收／状态消息，以及 r16 正式恢复／历史解密。
- r16 当前身份与原 ACHIEVED 状态独立核验通过；后续完整交易回执为 NOT_FOUND，实付 **22,067,736 MIST** 以原安装 UI confirmed 回执为证。现场未触发 unknown 告警，相关保留分支由 5 项回归覆盖。
- 源码 `4063bb05bfd1b7b10b5a0ae7af40ad48ee39d7f1` 的 App **375/375**、**38/38 CI** 已通过；最终提交以 [PR 当前 head 的检查](https://github.com/fractalmind-labs/fractalmind-os/pull/53/checks)为准。下方按版本排列的待办描述保留当时语境，不重开已通过门禁。

完整公开 ID、原交易、费用、独立链核验及来源摘要见[阶段证据](evidence/v020-authorized-ui-progress.json)、[第三笔执行证据](evidence/v020-authorized-oneoff-write.json)及[新增结果恢复](evidence/v020-authorized-result-cache-reconstruction.json)。投影的独立链读取确认 OKR 与 immutable spec 均关联原交易；原 gRPC 完整回执查询 notFound 保留，其后同节点旧 JSON-RPC 只读诊断独立确认成功 effects 和相同费用，产品未增加该兼容路径。前两次写入失败／取消及当时单次累计 4／0 继续保留，后续成功使当前累计为 7／0。

### 桌面 r12 正式恢复增量

重包后的旧隔离 profile 等待系统 Keychain，操作者没有处理安全窗口或修改 ACL，退出未完成的读取后，通过正式 Recovery UI 用测试码恢复到 `test-core-r12-recovery`。原交易 `FfFs5CSL9dbKfu2EpJFSxVgH5vCCKUmw8nJsq23a1c3i`；独立 fresh 链读确认同 Human／组织及管理员，generation／recovery version **1／1→2／2**，只有新设备具备当前代次授权。旧 Grant 的 `revoked` 标志仍为 false，但代次不匹配而无效；旧恢复记录 inactive、新记录 active，原 OKR 与 spec 密文未变。历史密钥可解密性和费用不属于本次独立公开链证明。见[公开桌面恢复证据](evidence/v020-desktop-recovery-installed.json)。

### r14 正式恢复与测试环境恢复

正式 Recovery UI 使用新隔离 profile，原交易 `5cQLkQ6aoqZtY9b3nvJ88tynxGc9eFkvXo5ofPTV9fVU` 将代次／恢复版本推进到 **3／3**；后续独立完整 SDK／raw gRPC 回执确认实付 **19,893,680 MIST**。独立公开链读确认同 Human／组织、当前代次设备和原 OKR／密文连续性。中断使旧 localnet、Coordinator 与临时云 supervisor 结束；原数据库重新打开，chain identifier 与 genesis 保持，旧云加密库保留但其未持久化会话密码已丢失，新 Host 正常准入正在进行。以上不表示桌面执行闭环完成。r12 及此前缓存证据均保留，详见[同一公开证据的 latestProgressR14](evidence/v020-desktop-recovery-installed.json)。

### 回执可用性归因修正

旧 Host 邀请 `CAqJ…` 在 SDK、raw gRPC 和 CLI 中均为 NOT_FOUND，但同节点旧 JSON-RPC 的独立只读诊断仍返回成功 effects：checkpoint **1161953**，低于 gRPC 最低可用 checkpoint **1178598**，实付 **4,958,376 MIST**。因此历史“裁剪”仅表示当时 RPC 回执不可用，不能推断交易或链数据丢失；也不是 SDK 字段选择问题。产品继续使用当前 RPC，不增加旧 JSON-RPC fallback。较新恢复 `5cQL…` 的完整回执已通过 SDK/raw gRPC 读回，最初 UI unknown 的原因没有原始网络证据，保持未定。见[公开诊断](evidence/v020-desktop-recovery-installed.json)。

### r15 实际 Host 历史归档与独立接入准备

r15 构建验签通过，正式恢复到原 Human／组织 **4／4**；独立完整回执确认 `H3MY…` 成功及实际 Gas **20,980,708 MIST**。实际界面只读查询旧 `CAqJ…`，保持当前 unknown／历史 Confirmed，用户明确归档后成功创建新绑定 `7Xxv…`（**4,089,240 MIST**）及邀请 `HU8x…`（**4,965,672 MIST**）。旧历史没有被删除或重发。独立公开链读确认原身份／组织、当前设备和新绑定，原 OKR 与密文保持。恢复界面的结果覆盖问题正在修复，后续重包专项验证；这些子流程不证明完整桌面执行。见[latestProgressR15](evidence/v020-desktop-recovery-installed.json)。

## 当前回归与 CI

- 当前源码提交 **`4063bb05bfd1b7b10b5a0ae7af40ad48ee39d7f1`** 已推送：App **375/375**（含 5 项恢复回执保留测试）。一次只读核对 [PR #53](https://github.com/fractalmind-labs/fractalmind-os/pull/53) 的同一 head，**38/38 检查均 COMPLETED／SUCCESS**：[主 CI](https://github.com/fractalmind-labs/fractalmind-os/actions/runs/37171671324)、[原型回归](https://github.com/fractalmind-labs/fractalmind-os/actions/runs/37171671316)，最后检查于 2026-10-04 02:43:25 UTC 完成。该 CI 完成时桌面专项仍在进行；其后 r16 已收口，最终提交以 PR 当前 head 检查为准。

- #24 的[并发恢复](v020-recovery-race.md)已完成：一胜一拒，代次与恢复版本恰加一，只有赢家获得有效设备授权。
- 前一阶段本地完整 App **370/370**、历史查询专项 **25/25**、严格 TypeScript r3 exit 0 通过，r15 构建／验签及 Host 历史归档 UI 子流程通过，恢复结果覆盖修复后的重包验证仍待完成。原生导出边界 `cargo test --lib okr_export::tests` **1/1** 通过，包含 8 项导入历史只读查询和此前 9 项 AgentImport 真实 manager／fake-clock 测试；此前 343 项含 6 项 picker 生命周期测试。r11 原生保存改动已构建／验签／安装并实际通过投影流程，尚未提交的工作树文件哈希与 APK SHA 记在[独立证据](evidence/v020-android-projection-installed.json)，最终源码构建与 CI 另验。此前 r8 的完整 App **337/337**、APK 构建与签名验证通过，r8 APK 摘要 `17743588aaf2c5a14cad9c1cc15386da2713e3626739534545d81d04496fe010`，覆盖安装已保留原数据，新版本独立暂停已通过实际 UI。
- 草稿增量：direct 组 **82/82**（含 9 项新草稿测试）、严格 TypeScript、生产前端构建及差异格式检查通过。复用原生 record 加解密，未新增 native API；测试用生成的测试密钥验证真实密码算法，不冒充当前 APK 的 OS 凭据验收。localStorage 的版本检查可检测已观察到的修改，不保证跨窗口原子 CAS；交易日志及链上检查继续负责执行防重。
- [PR #53](https://github.com/fractalmind-labs/fractalmind-os/pull/53) 首轮提交 **`f00e307cf324239ac87a64827299efc3b0581a5b`** 的 38 项检查均为 `COMPLETED / SUCCESS`，包括 App、SDK、三个协议 Move 包、envd、三个桌面设备核心及 Android APK：[CI](https://github.com/fractalmind-labs/fractalmind-os/actions/runs/37152500717)、[原型回归](https://github.com/fractalmind-labs/fractalmind-os/actions/runs/37152500718)。下述当前源码提交已独立复验；最终文档提交继续单独检查。

- 已验证的源码提交 `f81567841cd9fe2aacb48fcc0e1ef1f50a0b7a3f` 已通过 **38 项 CI**，包括原请求保留、审批弹窗稳定、云端授权读取、按物理实例隔离导入和较新 OKR 独立暂停的修复；最终文档提交仍另验。

## 平台与范围限制

当前证据包含本地真实 macOS Keychain Host、真实 Ubuntu 云进程、Android 模拟器中的实际 APK，以及 localnet／SSH 测试连接。它们不证明实体手机、蜂窝网络或五平台生产发行。

[#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40) 明确按收敛切片验收，[#38](https://github.com/fractalmind-labs/fractalmind-os/issues/38) 不要求同时完成五平台生产发布。[PRD §4、§9、§11](fractalmind-app-prd.md) 的“首版”指 P2 五平台 MVP；对应真机和发行要求仍保留在该阶段，不追加为当前 v0.2.0 的硬件门槛。特定 Mac mini 尚待 Keychain 授权，应作为该目标环境的证据限制，不推翻已有本地 Host 验证。

运行中未知副作用必须保持需要确认，停止由 Host 确认，重试不盲目重复；已验证运行中停止、完成后 Host 进程重启及丢结果缓存的防重。物理断电后的无缝自动续跑没有被声明为已通过。公共主网迁移、任意 Agent 适配器、多 Agent 编排、自动双向投影、赞助、渠道、日配额、完整 Memory 与资源趋势按对应后续范围交付。
