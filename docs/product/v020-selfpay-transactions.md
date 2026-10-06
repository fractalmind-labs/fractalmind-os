# v0.2.0 自付交易与待确认摘要

`SelfPayTransactionManager` 为 #37 提供真实 Sui 费用预检、设备自付签名、单次广播和原摘要查询。`IndexedDbTransactionJournal` 为浏览器／WebView 保存技术交易日志；业务正文、授权、OKR 和 Run 的持久事实仍在 Sui。该增量不代表完整 App 或 #37 已验收。

## 费用与充值

`prepare({ requestId, transaction, gasBudget, maxSuiSpend })` 检查实际网络、付款地址、余额、Gas 价格和当前对象引用，执行启用校验的真实模拟。它不签名、不广播。`gasBudget` 是签名交易的 Gas 上限，`estimatedGas` 是本次模拟的净 Gas 估计；两者不能用同一数值表达。净费用为计算费 + 存储费 − 存储返还，非退还存储费已经包含在存储费中，不重复相加；净值可能为负。

余额不足返回 `needs_funds`，网络不可用返回 `rpc_unavailable`，不能把读取失败显示为零余额。需要可支付余额至少覆盖 Gas 上限及声明的 SUI 支出。充值后仍需重新估算并明确提交。Gas 对象变化、报价过期、网络变化、签名取消或交易日志无法保存时不广播，也不自动重建并再次签名。

`maxSuiSpend` 默认为 0，是模拟时允许的额外 SUI 支出，**不能代替任意 Move 调用中的链上转账限额**。动态状态可能在模拟与执行之间改变；带价值转移的业务必须在合约／交易参数中限制金额。当前 OKR 准备路径只写授权、正文及 Run，不转移业务 SUI。设备付款者必须是签名者；赞助交易后移至 v0.3.0。

## 日志、广播与恢复

1. 报价只存于内存，不把交易正文或签名写入日志。
2. `submit(quote)` 重新检查网络、余额和 Gas 引用，取得并核验该付款地址对原交易字节的签名。
3. 广播前原子写入 `{网络、真实链标识、付款地址、requestId、digest、Gas 引用、费用、修订、状态}`。同一请求或同一 Gas 的在途竞争不能各自广播。
4. 广播一次；回执丢失只查询原 digest。未找到、查询失败或无法核验原回执都保持 `unknown`，不推断交易没有执行。
5. 确认回执核验原摘要、发送者、Gas 付款者与签名预算。链上失败可能已扣 Gas，返回 `failed` 和实际费用。缓存写失败不把已知链上结果改为未知，但报告 `journalSynced: false`。

日志按实际链和付款地址隔离，不保存私钥、恢复码、签名、交易字节或产品正文。IndexedDB 的读写事务序列化多个窗口的请求及 Gas 预留，并用修订 CAS 更新。它是设备本地技术缓存，不是权限或执行结果的事实来源；`query(requestId)` 即使见到本地终态，也重新读取 Sui。节点已裁剪历史或不可达时仍显示无法确认，不能仅凭 Gas 对象版本变化宣布成功。完整 App 的历史服务可用性、费用历史恢复和缓存清除界面仍需接入。

`MemoryTransactionJournal` 仅用于测试或进程内示例；生产 App 必须使用持久提供器。浏览器日志的持久性由下述实际刷新测试单独证明，独立链脚本则使用内存日志避免操作用户的存储。

## 接入 OKR 执行

```ts
const manager = new SelfPayTransactionManager({
  client: sdk.client.client, network: sdk.client.network,
  signer: deviceSigner, journal: new IndexedDbTransactionJournal(),
});
const submit = createSelfPayOkrSubmitter({
  manager, gasBudget: approvedGasCeiling,
  approveQuote: showFeeConfirmation,
});
const runner = new NativeFileOkrRunner({
  sdk, organizationId, humanId, grantId, signer: deviceSigner,
  keyForVersion: authorizedOrganizationKey,
  submit, deliver: fixedHostTransport.deliver,
});
```

执行循环将链上唯一票据逻辑 ID 作为稳定的 `requestId`。适配器先查询日志，已有请求只读取原交易，包括刷新／新建执行循环后；它不重新估算、签名或广播。首次请求在真实报价后调用必填 `approveQuote`，由 App 展示费用，或匹配用户明确启用且有上限的自动费用策略。仅给钱包充值不构成授权。

已记录的失败也不会被自动替换；纠正后新尝试需要显式授权和新的交易请求 ID，仍须遵循票据 CAS 与当前约定。当前适配器选择保留原请求，尚未实现 App 的重试决策界面。明确取消费用确认、签名取消与余额不足保留可辨认原因；日志读取失败不能排除过去已发送，保持待确认。

## 真实自测与边界

- [真实自付交易](evidence/v020-selfpay-manager-localnet.json)：独立本地 Sui 网络上 7 次广播（6 成功、1 预期失败）。恢复码派生的地址先零余额拒绝，再自付创建 Human；设备创建组织；真实执行响应被测试传输丢弃后，新管理器查询原摘要确认，没有第二次广播。独立手机设备在报价后撤销原权限，原交易真实失败并扣费。恢复地址自付消费恢复记录，不需旧钱包或赞助，Human 与组织关系保持稳定。
- [实际浏览器日志](evidence/v020-browser-transaction-journal.json)：独立测试数据库，两个连接竞争仅一次预留；冲突 Gas、旧修订被拒，终态释放预留，读副本不能改写存储。完整导航刷新后恢复原在途摘要与锁，并拒绝重复请求。截图为测试页面，不是产品 App 验收。
- SDK 单元测试覆盖费用返还、取消签名、RPC 失败、陈旧 Gas、广播响应丢失、网络切换、日志失败、错误回执、不可用历史，以及 OKR 费用确认和刷新查询。节点历史裁剪、五平台原生存储、完整 App、真实云 Host 和总体自主循环仍需验收。地址余额 Gas 路径尚无真实链证据，不宣称已完成。

复现（独立 localnet，SDK 目录）：

```sh
# 上次 identity-localnet 生成的原始部署报告需含 registryId 和 identityRegistryId。
node --import tsx scripts/transaction-manager-localnet.ts /tmp/deployment-report.json /tmp/selfpay-report.json
node --import tsx --test tests/*.test.ts
npm run typecheck
npm run build

# 浏览器夹具：两个文件放在隔离的测试目录，然后通过本地 HTTP 打开。
node_modules/.bin/esbuild src/browser-transaction-journal.ts --bundle --format=esm --platform=browser --outfile=/tmp/fm-journal-test/journal.js
cp scripts/journal-browser-selftest.html /tmp/fm-journal-test/index.html
python3 -m http.server 4188 --bind 127.0.0.1 --directory /tmp/fm-journal-test
```

打开 `http://127.0.0.1:4188/?db=fractalmind-test-唯一值` 点击运行测试；再导航同一数据库的 `&phase=restore` 点击运行测试。必须使用全新的隔离数据库，不能操作用户产品数据库。
