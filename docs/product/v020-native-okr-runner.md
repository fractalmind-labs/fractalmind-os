# v0.2.0 原生 OKR 执行接线

本文保留 `6015abc` 的准备／恢复专项证据。后续正式控制权限、继续界面与实际 envd 联测见[明确继续增量](v020-okr-continuation.md)；以下专项限制按其原运行范围记录。

## 当前实现

`NativeFileOkrRunner` 新增原生加密接口，正式 App 的 `NativeOkrRunner` 使用 OS 密钥库读取批准约定、加密精确命令票据，并为原 Host 封装单份命令结果密钥。组织密钥不进入 WebView；票据、结果密钥授予和原排队 Run 仍在同一 PTB 原子保存。原有 SDK 密钥提供方式继续供独立工具使用，调用者必须选择一种方式，不能混用。

当前运行器读取已批准的 1–3 个顺序文件 KR，复用原规格、约定、路径、每次工具上限、全局预算和签名交接政策。报价确认、系统交易签名等待期间重新检查当前设备／Host／实例、协议／KR 游标、能力和预算；界面范围关闭后不能释放签名进行广播。Host 投递固定原命令和目标，通过当前 Coordinator 的设备鉴权入口发送，投递前再次检查来源与交接政策。

原交易日志查询发生在私有正文解密、新命令签名和准备之前。已有成功／失败／unknown 摘要且票据未可见时，只报告原结果；日志不可读则保持未知。正式 App 使用类型化动态字段点查找发现票据，不把分页索引延迟当作不存在。恢复后的排队票据默认不发送；新准备也可使用 `prepareOnly` 分开确认准备和投递。投递回应不证明运行中，必须看到匹配的链上 Run。

示意调用（控制能力须已单独发行，界面使用方式见后续明确继续增量）：

```ts
const runner = new NativeOkrRunner(
  chain, signer, grantId, organizationId, nativeInvoke,
  durableJournal, confirmFeeQuote, fetch, assertUiScope,
);
await runner.step({ okrId, capabilityId, createIfMissing: true, prepareOnly: true });
// 用户明确释放原排队命令；保持原票据、签名和 Run。
await runner.step({ okrId, capabilityId, releaseQueued: true });
```

运行器不会替用户验证 KR 或最终接受 OKR。原费用回执只留在当前内存供显示，后续裁剪导致查询 unknown 不能抹掉已获得的成功回执，也不能触发重放。

## 实际验证

- [原生 OS＋localnet 报告](evidence/v020-native-okr-runner-localnet.json)：**19 项检查、16 笔确认交易／费用**。正式原生约定解密／票据加密／结果封装、独立费用确认、票据与 Run 原子准备、空 journal 恢复原票据／Run、零 Host 投递均通过；原排队继续通过 OKR 专用停止入口取消，预算预留由 3 降为 0。测试凭据已清理。
- [专项与回归](evidence/v020-native-okr-runner-unit.json)：SDK **127/127**、App **132/132**、类型／构建及脚本严格类型通过。新增原生接口同一 PTB、原始请求优先于私有读取／签名、无费用／准备重放、分离准备与投递及回应不能伪造运行状态的检查。最终 SDK 将原日志查询前移的细化由回归覆盖；localnet 原生正向报告记录于此前，原生加密接线未再变更。
- [前序失败及原请求只读复查](evidence/v020-native-okr-runner-prior.json)：首个隔离夹具的原生准备／恢复通过，清理误用通用停止入口，在模拟阶段以 `assert_unbound_contract`／8321 拒绝，未签名或广播取消。已修正为现有 `okrId` 分支并由新的 r2 夹具完整通过。r1 没有重放；它的原排队 Run／预算 3 仍未结清，原测试凭据已清理。后续夹具成功不能改变这一事实。

复现使用一个新报告路径，脚本拒绝覆盖已有报告或 `.progress.json`：

```sh
cd apps/fractalmind-app
node --import tsx scripts/native-command-results-localnet.ts \
  /tmp/isolated-deployment.json /tmp/new-native-runner-report.json --prepare-okr
```

## 剩余交付

本报告的 Host 为签名夹具，未派发实际 envd；原生传输为隔离子进程，技术日志为内存。执行适配器已实现，控制能力费用／明确继续 UI、安装后 IPC／IndexedDB、真实 Host 投递和持续自主仍待完成。

继续按 v0.2.0 总览完成过期／失败新尝试与未结请求处理、Agent 对话／介入、独立 Human KR 验证和最终验收、清空客户端缓存与重启恢复、真实云 Host、桌面／手机旅程。完整目标保持未完成。
