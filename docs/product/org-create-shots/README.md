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
| `03-root-form-duplicate` | 根设备表单、简介和已有同名组织的提示 |
| `04-fee-quote` | 改成唯一名称后的真实自付费报价与签名前确认按钮 |
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
- 原型/规格把同名组织当作允许继续的软提示；真实协议的全局 `name_registry` 会拒绝同名
  交易（localnet 复核为 `organization::new_organization` abort `3002`）。所以 `03` 如实
  显示提示，随后真实交易改用唯一名称，才生成 `04`–`06` 的报价与确认。这是既有合约与
  原型规格之间的约束差异；本次未获授权改合约，不能伪造一个会成功的重复名交易。

验收脚本是
`apps/fractalmind-app/scripts/org-create-browser-acceptance.mjs`。它创建和销毁本轮测试
profile；localnet、Vite 和 Chrome 均在运行结束后停止。
