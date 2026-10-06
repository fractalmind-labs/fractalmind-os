# App 原生 OKR 交接审批控制器

依据 PRD v0.11／原型 v2，承接[原执行结果与 Host 审阅读取](v020-app-execution-results.md)。本增量将原生密钥库、当前 OKR 规格及 Host 签名接到正式自付审批控制器；完整交接 UI 仍未完成。

## 审批前核验

`HandoverApproval` 固定组织、设备授权和原审阅 Run，使用 `handover-approve:<executionId>` 作为技术交易请求。`prepare`／`submit` 先查询该请求的原摘要，已有 confirmed／failed／unknown 结果均返回原结果，不因权限撤销、审阅到期或调用方输入改变而重建交易。

新审批要求当前设备具有 read／operate／approve／manage_hosts 权限及组织管理资格。控制器核验原签名命令与原成功结果中的 Host 接受签名，复核当前 Host／Coordinator 成员、活跃成员指针、实例／工作区／版本、完整执行目录及零未结控制执行。目录修订必须恰好是 Host 审阅修订加一；当前 OKR 必须为 DRAFT 或 PAUSED，版本、规格修订、截止时间及授权期限匹配。

当前规格正文通过 OS 密钥库解密。解析复用草稿的精确规格归一化；错误 schema、额外字段、指标尺度或采样周期冲突均拒绝。正式原生文件计划只支持 1–3 KR、整数文件计数（单位 `files`／`文件`）、基线 0 及明确文件内容。计划必须与 Host 审阅的路径哈希相同，各工具路径必须包含在规格允许目录内，文件必须同时处于读／写范围；预算、每 KR 工具上限及总计划额度不能超出约定。指标、权重、采样周期和优先级与链上 OKR 一致；暂停后的重新审批还核验原已花预算及剩余计划额度。

当前执行器只提供有边界的 file.read／file.write／file.list。它能够落实下列精确禁止项：`network.*`、`shell.*`、`process.*`、`file.delete`，以及已有规格常用表达 `external network`、`no shell`、`write outside project`、`禁止外部网络`、`禁止执行 shell`、`禁止写入项目外`。明确禁止任一文件工具时，计划不得授予该工具。其他自然语言约束返回 `unsupported_constraint`，须由用户明确调整规格或后续适配器提供执行检查，不能默默授予。上述检查证明机械边界一致，文件内容是否达成目标仍由用户审阅和独立验收判断。

## 加密、费用与签名

约定包含原 Host 接受证明、确切文件计划及规格对象 ID，使用当前组织密钥版本在原生密钥库加密；JS 不接收组织密钥。引用当前约定目录修订，使用 SDK `handover.confirmOkr` 构建同一原子交易；链上消费原证明并确认控制、激活 OKR、保存审批政策。

加密后、构建后、报价后及提交前重新核验固定状态。用于正式交易管理器的 signer 在原生签名前和返回后再次复核，原生授权等待期间的状态变化或审阅到期会阻止广播。费用 quote 为内存对象，复制或伪造 quote 不可提交；同一控制器并发提交同一 quote 合并为一次提交。业务状态在 Sui，完整 UI 将提供 `IndexedDbTransactionJournal`；本专项仅使用内存技术 journal。

`prepare` 只报价；`submit` 为明确调用的审批动作。控制器没有继续执行／消息派发接口，审批不产生新的控制 Run。后续 App 必须以独立用户动作确认继续，并使用精确链上审批 ID／政策引用。

## 验证

- [App 回归及构建](evidence/v020-native-handover-approval-unit.json)：**116/116** 通过，新增 7 组测试覆盖规格／路径前缀逃逸／预算／禁止项、当前来源与目录变化、加密／报价／签名期间变化、审阅过期、原 unknown 查询优先、伪造 quote 和并发提交。控制器单元测试中的权限、历史审阅与费用服务为受控夹具。
- [实际 OS＋localnet](evidence/v020-native-handover-approval-localnet.json)：**12 项检查、13 笔确认交易及费用**，使用正式权限核验、原生签名／加解密、原结果验签和交易管理器。报价时 OKR 仍 DRAFT／实例未确认控制；提交后 OKR ACTIVE、实例版本 2、协议版本 1，审批引用原 Run／结果，工具上限 3。链上约定通过实际 OS 密钥库读取，内容与原计划及 Host 证明一致。
- 原审批摘要 `5JBBTD33chGEszEKcpbJbfmPp5UpqEjSCKfVAgyz9SS1`，审批对象 `0xf60fbad245d0266e70ccc747c3eb8fcb6e8a3d50b655de14923edab822bb40bd`。专项成功回执与后续裁剪后 unknown 查询分别保留，无重放。执行目录仍仅一条成功审阅 Run，无继续 Run；最后实际撤销 Host 并确认旧准备门禁拒绝、已授权历史读取仍可用。测试凭据已清理。

复现（App 目录，使用既有隔离部署和全新报告路径）：

```sh
node --import tsx scripts/native-command-results-localnet.ts DEPLOYMENT.json NEW_REPORT.json --approve-handover
```

已有报告／进度文件拒绝覆盖。该模式不调用 envd：Host 签署及发布的是明确标记的夹具审阅；不能证明真实物理预约、安装后 IPC／UI、持久 journal 重启恢复或 Human 操作旅程。真实 envd 的已有审阅／审批／继续证据见[运行时继续专项](v020-reviewed-continuation.md)，两份专项尚未合并成完整原生 App 联测。

## 剩余工作

接通 App 审阅请求与原命令票据恢复、任务／约束审阅和费用确认 UI，以及独立明确继续动作；补原生 runner、持续自主推进、对话／介入、独立 Human 验证与最终验收。云 TLS Host、历史迁移／升级、安装后 journal／系统密钥库与五平台仍需完成。v0.2.0 整体目标保持未完成。
