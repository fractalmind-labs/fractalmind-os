# v0.2.0：对话转为保留来源的 OKR 草稿

依据 [#45](https://github.com/fractalmind-labs/fractalmind-os/issues/45)、PRD v0.11 J12／FR-41 与原型 v2；基线 `cc78331`。本增量接通对话转 OKR 草稿，完整 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40) 仍未完成。

## 用户流程

1. 在固定实例的正式沟通窗口读取原消息，有批准权限的设备可点击「转为 OKR 草稿」。转换先读取、解密并核对原消息与原 Host 回执，不生成费用报价或派发。
2. 草稿窗口显示原请求、可用的原模型建议、具体实例／版本、时间和原边界。模型建议明确保持待审阅；用户填写目标、成功标准、1–3 条可测量 KR、路径、禁止动作、预算和期限。
3. 来源目录仅作为候选参考，零工具消息不会自动产生新的工具额度。独立核对候选、原生加密、费用确认和设备签名后，在 Sui 保存 DRAFT。保存不纳管实例、不激活约定、不预留执行预算，也不创建 Run。
4. 关闭、隐藏或源设备授权到期释放当前窗口的私有上下文和报价。技术尝试缓存仅保存公开操作定位；未知摘要先查询，不改成新的尝试。再次转换同一原消息可以查询其原创建请求。
5. OKR「技能上下文与提案」读取后可显示来源对话。规格编辑和技能导出／导入保留同一来源；正式规格替换拒绝删除、追加或换成其他消息来源。后续接管、审阅、审批、明确继续及人工验收仍分别完成。

## 持久来源与核验

现有加密 `fractalmind.okr-spec.v1` 增加可选 `source`。`fractalmind.okr-message-source.v1` 保存网络／实际链标识、组织、受管理实例及版本、成员资格、原消息和密文记录、权限版本、作者、时间、请求哈希与完整原请求。已有成功模型回复时，额外保留原 Run／不可变结果记录、原建议和模型／token 信息，`verified` 始终为 false。

来源在规格密文中上链，没有新增明文业务缓存、业务后端或 Move 对象布局。无来源的既有规格保持可读；当前解析器、编辑器和投影严格保留可选来源。此增量不证明历史客户端升级／迁移已完成。

App 复用直接消息及原执行结果验证器，在加密前后、报价后、原生签名前后重新读取来源；跨组织／实例、修改请求、替换原回复或伪造验证标记会被拒绝。当前授权和窗口范围亦重新检查。历史对话到期或已有执行结果不是新执行授权，来源完整性不替代合约对新 OKR 约定的检查。

## 实际证据

- [原生控制器＋实际 OS 密钥库＋Sui localnet＋生产 envd](evidence/v020-message-okr-localnet.json)：**18 项检查、56 笔 App 确认交易**。正式零工具问答收到原加密 Host 回应，篡改建议在报价前拒绝；独立费用与签名创建含原来源的 DRAFT。删除来源的规格换版拒绝，保留来源的独立换版到 revision 2 通过；空技术 journal 的新控制器和技能投影从 Sui 重建相同来源。新草稿 Run 数为 **0**，新增模型请求／派发／工具支出均为 **0**。
- 同轮两 KR 独立验证和最终 Human 验收、固定实例直接消息、单次超权批准及 Host 撤销通过。工具账本分别为 OKR **6／0**、常驻 **4／0**、单次审批累计 **6／0**。原草稿创建回执已被裁剪，恢复查询保持 **unknown** 并返回同一 digest；不会将当前 DRAFT 或保存的旧成功回执作为重新发送依据。隔离测试凭据清理通过。
- [回归](evidence/v020-message-okr-unit.json)：App **229/229**、生产构建及原生联测脚本严格类型通过。覆盖来源篡改、跨组织／实例、原回复替换、加密／报价／原生签名期间变化、隐藏窗口拒绝签名、规格来源不可删除／替换，以及精确编辑器往返。保留错误采用 NodeNext 检查扩展名缺失的前序命令，改用项目的 Bundler 解析后通过。SDK／Move／Go 未修改或重复重跑。
- [真实网页检查](evidence/v020-message-okr-browser.json)：中文白天／英文黑夜创建入口、关闭清空候选、网页原生签名保护，以及 **390 px** CSS 视口下对话框边界通过。临时尺寸和偏好已恢复；截图后端返回缩放图，此处不作为物理手机或原生转换 UI 验收。
- [当前 macOS debug 验收包](evidence/v020-message-okr-native-bundle.json)已重新构建，生成包本地 ad hoc 签名后严格验证通过；没有 Apple 开发者签名／公证，不是生产发布。再次读取窗口时 Mac 锁定，未操作现有 App 或声称正向 UI 已通过。

## 未完成范围

模型提供方是合成 Messages HTTP 夹具，真实语言模型质量及账单未验收。Human 决定由脚本给出，原生调用为隔离子进程，Host 密钥与技术 journal 为内存；未证明安装后 IPC／IndexedDB 的完整转换旅程。

实际云 TLS Host、手机沟通审批、完整身份／清缓存恢复、main 旧合约升级、长期无人值守和通用项目规划仍需完成。此增量不关闭 #45/#40。对话转独立任务及日配额继续由 v0.3.0 #52 承接。

## 重现

使用原隔离 localnet 三包部署、OS 测试密钥库和当前生产 Host 测试二进制，在 `apps/fractalmind-app` 运行：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-running-stop-app-tests \
  node --import tsx scripts/native-app-execution-localnet.ts \
  /tmp/fm-scheduled-queue-three-package-deployment-r1.json \
  /tmp/fm-native-message-okr-protocol-r1.json \
  --human-sequence --direct-permission --direct-dispatch --direct-app \
  --model-fixture --message-okr
```

新的独立测试必须选择新的报告路径与隔离身份；原未知请求只能查询，不能通过重跑替代原状态核实。
