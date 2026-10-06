# v0.2.0 App 明确继续与实际 Host 联测

依据 PRD v0.11、原型 v2 和 #34/#37/#38；完整 v0.2.0 仍未完成。

## 当前交互

工作台与 OKR 详情的「执行与继续」读取当前设备授权、原请求、规格和已批准的文件计划。它展示精确目标、成功标准、当前 KR、文件内容、路径、禁止动作、工具上限及约定有效期。审批完成后，原交接窗口可进入对应工作台。

1. 确认当前设备／约定／KR 的单次控制权限费用。
2. 独立确认当前 KR 的原命令票据与 Run 准备费用；此时仍排队，未投递。
3. 明确选择「发送原命令到 Host」，固定原票据、签名、目标和 Run。
4. 查询原交易／Run；Host 测量达标后仍等待人独立验证，最终验收另行完成。

`OkrControl` 复用现有合约。报价与原生签名期间复核当前 Human／Grant、活跃 Host 指针、受管理实例、完整执行目录、规格／约定／KR 游标、政策和预算；报价副本不能提交。同一个报价的并发提交合并为一笔。已有原摘要先查询，不因 unknown 再发行能力。

能力 ID 只是定位信息：使用前校验共享对象类型、当前设备／Host／实例、单次 assign 权限、未使用／未委托预算、当前约定及完整类型化授权绑定。界面技术缓存保存这些公开定位信息和是否尝试投递；清缓存不会凭空产生「尚未发送」判断。已有排队票据的投递历史不明时，只提供查询。

私有计划／报价只在内存。关闭、页面隐藏或卸载使原生操作范围失效；读取／授权失败清除先前私有计划及可操作状态。网页显示原生 App 提示，不调用模拟签名器。完整清缓存恢复与安装后 IPC／IndexedDB 正向验收仍待完成。

## 实际证据

- [原生 OS＋localnet＋生产 envd](evidence/v020-native-app-execution-localnet.json)：**9 项检查、12 笔原生 App 确认交易／实际费用**。真实原生身份／组织、正式 Host 接入控制器、生产 CLI 的原加入摘要恢复、签名实例发现／原生导入、正式 Host 审阅／审批／控制权限及 runner 通过。实际 Agent 写入并验证 `docs/APPROVED.md`，原加密结果由 OS 密钥库解密。继续投递 **1 次**，另有 **1 次设备鉴权**；测量 **1**，工具预算 **3／0**，ACTIVE、未人验证。Host 实际撤销后，Coordinator 路由与 worker 心跳被拒，授权设备仍能读取历史结果。harness 正常退出，隔离 OS 凭据已删除。
- [专项与回归](evidence/v020-okr-continuation-unit.json)：SDK **128/128**、App **137/137**，SDK／App 构建和脚本严格类型通过。新增测试覆盖旧未知摘要优先、报价副本／并发、签名期间状态变化／窗口关闭、缓存能力错版／错目标／错授权／已使用，以及已测量／未结执行禁止重复发行。批准计划的只读展示不签名、预留、提交或投递，并拒绝读取期间的约定变化。
- [浏览器检查](evidence/v020-okr-continuation-browser.json)：真实 Sui 数据下的工作台和 OKR 详情入口、中英文／明暗弹窗、关闭／重开和网页原生保护。未注入原生 mock；不作为安装后正向 UI 证据。

实际 Human 密钥在 OS 密钥库中，原生调用通过隔离子进程；Host 使用测试内存密钥提供者，Coordinator 在 loopback。内存 journal 的恢复保留公开连接／身份与 OKR ID，不能作为全量客户端清缓存或物理云主机验收。12 笔费用仅统计原生 App 交易，Host 的加入／执行／测量费用另有其原摘要，不混入该数字。

### 前序失败与原请求

[只读复查](evidence/v020-native-app-execution-prior.json)保留三份原状态，后续新夹具没有重放它们：

- r1 原审阅 Run 明确失败，OKR 仍草稿。该轮未保留具体 Host 错误；测试工作区没有计划要求的现有 `docs` 根。生产审阅要求范围目录已经存在，修正仅为在隔离 Go 工作区创建该目录，未放宽执行边界。
- r2 在确认票据后，完整目录读取遇到 size=1／分页=0，harness 停止，原观察 Run 仍排队且工具预算为 0。改为有界只读等待同一票据／完整目录，不重新准备或投递。未激活草稿的全局预算索引不可用，复查明确记为未知。
- r3 实际审阅／审批／文件执行／原生结果读取通过；尾部断言误把鉴权请求计为命令投递，harness 未运行撤销尾部。原继续 Run 成功，测量 1、预算 3／0。修正测试计数后，r4 完整退出。

## 复现

先启动隔离 localnet 并准备当前协议部署 JSON（链标识、packageId、registryId），使用新输出路径。脚本拒绝覆盖已有报告或进度文件。

```sh
cd runtime/fractalmind-envd
go test -c -o /tmp/fm-envd-native-app-execution-tests ./cmd/envd
cd ../../apps/fractalmind-app
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-native-app-execution-tests \
  node --import tsx scripts/native-app-execution-localnet.ts \
  /tmp/isolated-deployment.json /tmp/new-native-app-execution-report.json
```

还需先构建 `native` 的 `device-test-helper`；该测试只用隔离身份与本地 faucet，结束时删除测试凭据。

## 剩余交付

持续多 KR 的正式 App 旅程、独立 Human KR 验证与最终验收；Agent 对话、暂停／调整／审批后恢复；过期审阅与旧未结请求处理；安装后原生 IPC／持久 journal、完整清缓存／重启恢复；真实云 Host、桌面与手机完整核心旅程。按总览继续验收，不关闭 #34 或完整目标。
