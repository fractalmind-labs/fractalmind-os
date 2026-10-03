# v0.2.0：运行中等待模型时的原 Run 停止确认

依据 [#33](https://github.com/fractalmind-labs/fractalmind-os/issues/33)、#34/#45、PRD v0.11 与原型 v2；基线 `4ddd295`。本增量补齐待模型请求期间的停止响应，完整 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40) 仍未完成。

## 实现

生产 Host 在等待模型规划或直接问答时，每秒只读查询同一原 Run，核对 attempt、命令指纹、实例、签名者、权限与期限。精确停止请求取消当前提供方连接；原检查点丢失、换实例或 RPC 不可用保持不同的失败原因，不能据此声称停止已确认。每次工具调用继续使用原授权检查，没有新增执行器或调度器。

App 的停止请求与执行端确认分别读取。只有原 Host 完成 Run 结算并发布原不可变加密结果，才构成取消确认。停止保留已经发生的文件副作用和实际工具支出，只释放未用预留；取消的 Run 不发布达成测量。重新执行须新审阅、独立 Human 审批和新 Run，不能自动重放未知原请求。

## 真实协议验证

[实际 OS 密钥库＋Sui localnet＋生产 envd](evidence/v020-running-stop-localnet.json)通过 **14 项检查、25 笔 App 确认交易**。提供方为合成 Messages HTTP 接口，实际文件操作、原生设备签名与 Host 结算使用生产代码。

- 第一 KR 完成三次工具调用并独立 Human 验证。
- 第二 KR 实际读取、写入后，提供方保持第三个请求不回复。原 Run 已 RUNNING，App 正式控制器暂停 OKR，再请求停止同一 Run。
- 停止请求确认后的读取仍显示 RUNNING／stop requested／无结果；随后 Host **810 毫秒**内确认 CANCELLED，原生控制器解密原取消结果，精确支出 **2 次**。连接由生产 Host 取消，没有测试端补回复，也没有重放原 Run。
- 全局工具账本 **5 已用／0 预留**，第二 KR 无达成测量。新 Host 审阅和独立审批不清空旧支出、不隐式派发。
- 新 Run 只读取已经写好的文件，未重复写入；两 KR 独立验证和最终 Human 验收后 ACHIEVED／游标 2，工具账本 **6 已用／0 预留**。
- 实际 Host 撤销、原历史结果读取和隔离测试凭据清理通过。完整原摘要、对象和实际费用保留于报告。

## 回归与范围

[回归记录](evidence/v020-running-stop-unit.json)：Go 六包 race、原生联测脚本严格类型与 Host 测试二进制编译通过。覆盖精确停止、另一 attempt 的停止不能冒充原停止、检查点缺失／不可用、正常清理不取消父上下文、等待中的规划与问答取消且没有额外工具或提供方请求。

前序 HTTP 测试未消费请求体，取消观测与服务器清理阻塞；保留原失败栈，修复测试服务器后通过。另一轮因沙箱禁止监听未执行完整测试，使用所需权限的 R4 六包全部通过；两轮失败记录与哈希独立保留。App／SDK／Move／Rust 在本增量未修改，未重复声称重新运行这些套件。

这是等待模型期间的停止确认，不能据此声称任意外部工具都可中断或撤销。模型为合成接口，Host 密钥和技术 journal 为隔离内存，Human 决定由脚本给出；原生传输为测试子进程。安装后 UI／IndexedDB、真实语言模型、云 TLS Host、手机审批、完整身份和缓存恢复及 main 旧包升级仍待验收。原 5 分钟命令期限保持，长期无人值守和通用项目规划仍需实现。整体 Issue 不因此关闭。

## 重现

使用隔离 localnet 的三包部署报告和实际 OS 测试密钥库，将当前生产 envd 编译为原有 native-app 联测测试二进制，再运行：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-running-stop-app-tests \
  node --import tsx scripts/native-app-execution-localnet.ts \
  /tmp/fm-scheduled-queue-three-package-deployment-r1.json \
  /tmp/fm-native-running-stop-protocol-r1.json \
  --human-sequence --model-fixture --running-stop
```

工作目录为 `apps/fractalmind-app`。新的独立测试使用新的报告路径／隔离身份，已提交或未知的原请求只能查询，不能用重新运行替代原状态确认。
