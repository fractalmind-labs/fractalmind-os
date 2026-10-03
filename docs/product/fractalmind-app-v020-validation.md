# FractalMind App v0.2.0 实现与验证记录

依据：GitHub v0.2.0 里程碑与收敛总览 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40)。起始代码：main `5271324`。

本记录用于逐项映射验收条件与实际测试证据。完整目标完成前，任何局部测试通过都不代表 v0.2.0 已完成。

## 当前验证证据

以下按增量从新到旧记录；每项证明范围和当时尚未完成的事项独立保留，整体验收仍以 #40 为准。

### 正式 App 对话转 OKR 草稿与来源保留增量

- 固定实例沟通窗口接通「转为 OKR 草稿」，显示原请求与待审阅的原模型建议，用户填写指标与新约束后独立确认费用／签名。原消息、实例／权限版本、作者／请求哈希及原 Run／加密回应引用保存在规格密文；编辑和技能投影保留来源，规格替换拒绝删改来源。创建仍为 DRAFT，无执行授权／Run／派发。
- [实际 OS＋localnet＋生产 envd](evidence/v020-message-okr-localnet.json)：**18 项检查、56 笔 App 确认交易**。篡改建议在报价前拒绝，独立创建和来源保留换版通过；空 journal 从 Sui／技能投影重建原来源，新草稿 Run **0**／新增模型请求、派发及工具支出 **0**。原创建回执被裁剪后查询保持同一摘要／unknown，没有重放。两 KR 最终验收及直接消息／超权审批仍通过，工具账本 OKR **6／0**、常驻 **4／0**、单次累计 **6／0**，测试凭据已清理。
- [回归](evidence/v020-message-okr-unit.json)：App **229/229**、构建／严格类型通过；[真实网页](evidence/v020-message-okr-browser.json)核对中英文明暗、关闭清理、网页签名保护及 390 px CSS 对话框边界。[当前 debug 原生包](evidence/v020-message-okr-native-bundle.json)已构建并本地签名通过严格验证，Mac 再次锁定，正向安装后 UI 未验证。模型仍是合成接口，云 Host、手机、完整恢复与旧包升级等门禁保持。详见[实现与证明范围](v020-message-okr.md)，#45/#40 仍未完成。

### RUNNING Run 等待模型期间的停止确认增量

- 生产 Host 在待模型请求期间只读监听精确原 Run；停止请求取消提供方连接，检查点不可用不能冒充停止确认。逐工具权限检查、原 Executor 和账本保持；已发生副作用及实际支出保留，只有 Host 原结算／加密结果确认取消。
- [实际 OS＋localnet＋生产 envd](evidence/v020-running-stop-localnet.json)：**14 项检查、25 笔 App 确认交易**。第二 KR 实际读取／写入后停在合成提供方请求中，正式暂停和停止后 Host **810 毫秒**内确认取消，支出 **2**／无 KR 达成测量，全局 **5 已用／0 预留**。新审阅与独立审批后新 Run 只读原文件，没有重复写入；两 KR 独立验证及最终 Human 验收通过，全局 **6／0**。原请求没有重放，Host 撤销与测试凭据清理通过。
- [回归与前序失败](evidence/v020-running-stop-unit.json)：Go 六包 race、严格脚本类型／Host 编译通过；保留测试 HTTP 请求体未消费导致的清理阻塞和沙箱监听拒绝。**仍未完成**：任意工具中断／副作用回滚、实际语言模型、安装后 UI、云 Host、手机、完整恢复与旧包升级。详见[实现与证明范围](v020-running-stop.md)，完整 #40 保持未完成。
- 状态补充：2026-10-02 21:06 PDT，Computer Use 已成功读取 `FractalMind · isolated local acceptance` 原生窗口（`tauri://localhost`）。此前锁屏阻塞已解除；这次只读观察不能计作完整原生交互验收。

### 当前代码的 macOS 原生验收包

- [原生产前端打包＋Tauri 构建记录](evidence/v020-app-native-bundle.json)：`e9db070` 构建 macOS arm64 debug `.app`（约 35 MiB），Tauri origin guard **1/1**。开发包初始 linker 签名未封装资源，生成产物另行本地 ad hoc 签名后严格验证通过；这是隔离验收包，没有 Apple 开发者签名或公证，不是五平台生产发布。
- 通过 Computer Use 尝试读取原生窗口时，工具返回 **Mac 已锁定、自动解锁失败**。已请求手动解锁；当前包尚未启动进行正向 UI 操作，不能把构建／来源保护测试计作原生 IPC、IndexedDB 或安装后 UI 全旅程通过。锁屏影响原生 UI 验收，其他代码与协议工作可继续。

### 后续 KR 提前授权与原链上状态恢复增量

- 工作台接通剩余 KR 的逐笔权限／准备／链上投递费用审阅；Host 只在独立 Human 验证推进游标后执行原预授权命令，不取得 Human 权限。全部预留计入同一 OKR 上限，最终验收要求预留为零；原 **5 分钟**命令期限仍保持。
- [R3 实际 OS＋localnet＋生产 envd](evidence/v020-scheduled-okr-delivery-localnet.json)：**17 项检查、19 笔 App 确认交易**。未来 KR 先排队，原执行控制器关闭后 Host 从 Sui 顺序完成两 KR，Coordinator 派发 **0 次**；独立 Human 验证及最终验收通过，工具预算 **6 已用／0 预留**。历史裁剪使原回执查询保持 unknown，空技术 journal 的新原生控制器仍从 Sui 恢复原票据／成功 Run／投递，无新增费用或派发。[R1／R2 原结果与只读复查](evidence/v020-scheduled-okr-delivery-prior.json)单独保留；R2 未最终验收，无原请求重放。
- [回归](evidence/v020-scheduled-okr-delivery-unit.json)：App **218/218**、SDK **158/158**、OKR Move **13/13**、Go 三包 race、构建／类型通过；[三包新部署](evidence/v020-scheduled-okr-delivery-deployment.json)保持标准 validator 限制。**仍未完成**：安装后 UI／IndexedDB、实际 App 窗口关闭／物理 Host 重启、长时间自主推进、真实模型、云 Host、手机、完整恢复及 main 旧包升级。详见[能力与证明范围](v020-scheduled-okr-delivery.md)。完整 #40 保持未完成。

### 原命令通过 Sui 独立投递到 Host 增量

- 正式 App 在原 Run 准备后支持另行确认费用、原生加密与签名，将原命令固定到链上 Host 队列；生产 Host 开启 `runtime.chain_queue` 后独立读取 Sui，沿同一 Executor 与原权限／预算／期限执行。已发布命令不补发 Coordinator；取消费用在签名／广播之前保持原排队状态，再次发布须用户明确确认。后续 KR 授权与 Human 验收仍独立。
- [实际 OS＋localnet＋生产 envd](evidence/v020-chain-command-delivery-localnet.json)：**13 项检查、18 笔确认交易**。费用取消无发布／派发，重新明确确认后的首 KR 从链上执行，Coordinator 命令派发 **0 次**；次 KR 独立授权后走原 HTTP 路径，整轮派发 **1 次**。两 KR 独立验证和最终验收通过，工具预算 **6 已用／0 预留**。原记录恢复、Host 撤销与测试凭据清理通过；[前序失败与原回执](evidence/v020-chain-command-delivery-prior.json)已保留，无旧请求重放。
- [回归](evidence/v020-chain-command-delivery-unit.json)：App **218/218**、SDK **155/155**、Move **147/147**、Rust **21/21**、Tauri origin guard **1/1**、Go 四包 race、构建／类型通过。[三包新部署](evidence/v020-chain-command-delivery-deployment.json)保持标准 validator 限制；[真实网页](evidence/v020-chain-command-delivery-browser.json)核对双语明暗和原生保护。**仍未完成**：完整无人值守授权／下一 KR、实际 App 关闭／Host 重启、真实模型、安装后 UI、云 Host、手机、恢复及旧包升级。详见[能力与证明范围](v020-chain-command-delivery.md)。完整 #40 保持未完成。

### Host 配置模型问答与受约束工具选择增量

- 正式 App 接通 `ask` 常驻授权、零工具消息、独立费用／签名、原命令投递与加密原回复；模型文字标记为待审阅建议。生产 Host 可明确配置 Anthropic Messages 兼容提供方，由模型选择已批准文件任务的下一步工具动作，逐次权限、预算、冲突哈希及实际测量继续由原执行端检查；模型失败不转为其他执行策略。
- [实际 OS＋localnet＋envd 与合成模型接口](evidence/v020-host-model-localnet.json)：**17 项检查、54 笔确认交易**，六个模型接口选择的真实 OKR 工具动作及一次正式零工具问答通过；两 KR 独立验证、最终验收和原加密结果重建通过。工具预算 OKR **6／0**、常驻 **4／0**、单次审批 **6／0**。[原失败与只读复查](evidence/v020-host-model-prior.json)保留原失败 Run／加密记录及 **0／0** 结算，无重放。
- [回归](evidence/v020-host-model-unit.json)：App **216/216**、构建、脚本严格类型及 Go 七包 race 通过；[真实网页](evidence/v020-host-model-browser.json)核对双语明暗及原生保护。**提供方是合成 HTTP 夹具，没有真实语言模型凭据，不能证明模型质量或实付账单**。目前是独立问题及已批准的 1–3 个文本文件目标，真实模型、通用项目规划、多轮来源上下文、消息转 OKR、模型配置向导、无人值守、安装后 UI、云 Host、手机、恢复及升级仍需验收。详见[能力与证明范围](v020-host-model-runtime.md)。完整 #40 保持未完成。

### 正式 App 技能上下文导出与显式提案增量

- 工作台／OKR 详情接通实际 `OKR.md` 导出、提案文件导入、逐字段变更审阅、费用确认和授权设备签名。投影保留当前来源、原批准计划、KR 采样／验证、Run／证据、预算和验收；本地修改保持未提交，ACTIVE 必须先暂停，替换后须新约定审批。
- [实际 OS＋localnet＋生产 envd](evidence/v020-okr-projection-localnet.json)：**14 项检查、18 笔确认交易**。草稿磁盘导出／导入和独立签名换版、旧版本拒绝、ACTIVE 提案阻止提交、两 KR 实际执行／独立验证／最终验收及链上投影重建通过，工具预算 **6 已用／0 预留**。[R1 原失败](evidence/v020-okr-projection-prior.json)保留原生创建不可用及未确认清理的事实，没有原请求重放。
- [回归](evidence/v020-okr-projection-unit.json)：App **214/214**、专项 **21/21**、构建、脚本严格类型和技能校验通过；[真实网页](evidence/v020-okr-projection-browser.json)检查中英文／明暗及原生保护，保留一次重载恢复的开发页面异常。**仍未完成**：自动 Host 投影同步、通用模型规划／对话、无人值守循环、安装后 IPC／文件／IndexedDB 全旅程、运行中停止确认、云 Host、手机、清缓存重启恢复及旧包升级。详见[实现与证明范围](v020-app-okr-projection.md)。完整 #40 保持未完成。

### 正式 App 单 Agent 持续推进增量

- 工作台增加已批准文件计划的持续执行会话：明确确认本次 Gas 总上限和期限后自动准备／投递当前 KR；独立人审推进游标后自动继续下一个 KR，最终验收仍另行决定。跨产品写入的实际权限语义单独核验，保留每笔交易严格版本检查；关闭／后台／到期／撤销终止后续操作。
- [实际 OS＋localnet＋生产 envd](evidence/v020-okr-autonomy-localnet.json)：**13 项检查、28 笔 App 确认交易**。新目标自动执行两 KR、重复 heartbeat 无新费用／投递、独立验证及最终验收通过；工具 **6 已用／0 预留**，四笔自动交易的最大 Gas 预算累计 **800000000 MIST**，实际费用另见原回执。[前序原事实只读复查](evidence/v020-okr-autonomy-prior.json)保留一条未投递排队 Run，**0 已用／3 预留**，没有重放或把新成功称作旧执行已结算。
- [回归](evidence/v020-okr-autonomy-unit.json)：App **189/189**、SDK **153/153**、构建／类型及脚本严格类型通过；[真实浏览器](evidence/v020-okr-autonomy-browser.json)核对中英文／明暗入口和网页保护。**仍未完成**：技能规划／投影、通用对话、无人值守 Host 循环、安装后 IPC／IndexedDB、运行中停止确认、云 Host、手机、清缓存重启及旧包升级。详见[实现和证明范围](v020-app-okr-autonomy.md)。完整 #40 保持未完成。

### 正式 App OKR 暂停、调整与审阅后恢复增量

- 工作台与 OKR 详情接通正式介入入口：加密暂停原因、原 Run 停止与结算、完整规格换版、重新 Host 审阅和独立批准。暂停保留预留，批准不隐式投递，旧证据按当前规格及具体文件哈希独立人审。
- [实际 OS＋localnet＋生产 envd](evidence/v020-okr-intervention-localnet.json)：**13 项检查、25 笔 App 确认交易**。草稿规格换版、第二 KR 排队后暂停／原取消、重新审阅审批、明确继续和两个 KR 最终验收通过；ACHIEVED／游标 2／工具预算 **6 已用、0 预留**。[前轮完整原回执](evidence/v020-okr-intervention-prior.json)保留 12 项检查、24 笔确认交易，无重放。
- [回归](evidence/v020-okr-intervention-unit.json)：App **178/178**、构建和脚本严格类型通过；[真实浏览器](evidence/v020-okr-intervention-browser.json)核对中英文／明暗入口及网页保护。**仍未完成**：运行中工具停止确认、安装后 UI 全旅程、持续自主／技能投影、通用模型对话、云 Host、手机、清缓存重启与旧包升级。详见[介入实现与证明范围](v020-app-okr-intervention.md)。完整 #40 保持未完成。

### 正式 App 固定实例沟通、权限与单次审批增量

- 团队实例／工作台接通原生沟通窗口：版本化常驻权限、独立总额度、精确本次目录／动作／工具额度审批、分别报价与签名、明确原命令投递、原加密结果及停止请求。原请求先查询，重新打开不自动重发；隐藏或设备到期释放私有内容。
- [实际 OS＋localnet＋生产 envd](evidence/v020-direct-app-localnet.json)：**16 项检查、51 笔 App 确认交易**。正式控制器在零剩余额度下查询状态，执行精确批准的文件请求，并在空 journal／撤销后重建原结果。原两个 KR 独立验证与最终验收保持通过。
- [原账本只读复查与前序失败](evidence/v020-direct-app-prior.json)：最终常驻 **4 已用／0 预留**，批准累计 **6 已用／0 预留**，原 OKR **6／0**。R15 原权限调整成功，消息期限模拟失败，无原请求重放；R16 原 `directFinalBudget` 是前一阶段快照，不混作最终账本。
- [回归](evidence/v020-direct-app-unit.json)：SDK **152/152**、App **162/162**、构建／类型／脚本严格类型通过；[真实浏览器](evidence/v020-direct-app-browser.json)核对中英文／明暗入口及网页保护。**仍未完成**：安装后 UI 全旅程、通用模型对话、首次直接纳管、OKR 暂停调整恢复、持续自主／技能投影、云 Host、清缓存重启与手机验收。详见[实现与证明范围](v020-app-direct-communication.md)。完整 #40 保持未完成。

### envd 直接消息执行与原生结果回执增量

- 生产验证器／每次工具 hook、普通及单次批准 begin／finish、固定实例文件适配器、direct scope 设备鉴权和原生结果密钥接通。SDK 补齐常驻动作／边界／单消息与剩余额度预检；Go PTB 复用同一对象输入，修复同设备执行及批准的真实开始拒绝。
- [实际 OS＋localnet＋生产 envd](evidence/v020-direct-message-localnet.json)：**14 项检查、41 笔 App 确认交易**。真实普通写入、读取、零工具状态、重复投递和精确单次批准通过。常驻工具预算 **4 已用／0 预留**，审批预算 **3 已用／0 预留**；原两 KR 独立验证及最终验收仍通过，OKR 预算 **6 已用／0 预留**。
- [回归摘要](evidence/v020-direct-message-unit.json)：SDK **138/138**、App **147/147**、两者构建、脚本严格类型及六包 envd race 通过。[前序原回执只读复查](evidence/v020-direct-message-prior.json)保留两项历史未执行预留，无重放；新成功联测不代表它们已取消。
- **该阶段边界**：正式直接消息／审批 UI 随后由上一节接通，安装后全旅程仍未验收。通用对话适配器、首次直接纳管、OKR 介入、持续自主／技能投影、安装后人工操作、云 Host、清缓存重启和手机核心旅程仍未完成。当前适配器只支持明确文件任务及状态，`ask` 明确拒绝；脚本人审不能替代安装后 UI 验收。详见[实现、原账本与限制](v020-direct-message-execution.md)。完整 #40 保持未完成。

### 历史：envd 直接权限读取与原消息核验增量

- 生产 Go 读取器分开 direct 与 OKR 来源，核对常驻权限、固定实例、工作区及单次审批的当前批准设备；新增 SDK 同源内容哈希、原不可变消息／加密记录／Run／两个预算账本核验。原历史可读取，旧版权限不能成为当前执行资格。
- [7 组专项、45 个子测试及五包 race](evidence/v020-direct-authority-unit.json)通过，App 构建和原生脚本严格类型通过。[生产 gRPC 真实链只读复查](evidence/v020-direct-authority-original-localnet-read.json)读取原普通及审批取消 Run，并拒绝错误扩展来源，**0 次广播**。
- **该阶段边界**：此只读证据不能证明直接消息执行。验证器／工具 hook、begin／finish 交易路由及明确文件任务随后由上述执行增量接通；正式 App 对话／审批 UI 仍未完成。详见[读取实现与后续验收](v020-direct-authority-runtime.md)。

### 三包部署与真实 OKR 回归：发布门禁已通过

- core、OKR/handover、direct-agent 三包在标准大小限制下全部实际发布；身份目录随 core 发布原子初始化。[原发布摘要／费用](evidence/v020-product-three-package-deployment.json)已保存。既有 main 模块保留，真实旧发布升级与开发单包对象迁移仍未验证。
- [实际 OS＋localnet＋生产 envd](evidence/v020-product-three-package-native-localnet.json)：**12 项检查、29 笔 App 确认交易／费用**。新三包上两个 KR 真实按序执行、独立人工验证与最终验收通过，ACHIEVED／游标 2／工具预算 **6 已用、0 预留**。直接消息常驻与单次审批的签名、原 Run 预留、权限换版和历史取消通过，独立预算最后全部归零，未派发直接消息。Host 撤销与原历史读取通过，OS 测试凭据已清理。
- [回归摘要](evidence/v020-product-three-package-unit.json)：Move **143/143**、SDK **137/137**、App **146/146**、Rust 核心 **20/20**、四包 envd race、类型／构建和脚本严格类型通过。三项跨包伪造拒绝测试通过。[前序记录](evidence/v020-product-three-package-prior.json)保留未完成联测、原未知初始化和原状态只读复查，无重放。
- **该阶段边界**：直接执行随后由本记录首节接通；对话与介入 UI、首次直接纳管、持续自主／技能投影、安装后人工操作、云 Host、清缓存重启与手机核心旅程仍未完成。详见[三包职责与验证限制](v020-product-package-split.md)。

### 历史：直接消息常驻权限与 SDK 增量，原单包未通过发布门禁

- 新协议实现版本化常驻权限、精确消息／内容绑定、单次审批与分账、原 Run 幂等和历史退款；同 Host 同目录中的不同实例共享 OKR 写保护。旧通用命令入口拒绝未经该模型的 direct.message。SDK 接通类型化读写、消息目录及签名命令准备；envd 和正式对话 UI 尚未接入。
- [专项与回归](evidence/v020-direct-permission-unit.json)：Move **140/140**（新增 18）、SDK **136/136**（新增 8 组）、App **146/146**、类型／构建和联测脚本严格类型通过。单位测试 Host 入网／控制来源使用明确的 test_only 夹具；不证明真实直接消息派发。
- [原发布模拟](evidence/v020-direct-package-size.json)拒绝：完整单包对象 **116,714 bytes** 超过当前上限 **102,400 bytes**，未广播发布交易。当时新增 --direct-permission 分支仅通过类型检查；后续三包部署和联测见上一节，旧对象升级仍需验收。本增量不关闭 #41/#43/#45 或完整目标。详见[直接权限与原发布门禁记录](v020-direct-permission.md)。

### 原生人工 KR 验证与最终验收增量

- 工作台／OKR 详情新增「验证与验收」：当前原始证据、独立确认与理由、单独费用／原生签名；KR 验证只推进游标，全部验证后再独立确认整体成功标准和最终验收。正式控制器核对当前授权／政策、原 Host 签名、测量新鲜度、已结清执行及不可变结果来源；多 KR 旧验证记录从当前目录头沿连续不可变历史解密。
- [实际 OS＋localnet＋生产 envd](evidence/v020-native-human-review-localnet.json)：**11 项检查、17 笔 App 原生确认交易／费用**。两个 KR 按序投递 **2 次**，分别验证后最终验收，链上 **ACHIEVED（3）**、游标 **2**、工具预算 **6 已支出／0 预留**。原请求／历史验证读取、Host 撤销尾部通过，测试凭据已清理；[前序尝试](evidence/v020-native-human-review-prior.json)保留原状态且无重放。
- [App 146/146、生产构建／脚本严格类型](evidence/v020-native-human-review-unit.json)通过；[真实浏览器](evidence/v020-native-human-review-browser.json)检查中英文／明暗、两个入口及网页保护。Human 决定由脚本显式给出，原生调用是子进程、Host 密钥为内存、journal 为内存；**安装后人操作的完整验收仍待完成**，完整自主／对话介入、技能投影、缓存清空与重启、云 Host／桌面手机核心旅程也保留。详见[交互和限制](v020-app-human-review.md)。

### 正式 App 控制器与实际 envd、明确继续界面增量

- 工作台和 OKR 详情接入原生执行／继续入口，审批后可进入工作台。只读展示当前精确规格／文件计划；单次控制权限和命令票据分别确认费用，准备后的 Run 不自动投递，用户明确发送原命令。缓存只保存公开定位信息，投递历史不明时保持查询；关闭／隐藏清除私有计划并使等待中的签名范围失效。
- [实际 OS＋localnet＋生产 envd](evidence/v020-native-app-execution-localnet.json)：**9 项检查、12 笔原生 App 确认交易／费用**。实际 Coordinator／Host 接入、签名实例发现、原生导入、真实 Host 审阅、原子审批、正式控制权限、票据与 Run 准备、明确投递、原生结果读取及撤销尾部回归通过。继续命令投递 **1 次**（另有 1 次设备鉴权请求），原测量 **1**、工具预算 **3 已支出／0 预留**，仍 ACTIVE／未 Human 验证。空内存 journal 恢复无新费用或投递，隔离 OS 凭据已清理。
- [前序原请求复查](evidence/v020-native-app-execution-prior.json)保留三次未完整退出的隔离 harness：首轮 Host 审阅失败；第二轮在分页尚不可见时停止，原观察 Run 仍排队；第三轮真实执行通过但把鉴权请求误算成第二次命令投递，尾部撤销未执行。后续成功没有改写这些原状态，均无重放。
- [专项与回归](evidence/v020-okr-continuation-unit.json)：App **137/137**、SDK **128/128**、构建／脚本严格类型通过；[真实浏览器](evidence/v020-okr-continuation-browser.json)覆盖工作台／OKR 详情入口、中英文／明暗及网页的原生操作保护。**仍未完成**：安装后 IPC／IndexedDB 正向操作、持续多 KR 与独立人验证／验收、对话／介入、完整清缓存重启、云 Host 和桌面／手机完整旅程。详见[实现与边界](v020-okr-continuation.md)。

### 原生 OKR 运行器加密与原交易恢复增量

- 正式 App 运行器通过 OS 密钥库解密约定、加密命令票据、封装原 Host 专用结果密钥；同一 PTB 保存票据／授予／原 Run。原日志查询前置于私有解密／命令签名；点查目录、单独准备与明确投递、当前政策／预算和界面寿命保护已接线，投递回应不直接标为运行中。
- [实际 OS／localnet](evidence/v020-native-okr-runner-localnet.json)：**19 项检查、16 笔确认交易／费用**，空 journal 恢复原票据／Run，零 Host 投递；原排队继续取消后预算预留 3→0。测试凭据已清理。[前序失败与原请求只读复查](evidence/v020-native-okr-runner-prior.json)保留错误通用取消入口的模拟拒绝；前序原排队 Run／预算 3 仍未结清，无重放。
- [App 132/132、SDK 127/127、类型／构建／脚本严格类型](evidence/v020-native-okr-runner-unit.json)通过。**仍未完成**：控制能力／明确继续 UI、真实 envd＋安装后 App 投递与持续自主、对话／独立人验收、完整缓存清空和重启恢复、云 Host／桌面手机旅程。详见[原生接线与限制](v020-native-okr-runner.md)。

### App 纳入 OKR：观察权限、审阅与审批界面增量

- v2 受管理实例卡片接通目标／具体文件计划／边界检查、三次独立费用确认、原票据恢复／目录查找、Host 审阅发送／回应核验及原生审批。正式 `HandoverSetup` 签发当前设备／实例绑定、单次零工具预算的观察能力，构造原生签名审阅并复核当前规格；关闭窗口／页面隐藏使等待中的原生范围失效。
- [实际 OS／localnet](evidence/v020-native-handover-setup-localnet.json)：**16 项检查、13 笔确认交易／费用**，正式能力发行／提案工厂与后续票据／原证明／原子审批通过，测试凭据已清理。Host 仍为夹具，无派发或继续 Run；原生传输为隔离子进程，journal 为内存。
- [App 131/131、专项 6/6、SDK 122/122、自付管理器 17/17、类型／构建／脚本严格类型](evidence/v020-native-handover-setup-unit.json)通过，广播前同步范围检查覆盖签名返回／日志 claim 后关闭的竞态；[真实目录浏览器走查](evidence/v020-native-handover-flow-browser.json)覆盖中文白天、英文黑夜和网页保护。**仍未完成**：安装后正向费用／审阅／审批、真实 envd 联测、过期／失败新尝试、原生 runner／明确继续及持续自主、对话／独立人验收、完整清空缓存恢复、云 Host／平台验收。详见[界面实现与限制](v020-app-handover-flow.md)。

### App 原生 Host 审阅票据与恢复增量

- 正式控制器在当前设备／观察能力、实例、规格、边界和完整执行目录核验后，同一 PTB 原子保存精确加密审阅票据、结果密钥授予及原 Run；费用／原生签名等待期间重新复核，已有摘要优先查询。恢复默认只读，核验原作者／签名／Run 和不可变票据创建摘要；已有命令 preflight 不构建新交易。
- [实际 OS／localnet](evidence/v020-native-review-ticket-localnet.json)：**14 项检查、13 笔确认交易／费用**。同一公开 attempt UUID、空 journal 重建后恢复原命令／计划／Run，读取并验签原 Host 接受证明，再完成原生原子审批；无 Host 派发或继续 Run，测试凭据已清理。[前序记录及原请求只读复查](evidence/v020-native-review-ticket-prior.json)保留分页延迟的两次终止及一次中间成功，无重放；原排队 Run 未结清。
- [App 125/125、专项 5/5、类型／构建及脚本严格类型](evidence/v020-native-review-ticket-unit.json)通过。**仍未完成**：观察能力发行／票据发现／审阅费用与继续 UI、真实 envd＋原生 App 联测、安装后 IPC／持久 journal、持续自主／对话／独立人验收、迁移升级、云 Host 和五平台。专项 Host 接受证明为夹具；空 journal 恢复保留公开 attempt UUID，不是完整客户端清空恢复验收。详见[实现与限制](v020-app-handover-review.md)。

### App 原生 OKR 交接审批控制器增量

- 正式控制器从原 Run 验证 Host 审阅，在当前设备四项权限、成员／活跃指针、实例、规格／指标、路径／预算和完整零未结执行目录核验后，通过 OS 密钥库加密精确约定、准备费用报价及链上原子审批。原生签名前／返回后再次核验；已有原摘要优先查询，审批没有继续执行接口。
- [实际 OS／localnet](evidence/v020-native-handover-approval-localnet.json)：**12 项检查、13 笔确认交易／费用**。正式原生审批产生准确政策／原证明／加密约定，报价不授予控制，提交后没有新增继续 Run；裁剪后的 unknown 查询保留原成功回执且无重放，测试凭据已清理。
- [App 116/116、类型／构建及脚本严格类型](evidence/v020-native-handover-approval-unit.json)通过。**仍未完成**：完整审阅请求／票据恢复／费用与继续 UI、实际 envd＋原生 App 联测、持续自主／对话／独立人验收、迁移升级、云 Host 和五平台。该专项 Host 证明为夹具，原生传输为子进程，journal 为内存。详见[实现与限制](v020-app-handover-approval.md)。

### App 原执行结果与 Host 审阅读取增量

- 正式 App 从原共享 Run 定位不可变加密结果，核对来源、密文哈希与预算，调用原生密钥库解密，释放前重新核验当前权限／Run；摘要仅来自原对象创建交易。新增 Host 审阅原命令／提案匹配、签名和有效期检查方法，尚不授予接管。
- v2 实例执行记录增加原生结果读取、内存正文与隐藏操作；网页保留桌面提示，无解密按钮。[浏览器检查](evidence/v020-native-execution-results-browser.json)通过中英文／明暗、当前 4 条真实历史与网页保护。
- [真实 OS／localnet 报告](evidence/v020-native-execution-results-localnet.json)：**9 项检查、12 笔确认交易／费用**。原结果发布与原生读取、交易来源、实际 Host 撤销后历史读取通过；测试凭据已清理。[第一次终止与原请求只读复查](evidence/v020-native-execution-results-prior.json)保留成功原回执／查询裁剪未知／排队原 Run，无重放。
- App **109/109**、类型／构建／脚本严格类型通过。本专项 Host 发布与正文为夹具，未派发 envd；安装后结果读取／自动隐藏／IPC、完整审阅审批继续、持续自主／对话／人验收、迁移升级、云 Host 与五平台仍未完成。详见[实现、证据与限制](v020-app-execution-results.md)。

### App 原生命令结果密钥与实际交易接线增量

- 新原生接口从 OS keyring 派生单条命令结果密钥，仅返回指定 Host 的密文；App 在原生调用及构建前后核验当前设备、组织、成员／活跃指针、实例和密钥版本，并提供广播前复核。SDK 同一 PTB 授予密钥与预留原 Run，不要求正式 App 导出组织密钥。
- [真实 OS／localnet 报告](evidence/v020-native-command-results-localnet.json)：**8 项检查、11 笔确认交易及费用**。原生签名／封装、Host 独立解包、FME2 原生解密、原摘要查询、原排队观察取消及实际 Host 撤销拒绝通过；测试凭据已清理。
- [SDK 121/121、App 103/103、Rust 核心 19/19、Tauri 来源 1/1、类型／构建](evidence/v020-native-command-results-unit.json)通过。保留[五次前序记录](evidence/v020-native-command-results-prior.json)，修复活跃 Host 目录键类型及测试可见性门禁，并保留类型化模拟错误／明确组织名冲突提示。
- **仍未完成**：完整 App 审阅／审批／明确继续、原生 runner／持续自主／对话／人验收、历史迁移／升级、安装后 UI／持久 journal、真实云 Host 与五平台。此专项 Host／实例为登记夹具，未派发 envd，FME2 互操作正文未作为真实 Run 结果上链；独立子进程 OS 测试不替代安装后 IPC。详见[原生命令结果接线与限制](v020-app-command-results.md)。

### 审批政策复核与签名继续执行增量

- 正式 envd 读取当前类型化 HandoverPolicy，原生 assign 拒绝未绑定 OKR 的通用能力。签名继续固定审批 ID／提案哈希／nonce；每次工具前检查当前政策、协议／游标、路径、预算、本人 Run 和实例。物理审阅只在当前链检查通过后消费，失败保留另一条预约。
- SDK runner 在票据创建、签名返回及派发前核验政策，恢复票据不在政策替换后派发；历史结果读取保持原协议，不成为当前授权。
- [原请求实际链确认](evidence/v020-handover-continuation-localnet.json)：**9 项检查、14 笔成功费用回执、2 份原不可变对象确认**。真实文件任务 3 次工具、预算 3／0、测量 1，仍 ACTIVE／未 Human 验证。原 harness 在索引可见性断言失败后，由同一 Run 的只读重查完成继续验收，没有重派；未执行该 harness 尾部撤销回归，详见[前序记录](evidence/v020-handover-continuation-prior.json)。
- [SDK 118/118、App 98/98、Go 六包 race、类型／构建](evidence/v020-handover-continuation-unit.json)通过。**仍未完成**：App 完整交接／明确继续 UI、新版 runner 实际链／持续自主、对话／独立人验收、历史覆盖／升级迁移、安装后 UI／OS 密钥库、云 Host 与五平台。详见[继续实现与限制](v020-reviewed-continuation.md)。

### Host 签名消费与 OKR 原子审批增量

- 新合约在当前权限、实例／规格版本、完整零未结目录、原成功 Run 与 Sui Clock 检查后，验证并消费精确 Host 签名，原子确认控制／激活 OKR，保存不可变审批与当前工具政策；审批不派发工具。
- 直接传入控制标志和旧激活入口分别拒绝 `9211`／`9410`；已审阅工具上限用于 OKR Capability，实测总预算 10、能力上限 3。
- [实际链报告](evidence/v020-handover-approval-localnet.json)：**18 项检查、17 笔确认交易／实际费用**；五项精确 validator 负向预检通过。保留[六次原 Run 查询与前序失败](evidence/v020-handover-approval-original-checks.json)及[前序发布未知费用](evidence/v020-handover-approval-publication-prior.json)，没有重放原命令／审批。
- [SDK 115/115、App 98/98、Move 122/122、Go 五包 race、类型／构建](evidence/v020-handover-approval-unit.json)通过。隔离新发布不等于升级兼容／历史迁移；旧 raw SDK 夹具需迁移，不能将历史执行通过套用于新包。
- **仍未完成**：完整 App 安全交接与明确继续、运行时政策／nonce 复核及未绑定 OKR 的入口保护、历史覆盖／升级迁移、持续自主／对话／人验收、安装后 UI／OS 密钥库、云 Host 与五平台。详见[审批实现与限制](v020-host-handover-approval.md)。

### Host 接管约束审阅与签名证据增量

- 设备签名的状态命令携带精确版本／路径／预算／期限提案。Host 核对当前链资格、草稿／暂停 OKR、完整零未结执行目录和实际空闲工作区，在工具调用前预约同一物理实例并二次核验；预约不授予执行权。
- Host 对限定 BCS 域的确认签名，再作为原状态结果加密保存到 Sui。SDK 独立解密／验签；重建读取保持原有效期。失败不能释放后来预约，缺失目录／Clock 保持不可用。
- [实际链报告](evidence/v020-handover-review-localnet.json)：**24 项检查、29 份成功回执／费用、4 份原结果对象确认**；新 OKR 保持 Draft，ManagedAgent 版本不变。审阅目录版本 10，确定的状态结果结算后为 11；四笔原交易已裁剪，费用明确未知，未重放。
- [SDK 114/114、App 98/98、Go 五包 race、类型／构建](evidence/v020-handover-review-unit.json)通过。**仍未完成**：消费 Host 确认的链上审批、App 完整交接与明确继续、对话／持续自主／人验收、历史覆盖迁移／升级、OS 密钥库与安装后 UI、云 Host、五平台。未修改 UI 或合约，详见[Host 审阅说明](v020-host-handover-review.md)。

### App 原生命令签名与设备命令传输增量

- 原生层支持限定 NodeCommand v1 域的直接 Ed25519 签名；严格字段／范围／时间检查先于 OS 密钥读取，JS 对精确返回字节独立验签。没有私钥导出或任意原始数据签名接口。
- 一次性命令挑战固定目标 Host、范围及完整请求哈希。控制挑战要求当前 `read` 与 `operate`；发送前重新核验，已发送但响应不可信／超时保持结果未知并查询原 Run，不自动重发。正常执行写入改变组织版本不会被误判为撤销，具体授权字段仍核验。
- [真实链报告](evidence/v020-device-command-localnet.json)：**22 项检查、27 份成功回执及实际费用**；状态命令穿过真实 Coordinator HTTP 与认证 envd，重复 `send` 无第二次 HTTP 派发。两个文件／6 次工具的既有执行链路也通过，但控制执行尚未使用新增 App HTTP 接管流程。[前序原结果查询](evidence/v020-device-command-prior-checks.json)保留第一次未知响应与第二次测试断言失配，未重发原命令或覆盖前序事实。
- [App 98/98、Rust 17/17、Go 三包回归／race、类型与编译](evidence/v020-device-command-unit.json)通过。**仍未完成**：完整 App 安全交接／明确继续、直接对话／自主人验收、历史覆盖及升级迁移、OS 新接口与安装后 UI、云 Host 和五平台验收。详见[设备命令说明](v020-app-device-commands.md)。

### 实例执行目录与接管前链检查增量

- 新实例的链目录覆盖跨 Capability／OKR 的全部执行；排队、运行、结果未知的控制阻止重新关联。已知结果及预算结算后清除未结计数，运行中停止请求不视为已结束；旧目录缺失保持未知。
- App 基于 v2 在实例卡片增加“检查旧执行”，显示未结控制、完整历史与预算；上下文变更清除检查，60 秒后过期。零未结不代表物理空闲或用户授权。
- [实际链专项](evidence/v020-agent-execution-localnet.json)：**21 项检查、25 份成功回执／费用、4 份不可变结果原摘要确认**。真实 Move `9210` 预检拒绝排队时重新关联；重复准备不多计，实际执行结算与排队取消通过。保留[五次前序检查与原摘要](evidence/v020-agent-execution-prior-checks.json)，其中原排队命令经后续链 Clock 读取证实到期后仍预留 6、未结 1，没有重放。
- SDK **111/111**、App **90/90**、Move **121/121**、类型／构建和脚本类型通过；[实际网页](evidence/v020-agent-execution-browser.json)验证中英文／明暗及保护。
- **仍未完成**：本轮是接管前链检查；完整 Host 约束确认、旧任务结束／未知结果处理、App 授权与明确继续、直接对话／人验收、云 Host、原生身份及五平台仍待验收。历史实例完整覆盖的迁移与新包升级兼容性也未验收。详见[实例执行目录说明](v020-agent-execution-coverage.md)。

### 原生别名实际链执行与物理忙闲状态增量

- 同一发现出的 `native-*` 实例沿生产 envd 工厂、签名命令、链授权／检查点、实际工作区工具和加密结果执行两个文件目标。ACTIVE OKR 实测值为 2，6 次工具预算结算，仍未人类验证／验收。
- 原生 `status`／`availability` 查询实际忙闲及当前命令／执行 ID；配置名称与发现别名共享执行槽，第二条任务在工具前拒绝、已知工具支出为 0，工具句柄关闭后释放。配置名称也固定原物理目录，不允许替换目录执行。
- 重建执行器从不可变加密结果对象的 `previous_transaction` 恢复原摘要，无新工具调用。摘要来自链对象而非运行时明文；物理空闲不等于所有链检查点均终结或接管授权。
- [实际链报告](evidence/v020-native-execution-localnet.json)：**19 项检查**，记录 **23 份成功交易回执及实际费用，2 份不可变结果原摘要确认**。后两笔原交易查询不可用，费用明确未知，未补造费用／重放。首轮独立状态查询摘要[保留为回执未核实](evidence/v020-native-execution-prior-query.json)，不从后续独立成功夹具推断其状态。
- [Go 五包 race、gRPC 元数据专项及脚本类型](evidence/v020-native-execution-unit.json)通过。UI 本轮未更改；依然以原型 v2 为基线。
- **仍未完成**：本测试通过 raw SDK 显式设置 `control_confirmed=true`，仅证明执行引擎。App 安全交接、旧执行停止／检查点确认、用户明确继续、对话／持续自主与人验收、原生 Host 重新接入、OS 密钥库／安装后 UI、云 Host 和五平台仍未验收，详见[原生执行说明](v020-native-agent-execution.md)。

### 原生文件 Agent 发现与仅观察导入增量

- 原生适配器按实际 envd 进程创建身份与绑定标识生成实例 ID，固定规范工作区和物理目录身份；生产扫描和独立 Host 签名带出单独来源，tmux 不能提升为原生适配器。
- App 区分来源和能力，原生导入／显式重新关联仍为仅观察，不授予 OKR 执行；原生实例别名映射固定工作区，工具实际打开根目录时再次核对物理身份。
- [实际链导入](evidence/v020-native-agent-localnet.json)：**16 项检查、12 笔确认交易**；[原生重新关联](evidence/v020-native-agent-rebind-localnet.json)：**19 项检查、16 成功、1 预期 Move 失败**。原摘要恢复、正常重复免新支付与版本条件拒绝通过。
- [App 90/90、Go 五包 race、类型与构建](evidence/v020-native-agent-unit.json)通过；[浏览器证据](evidence/v020-native-agent-browser.json)核对实际链上登记、中英文／明暗和网页权限保护。
- 原生别名的实际链执行随后通过上节专项验收。**仍未完成**：原生 Host 重新接入、完整安全交接／ACTIVE OKR 授权与明确继续、直接沟通／自主验证闭环、OS 密钥库／安装后 UI、云 Host 与五平台。详见[原生发现说明](v020-native-agent-discovery.md)，完整目标保持不变。

### Host 显式重新接入与同一实例连续性验收

- 扩展实际链验收辅助程序，复用生产路径：同一个运行中的 worker、Host 密钥与真实 tmux 进程在成员撤销后，以新邀请显式重新接入并重新认证；独立核对磁盘原摘要归档及新摘要恢复，每次接入广播一次。
- 仍未过期的旧 Host 签名和撤销前的设备挑战被拒绝；新签名证明当前成员与原内核实例。普通导入拒绝静默改关联，显式审阅版本后保留记录／实例 ID，登记推进为版本 2，仍仅观察。
- [重新接入报告](evidence/v020-host-rejoin-localnet.json)：**19 项检查、15 笔确认交易**；[原流程回归](evidence/v020-host-rejoin-regression-localnet.json)：**16 项检查、12 笔确认交易**；[Go 六包 race 与脚本类型](evidence/v020-host-rejoin-validation.json)通过。
- **仍未完成**：正式 OS 密钥库与进程重启、安装后 UI、云 Host、五平台、可控交接与 OKR 自主闭环。本轮是实际协议链路的验收，生成的测试钥／注入 App 传输不替代这些门禁，详见[重新接入说明](v020-host-rejoin.md)。

### 已有实例显式重新关联增量

- v2 发现入口读取原登记、核对原成员／工作区／版本并明确选择重新关联。保留原记录，只更新仅观察关系；旧可控记录要求安全交接，不自动接管。
- 合约新增 `rebind_agent_at_version`，App 固定传已审阅版本，提交前及原生签名返回后复核来源和原登记。原摘要恢复按操作类别区分；列表展示最新逻辑版本。
- [真实链证据](evidence/v020-agent-rebind-localnet.json)：**19 项检查、16 笔成功、1 笔预期 Move 失败**。原摘要恢复一次广播、并发旧报价拒绝和合约实际 `9208` 失败通过；记录 ID 保留，获胜版本保持 5。
- [测试／构建](evidence/v020-agent-rebind-unit.json)：App **87/87**、SDK **105/105**、Move **121/121**、类型及构建通过。[实际浏览器](evidence/v020-agent-rebind-browser.json)读取同一真实记录及版本；仅证明网页展示及保护。
- Host 成员更换后的实际链协议流程随后通过[专项验收](v020-host-rejoin.md)；安装后重新关联对话框／OS 密钥库／持久 journal、安全交接、OKR 执行与沟通／自主闭环、云 Host 和五平台仍未完成。目标保持完整，部署需求及旧负向夹具未知摘要的保留见[重新关联说明](v020-agent-rebind.md)。

### 已有实例链上仅观察导入增量

- v2 Agents 入口接通 Host／实例／工作区确认、当前管理与读取权限、费用预览和显式支付。提交前及原生签名返回后复核来源；保留原任务，固定 `tmux-observe` 与 `control_confirmed=false`。
- 精确目录键防止跨 Host 合并；已登记时返回原记录、无新报价。丢失响应后只查原摘要；按类型、组织、发送者固定的 `AgentImported` BCS 事件重建记录，包含没有新建对象的幂等回执。
- [真实链报告](evidence/v020-agent-import-localnet.json)：**16 项检查、12 笔确认交易**。实际发现实例导入、原交易一次广播恢复、正常重复无新支付，以及额外合约幂等回执均通过。
- [App 测试](evidence/v020-agent-import-unit.json)：**80/80**、类型、生产构建及脚本类型通过。[实际浏览器记录](evidence/v020-agent-import-browser.json)读取真实登记，修复长 ID 展示，校验中英文／明暗和网页保护。
- **仍未完成**：安装后导入对话框／持久技术 journal／OS 密钥库、支持约束的适配器及安全交接、重新关联、对话／自主闭环、云 Host 与五平台。详见[导入说明](v020-agent-import.md)，完整目标保持原范围。

### Host 已有实例连续性与 v2 Agent 发现增量

- envd 链模式扫描真实 tmux pane，实例标识结合 server／pane 内部 ID、系统启动标识及原生进程创建时间；改名不重建实例，respawn、拆分与同名重建可区分。工作区指纹和原扫描时间随 Host 原文签名，不以心跳刷新旧扫描期限。
- App 团队与 Agents 接通发现视图；独立核验当前 Host、扫描新鲜度和指纹，区分无实例、失败、未核实、不支持与过期。观察结果只保留页面内存，不获得执行能力。
- [真实 localnet 报告](evidence/v020-agent-discovery-localnet.json)：**15 项检查、10 笔确认交易**，实际 tmux／系统进程数据经过 Host 签名、设备鉴权和生产 App 校验。成员／设备撤销与原摘要一次广播恢复继续通过。
- [测试与构建](evidence/v020-agent-discovery-unit.json)：Go 五包 race、真实 tmux 生命周期、App **71/71**、类型与生产构建通过。[浏览器走查](evidence/v020-agent-discovery-browser.json)覆盖真实链目录、中英文和明暗发现入口；没有注入可信实例。
- **仍未完成**：J11 链上导入／幂等确认与安全交接、支持约束的适配器、对话／自主闭环、云 TLS Host、安装后原生资格旅程及五平台验收。Windows/Linux 交叉构建只证明编译。完整目标不变，详见[发现实现与范围](v020-agent-discovery.md)。

### Host 独立签名心跳与 App 当前资格核验增量

- Host 主动心跳绑定完整链／组织／成员／入口逻辑版本、实际握手 nonce、连接序号、精确原文和有限期限，使用已初始化 Host 签名钥。Coordinator 拒绝重放、跨连接 nonce、旧 unsigned 和变化／撤销资格；保留原始签名再以设备读取协议转发。
- App 主机页独立验证 Host 原文、公钥和精确当前成员指针，读取后重核来源及设备权限。资源值来自 Host 原文；单台异常保持未知而不隐藏另一台有效 Host。观测到期隐藏资源；父页面权限／目录变更清除结果，旧异步返回不能恢复它。
- [真实 localnet 报告](evidence/v020-host-signed-localnet.json)：**14 项检查、10 笔确认交易**。实际系统心跳独立核验、正文篡改拒绝、链上撤销成员后保留旧签名不再可信；设备撤销、路由拒绝和原摘要一次广播恢复继续通过。
- [四包 race／App 测试摘要](evidence/v020-host-signed-unit.json)：App **67/67**、类型与生产构建、正式 envd 构建通过。[浏览器证据](evidence/v020-host-signed-browser.json)覆盖真实目录、网页保护和中英文／明暗可信说明。
- envd darwin/arm64 构建、windows/amd64 与 linux/amd64 交叉编译通过并记录产物摘要；平台运行／安装后的完整流程仍未验收，不能据此关闭五平台门禁。
- **仍未完成**：Host 签名不证明独立 Agent 身份或约束控制能力；真实实例连续性、发现／导入／交接、自主闭环、安装后 IPC／OS 密钥库、云 TLS Host 与五平台仍需完成。链夹具使用生成的内存钥，不作为这些门禁的替代证据；现有原生 App 仍等待系统密钥库授权。详见[实现说明](v020-host-signed-observations.md)。

### 设备 HTTP 读取鉴权与 v2 主机运行观测增量

- Coordinator read API 接通链上 read Grant／角色／范围／代次和期限核验，单次限时挑战、Sui 设备持钥证明及响应签名。公开 ID、未签名请求及旧 Bearer token 均不能读取。生成数据前后重读权限，撤销后无缓存登录。
- App 主机页读取链上入口、验证 Coordinator 公钥、调用原生证明、核验精确响应与最新权限；显示 Host 地址、心跳、系统／CPU 和实例数。失败或上下文改变清除观测，旧数据明确标注；网页禁用签名操作，页面不持久化观测。
- [真实 localnet 报告](evidence/v020-device-http-localnet.json)：**12 项检查、10 笔确认交易**。实际 Host 心跳经生产 App 客户端和页面格式核验；链上撤销设备后，之前已准备的读取被真实 HTTP 服务拒绝。成员撤销及原摘要单次广播恢复继续通过。
- [测试摘要](evidence/v020-device-http-unit.json)：Go 三包 race 通过、App **64/64**、类型／生产构建通过。[浏览器走查](evidence/v020-device-http-browser.json)覆盖中英文与明暗、真实链上入口和网页保护。
- **仍未完成**：以上设备钥为注入内存夹具，尚未证明安装后 IPC／OS 密钥库流程。签名响应认证 Coordinator 观测，独立 Host 签名未接通；不能提升为最终在线或执行凭据。公开 TLS／云 Host、完整设备控制、Agent 发现／导入、自主闭环和五平台仍需验收。现有原生 App 等待系统密钥库授权。完整目标保持未完成，详见[读取说明](v020-device-http-read.md)。

### Host 链资格与真实 Coordinator 连接增量

- 独立 `host_connection_enabled` 模式从 NativeStore 加载已初始化 Host 身份，连接前／重连／收发核验完整 Chain ID、当前成员指针、组织目录、入口、公钥、期限与版本。按链上 origin 连接并固定 Coordinator 身份；不以主机名、自报 Host ID 或历史邀请回执授予权利。
- Coordinator 保留握手地址，拒绝注册／心跳伪造；回执绑定原连接，撤销／未知资格拒绝新的转发。旧连接清理不会删除其他当前连接。Host 关闭取消链读取／拨号／重连。链模式保留旧 Agent 进程，旧桌面信令因无法携带设备动作权限而拒绝。
- [真实链与 loopback 报告](evidence/v020-host-chain-connection-localnet.json)：**10 项检查、10 笔成功交易**，独立 Go Host 兑换后由链上入口真实双向认证，Coordinator 收到心跳；App 撤销成员后，路由明确因当前链指针缺失而拒绝，worker 心跳也拒绝。原摘要恢复仍为一次广播。
- [四包 race 自测](evidence/v020-host-chain-connection-unit.json)、生产 envd 编译、App 类型／生产构建与脚本类型通过。大 JS 包性能警告仍保留。
- **仍未完成**：本次 Host／Coordinator 是同机实际 socket 和生成的内存测试钥；正式 main 的 NativeStore／进程重启、安装后 UI、TLS／真实云 Host、签名观测正文、设备 HTTP 鉴权、桌面设备授权、Agent 发现／导入和五平台继续验收。现有原生 App 等待系统密钥库授权。完整目标保持未完成，详见[连接说明](v020-host-chain-connection.md)。

### envd Host 兑换 CLI 与原摘要恢复增量

- 正式 `--join-host` 入口接通隐藏邀请码输入、完整组织确认、有限观察权限与 Gas 预览、签名前后核验、精确原字节签名／模拟。广播前磁盘 flush 原摘要和公开技术元数据；未知结果拒绝重放。`--host-join-status --host-address` 仅查原交易，无需私钥。
- [真实链 CLI 报告](evidence/v020-envd-host-cli-localnet.json)：App 创建邀请码，独立 Go Host 实际兑换；广播后故意丢失回执，再创建 runner 从真实磁盘 journal 恢复同一摘要、费用和资格，**广播计数 1**。9 项检查、10 笔成功交易；App 后续撤销成员，Go 恢复的有效资格是撤销前快照。
- [四包 Go 测试](evidence/v020-envd-host-cli-unit.json)通过，覆盖原摘要优先、未知／失败回执、单次广播、费用／签名／来源和损坏记录拒绝；[独立 PTY 测试](evidence/v020-envd-host-cli-tty.json)确认实际隐藏读取关闭 echo，输入凭据未泄露。
- App 接入指导在生成邀请码之前可见，公开配置使用独立 `protocol_registry_id` 和核验后的完整 Chain ID；[中英文／明暗浏览器证据](evidence/v020-app-host-cli-guide.json)与[中文截图](evidence/v020-app-host-cli-guide.png)已保存。App 60/60、类型和生产构建通过。
- **仍未完成**：链夹具使用仅测试二进制注入的生成内存钥，恢复为同进程重建 runner；正式 NativeStore／进程重启验收、Windows 断电持久性、安装后 UI、实际本地／云 Host 与 Coordinator、发现／导入及五平台继续推进。现有原生 App 会话等待用户处理系统密钥库授权。完整目标保持未完成，详见[CLI 实现和边界](v020-envd-host-join.md)。

### envd Host 邀请预检与交易字节核验增量

- Go envd 从 Sui 核对注册表、组织、入口、邀请码、Human／Grant／管理员角色、目录、时钟与权限版本；邀请码跨语言派生／证明与 TypeScript SDK 一致。成员重建分别表达当前、撤销和历史指针缺失，RPC 故障保持未知。
- 接入报价在本机编码参数，逐项校验 gRPC 返回的原始 BCS，拒绝额外命令、参数或付款人替换、超预算及错误 Gas coin。地址余额的 `ValidDuring` 与当前 Mysten SDK 一致；真实验证器不支持时间戳过期，已改为 epoch 有效期，证明短时有效期继续由合约检查。
- [Go 测试](evidence/v020-envd-host-join-unit.json)：两个相关包通过，10 个 Host 测试组及 70 个子项通过；普通单元运行跳过独立真实链助手。[联合本地链报告](evidence/v020-envd-host-join-quote-localnet.json)：9 项检查、10 笔成功夹具交易，生产 Go 路径的预检／模拟报价成功，没有广播 Go Host 兑换交易。
- **该阶段边界**：此报告只验收预检与报价。生产 CLI、终端确认、原摘要持久化与恢复的后续增量见上一节；OS 原生签名、实际本地／云 Host 与 Coordinator 及五平台仍未完成。

### v2 App Host 邀请与成员管理增量

- 主机页接通入口公钥／地址登记、Clock 限时单次邀请码、成员与有限观察期限、实际费用确认、原摘要查询及邀请／成员撤销。邀请码秘密只在当前窗口，丢失后不能从链上重建。当前合约的观察权限不被标为 OKR 执行权限。
- [控制器本地链报告](evidence/v020-app-host-controller-localnet.json)：**8 项检查、10 笔成功交易**；实际邀请兑换／消费、成员撤销、无秘密重建与报价后权限撤销拒绝均通过。使用生成的内存夹具钥与注入传输，尚不证明原生 OS 存储或安装后完整 UI。
- [浏览器证据](evidence/v020-app-host-browser.json)覆盖真实目录、中英文／明暗主题、网页管理保护与已消费／已撤销状态。修复撤销后当前指针缺失被错误标为 RPC 失败的问题，历史记录继续保留。
- App **60/60**、类型与生产构建通过。envd CLI 的后续进展见本记录首节；实际本地／云 Host 与 Coordinator 路由、发现／导入、原生联测及五平台等仍须完成，详见[实现和边界](v020-app-host-access.md)。完整目标保持未完成。

### v2 设备配对、组织数据分享与原生界面增量

- 欢迎页“我已有身份”及“我的身份 → 批准新设备”接通独立原生钥、10 分钟 Clock 链上请求、完整指纹核对和组织范围授权。默认 7 天 read，没有 Human 根权限；组织历史数据分享另行确认、原生封装与收费。
- 原生只封装选定组织钥；拒绝多组织 legacy 全局钥或交叉组织历史钥重用。分享同一 PTB 校验组织 key version，签名期间轮换会原子失败。原有身份对象布局保持升级兼容。
- [正式控制器报告](evidence/v020-app-native-pairing-localnet.json)：**14 项检查、10 笔交易（9 成功、1 预期失败）**。真实批准响应丢失只查原摘要；组织 read 与审批权限分开；分享后原生解密；撤销后拒绝；签名期轮换导致实际 `9102` 失败且不覆盖旧封装。
- 本机解锁后补实际 macOS debug UI／Tauri IPC／IndexedDB 创建与配对管理走查，见[原生界面报告](evidence/v020-app-native-pairing-ui.json)与[截图](evidence/v020-app-native-pairing-ui.png)。第二设备由隔离子进程准备和核验，尚不证明两台实体设备的完整 UI 旅程。走查发现回执早于查询可见，修复为只读等待 effects 输出版本；缺失／旧版本不作为本次操作后的当前状态，RPC 错误继续表达未知。
- debug 重启后公开身份／组织／Grant 重建通过；新构建的系统密钥库访问等待 SecurityAgent 授权，重启后的原生原摘要查询仍待验收，不能据先前使用 IndexedDB 的提交证明整个重启恢复门禁通过。
- App **53/53**、SDK **104/104**、Move **121/121**、原生核心 **14/14** 通过，类型及 macOS debug 构建通过。配对 QR／队列、失败新尝试、完整恢复 UI、持续自主运行、Host／云端及五平台仍未完成，详见[配对实现及限制](v020-app-pairing.md)。
- [官方 Testnet 水龙头](https://faucet.sui.io/how-to-use/)的 PoW v3 工具通过 5 组官方向量，实际领取 **1 SUI** 并由 gRPC 验证交易／余额；复用报告只查询原摘要，见[公开网络充值证据](evidence/v020-testnet-faucet.json)。这不代表协议或 App 已完成 Testnet 验收。

### v2 欢迎页恢复与正式交易控制器增量

- 恢复入口接通原生导入、公开恢复地址查链、同一 Human 重建、新设备独立钥、新码一次备份、旧恢复地址／新设备运行费与报价确认。网页恢复页不接收秘密；只有公开连接提示可缓存。
- 正式控制器验证对象类型、共享所有权、UID、目录、公钥、代次和组织 key version。报价／提交前重读来源；未知交易只查询原摘要。已消费原码只接受本配置所准备的新设备，不能接管另一次恢复的结果。
- 新增合约 `assert_recovery_snapshot`，同一 PTB 先校验代次／备份版本／组织目录，再轮换组织和恢复。签名过程中备份更新会使交易原子失败，保留实际失败 Gas。
- [正式恢复 localnet 报告](evidence/v020-app-native-recovery-controller-localnet.json)：**20 项检查、9 笔真实交易（8 成功、1 预期失败）**。覆盖两次恢复、历史 v1/v2 解密、旧设备／旧码拒绝、变化后的旧报价拒绝、实际响应丢失只查询原摘要及签名期间备份更新拒绝。全部使用隔离测试凭据并在 finally 清理；夹具按交易 effects 的对象版本等待查询可见。
- App **49/49**、SDK **104/104**、Move **113/113**、原生核心 **12/12** 与桌面来源 **1/1** 通过。安装后 UI／实际恢复 IPC／IndexedDB 全旅程及五平台、配对、云 Host 和自主执行仍未验收；完整 v0.2.0 目标保持未完成。详见[恢复旅程](v020-app-recovery.md)。

### 原生恢复凭据与独立组织密钥轮换增量

- 原生核心新增恢复码导入、原公开恢复地址派生、新独立设备钥、新恢复码一次性显示、OS 准备态重建与规范自付恢复签名。创建/恢复共用配置互斥锁，已有钥不会被恢复流程复用或覆盖。
- 内容读取兼容旧密钥环并接通 format:2 组织独立钥和显式历史版本；恢复准备保留历史、分别轮换指定组织的未来钥，缺少组织/版本和过期备份均失败。
- [原生恢复 localnet 报告](evidence/v020-app-native-recovery-localnet.json)：15 项检查、6 笔真实交易。两次原生签名与原子组织轮换/恢复后 Human 与组织 ID 保留；旧码重用、旧设备授权和旧钥解密新版本均被拒绝，历史 v1/v2 正文可重建读取，最后只凭新码的原生公开地址定位同一 Human。测试凭据已清理。
- Rust 核心 **12/12**、App **43/43**、桌面来源限制 **1/1** 通过。这是先前原生核心及隔离测试适配器证据；页面／正式控制器与 Tauri 命令的后续接线见上方恢复旅程增量，安装后完整流程仍未验收；其他 v0.2.0 门禁保留。详见[恢复核心及限制](v020-app-native-recovery.md)。

### 原生加密与 OKR 候选创建增量

- v2 OKR 列表接通候选表单：目标/成功标准、1–3 个完整 KR、精确固定点指标、证据规则、路径/禁止动作/TOOL_CALLS 预算。原生内容密钥不进入 JS；按组织验证 read/approve 与管理员角色，费用明确确认后单交易创建指标和加密规格。确认后为草稿，无自动激活。
- [原生草稿 localnet 报告](evidence/v020-app-native-okr-draft-localnet.json)：16 项检查、8 笔真实交易；原生加密与签名保存草稿/规格更新，原生和独立 JS 双向互通，原交易查询、无技术缓存重复拒绝及真实并发版本冲突均通过。测试凭据已清理。
- App **43/43**、Rust 核心 **8/8**、桌面来源限制 **1/1**、类型/生产构建及 macOS debug 打包通过。浏览器表单结构校验、小数预览、KR 上限与英文夜间走查通过。安装后 UI 的费用确认/实际 IPC/IndexedDB 全旅程仍受锁屏阻挡；技能质量校验、激活/自主运行/介入、密钥轮换/完整身份、多平台等仍未完成。详见[草稿实现及限制](v020-app-okr-draft.md)。

### 原生加密正文与按组织读取增量

- v2“记忆与成果”接通当前加密正文的目录/读取。每次核验独立设备持钥、Grant 代次/范围/read 权限与到期时间，以及目标组织活动状态和 OrgRole；原生解封 keyring，按指定历史版本解密 FME1/FME2，正文释放前重读授权及目录头。正文不进业务缓存。
- [原生正文 localnet 报告](evidence/v020-app-native-records-localnet.json)：12 项检查、6 笔真实交易；独立 JS 加密与原生解密互通，错误上下文/密钥版本/篡改被拒绝，缓存无关重建，第二个原生设备真实撤销后旧设备不能继续读取。隔离凭据已清理。
- App **38/38**、Rust 核心 **7/7**、桌面来源限制 **1/1**、类型/生产构建和 macOS debug 打包通过；浏览器拒绝私有正文操作。原生 UI 正向走查仍受 Mac 锁屏阻挡。多组织密钥/轮换、配对/完整恢复、正文写入、Agent/Host/云端与五平台完整验收仍未完成，详见[读取说明及限制](v020-app-private-records.md)。

### 欢迎页原生身份创建与运行费增量

- v2 创建入口接通独立设备／恢复码、运行费地址与余额、两笔分别报价确认的 Human／组织创建、原交易查询及链上重建。恢复／签名密钥留在系统密钥库，恢复码仅显式显示一次供用户保存，确认保存前不提交。网页不生成私钥。
- [原生创建 localnet 报告](evidence/v020-app-native-onboarding-localnet.json)：7 项检查、2 笔真实交易。独立 JS 验证 HKDF、公钥及密文互通；零余额阻止准备；原生恢复签名创建 Human、独立设备创建组织；新进程与空技术缓存找回同一 Human／组织，拒绝重复创建。测试使用隔离密钥库，凭据已清理。
- App **33/33**、Rust 核心 **6/6**、Tauri 来源限制 **1/1**、类型检查／生产构建及 macOS debug 打包通过。已确认目录索引可能晚于交易回执可见，并加入只读等待。实际原生 UI 全流程走查被系统锁屏阻挡；真实链证据使用子进程和内存 journal，不等于安装后 UI／五平台完整验收。新尝试、配对／恢复、原生解密、运行时／云 Host 等仍未完成。详见[创建接线与限制](v020-app-identity-creation.md)。

### App 界面按原型 v2 修正

- 正式客户端以 `docs/product/fractalmind-app-prototype-v2` 为唯一界面基准，修正独立只读 Alpha 的设计偏差：使命欢迎页、十入口分组导航、决定优先工作台、常驻上下文、可信阶梯、组织成长路径、五入口手机导航与全部功能底部抽屉。
- 数据与未接通流程保持明确：真实链记录驱动状态，不导入演示模型或业务缓存；完整身份、解密、审批、对话与持续自主执行仍待实现。
- App **29/29** 单测、类型检查、生产构建通过；浏览器真实链及 390 × 844 iframe 的抽屉导航走查通过；macOS Tauri debug 打包及实际原生 IPC 缺钥负向检查通过。来源映射与限制见 [v2 界面基准](v020-app-v2-baseline.md)，[原生截图](evidence/v020-app-v2-native-workbench.png)。历史六导航／纵向 SVG 的证据对应早期独立 Alpha，由本次 v2 五导航／路线条取代；不代表原生手机验收。

### App 原生设备密钥与持钥核验增量

- 新建 Rust 设备密钥核心与 Tauri 桌面壳；私钥留在系统密钥库，无秘密文件降级或静默重建。完整 BCS PTB 解析，sender/Gas owner 必须属于本机设备。原生命令仅授予本地 main 窗口，禁止远程导航、秘密导出及 shell/文件操作。
- App signer 适配器独立核对字节、公钥与签名；正式身份核验器检查包来源、UID/共享所有权、Registry、Human 代次、Grant 绑定、加密公钥和链上到期时间，在新持钥证明前后重读版本。身份页面增加显式加载／准备设备与核验授权；浏览器显示需要桌面 App，不把公开资料当登录。
- [实际 macOS 系统密钥库及 Sui 报告](evidence/v020-app-native-device-localnet.json)：10 项检查，4 笔真实交易。跨进程加载／重复初始化保持身份；Rust 签名由 Mysten JS 验签；原生设备自付创建组织；真实链撤销后核验失败、新组织交易模拟拒绝。隔离测试条目已删除；没有使用用户 keystore。
- App 26/26 单元测试、类型检查及浏览器生产构建通过；Rust 核心 3/3、桌面来源限制 1/1 通过。Tauri JS/Rust 版本已按实际构建门禁对齐。新增三桌面平台核心 CI 与 macOS 桌面编译门禁，尚未执行远端 CI。
- **仍未完成**：安装后原生 IPC 的完整身份创建／配对／恢复与解密、费用审批操作、组织角色与具体动作接线、五平台原生验收，以及原有沟通／持续自主执行／真实云 Host 等整体要求。上述真实签名测试使用隔离进程传输、临时 JS 恢复夹具及内存交易日志，不代表完整 App 验收。设计与复现见[原生设备说明](v020-app-native-device.md)。

### 统一 App 的真实链读取与运行导航增量

- 新建 `apps/fractalmind-app`：React/TypeScript 客户端通过正式 SDK 与 Sui gRPC/Core API 直接读取 Human、组织、设备授权、OKR、Run、观测、预算、Host 和实例目录。静态资源预览不提供业务后端；当前入口只接收公开连接资料，不能据此登录、解密或签名。创建身份／设备配对／恢复界面尚未接通。
- 工作台展示地图导航，OKR 页面保留列表、筛选和详情。验证点、当前新鲜实测、独立人工验收分开；未知 Run 保留 14 单位在途预算，并保持先核实原执行的状态。过期观测不会伪装成实时进度；缺少动作轨迹不能判定偏航或死胡同。
- Host 按稳定地址展示，以 `HostIndex.active_hosts` 的当前指针选择成员记录。真实链及单元测试均验证重新接入后旧撤销记录版本更高、当前记录版本重新从 1 开始的情况；不能取最大版本推断当前成员。资格有效不表示在线。身份代次与设备授权随组织同步刷新，页面明确标注快照时间及未登录状态。
- [实际 App 读取证据](evidence/v020-app-reader-localnet.json)：两个组织、四个 OKR，已验收 OKR 的两个验证点／三份观测／四条 Run／预算 11／0，未知 Run 的 14 单位预留，空组织目录，以及新客户端会话无业务缓存重建。全部读取正式部署的隔离本地链，测试没有向 App 导入私钥。
- App 16/16 单元测试、类型检查、生产构建、`npm ci` 和 Sui transport 检查通过；依赖安装审计报告 0 项漏洞。增加独立 App CI job：构建本地 SDK 依赖，再安装、测试及构建 App，并纳入 `CI result`。本地验证了 YAML 与构建流程，未宣称 GitHub 远端 job 已执行。
- [实际浏览器走查](evidence/v020-app-browser.json)：生产 CSP 与浏览器直接访问本地 Sui RPC 生效；组织切换、空列表、筛选返回、历史／验收来源、设备快照、英文夜间主题、清除公开连接缓存、重新连接和页面刷新重建、初始 RPC 失败／重新查询均有页面证据；另一窗口刷新不会重新写回已经清除的连接资料。[白天验收地图](evidence/v020-app-accepted-workbench.png)／[夜间未知状态](evidence/v020-app-unknown-workbench.png)。
- [390 × 844 窄屏浏览器截图](evidence/v020-app-narrow-browser.png)使用实际生产 App iframe，地图改为纵向排列，六个导航入口可见。该走查仅证明浏览器布局及链读取，不证明 iframe 中各入口点击、原生手机、触控、Safari 或五平台验收。可复制 `scripts/responsive-check.html` 到忽略的 `dist/__responsive-check.html` 复现。
- **仍未完成**：安全身份／原生密钥与签名、授权解密、费用／审批／充值操作界面、沟通介入、持续自主执行、真实云 Host、原生平台及完整流程验收。生产 JS 包仍有大体积警告，发布前需拆分与性能验证。#34/#37/#38 及完整 v0.2.0 保持未完成；运行方式见 [App README](../../apps/fractalmind-app/README.md)。

### 自付交易、持久摘要与 OKR 接线增量

- `SelfPayTransactionManager` 实现实际网络／余额／Gas 引用校验、真实模拟与费用报价、签名校验、广播前原子日志、单次广播和原摘要查询。余额不足、网络失败、签名取消、报价过期、Gas 冲突分别表达；失败交易保留真实费用。缓存终态仍须查询 Sui，历史不可用时保持未知。
- `IndexedDbTransactionJournal` 在实际浏览器通过两个连接的原子竞争、在途 Gas 排他、CAS、终态释放及刷新恢复，6 项初始检查与 4 项刷新检查通过。[浏览器证据](evidence/v020-browser-transaction-journal.json)／[截图](evidence/v020-browser-transaction-journal.png)为隔离夹具，未验证完整 App。
- [真实自付链测试](evidence/v020-selfpay-manager-localnet.json)：7 次广播，6 成功、1 预期失败。零余额阻止创建、充值不自动提交；恢复地址自行付 Gas 创建 Human 并消费恢复记录，不需旧钱包或赞助；稳定 Human 和组织保留。真实执行响应丢失后重建管理器，查询原摘要，没有重复广播；报价后撤销权限导致真实失败并记录实际扣费。
- [真实 OKR 接线证据](evidence/v020-selfpay-runner-localnet.json)：138 笔 SDK 交易（88 成功、50 预期拒绝），其中两个 KR 的票据／结果密钥／预留交易改由正式自付交易管理器模拟、确认费用与提交。Host 实际文件执行、三次自动观测、重新审批、分别人工验证与验收、全局预算 11／0、消费式恢复后的两份票据与历史正文重建继续通过。确认回执可能先于 ledger 查询可见，夹具只读等待原摘要，不能据此重发。
- 执行循环为交易提供稳定票据 `requestId`；正式接线适配器要求费用确认，重启后先查日志，保留未知或失败原交易。SDK 104/104、类型检查及构建通过。**未完成**：完整 App 费用／重试界面、自动推进策略恢复、地址余额 Gas 的真实链验证、通用规划／持续循环、直接对话及真实云 Host。#34/#37/#38 保持整体未完成。设计、接线及复现见[自付交易说明](v020-selfpay-transactions.md)。

### 设备端 OKR 执行循环增量

- SDK `NativeFileOkrRunner` 从链上当前批准的加密文件计划读取目标，检查设备／Host／实例／约定及两层预算，在同一 PTB 保存签名票据、Host 专用结果密钥和排队 Run。票据按约定及 KR 使用唯一逻辑 ID 和修订 CAS；固定实例投递前重验当前约定。
- 默认只恢复／查询。未知交易或执行结果不自动重发；恢复的排队票据需要显式释放投递；运行中、成功待观测、失败、取消和过期分别返回状态。真实测试发现确认回执早于目录索引，已修复为最多 5 秒只读等待。KR 验证与最终验收仍由人负责。
- [实际链证据](evidence/v020-device-runner-localnet.json)：138 笔 SDK 交易（88 成功、50 预期拒绝），另有实际 Go 文件执行和三笔自动观测；两个重新审批后的 KR 使用正式执行循环，预算累计支出 11／在途 0。重建执行循环不重复投递；消费式 Human 恢复后从链上目录找到并解密两份票据，原有 OKR／Run／观测／历史正文和预算恢复继续通过。
- SDK 88/88、类型检查及构建通过。单位测试覆盖并发、未知回执、索引延迟、旧绑定、预算在途／委托额度、恢复排队、换版、过期、篡改、RPC 失败与明确拒绝后纠正。当前仅支持明确的原生文件目标，执行设备需要 `approve` 权限；完整 App 交易日志、持续循环、通用模型规划、对话、真实云 Host 尚未完成。#34/#37/#38 继续保持未完成。接口和边界见[执行循环说明](v020-okr-runner.md)。

- 起始 Move 合约：76/76 测试通过；Clock 迁移后 83/83 通过，包含同 epoch 毫秒边界、父授权过期及旧入口拒绝。
- 未签名命令：envd 与 Coordinator 均拒绝；允许旧 shell 配置及 bearer token 不授予执行权。相关 Go 回归测试通过。
- SDK 新增 Ed25519 NodeCommand 签名；56/56 SDK 测试通过，包含独立 Node crypto 验签与载荷完整性检查。
- 恢复码派生、AES-GCM 正文与 X25519 密钥分发测试通过；真实链身份与数据恢复证据见下节。
- SDK 与 Console 构建通过；Console 改用签名投递，完整身份/授权配置界面仍待接入。

### 身份与正文的真实链验证

- HumanIdentity、独立 DeviceGrant、组织绑定、消费式 RecoveryRecord 已实现，Move 测试扩展为 93/93 通过。覆盖成员角色不允许审批、跨组织隔离、设备独立撤销、同 epoch 到期边界、旧设备和旧恢复记录拒绝、更换恢复码保留设备。
- 独立本地 Sui 网络上，真实交易通过创建 Human → 创建组织 → 手机默认只读 → 越权拒绝 → 撤销并原子更新密钥 → 单份恢复码定位与解密 → 原子恢复 → 旧设备/旧记录拒绝 → 新设备继续操作。网络与生成的测试密钥不使用用户 keystore。
- OKR、约定、审批、证据、检查点、消息和备份七类加密正文实测保存、读回及分页重建；比较可变动态字段和索引 + 不可变修订，测量 256..65,504 明文字节。64 KiB 密文需要同一 PTB 分块组装，逐块纯参数上限由真实链验证。
- 组织 key_version 约束后续正文；撤销与恢复可以在同一 PTB 内轮换组织密钥、设备和恢复备份。历史内容可恢复，新代次正文不能由旧设备原有密钥解密。
- 设计与成本边界见 [ADR](adr-v020-identity-storage.md)，公开测试证据见 [本地链报告](evidence/v020-identity-storage-localnet.json)。App、安全存储、所有业务入口、并发恢复及已发布包升级测试仍待完成；上述 Issue 尚不标记整体完成。

### Host 接入、Agent 纳管及执行端授权读取

- 新增 `CoordinatorBinding`、单次限时 `HostInvite`、`HostMembership` 与独立于公开注册的 `ManagedAgent`。邀请证明绑定组织、入口版本、Host 签名/加密公钥及到期时间；兑换者必须持有 Host 签名密钥。有限观察授权与成员资格在同一交易创建。
- Move 99/99 测试通过，覆盖同 epoch 邀请到期前/当时/后 1 ms、已撤销入口/邀请和邀请来源设备版本变化；SDK 59/59 测试通过，包含独立验签、网络不一致及载荷变化拒绝。
- 本地链完整集成报告包含 48 笔已确认交易：34 笔成功，14 笔预期拒绝。验证复制证明拒绝且邀请未消费、并发兑换仅一笔成功、已消费邀请无法撤销、同 Host 重复导入幂等、不同 Host 同名不合并、观察实例无法取得执行授权、主机撤销后拒绝新授权。
- 显式重新接入、管理设备重新纳管沿用原 ManagedAgent ID 并提升版本；发现操作不能静默恢复旧权限或更改工作区，旧能力仍绑定旧成员及实例版本。
- Go `ChainAuthorityResolver` 通过原生 gRPC 和严格 BCS 读取能力、私有动态字段绑定、主机/入口、当前成员索引、Human/DeviceGrant、组织角色及受管理实例。核验模块来源、UID、字段父对象、所有依赖版本，RPC 失败或读取中发生变化均拒绝。
- 实际链状态下 6 次 SDK → Go 授权读取通过：有效设备能力；撤销成员后拒绝；重新接入后的 Host 观察能力；重新纳管后的设备能力；恢复 Human 后拒绝旧设备能力；恢复后组织已接入 Host 的观察能力保持有效。Go 全量 `go test ./...` 通过。
- 公开测试证据见 [Host 本地链报告](evidence/v020-host-admission-localnet.json)，复现与剩余工作见 [Host 与授权说明](v020-host-admission.md)。这里的两个 Host 是本地链上的两个独立测试身份，尚不能证明云端 envd 已部署。
- **未完成**：生产工厂已接入链上授权、预留和结果存储，见下述生产工厂增量；尚未接入真实受约束 Agent，运行时实际能力核验、签名心跳、Coordinator 设备鉴权与双 Host 真正执行仍需交付。#25/#30/#32/#48 继续保持未完成。

### 命令预留、启动资格与持久检查点

- `node_execution` 将设备签名意图的能力使用次数、预算预留和排队检查点在同一交易创建。精确重试返回原检查点，不再消费；目标 Host 启动时在链上重验设备、组织角色、Host 成员、实例、能力版本与期限。
- 每次启动生成独立随机尝试标识并写入检查点。Go 执行端必须确认返回交易摘要和自己的尝试标识；成功回执先于 ledger 可见性时仅有时限地查询，不重发事务。仅看到 RUNNING 不授予本地执行资格。
- 完整独立本地链报告新增至 [命令检查点证据](evidence/v020-node-execution-localnet.json)：64 笔 SDK 提交交易（44 笔成功、20 笔预期拒绝），另有 2 笔真实 Go 启动交易及 6 次 Go 命令预检/查询。原有身份与 Host 流程仍全部通过。
- 覆盖精确预留重试、未预留拒绝、最后允许次数可启动、运行中不能再启动、错误 Host 拒绝、终态不能先于启动、排队取消、次数超限、预留后 Host 撤销拒绝启动，以及未知结果不得重放。成功和需要确认两类加密终态写入链上；清空 SDK 状态并仅凭恢复码取得历史密钥后，可重建、解密这些检查点。
- Go gRPC 显式区分 Move 对象引用与地址/字符串；现有 peer、策略和 Clock 调用同步迁移。确认失败回执保留原 digest，和无回执的未知状态分别处理。Go 全量回归通过，SDK 类型检查、构建和 61/61 测试通过；并发启动、回执丢失与丢失结果缓存的回归测试证明不会取得第二次运行资格。
- 后续预算结算已通过 [74 笔 SDK 真实交易报告](evidence/v020-node-budget-localnet.json)：50 成功、24 预期拒绝，另有 3 笔 Go 启动交易、8 次命令查询/校验、13 个预算断言。区分已支出与在途预留，排队取消释放、运行中停止请求保留、Host 确认后结算、未知结果保留全部额度；预算释放不退款使用次数或防重放记录。超额支出、重复结算及在途预算超限均拒绝，结果写入失败使结算原子回滚。
- 新建 SDK 在 Human 恢复后可解密 3 份终态正文，并重读 6 个选定检查点的逐笔账本，与 3 份总账一致。测试对象 ID 由报告指定，尚非完整 App 目录重建。Move 103/103、SDK 64/64 测试及构建、envd 全量 Go 回归通过；执行端账本的来源、状态和读取版本一致性受校验。
- 执行端结果读取新增严格的不可变对象、原始包、UID、命令/组织/Host/Human/Grant 及版本、写入时间和密文摘要校验；恢复后的 3 次真实 Go 读取记录于同一报告的 `authenticatedResultReads`。SDK/Go 双向 AES-GCM 互操作和篡改/AAD/容量边界测试通过，SDK 扩展至 65/65，envd 全量 Go 回归通过。该次验证尚未接入执行器，后续进展见下面的结果存储增量证据。
- **未完成**：此测试明确没有调用 Agent 适配器，费用是测试输入，物理停止与真实费用计量尚未验收。OKR/常驻权限约定预算联动、未知费用人工核实、Host 正文密钥分发、链上结果存储接线、真实运行/停止确认及完整 App 闭环继续推进。#27/#28/#30/#33/#41 不标记整体完成。

### 命令专用密钥与执行器结果存储的增量证据

- SDK 在命令准备 PTB 内登记专用结果密钥；HKDF 派生绑定组织、意图及密钥代次，X25519 封装绑定 capability 与 Host 成员。Host 不取得组织根密钥；恢复设备可从历史 keyring 重建结果密钥。FME2 标识专用密钥正文，不静默回退根密钥。
- Go `ChainExecutionStore` 已接入执行器接口：执行前确认密钥、Gas 和本次链上启动归属；结果通过原生 gRPC 写回 Sui。已知费用结算，未知费用保持需要确认和全部预留；新建执行器从链上读取历史结果，不使用文件结果缓存。
- [真实链证据](evidence/v020-runtime-result-store-localnet.json)：80 笔 SDK 交易，53 成功、27 预期拒绝；3 笔 Go 校验器启动、8 次检查，另有 2 笔 Go 执行器启动和 2 笔结果写入。两个合成适配器子进程各调用一次，分别验证已知/未知费用；约 33 KiB 密文同 PTB 分块写入。14 个预算断言通过。
- Human 恢复后 5 份终态正文可解密，8 个选定检查点账本及 4 份总账一致。原有 6 次 Go Host 授权读取仍通过。SDK 66/66、类型检查及构建通过；Move 103/103、envd 全量 Go 回归通过。
- 测试发现并修复大正文 Gas 上限不足与首次空分页 token 的真实链问题。余额不足、RPC 无法读取、回执丢失、已提交后回执丢失的只读恢复、正文与终态/费用冲突均有回归；不能把 RPC 失败显示成确定需要充值。
- **未完成**：本次结果存储验证尚未覆盖生产工厂/OS 密钥存储，后续进展见下节。组织轮换后的在途结果密钥补交、真实受约束 Agent、物理停止与实际费用计量尚未交付；合成子进程和费用不是实际 Agent 验收。#27/#28/#30/#32/#33/#41/#48 均继续保持未完成。

### 生产工厂与 Host 安全身份增量

- envd 生产工厂选择链上授权/预留/加密结果存储，拒绝生产文件授权路径。Host 签名与加密密钥显式初始化并保存到系统凭据库；正常启动不自动生成身份，控制通道与 Sui 客户端复用同一 Host 地址。
- macOS Keychain 原生测试通过：独立生成测试密钥、重新加载同一身份、重复创建拒绝，测试条目已删除；没有秘密文件或用户 keystore 访问。Linux Secret Service/Windows Credential Manager 提供者和三平台 envd 编译通过，尚无 Linux/Windows 原生存储运行证据。无 Secret Service 的无界面 Ubuntu 云端接入仍待交付。
- [生产工厂真实链报告](evidence/v020-production-factory-localnet.json)：84 笔 SDK 交易，57 成功、27 预期拒绝；原有 Go 校验器和结果存储流程全部通过，新增生产工厂 1 笔启动和 1 笔加密结果保存。注入测试凭据库和合成观察子进程，重启保持身份、读取链上原结果，只调用一次；控制请求保持排队，显式取消释放预留。16 个预算断言通过。
- Human 恢复后 6 份终态正文可解密，10 个选定检查点与 5 份预算总账一致。全量 Go 回归、Host/执行器 `-race` 检测与 SDK 类型检查通过。设置和复现见 [Host 身份与执行器](v020-host-identity-runtime.md)。
- **未完成**：当前生产 agent-manager 仅观察；链上确认的控制标签不能替代沙箱，所有并发控制请求在预留前拒绝。此增量不证明真实 Agent、云端 envd、实际计费或 App 完整恢复已验收。#25/#30/#32/#48 继续保持未完成。

### 原生文件 Agent 的真实执行增量

- 生产工厂可显式选择 `native-file-agent`。依次观察、修复并测量 1–3 个文本文件目标；单独的工具目录根限制读取/写入/列目录，每次调用和发布前重验链上权限、检查点、停止状态和 Clock。
- [原生执行真实链报告](evidence/v020-native-file-agent-localnet.json)：87 笔 SDK 交易，60 成功、27 预期拒绝；17 个预算断言。新增成功/停止两条原生文件流程，真实写入与 Host 读取测量通过；设备链上停止阻止下一目标，两次运行分别消费 6/1 次工具尝试，预留全部释放。执行器重启读取原加密结果；Human 恢复后 8 份终态正文、12 个检查点与 6 份总账一致。
- 工具越界、受保护目录的大小写变体、Windows 别名/设备路径、硬链接/FIFO、并发预算、停止后临时文件清理、重试后撤销和期限边界测试通过。Go 全量回归、工具/执行器/授权竞态检测、SDK 66/66 与类型检查通过。配置与边界见 [文件 Agent 说明](v020-bounded-file-agent.md)。
- **未完成**：这是明确文件目标的真实执行增量，不代表通用模型规划、完整 OKR 生命周期/审批约束、App 导航、模型费用计量、云端 Host 或五平台原生运行已验收。测试凭据库注入和步骤间停止触发器只用于独立链测试。#25/#27/#28/#30/#32/#33/#34/#41/#48 仍不标记整体完成。

### OKR 模型、人工验收与观测历史增量

- 新增 `okr::Okr`，保持已发布 Objective/KeyResult/Run 对象字段。组织目录、草稿/ACTIVE/暂停/达成/归档、最多三个 ACTIVE、1–3 个定量 KR、单实例约定、CAS 版本、顺序游标与独立人工验收持久化。规格/约定/验证/验收正文复用加密记录；原始数值等公开链上字段的隐私边界见 [模型说明](v020-okr-model.md)。
- Host 观测要求同组织/实例、真实已成功 Run 与其不可变结果，并检查当前成员、实例及约定版本和新鲜度。观测保持未验证，授权人验证 KR 后才推进顺序，全部验证后仍需整体人工验收。不可变观测历史可分页重建。
- [真实链报告](evidence/v020-okr-lifecycle-localnet.json)：105 笔 SDK 交易，73 成功、32 预期拒绝；新增 18 笔 OKR 交易覆盖三 ACTIVE/第四个拒绝、暂停名额、精确创建重试、旧版本、其他 Host 拒绝、100% 未达成及单独人工验收。复用两个真实文件成果；Human 恢复后四个 OKR、观测历史和十份正文重建/解密通过，原有命令与预算恢复仍通过。
- Move 110/110、SDK 69/69、类型检查和构建通过。**未完成**：OKR 约定到命令 capability/预留/工具的强制绑定、预算累计与在途预留、2–3 KR 真实顺序执行、退回重规划、领域验证器、App 导航/审批及云端部署。约定版本目前改变产品状态，尚未自动撤销独立运行时 capability。#27/#28/#34/#37 继续保持整体未完成。

### OKR 强制执行与全局预算增量

- capability 绑定 OKR、约定版本与边界摘要；签名命令绑定当前 KR。准备和启动校验有效约定，实际文件工具在每次动作及发布前重新读取链上约定／游标／权限／Clock；通用命令入口无法绕过。观测证据需要同一绑定权限和 KR。
- OKR 全局总账与 capability 逐笔账本原子更新，共用已支出与在途预算；权限换发不重置预算、精确重试不再次预留、排队取消释放。暂停后的旧命令无法启动，已启动运行和旧约定的历史结果仍可结算与读取。预算有记录后禁止换资产。
- [实际链证据](evidence/v020-okr-execution-bound-localnet.json)：118 笔 SDK 交易，78 成功、40 预期拒绝；真实原生文件 Agent 两次运行消费 6／1 次工具调用，14 次预留全部结算或释放。恢复后的新 SDK 重建全局总账（7 支出／0 在途）、成功逐笔记录和暂停后的取消记录；原有 8 份结果、12 个检查点、6 份能力总账与 10 份 OKR 正文恢复仍通过。
- Move 110/110、SDK 71/71 与类型检查／构建、envd 全量回归、工具／授权／执行器竞态检测及三平台编译通过。**未完成**：2–3 KR 实际顺序执行、绑定 OKR 的未知结果专项链测试、退回重规划、重新审批恢复、App 导航／沟通／证据审阅、云端 Host、通用规划与完整发布验收。各整体 Issue 保持未完成，历史增量的限制由本节新增证据补充。

### 多 KR、重新审批与未知结果预算增量

- [实际链证据](evidence/v020-okr-sequential-localnet.json)：141 笔 SDK 交易（91 成功、50 预期拒绝），20 个预算断言。原 KR0 验证后暂停，修改规格并清空指标与验证，显式重新审批至约定版本 4；旧 capability、旧规格审批和旧证据拒绝。重新审批不能把上限降低至已有支出以下。
- 新约定下两个 KR 分别实际读取已有文件、创建并再次读取最终文件，消费 1／3 次工具调用；全局支出由 7 累计至 11，在途 0。两条观测分别经人验证，全部验证后仍需整体人工验收。历史约定与旧正文保留。
- 新 SDK 从组织／OKR 链上目录分页发现四个 OKR、三条历史观测和已达成 OKR 的四个 Run；核对两层账本。`productRecord.listHistory` 校验不可变修订的来源、UID、范围及连续链接，包括分页边界；恢复后十份当前 OKR 正文、两份旧正文，以及十一份命令终态、十五个检查点、八份 capability 总账重建通过。
- 另一个绑定 OKR 的合成未知结果真实回链：保留 14 次工具预留；新 capability 无法绕过全局上限，重复查询不再次执行。恢复后从链上目录发现该 Run，仍为需要确认、支出 0／在途 14。此项证明传输和账本，未核实实际 Agent 的未知副作用，也未实现人工核实结算。
- SDK 75/75、类型检查／构建、envd 全量 Go 回归与工具／授权／执行器竞态检测通过。**未完成**：生产自主循环、审批介入、未知结果人工核实、App 导航／沟通／恢复、云端 Host 和完整发布验收。顺序 KR 的签名准备及人审由脚本驱动；整体 Issue 继续保持未完成。此增量补充上述历史记录中尚未验证的多 KR／重新审批／绑定未知结果部分。

### 技能与文件投影契约增量

- `okr-manager` 增加链上组织模式，保留独立文件使用方式；链上模式区分未提交编辑、观测、KR 验证和人工验收，禁止通过文件修改扩大权限或自动达成。中英文模板增加基线／当前／目标、单位与精度、方向、权重、新鲜度、Run／证据来源。
- Agent OS 核心文件与心跳契约引用版本化 OKR 投影规则；技能中的可移植示例说明来源版本、当前 KR、预算支出与预留、未知采样和阻塞依据。技能校验器通过，文档引用检查通过。
- **未完成**：App／SDK 的正式导出、草稿导入和版本／设备签名提交流程及实际自主循环仍需实现；仅更新契约不能证明 #39 整体验收。该 Issue 保持未完成。

### 生产 Host 自动测量提交增量

- envd 接入签名 `verified_text_file_count` 测量方式。成功结果确认后核对实际文件证据，自动提交当前 KR 的未验证观测；计数取实际读取结果，采样使用最早读取时间。指标目标不符在启动前拒绝。观测事务与执行结果状态分别返回，失败／停止／未知执行不冒充成功观测。
- [实际链证据](evidence/v020-auto-observe-localnet.json)：138 笔 SDK 交易（88 成功、50 预期拒绝），原来由脚本代提交的三笔观测改由正式生产 envd 提交。三条观测、两个 KR、重新审批、人工验证和单独验收、全局预算 11／0、身份恢复与另一 OKR 的未知预留 14 均通过。
- 实际链测试发现本机采样略领先 Sui Clock；修复为等待链上时间达到真实样本，不改写时间。Go 回归覆盖回执丢失后的只读确认、篡改证据、换版／换实例失效、人已验证后的重复查询、重规划移除旧 KR 和观测 Gas 预检。Go 全量／竞态检测、SDK 75/75／类型检查通过。
- **未完成**：设备端仍由脚本准备每条签名命令和人审，生产自主循环、观测异常的 App 查询／处理、通用模型规划、云端 Host 及完整 App 闭环仍需交付。此增量不标记 #34 或 v0.2.0 整体完成。

## 必须通过的最终闭环

1. 创建或只凭恢复码恢复稳定 Human，独立设备授权及撤销有效，加密数据可恢复。
2. 创建组织，一次性限时邀请码接入本地及云端 Host，发现并明确授权受约束 Agent。
3. 用户确认可测量 OKR、范围、预算及期限，Agent 自主顺序推进，并产生可检查证据。
4. 工作台显示当前步骤、最近观测、指标趋势和边界；偏航/卡住可沟通、暂停、审批并恢复。
5. 签名及链上授权被执行端校验；超限与撤销拒绝，结果未知不重复执行，停止由执行端确认。
6. KR 验证与人工验收分开，最终达成由人确认；清空客户端与 Coordinator 缓存后从链上重建。
7. 余额、费用、充值和自付交易流程真实可用；桌面/手机布局、中英文及深浅主题走查通过。

## Issue 验收映射

### #22 protocol: 用 sui::clock 替换 epoch_timestamp_ms 做时间判断

来源：[22](https://github.com/fractalmind-labs/fractalmind-os/issues/22)。状态：未完成。

- 到期前后 1 ms 的边界测试，覆盖关键授权入口。
- 调用方完成迁移，旧入口处置和升级兼容说明写入协议文档。

PRD：§8、FR-33；供 #23/#25/#27/#28 复用。

### #23 protocol: Human 身份、设备授权与统一权限判断

来源：[23](https://github.com/fractalmind-labs/fractalmind-os/issues/23)。状态：未完成。

- 两台设备独立授权、独立撤销；只读设备或无审批角色不能审批；撤销后新受保护操作被拒。
- 身份及组织关系可从链上重建；覆盖原型 approvals/devices 中本范围的场景。

依赖 #22；各入口随对应功能接入，不要求完成未来模块后才交付。PRD：§5、J4、J8、FR-11、FR-15、FR-35、FR-36。

### #24 protocol: 单恢复码的链上恢复记录

来源：[24](https://github.com/fractalmind-labs/fractalmind-os/issues/24)。状态：未完成。

- 单份恢复码可定位并恢复身份，不要求额外抄录 Human ID；仅查找身份不授予权限。
- 并发/重放只成功一次，旧设备与旧恢复码不能继续授权；恢复后能解密原有持久数据。
- 覆盖原型 recovery 组及真实链上恢复集成测试。

依赖 #23；加密数据恢复与 #26 联合验收。PRD：J9、FR-37。

### #25 protocol: 主机一次性邀请码与成员资格

来源：[25](https://github.com/fractalmind-labs/fractalmind-os/issues/25)。状态：未完成。

- 复制证明、过期/撤销邀请被拒；并发兑换只成功一笔；失败交易不消费邀请。
- 已消费邀请不能再撤销，应撤销主机；成员资格或执行授权失效均阻止新执行。
- 覆盖原型 invites 组和接入后授权重建。

依赖 #22、#23。PRD：J7、FR-26、FR-33、FR-34。

### #26 spike: 加密正文上链与存储成本 PoC

来源：[26](https://github.com/fractalmind-labs/fractalmind-os/issues/26)。状态：未完成。

- 给出实测数据、可复现脚本、成本估算、ADR 及采用方案的边界；清空本地缓存后仍能重建、解密持久状态。
- 结果只阻塞对应持久正文方案落地，不阻塞 #29、#33 的运行时改造或 #38 的模拟数据客户端。
- 若实测无法满足产品约束，明确提交待决策项；不得静默改成业务后端或链外正文。

PRD：§8、FR-32、§13。与 #24 联合验证恢复；为 #27/#28/#41 的正文方案提供依据。

### #27 protocol: 最小 OKR 模型、执行约定与证据验收

来源：[27](https://github.com/fractalmind-labs/fractalmind-os/issues/27)。状态：未完成。

- 一个真实 OKR 可激活、推进、提交证据、人工验收并从链上重建；预算含在途预留，旧约定不能继续授权。
- Agent 自报或指标达到目标不能直接变成已验收；覆盖原型 achievement/completion/draft/lifecycle 的基础场景，高级场景由 #49 承接。

依赖 #22、#23；正文方案以 #26 为准。PRD：§8.1、FR-04、FR-05、FR-07、FR-40。

### #28 protocol: 审批、证据与 Run 持久检查点

来源：[28](https://github.com/fractalmind-labs/fractalmind-os/issues/28)。状态：未完成。

- 同意不等于已执行；过期、失效及已消费的审批不能执行；提交与执行前重验版本和授权。
- 能从链上恢复审批、证据及 Run 检查点，无法确认副作用时保持需要确认。
- 覆盖 approvals 及证据验收的基础场景。

依赖 #27；正文方案以 #26 为准；与 #33 联合交付。PRD：§8、FR-06、FR-07、FR-08。

### #29 envd: 下线未签名的旧命令通道

来源：[29](https://github.com/fractalmind-labs/fractalmind-os/issues/29)。状态：未完成。

- 未签名写命令被拒绝；有签名但目标/动作/范围不符也被拒绝。
- 写操作绑定主机与实例，产生 NodeEvent 回执；结果未知先查询，不盲目重发。

可立即推进，无需等待全部新协议对象完成；最终链上授权与 #30 联合验收。PRD：FR-27、FR-30、NFR-03。

### #30 envd: 以链上状态为准的 AuthorityStore

来源：[30](https://github.com/fractalmind-labs/fractalmind-os/issues/30)。状态：未完成。

- 在线但撤销与授权有效但离线分别可辨认；撤销后新受保护命令被拒。
- 清空缓存可从链上重建；重复投递不会重复消耗预算或执行。

链上解析依赖 #23、#25；接口和运行时测试可先推进。PRD：FR-32、FR-33、NFR-06。

### #31 envd: 签名心跳、实例状态与最后观测

来源：[31](https://github.com/fractalmind-labs/fractalmind-os/issues/31)。状态：未完成。

- 伪造主机、无效成员资格和篡改载荷被拒；断线后不把旧数据显示为当前状态。

成员资格校验依赖 #25；载荷与签名接口可先开发。PRD：§8.3、FR-25、FR-30。

### #32 envd: Agent 发现的身份与能力信息（J11）

来源：[32](https://github.com/fractalmind-labs/fractalmind-os/issues/32)。状态：未完成。

- 在本地与云端 Host 发现、导入已有实例，重复导入和同名实例行为正确。
- 仅观察与可控制状态准确；已授权的可控实例可进入执行流程；覆盖 discovery 的对应基础场景。

依赖 #25、#48；观测状态与 #31 联合交付。PRD：J11、FR-39。

### #33 envd: Run 状态机与事件流

来源：[33](https://github.com/fractalmind-labs/fractalmind-os/issues/33)。状态：未完成。

- 覆盖执行成功、待审批、停止确认、断线、重复请求及未知结果恢复；断线不等于失败。
- 覆盖原型 runs 组；无需另建通用工作流引擎或事件中间件。

运行时依赖 #29，可先用模拟协议推进；持久检查点与 #28 联合验收。PRD：§8、J3、J12、FR-09、FR-41、附录 B.3。

### #34 envd/app: 单 Agent OKR 自主循环与运行导航

来源：[34](https://github.com/fractalmind-labs/fractalmind-os/issues/34)。状态：未完成。

- 一个真实目标可持续推进；超限暂停，用户沟通或审批后按新事实恢复，证据达标后仍等待人验收。
- 地图能说明到哪里、最近是否推进、为何暂停，不能把没有证据的判断当事实。
- 覆盖 heartbeat/scenarios 的基础集成场景；不引入分布式调度或通用多 Agent 编排。

执行集成依赖 #27、#28、#30、#33；状态契约和模拟测试可先推进。PRD：§8.1、§8.2、FR-05、FR-06、FR-31。

### #35 coordinator: 按设备鉴权与链上节点目录

来源：[35](https://github.com/fractalmind-labs/fractalmind-os/issues/35)。状态：未完成。

- 撤销设备后新请求被拒；跨组织订阅和路由被拒；一个入口断开不改变其他入口的授权。
- 清空缓存后可重建 Host 路由，本地及云端各一台 Host 可从同一 App 管理。

鉴权与目录依赖 #23、#25；在线状态与 #31 联合交付，直接消息集成见 #43。PRD：§8.4、FR-33、FR-34、FR-41。

### #37 sdk: 核心协议读写、事件游标与自付交易管理器

来源：[37](https://github.com/fractalmind-labs/fractalmind-os/issues/37)。状态：未完成。

- 核心闭环的链上读写可用；结果未知时查询同一交易，确认后不重复提交。
- 未充值不能发出需要 Gas 的交易，失败与费用信息准确；恢复流程有可行自付 Gas 路径。
- 覆盖 fees/invites 及当前启用对象的集成场景。

各对象实现依赖对应 #23/#24/#25/#27/#28/#41；交易管理器、共用读取及接口可先开发，不串行等待全部 schema。PRD：FR-38、附录 B.3。

### #38 app: 基于原型 v2 的客户端骨架

来源：[38](https://github.com/fractalmind-labs/fractalmind-os/issues/38)。状态：未完成。

- 当前核心领域场景测试通过，桌面与手机可走查完整核心流程；后续测试分组已有明确承接 Issue。
- 本地与云端 Host、未知/离线状态、待审批和费用不足能正确展示，清空缓存可恢复持久状态。

模拟接口和客户端骨架可立即推进；真实数据依赖各已启用对象的 #37 与 #35。PRD：§5、§9、附录 B.1、附录 C。

### #39 skills/spec: OKR 模板加入 KR 指标，并定义为链上记录的投影

来源：[39](https://github.com/fractalmind-labs/fractalmind-os/issues/39)。状态：未完成。

- 同一核心 OKR 在 App、链上和技能投影中语义一致；过期版本和未提交编辑有明确提示。
- 结构化观测能支撑运行导航，Agent 不能通过修改文件绕过授权和验收。

字段实现依赖 #27；模板及契约定义可并行推进。PRD：§8、§8.1。

### #41 protocol: 最小常驻权限与 App 直接对话记录

来源：[41](https://github.com/fractalmind-labs/fractalmind-os/issues/41)。状态：未完成。

- 白名单内可执行，预算不足或超权先暂停审批；旧版审批失效，审批执行一次，未知结果先查询。
- 不受约束/仅观察 Agent 不获得执行常驻权限，也不能承接 OKR；数据与授权可从链上恢复。
- 覆盖 direct 组基础场景；日配额及独立任务转换测试由 #52 承接。

依赖 #23、#28；正文以 #26 为准；与 #43/#45 组成一条端到端交付切片。PRD：J12、§8.2.3、FR-41。

### #43 envd: 直接消息投递与常驻权限执行检查

来源：[43](https://github.com/fractalmind-labs/fractalmind-os/issues/43)。状态：未完成。

- 覆盖签名投递、预算预留、工作区冲突、旧版策略、幂等和固定实例离线场景。
- 未知结果先查询；仅观察或不支持对话的适配器不冒充可执行/可对话实例。

依赖 #41、#29、#33；路由与 #35 联合交付。与 #41/#45 共同验收。PRD：J12、§8.2.3、FR-41。

### #45 app: 最小 Agent 对话、常驻权限与介入审批

来源：[45](https://github.com/fractalmind-labs/fractalmind-os/issues/45)。状态：未完成。

- #41/#43/#45 端到端走通一次真实对话执行与超权审批；单次批准不扩大长期权限。
- direct 基础场景在桌面/手机、中英文/深浅色可用，高级场景由 #52 承接。

依赖 #38、#41、#43；可先模拟接口开发。PRD：J12、§8.2.3、FR-41。

### #48 protocol/envd: 受管理 Agent 的身份、Host 归属与能力核验

来源：[48](https://github.com/fractalmind-labs/fractalmind-os/issues/48)。状态：未完成。

- 未纳管的公开注册 Agent 不能借注册信息执行组织命令；跨组织、伪造 Host 归属、自报控制能力的请求被拒绝。
- 同一 Host 同一实例重复导入不重复登记，同名不同 Host 不合并。
- 纳管与成员资格可从链上重建；受管理实例的展示不会让仅观察实例获得控制权限。

依赖 #23、#25；与 #30、#32 联合交付。PRD：J11、§8.4.1、FR-39、FR-43。
