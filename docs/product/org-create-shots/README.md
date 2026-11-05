# 新建组织：真实浏览器验收截图

这些不是 mock 或生成图。它们来自一个新鲜、隔离的 Sui localnet：先发布临时的三包，
再用真实的原生测试设备创建 Human 和个人组织；Chrome headless 经 CDP 打开 Vite App，
并通过一个仅接受本轮 `test-*` profile 的 loopback bridge 完成真实自付费交易。完整清单、
记录时间、网络、主题和尺寸在 [acceptance.json](acceptance.json)；该文件不含私钥。

每个状态有四张同屏截图：`light` / `dark` × `desktop-1280x800` /
`phone-390x844`。

| 前缀 | 实际状态 |
| --- | --- |
| `01-orgs-entry` | “我的组织”页右上角的“新建组织”入口 |
| `02-org-menu-entry` | 组织切换菜单里的“新建组织…”入口 |
| `03-root-form-name-taken` | 根设备表单、简介、自己的已占用全网名称提示，以及禁用的“签名创建” |
| `04-fee-quote` | 改成全网唯一名称后的真实自付费报价与签名前确认按钮 |
| `05-pending` | 原生设备已实际签名、尚在提交的 pending 状态 |
| `06-confirmed-workbench` | 已确认后切到新组织工作台及“组织已建好”提示 |
| `07-non-root-explanation` | 有 `org_scope` 的设备被拒绝时的说明和无设备名回退标签 |

## 与原型的实际对照

- 桌面四态、深浅两色、入口、表单、报价、pending、确认后的工作台/成功弹层与
  `view-org.js` 的 `org-new` / `org-made` 流程一致。
- 手机上的对话框现在是原型的底部抽屉，而不是挤进窄屏的桌面对话框；为此 v2 host
  在窄屏加上原型 CSS 所需的 `.app.m` frame。
- 链上 `DeviceGrant` 没有设备显示名。实际截图里的未知设备按产品要求显示为
  `另一台设备 · 0x12ab…cd` 形式，而不是裸地址或虚构名称。
- 修正后的规格和协议一致：输入停顿后按 `ProtocolRegistry.name_registry` 查询；`03` 是
  当前 Human 自己已占用的名称，按钮明确禁用，因而没有报价、签名或交易。换成一个新名称后
  才生成 `04`–`06` 的真实报价、签名和确认。查询与签名之间若被抢注，客户端也会把合约的
  精确 `organization::new_organization` abort `3002` 映射回同一可改名提示。

验收脚本是
`apps/fractalmind-app/scripts/org-create-browser-acceptance.mjs`。它创建和销毁本轮测试
profile；localnet、Vite 和 Chrome 均在运行结束后停止。
