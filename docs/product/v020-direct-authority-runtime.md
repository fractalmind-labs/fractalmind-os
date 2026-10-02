# v0.2.0 envd 直接权限读取与原消息核验

依据 PRD v0.11、原型 v2、#41/#43/#45。本文记录 `c907433` 的只读来源核验增量；直接消息执行随后由[执行与原生回执增量](v020-direct-message-execution.md)接通。完整目标保持 active。

## 当前实现

- ChainAuthorityResolver 分别配置 core、OKR、direct 的原始类型来源；生产 runtime／连接配置接受 direct_package_id 和 direct_original_package_id。App 接入指导和隔离联测输入同步这些公开字段。
- 当前 direct 能力读取自己的权限版本和边界，不再按 OKR 解码。核对 core 扩展来源、带 Witness 类型的字段、组织目录指针、Human 代次、Host 成员、固定实例及工作区；在常驻和单次审批之间保留独立记账语义。
- 单次审批核对原消息和当前批准设备 Grant／版本／组织范围／角色／有效期；写入审批还核对工作区占用版本。常驻写入遇到本实例或同 Host 同目录的其他 OKR 占用时需要审批；RPC 错误不会转换为可写。
- ParseDirectRequest 拒绝错误 direct 范围、未固定实例、额外 payload 字段、旧版／错配审批和预算。Go 内容哈希与 SDK 的 BCS 域、UTF-8、路径边界和工具次数一致。ask／status 不接受工具预算或任务。
- LookupExecution 验证原始 direct 命令字段、core 合同、原消息／Run 两个目录、不可变消息及加密记录作者、两个单项预算及累计账本。旧版或撤销后的当前权限不会改写原 Run 的身份和结算；当前 Resolve 仍拒绝用旧权限执行。
- ValidateDirectCommand 比较完整命令、原 Run、消息正文承诺和当前授权快照；它是**签名已验证后的只读检查方法**，自身不代替 Ed25519 验证器，不开始执行或写入链上状态。

## 证据

[安全专项与回归](evidence/v020-direct-authority-unit.json)：7 组新增测试、45 个子测试通过；nodecommand、boundedrun、runtimeadapter、sui、cmd/envd 五个包 race 通过。App 生产构建与原生联测脚本严格类型通过。测试覆盖权限／类型来源／目录／审批设备／工作区变化、读取期间变化、消息正文替换、原 Run 预算替换和加密记录作者。每个历史消息拒绝案例先证明正确来源可通过，避免无关夹具错误被算作安全拒绝。

[真实链只读核验](evidence/v020-direct-authority-original-localnet-read.json)：生产 Go gRPC 读取器读取上一轮真实 OS／SDK 联测的两个原 Run，一个普通消息、一个单次审批消息。两者均保留原权限版本 1、原消息与加密记录，状态 CANCELLED（5）、结算已完成、已用／预留均为 0；换成 core 类型来源均被拒绝。此次 **0 次广播**，不重新准备、开始、取消或结算。它只证明跨语言来源和历史账本读取，不证明直接消息执行。

## 历史阶段边界与后续验收

此只读增量尚未接入命令验证器的 direct 校验 hook、每次工具前检查、direct begin／finish 交易路由及适配器执行，不因存在读取方法而授予工具执行。这些路径随后接通生产原生文件适配器，并通过实际链联测；正式 App 对话／审批 UI 和通用对话适配器仍未完成。

后续执行证据复用原 Run 的 Host 开始所有权、固定实例物理占用、停止检查、结果密钥封装及不可变加密结果。普通执行、精确单次批准、零工具查询及重复投递的真实联测和专项回归见执行文档；安装后持续自主、技能投影、云 Host、清缓存恢复和手机核心流程仍须按 #40 验收。本只读证据不独立关闭 #43 或完整目标。
