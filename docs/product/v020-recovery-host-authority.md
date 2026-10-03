# v0.2.0：身份恢复后的 Host 独立撤权

依据 [#24](https://github.com/fractalmind-labs/fractalmind-os/issues/24)、[#30](https://github.com/fractalmind-labs/fractalmind-os/issues/30) 及总验收 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40)；基线 `f084031`。本增量修正生产 Host 的错误分类顺序，并补齐绕过 Coordinator 的实际执行器撤权证据。

## 生产修复

链上结果执行器原先先检查结果密钥／Host Gas，再校验当前设备授权。身份恢复会轮换内容密钥；恢复前准备的命令可能先得到「结果密钥不可用」，掩盖已经撤销的设备资格。

`Validator.CheckCurrentAuthority` 在结果预检前只读核对命令期限、原签名和当前链上授权，保留明确的 `revoked` 原因。它不预留预算、不消耗次数，也不授予执行资格。原 `Validate`／精确 claim 检查仍在执行前进行，工具 hook 保持；授权有效但结果密钥缺失仍停止于预留前。只读检查不根据剩余次数阻止精确旧请求进入后续重复检查。

## 实际验收

每轮恢复前，正式 App 控制器另行报价／签名签发零工具 `status` 观察权限，原生签名并包装结果密钥，保存一条独立 QUEUED Run。实际 Host 只读确认当前权限、签名、精确 Run、原发现实例和未过期命令；不执行该命令。

恢复确认后，通过仅存在于显式 Go 测试二进制的 stdin 阶段，将**同一原命令**直接交给生产 `chainRuntimeExecutor.Execute`。没有增加产品接口。两轮均返回 **revoked / device permission or identity generation changed**；拒绝时原命令还剩约 **298 秒**有效期。原 Run／Capability／零工具预算和未结算 claim 都保持不变。

恢复后的新设备随后另行确认费用、签名取消同一原排队 Run；状态变为 CANCELLED、claim 已结算、工具 **0 已用／0 预留**。不会自动改签或执行旧命令。

## 证据

- [R2 实际 OS＋localnet＋生产 envd／Coordinator](evidence/v020-recovery-host-authority-localnet.json)：**26 项检查、65 笔 App 确认交易**，实际 Host 测试二进制开启 race，退出 0，Host 最终撤销及测试凭据清理确认。
- 两次恢复各广播一次，Coordinator 原签名读取及旧设备新挑战拒绝仍通过；原 **38 份正文哈希、9 条消息**、两个已验证 KR／最终验收及来源草稿恢复保持。恢复新增 Coordinator 派发、模型请求 **0**，原 OKR 工具账本 **6／0**，直接消息常驻 **4／0**、单次累计 **6／0**。
- [回归与构建](evidence/v020-recovery-host-authority-validation.json)：Go 四包 race、严格脚本类型、当前 race Host 测试二进制及普通生产 envd 构建通过。覆盖撤权优先于缺失密钥、无提前预留、耗尽次数的只读检查及已有执行／重复路径。生产 App／SDK／Move／Rust 未修改，不计作 App 或合约全量重跑。
- [R1 原失败与只读复查](evidence/v020-recovery-host-authority-prior.json)：首轮实际 Host 拒绝、恢复／38 份正文恢复及新设备原 Run 取消通过；第二轮测试桥使用了错误的结果包装参数名，在 Run 准备前失败。保留原 **61 笔确认交易**及来源快照／哈希，凭据清理确认；原 Human 仍 generation 2、原探测 Run CANCELLED／零支出，Host 最终撤销未完成。只读复查 **0 广播**。修复测试桥后，R2 使用新的独立身份和报告，不重放 R1 或归属其未完成验收。

## 复现

在 `runtime/fractalmind-envd` 中构建当前测试二进制：

```sh
go test -race -c ./cmd/envd -o /tmp/fm-envd-recovery-host-authority-race-app-tests
```

保持隔离 localnet／三包部署，在 `apps/fractalmind-app` 中使用新的报告路径：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-recovery-host-authority-race-app-tests \
node --import tsx scripts/native-app-execution-localnet.ts \
  /tmp/fm-scheduled-queue-three-package-deployment-r1.json \
  /tmp/fm-native-recovery-host-authority-new.json \
  --human-sequence --direct-permission --direct-dispatch --direct-app \
  --model-fixture --message-okr --workload-recovery --recovery-authority
```

新选项要求完整工作历史恢复选项。默认 Go 测试跳过显式 localnet 夹具；上述实际联测另行使用 race 二进制。已有报告／进度路径拒绝启动，未知原请求只能查询。

## 剩余验收

此证据覆盖两次恢复后原有效、未执行的 `status` 命令及新设备显式取消；不将它扩大为所有运行中工具的中断／回滚验证。模型仍为合成接口，Human 决定由脚本给出，Host 凭据为隔离内存，OS Human 钥使用测试服务。

安装后完整 UI／IndexedDB 清空、实际进程／物理 Host 重启、真实模型、云 TLS Host、手机沟通审批及 main 旧包升级仍未完成。完整 v0.2.0／#40 保持进行中。
