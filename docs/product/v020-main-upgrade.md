# v0.2.0：main 原包升级、组织迁移与混合类型来源

依据 [#22](https://github.com/fractalmind-labs/fractalmind-os/issues/22)、[#23](https://github.com/fractalmind-labs/fractalmind-os/issues/23)、[#25](https://github.com/fractalmind-labs/fractalmind-os/issues/25)、[#37](https://github.com/fractalmind-labs/fractalmind-os/issues/37) 与总验收 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40)；实现基线 `2aa9af4`。GitHub 当前 main 已核对为 `52713248cb8f5c66c2a015972b473ed57d7d5f8d`。

## 实际升级

在隔离 localnet 直接从该 main 提取生产源码、发布原包并创建旧组织、Objective、KR；随后用当前生产 core 源码执行 `COMPATIBLE` 升级。每笔交易通过正式自付管理器报价、签名一次并保存原回执，逐项只读等待原输出可见；没有操作仓库配置的公共部署、用户 keystore 或 UpgradeCap，没有改变 validator 限制。

升级保持原 Registry、组织、OrgAdminCap、Objective 和 KR 的 ID／BCS 内容。UpgradeCap 指向新调用包、version 2；原 bootstrap 不重跑，必须明确初始化原 Registry 上的身份目录。旧 public 签名可通过兼容检查，但当前包的无 Clock Objective 入口仍明确拒绝 `8399`，当前 SDK 的 Clock 入口可创建保留原类型来源的 Objective。

## 发现并修复的生产问题

`originalPackageId` 不能代表升级包的所有类型。原 `RemoteCapability` 仍属于 main 首次发布包；同一模块新增的 `BoundBudgetKey`／`BoundBudgetTotals` 属于首次引入它们的升级包。身份、Host、Run、正文和扩展桥也首次引入于本次升级。

SDK 新增 `loadCoreTypeOrigins`／`coreType`／`coreTypeTag`，从精确调用包的不可变 BCS 包对象读取每个 datatype 的实际来源，核对包 ID／版本、所有权、原组织类型来源以及重复条目。升级读取按类型解析动态字段与对象；缺失类型、错误原包或不可用包不能退回猜测。并发读取共享一次加载，失败不缓存可用映射；同步字段名称要求先完成加载。首次发布仍沿用已配置的同一类型包，显式 API 类型覆盖保持其原语义。

同时修复 `listOkrs`：首个完整目录页与链上 Table.size 不一致时返回“目录尚未完整”，不能把索引滞后伪装成成功空列表。联测只重复读取原目录，不重新创建草稿。

## R8 验收

[原报告与来源哈希](evidence/v020-main-upgrade-localnet.json)：**13 项检查、22 笔确认交易，退出 0**。

- 原 main 真实发布、当前 core 原地兼容升级；五个既有对象正文保留。
- 新身份目录通过原 Registry 解析；创建 Human／恢复记录及定位恢复码成功。
- 原管理员同时持有 root DeviceGrant 与原 OrgAdminCap，将原组织迁移到稳定 Human。原 Cap 被包裹入 Human 私有表，链上表仍包含精确原 Cap／组织 ID；设备能经当前受保护入口写组织描述。原 Objective／KR 保持原正文，不转换或复制为新 OKR。
- 第二设备默认组织只读；管理员写入在真实模拟中因 `9001` 拒绝，未广播。
- 新正文类型／动态字段可读、解密并枚举历史；新 OKR 扩展能在同一原组织保存可测量 DRAFT 及完整密文。
- OKR／direct 扩展实际发布，依赖精确升级 core 的调用地址，core runtime 地址仍为原包。
- 同一原组织的 Coordinator 绑定、邀请、兑换、成员目录均可读。原类型 `RemoteCapability` 上准备新类型 QUEUED Run 和结果密钥，新增预算字段为 **0 已用／0 预留**；显式取消原 Run 后 CANCELLED、零工具 claim 已结算。没有派发 Host 或执行工具。
- 测试 Host 最后明确撤销并读回确认。

[回归](evidence/v020-main-upgrade-validation.json)：SDK **161/161**、App **229/229**、SDK 类型／构建、App 类型／浏览器构建、夹具严格类型通过。生产 App／Move／Go／Rust 未修改；没有重跑 Go 或合约全量测试，也没有重建原生包。

## 前序证据

[R1–R7 原结果](evidence/v020-main-upgrade-prior.json)均保留：路径定位、发布可见性、描述元数据滞后、SDK 错误类型来源、旧 owned 索引滞后、夹具 AAD 名称错误及 OKR 列表滞后。确认交易数分别为 **0、1、5、6、11、15、15**，不是成功 R8 的结果。

R5 原迁移已确认；其只读复查 **0 广播**，证明原 Cap 已进入原 Human 表且原 owned 索引后来移除。每次新夹具使用独立新账户／新部署／新报告，未重放或改写原请求。R6 的草稿已保存，但夹具使用错误 AAD，未通过正文解密；不能归属为已验收。

## 复现与剩余范围

在 `apps/fractalmind-app` 安装依赖并构建当前 SDK，保持隔离 localnet RPC `127.0.0.1:29000`／faucet `127.0.0.1:29123`：

```sh
node --import tsx scripts/main-upgrade-localnet.ts \
  52713248cb8f5c66c2a015972b473ed57d7d5f8d \
  /tmp/fm-main-upgrade-new-report.json
```

已有报告／进度路径拒绝启动。签名器、恢复码及内容密钥仅为进程内测试材料，没有 OS 密钥库操作或用户数据；报告只保存公开元数据／原回执／哈希。

**仍未完成**：App 控制器与 envd 的混合类型来源完整接线及其实际升级执行闭环、已发布 Testnet 包升级、旧开发单包产品历史迁移、迁移后安装 UI／清缓存恢复、实际重启、真实模型、云 Host 和手机沟通审批。本增量证明合约兼容升级与上述 SDK 路径；不证明整个旧部署已可交付，#40 保持进行中。
