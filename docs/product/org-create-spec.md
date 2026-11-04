# 新建组织：实现规格（FR-02a）

2026-11-04 定。需求与交互以 `fractalmind-app-prd.md` 的 J5、FR-02a 和原型 v2（`fractalmind-app-prototype-v2/`，入口「我的组织」右上角、组织切换菜单）为准。本文件把它们落到 `apps/fractalmind-app`；原型和本文件冲突时以本文件为准。

## 不改的东西

- 不改合约。`identity::create_organization` 已允许根授权设备随时新建组织，并把它挂到 Human 的 `organizations`、`admin_caps`、`roles` 上；SDK 已有 `sdk.identity.createOrganization({ humanId, grantId, name, description })`。
- 不做邀请成员、子组织、联邦（P3/P4，原「团队与子组织」即将推出卡片保留）。
- 新手引导的个人组织流程不变（`onboarding.ts` 里「已有组织就报错」只属于新手引导，不要挪到新流程里）。

## 规则

1. **谁能新建**：当前设备的授权（`DeviceGrant`）满足 `org_scope` 为空、`actions` 含 APPROVE、未撤销、未过期、代数等于 Human 当前代数（与合约 `assert_root` 一致）。不满足时入口仍可见，点开后是说明弹层：「只有主设备能新建组织：这台设备的授权只限于某个组织。」列出这个 Human 名下满足条件的设备名，并说明建好后在那台设备的「我的身份 › 设备」里给这台设备授权。不出现可提交的表单。
2. **表单**：名称必填，去掉首尾空格后 1–64 个字符（按 Unicode 码点计）；简介可选，最多 280 字符。
   **名称全网唯一**（2026-11-04 更正：原稿写“同名只提示”是错的）。`ProtocolRegistry.name_registry: Table<String, ID>` 拒绝任何人已用的名称（`organization::new_organization` abort 3002）。所以：
   - 输入停顿约 400ms 后，以及点「签名创建」前，用 SDK 按键查名称表（Table 的动态字段读取，键为 trim 后的名称）；查到即在名称框下显示「这个名字已经有组织在用了：组织名称在整个网络里不能重复，换一个吧。」（是自己的组织时用「你已经有一个叫这个名字的组织了…」），不报价、不能提交。查询失败时不拦截，但提示「暂时查不到这个名字有没有被占用，签名后如果重名会失败，手续费不退。」。
   - 平时在名称框下用小字说明「组织名称在整个网络里不能重复，建好后其他人在开放网络里也会看到它。」
   - 签名后合约以 3002 拒绝（查询与签名之间被抢注）：映射为同一句话，表单保留原内容和焦点，可改名重试（新的请求 ID）。
   - **新手引导的个人组织**也有同样的问题：同样在报价前查询，并把 3002 映射成可读提示（现在会显示原始错误）。表单上写明：从空开始、你是唯一管理员、邀请他人在后续版本、预计手续费（用现有自付费报价，与新手引导同一套）。
3. **提交**：复用新手引导的 `deviceManager.prepare` → 报价 → 提交路径，新建一个请求 ID：`org-new:{profile}:{humanId}:{随机 nonce}`，在用户点「签名创建」时生成并持久化，直到交易有确定结果；按钮在 pending / 结果未知时不可再次提交。结果未知时按现有规则查询原交易，**不重放**。gas 预算与新手引导建组织相同。
4. **确认后**：重新读取 Human（`chain.human()`），找到新增的组织 ID（`organizations` 比提交前多出的那一个），`selectOrganization` 切过去，进入工作台，弹出「组织已建好」：下一步建议（连接主机、写第一个 OKR），以及**还不能使用新组织的设备**：本 Human 名下有效授权中 `org_scope` 为某个别的组织的那些设备，附「去授权设备」入口（我的身份 › 设备）。
5. **标签**：组织副标题的类型改为：`depth > 0` → 子组织；是这个 Human 的**个人组织** → 个人组织；其余 → 组织。个人组织 = `human.organizations` 的第一个（新手引导创建的那个）。把这个判断写成一个有单测的函数，Shell 顶栏、切换菜单、「我的组织」列表、我的身份页统一用它（现在 `Shell.tsx` 用 `depth > 0` 判断，其余一律叫「个人」，要改）。
6. **入口**：「我的组织」页标题右侧主按钮「新建组织」；组织切换菜单在组织列表下方加「新建组织…」。手机布局下同样可用（弹层改为底部抽屉，沿用现有手机对话框模式）。

## 文案

中文为准，英文逐条对应，放进现有 i18n（`t(zh, en)`）。直接沿用原型 v2 `js/view-org.js` 里 `org-new` / `org-made` 两个弹层和错误表 `ORG_ERR` 的文字。

## 验收

1. `npm test`、`npm run build` 通过；新增单测：名称占用查询（被他人占用、被自己占用、未占用、查询失败）与 3002 映射，根授权判断（无 org_scope + APPROVE 通过；有 org_scope、缺 APPROVE、已撤销、已过期、旧代数各不通过）、名称校验、组织类型标签、提交前后组织列表差集取新组织、受限设备列表。
2. 仿照 `scripts/native-onboarding-localnet.ts` 写 `scripts/org-create-localnet.ts`：在本地网络上建身份和个人组织后，再用主设备新建第二个组织，断言 Human 的 `organizations` 为 2、新组织管理员是该 Human、App 读取层能读到两个组织；再用一个 `org_scope` 限定的设备尝试新建，断言合约拒绝。只用本地网络，不碰测试网。
3. 用开发模式在浏览器里走一遍：新建 → 待确认 → 已确认 → 切换 → 成功弹层；非主设备的说明弹层；截图日间、夜间各一套放 `docs/product/org-create-shots/`，并与原型同屏对照，列出差异。
4. 交付说明写在本文件末尾「实现记录」。

## 实现记录

2026-11-04 实现于 `terra/org-create`。

- 新增 `src/organization-create.ts`。它在每次报价前重读 `Human`，仅接受与
  `identity::assert_root` 一致的当前无范围 APPROVE 授权；校验名称和简介、生成
  `org-new:{profile}:{humanId}:{nonce}` 的持久请求定位符、按目录差集确认新组织，
  并列出仍局限于其他组织的有效设备。交易继续走自付费 `prepare → quote → submit`
  路径，预算与新手引导一致。未知结果只查询原请求，绝不重放。
- 新增 `v2/OrganizationCreate.tsx` 和两个入口（“我的组织”的主按钮、组织切换菜单）。
  成功后切换到新组织和工作台，并显示连接主机、首个 OKR 及“去授权设备”的后续操作。
  非根设备只显示说明，不显示可提交表单。现有 `Dialog` 的移动端样式负责改为底部抽屉。
- 组织类型判断现在在 `organizationKind` 中统一：有 depth 的是子组织，Human 向量第
  一个是个人组织，其余是组织；Shell 顶栏、切换菜单、我的组织和我的身份页共用它。
- 增加 `scripts/org-create-localnet.ts`。该脚本仅接受 loopback RPC/faucet：先创建
  身份和个人组织，再以生产 `OrganizationCreation` 控制器建第二个组织；它断言目录为
  两项、第二项管理员为该 Human、读取层可见两项，并以有 APPROVE 但带 `org_scope` 的
  设备模拟创建，断言合约拒绝且不广播负例。

规格未明示而按原型处理的情况：简介同名称一样在提交前去首尾空格（原型
`validateOrg` 如此处理）。`DeviceGrant` 没有设备显示名字段、且本次不能改合约，故
“可用主设备”和受限设备以稳定的缩写地址显示，而不是捏造一个名称。

已运行：

- `cd apps/fractalmind-app && npm test`（446 通过）
- `cd apps/fractalmind-app && npm run build`（通过）
- 新鲜隔离 localnet 上发布三包后运行 `scripts/org-create-localnet.ts`（3 项链上验收
  检查通过；本地临时报告未含私钥）。
- 新鲜隔离 localnet + Vite + Chrome headless/CDP 的真实浏览器验收（28 张：日/夜、
  1280×800/390×844，入口、表单、报价、pending、确认、切换及非根设备说明均已记录）。
  见 `docs/product/org-create-shots/README.md` 与 `acceptance.json`；临时 profile 在脚本
  结束时删除，未接触测试网或主网。

视觉验收相对原型的修正：v2 的 Dialog host 现在在窄屏包在 `.app.m` 中，因此手机用原型
的底部抽屉规则；无设备名时显示 `另一台设备 · 0x12ab…cd`，而非裸地址。真实链还揭示了
一个既有约束：协议的全局 `name_registry` 会拒绝重复名（abort `3002`），而原型/规则 2
把同名视为允许继续的软提示；为诚实取得后续的真实报价和确认截图，截图流在提示后改用
唯一名称。本次未改合约，差异也记录在截图 README 中。
