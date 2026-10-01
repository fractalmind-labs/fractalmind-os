# v0.2.0 设备端 OKR 执行循环增量

`NativeFileOkrRunner` 将设备签名与原生文件 Agent 的执行接通：从链上当前批准的加密约定读取计划，为当前 KR 准备一份持久命令票据，并交给固定 Host。它推进 #34/#37；完整 App、持续调度及通用模型规划仍待交付。

## 批准的计划

当前仅支持明确的文件目标。批准约定的加密正文包含：

```json
{
  "nativeFilePlan": {
    "format": 1,
    "paths": {"file.read": ["docs"], "file.write": ["docs"]},
    "krs": [
      {"files": [{"path": "docs/result.md", "content": "Measured result\n"}], "maxCalls": "3"}
    ]
  }
}
```

- 1–3 个顺序 KR；每个 KR 为 1–3 个文件。链上指标必须是基线 0、目标等于文件数、预算资产 `TOOL_CALLS`。文件目标、内容与预算来自批准的约定，调用者不能在 `step()` 中临时替换目标。
- 路径摘要必须等于当前约定的边界；相对路径、UTF-8、正文大小、工具次数和跨平台保护名称在设备端预检，实际执行仍由 Host 的文件沙箱与链上授权校验。
- 文件通常需要三次工具尝试：观察、修复、读取测量；已经符合目标的文件只需一次。预算不足返回待审批状态；审批请求界面仍需由 App 接入。

## 原子准备与固定投递

设备检查成员、受管理实例、工作区、能力及约定版本；检查 capability 与 OKR 两层预算，包括已支出、在途预留和已委托额度。签名命令含当前约定／KR、文件目标、边界、次数和明确的文件计数测量方式。

同一 PTB 保存以下状态：

1. 组织密钥加密的完整签名命令票据，逻辑 ID 为 `runner-{okrId无0x}-{agreementVersion}-{krIndex}`，创建要求修订为 0。
2. 仅供目标 Host 使用的命令专用结果密钥封装。
3. 使用次数、两层预算预留及排队 Run。

任一检查失败均原子回滚；两个设备竞争同一票据不能各自创建一次执行。票据直接保存使用 `product_record::save`，因此当前执行设备须具有 `approve` 权限及组织正文密钥。Host 不获得组织根密钥或设备签名密钥。

执行循环在确认票据和匹配的 Run 后，才投递原签名命令。目录索引可能晚于成功交易回执，最多只读等待 5 秒；仍不可见则返回待确认。等待不重新提交交易或投递 Host。Host 继续验证当前链上权限与自己的启动尝试，成功结果与真实费用确认后自动提交未验证观测。

## 接线与恢复

```ts
const runner = new NativeFileOkrRunner({
  sdk, organizationId, humanId, grantId, signer: deviceSigner,
  keyForVersion: authorizedOrganizationKey,
  submit: createSelfPayOkrSubmitter({
    manager: transactionManager, gasBudget: approvedGasCeiling,
    approveQuote: showFeeConfirmation,
  }),
  deliver: fixedHostTransport.deliver,
});

// 默认恢复／查询；不创建新命令，也不自动重发旧命令。
await runner.step({ okrId, capabilityId });

// App 明确启用当前批准约定的推进后，为尚无票据的 KR 创建命令。
await runner.step({ okrId, capabilityId, createIfMissing: true });
```

这里的密钥提供器、交易管理器和固定 Host 传输是 App 必须实现的接口，示例不代表已有完整 App 接线。`capabilityId` 只用于创建新票据；恢复时继续查询票据原本绑定的能力和 Run，不静默换发授权。

新建执行循环从组织链上索引读取、解密票据。恢复到排队 Run 时返回 `queued`，需要调用方显式 `releaseQueued: true` 才投递原命令；在途投递不能被推断为未发送。运行中只查询；成功但观测未确认显示待确认；结果未知保留预算、不重放副作用；失败、取消和过期命令不自动换一份命令继续执行。暂停、换版及当前 KR 改变会阻止新投递。

进度到达目标后返回待人工验证；KR 全部验证后返回待最终验收，执行循环不会代人签署验证或验收。缺失、过期或未来采样有明确状态依据。确定拒绝可在纠正后显式创建；未知提交在同一实例内保持查询状态。新进程默认仅恢复，尚未接入 App 持久交易摘要及自动推进开关的恢复流程，因此不能据此宣称完整自主循环已经完成。

## 验证

最新[自付接线证据](evidence/v020-selfpay-runner-localnet.json)重新运行完整闭环：138 笔 SDK 交易中，两个 KR 的原子准备使用正式 `SelfPayTransactionManager` 和真实费用报价，恢复、人工验证与验收仍通过。SDK 104/104、类型检查及构建通过。`submit(transaction, { requestId })` 接收与票据相同的稳定请求 ID；`createSelfPayOkrSubmitter` 先查询原交易，再对首次请求确认费用。未知和失败交易不自动替换。浏览器持久提供器及实际刷新证据见[自付交易说明](v020-selfpay-transactions.md)。

[真实本地链报告](evidence/v020-device-runner-localnet.json) 包含 138 笔 SDK 交易：88 成功、50 预期拒绝，另有正式 Go Host 启动、结果与三次自动观测。重新审批后的两个 KR 由正式执行循环从批准正文读取目标并创建票据，实际工具次数为 1／3；总支出 11、在途 0。新执行循环查询已测量的 KR，没有第二次投递。Human 消费式恢复和密钥轮换后，仅凭恢复记录的历史 keyring，可从链上目录定位并解密两份命令票据，重建原有 OKR、观测、历史正文、Run 和预算。

SDK 88/88 测试、类型检查及构建通过。执行循环回归覆盖并发调用、未知回执、索引延迟、恢复排队、过期命令、未知结果、两层预算、旧绑定、计划期间换版、RPC 失败、密文篡改与 Run 元数据冲突。单位测试模拟链传输；真实文件执行与链上账本由上述独立本地链测试证明。其他平台原生运行、真实云 Host、通用规划、持续循环、直接对话和完整 App 仍需验收。

复现：在 SDK 目录，使用独立 Sui localnet 和 faucet，以及包含当前 `okr` 模块的零地址测试包 bytecode：

```sh
FM_HOST_ACCEPTANCE=1 FM_HOST_AUTHORITY_VERIFY=1 FM_NODE_CHECKPOINT_ACCEPTANCE=1 FM_OKR_ACCEPTANCE=1 \
  node --import tsx scripts/identity-localnet.ts /tmp/protocol-bytecode.json /tmp/device-runner-evidence.json
node --import tsx --test tests/*.test.ts
npm run typecheck
npm run build
```
