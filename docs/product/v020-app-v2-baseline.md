# FractalMind App：v2 界面基准与接线状态

正式客户端 `apps/fractalmind-app` 的唯一界面基准是
[原型 v2](fractalmind-app-prototype-v2/README.md)，产品范围以
[PRD v0.11](fractalmind-app-prd.md) 为准。v1 保留供历史评审，不作为客户端设计来源。

早期客户端独立实现了只读链浏览与地图，未按 v2 还原，存在实现偏差。
本次修正页面骨架和关键状态表达，把真实 SDK／原生密钥能力接入 v2 的结构。
这次修正不代表 v2 的所有交互或完整 v0.2.0 已实现。

## 来源与实现对应

| v2 来源 | 客户端实现 | 当前能力 |
| --- | --- | --- |
| `styles.css`、`favicon.svg` | `src/prototype-v2-tokens.css`、`src/styles.css`、`public/favicon.svg` | 共用中性／鸢尾紫语义令牌与分形标志；浅色／深色主题 |
| `js/view-welcome.js`、`js/view-identity.js` | `src/Welcome.tsx`、`src/PairingFlow.tsx` | 使命、创建／已有／恢复三入口；创建接通原生密钥／恢复码／费用／Human 与组织交易；恢复接通原生导入／新码备份／费用确认与来源校验；配对接通 10 分钟链上请求、指纹核对、组织授权与单独数据分享，QR／请求队列待完成 |
| `js/shell.js` | `src/App.tsx`、`src/V2Views.tsx` | 十个分组桌面入口；工作区／Host／Agent／设备权限上下文；缺失或加密事实明确标注 |
| `js/view-workbench.js` | `Decisions`、`decisionFacts`、工作台／地图 | 决定事项优先，再显示目标与导航；原因／范围／预算／替代方案／期限；操作暂为查看真实事实 |
| `js/model.js`、可信阶梯组件 | `src/v2-model.ts`、`TrustLadder` | 声明／测量／验证／验收分开，缺数据不伪造声明；历史验证与观测过期分别表达 |
| 手机路线条与全部功能 | `MapView`、`features-sheet`、`mobile-nav` | 五个主入口：工作台、OKR、主机、我的组织、设置；全部功能底部抽屉补齐其余页面 |
| `js/view-org.js` | `OrganizationViews` | 真实组织目录与切换；个人→团队→子组织→联邦成长说明，后续阶段无虚假操作 |
| `js/view-hosts.js` | `src/HostAccess.tsx`、`src/host-admission.ts` | 入口公钥／地址登记、限时单次邀请码与实际费用确认、原交易查询、邀请／成员撤销；链上目录重建。envd 兑换 CLI、实际主机／原生联测与发现导入待完成（[证据与限制](v020-app-host-access.md)） |
| 记忆、治理、开放网络 | 对应页面入口 | 已人工验收成果从真实 OKR 读取；当前加密正文目录与原生按组织读取已接通（[限制](v020-app-private-records.md)），历史选择／审批目录仍待接入；开放网络为后续阶段说明 |

真实客户端没有导入 `js/fixtures.js`、演示状态、本地业务存储或原型的 FNV／签名模拟。
持久业务数据继续以 Sui 为权威；公开连接与外观仅是可丢弃的技术偏好。
原生设备持钥证明不能自动替代组织角色、动作权限、费用确认和解密权限。

OKR 列表的候选创建已接通原生加密、精确 KR、管理员/approve 校验、报价及明确确认后单交易保存草稿；
原生 UI 全旅程、技能质量校验及激活仍待完成，见[候选创建](v020-app-okr-draft.md)。

## 本次实际检查

1. App 单元测试 **29/29**、TypeScript 类型检查及浏览器生产构建通过。
   新检查覆盖结果未知优先级、预留保留、读取失败与空列表区分、测量新鲜度、历史验证与独立人工验收。
2. 浏览器实际读取隔离本地 Sui：工作台第一屏显示两个待关注 OKR；未知 Run 保留 **14** 单位在途预算。
   查看组织目录与成长路径；欢迎页三入口均可访问；恢复入口的后续接线见[恢复旅程](v020-app-recovery.md)。
3. **390 × 844 浏览器 iframe**：五个主导航可见；地图替换为路线条；实际点击“全部功能”打开抽屉，
   再点击“我的身份”关闭抽屉并导航成功，焦点返回触发按钮。
   这是响应式浏览器走查，不是 iOS／Android 原生或全手机旅程验收。
4. 本机 Tauri debug `.app` 重新构建／打包成功。实际 `tauri://localhost` 窗口从 Sui 读取工作台：
   [原生 v2 工作台截图](evidence/v020-app-v2-native-workbench.png)。
   在全新、不存在的测试配置名加载设备，真实 IPC 返回明确的“尚未准备设备密钥”，没有初始化替代身份。
   此负向检查不等于原生 UI 完整注册／恢复／签名交易验收。
5. 实际 macOS Keychain／原生签名／链上组织创建与撤销检查仍见
   [原生设备报告](evidence/v020-app-native-device-localnet.json)与[说明](v020-app-native-device.md)。
   使用隔离生成的测试身份，不使用用户 keystore。远端 CI 尚未运行。

可通过 App README 的构建／预览方式评审。手机 iframe 夹具是
`apps/fractalmind-app/scripts/responsive-check.html`，复制到忽略的 `dist/__responsive-check.html` 后访问；
它加载生产资源并直接读取链，不给设备权限。

## 后续实现必须保留的规则

- 新功能先对照 v2 对应页面与 PRD 旅程；沿用 v2 页面结构及语义令牌，不另起一套界面。
- 将模拟交互替换为正式合约、SDK、原生与运行时操作。结果未知先查原摘要／Run，不自动重放。
- 不把已测量、已验证与已验收合并。失去观测不能推断偏航、卡住或实时在线。
- 创建增量见[原生身份创建](v020-app-identity-creation.md)；本机解锁后已补创建与配对管理的实际 debug UI 走查，具体覆盖与限制见[配对说明](v020-app-pairing.md)。
- 尚待接线：完整创建失败后的新尝试、配对 QR／请求队列与两端完整 UI、安装后恢复 UI／IPC 全旅程、历史正文／通用写入、完整费用历史／审批、Host 兑换 CLI／实际本地和云端联测／发现／导入、
  对话与介入、持续自主运行、真实云 Host 及五平台原生验收。
  原生恢复凭据、正式控制器与链上竞态防护已验证，尚不等于安装后恢复旅程，见[恢复说明](v020-app-recovery.md)。
  完整门禁继续以[实现验证记录](fractalmind-app-v020-validation.md)为准。
