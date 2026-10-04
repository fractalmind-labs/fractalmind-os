# Direct 云端链读取优化：实现与回归

日期：2026-10-03。公开结构化记录见[性能证据](evidence/v020-direct-cloud-read-performance.json)。

## 问题与本次范围

实际单次审批测试出现过 Run 启动后在执行文件工具前因授权到期而失败，工具支出为 0，目标文件未写入。该原 Run 已失败结算，不能重放。本次优化 envd 的链依赖读取方式；下文保留 r13 的真实部分执行失败。用户之后已明确授权，前两次独立尝试失败／取消；第三次已获原 Run 与实际文件的成功证据，安装 UI 原结果解密及新增缓存恢复也已通过，见[阶段证据](evidence/v020-authorized-ui-progress.json)。

`direct.message` 的授权与原 Run 解析包含多次独立来源读取。原实现已经批量执行末尾版本复核，但多数 dynamic field 与 immutable 来源仍逐项读取。对同一解析中的已知依赖进行批量读取，可以减少远程读取轮次。

## 实现

- 每个 `chainRead` 仅在本次解析内保存成功读取的对象；后续相同依赖复用最初读取值，不覆盖它，也不缓存缺失或错误。缓存不会跨 `Resolve`、`LookupExecution`、请求或工具调用。
- 按依赖关系分批读取 direct permission 绑定、原 Run 的预算与命令绑定、消息／Run 索引，以及 immutable 消息与密文记录来源。
- `object()`、`field()`、`immutable()` 继续逐项核验类型及原始包来源、owner、UID、BCS 内容和业务绑定。预读本身不授予权限。
- 每次解析结束仍重新读取全部实际使用的依赖，比较原始版本并形成完整 pin；预读缓存不能替代这次最新读取。
- 可缺失的 workspace 字段保留原有 `not found` 处理，不混入必需批次。批次缺项、乱序、重复、RPC 错误或类型错误均拒绝，不回退到旧值。

未删除任何授权阶段、每工具检查、原 Run／停止／预算检查或链 Clock 检查；envd 没有修改 TTL、签名、交易格式、执行所有权或重放规则。App 新消息默认期限的独立调整见[窗口与恢复说明](v020-review-window-and-approval-queue.md)。

相关实现与测试：

- [读取缓存与预读](../../runtime/fractalmind-envd/internal/nodecommand/chain_snapshot.go)
- [typed field 读取](../../runtime/fractalmind-envd/internal/nodecommand/chain_authority.go)
- [direct 来源与权限](../../runtime/fractalmind-envd/internal/nodecommand/direct_authority.go)
- [原 Run 查询](../../runtime/fractalmind-envd/internal/nodecommand/chain_execution.go)
- [批量读取回归](../../runtime/fractalmind-envd/internal/nodecommand/direct_batch_test.go)

## 与旧 HEAD 的实际代码对照

旧基线为 `44705baa15d2856970012f564db40f644a2cabe9`。使用临时 Go overlay 替换上述四个源文件为该提交的原内容；工作树没有回退。同一 fixture 分别执行旧、新生产解析方法，并计数 `ReadChainObject` 与 `ReadChainObjects` 调用，包括最终版本复核。旧版也启用它原有的 batch 能力。

| 路径 | 旧版读取轮次 | 新版读取轮次 | 新版构成 |
| --- | ---: | ---: | --- |
| 常驻权限 Resolve | 15 | 12 | 8 次单读 + 4 次批量 |
| 单次审批 Resolve | 18 | 13 | 9 次单读 + 4 次批量 |
| 原 Run LookupExecution | 20 | 10 | 5 次单读 + 5 次批量 |
| 已知 Run RecheckExecution | 17 | 7 | 1 次单读 + 6 次批量 |

这些是 **fixture 下生产读取接口的调用次数**，用来衡量网络往返数量；不代表实测云端耗时、整体请求加速比例或真实网络包数量。原 Run 与已知 Run fixture 验证消息／记录／预算来源；单次审批 fixture 另外覆盖实际 approver 权限读取。

新版还与不提供 batch 接口的串行 reader 比较：返回的完整 typed authority／Run 和私有依赖版本信息均一致。每个成功读取的实际依赖仍被读取两次：一次供 typed 解码，一次供最终最新版本核对。

## 测试与日志

在 `runtime/fractalmind-envd` 目录使用 Go `1.26.0 darwin/arm64` 执行：

```sh
GOCACHE=/tmp/fm-envd-direct-batch-go-cache go test -race \
  ./internal/nodecommand ./internal/boundedrun \
  ./internal/runtimeadapter ./internal/sui
```

四包均通过。归档时重新运行同一命令得到的日志如下；`cached` 表示复用此前成功的同内容 Go 测试结果：

```text
ok  github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/nodecommand     (cached)
ok  github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/boundedrun      (cached)
ok  github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/runtimeadapter  (cached)
ok  github.com/fractalmind-labs/fractalmind-os/runtime/fractalmind-envd/internal/sui             (cached)
```

首次沙箱运行中，nodecommand 与 boundedrun 已通过；runtimeadapter 的自身进程发现、sui 的临时本机监听端口被沙箱限制。同一命令在获得测试所需权限后四包通过。这些前置条件失败没有被记为产品回归通过，也没有改变真实 Host 或链环境。

新增回归覆盖：

- serial／batch typed 输出与完整依赖 pin 等价，以及明确的读取轮次上限。
- 批次缺失、乱序、重复 ID、错误 owner／type／UID、非 canonical BCS、可变消息伪装和 RPC 失败均拒绝。
- permission、approval、approver grant、角色、workspace、Run、预算 claim、消息及记录在最终二读时发生版本变化均拒绝。
- 混合包版本下按 datatype origin 推导 dynamic field；同一次解析的第二轮预读不会覆盖最初版本、掩盖变化。
- 本次解析缓存不会跨调用保留；缺失的可选 workspace 与 RPC 失败保持不同语义。

`git diff --check` 通过。完整四包 race 包含现有停止、直接文件操作、交接与执行来源回归；它们不替代安装 UI 或实际云端验收。

## Linux 产物与后续验证

本轮已构建并部署 `envd-r13`。公开部署记录核对结果：

- 平台：Linux amd64。
- 文件大小：25,930,921 bytes。
- SHA-256：`5e09cc91695d76b880dc072b57ceb6dc93a63eaefc92762b37138756c5356d47`。
- 版本：`v020-direct-batch-r13`，部署记录中的源码提交：`d6c293e`。
- worker 于 22:28:58 UTC 替换；原进程正常退出，新进程于 22:29:05 UTC 重新认证 Coordinator。
- native profile、配置及 Host 地址保持一致，原、新 binary 哈希已核对，其他既有 envd 仍运行。

构建摘要、进程替换与重新认证见结构化报告中的公开部署记录。App 导入修复已通过 23 项专项回归；实际 r7 APK 已成功独立导入新物理实例，并保留旧实例的未知交易。新实例已完成控制确认，并在 r8 中明确暂停对应 OKR。下节记录独立新请求的实际部分执行与失败；用户明确授权后的第三次独立请求已有链与文件成功证据；此前失败请求保持原状。进程部署和重新接入本身不证明执行耗时改善。

### r13 首次独立写入：保留部分执行失败

r8 安装版以新物理实例完成单次批准和一次投递。Host 于 23:02:02 UTC 收到命令，原 Run 于 23:02:36.750 开始；原消息期限为 23:04:45.149。第三次工具调用前在期限后 1 毫秒拒绝，Run 失败结算，实际支出 2、预留 0。SSH 已确认 `ONE-OFF-UI.md` 写入 55 字节、正文精确，SHA-256 为 `6d7b5941db8bf3340cca6ec235ac7c72bc55ae207689c4e9887d5ad78dd18f1e`，原 OKR 文件未改变；由于缺少第三次复读证据，此次不算完整执行通过。

当前产品明确显示消息、审批、授权与执行共用原 5 分钟期限，费用预览时间也计入。此次消息准备至首次投递约 120 秒，包含实际界面步骤与测试工具之间的等待；后续独立新目标用连续 DOM 操作减少工具往返，保留全部审阅、费用确认和逐工具校验。原请求和原文件不重放。调用轮次减少不代表在任意人工等待下都能完成。

## 已获授权后的后续结果

用户明确“授权你审批写入”后，实际安装 UI 为独立目标 `docs/ONE-OFF-UI-VERIFIED.md` 创建并批准两笔不同消息，原 5 分钟期限未延长。第一笔 Run `0x25dee1…b79a5` 返回 `operation_unconfirmed`，FAILED／支出 2／预留 0；独立 SSH 确认该目标不存在。支出 2 不证明写入成功，早前存在的 `ONE-OFF-UI.md` 是另一文件。

第二笔 Run `0x8403b4…a3730` 的首次投递显示 `command_outcome_unknown`，云 Host 日志未观察到该命令，没有再次投递。它随后通过实际 UI 的独立停止交易取消，fresh 链读为 CANCELLED 5／支出 0／预留 0／已结算；原投递仍为未知，不能用取消结果反推传输已确定失败。单次累计支出 4／预留 0，常驻 status-only 仍为 0／0。

前两笔结果没有证明完整执行耗时已达标，当时仍需成功执行与独立文件核验；下一节记录第三笔的新证据。精确 ID、交易和后续状态见[阶段证据](evidence/v020-authorized-ui-progress.json)；原读取轮次回归和历史缓存证明保持各自的范围。

### 第三笔独立意图：原 Run 与实际文件已成功

Android r11 连贯实际 UI 完成 5 次分别确认费用与签名，只首次投递一次。初始 HTTP 仍显示 unknown，之后只查询同一原 Run `0x897aec205819d80a46ae00cd4b9e8ca04e163261d4db07f8be00bb96a5a864ff`。01:23:39 UTC 独立链读为 SUCCEEDED 2、支出 3／预留 0／已结算；单次累计 7／0、status-only 常驻 0／0。原期限未延长，原网络观察缺口没有被改写为传输确认。

独立 SSH 证实 `ONE-OFF-UI-VERIFIED.md` 精确 68 字节，SHA-256 `4a9a40358fa6c07b2bee30f6835887391ca11e220541478f9228ae93ba88d313`，两份旧文件哈希不变。该次请求证明在本次人工/UI 时序下完整工具执行成功；不推导通用延迟保证。实际 App 已解密原结果，并通过清缓存／冷启动／公开表单重连恢复完全相同的结果。独立双读证明 47 密文／9 Run／96 对象与原预算不变，62 技术日志逐行保留，云命令 8→8、三份文件哈希与修改时间不变；新增链写入／派发为 0／0。该次没有重启 Coordinator；HTTP 清除由操作代理和已记录 runner 分支证明，未另存 CDP 返回值。见[恢复证据](evidence/v020-authorized-result-cache-reconstruction.json)。见[第三笔公开证据](evidence/v020-authorized-oneoff-write.json)。
