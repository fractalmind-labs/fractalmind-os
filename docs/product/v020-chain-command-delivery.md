# v0.2.0：通过 Sui 投递原 Run 给 Host

依据 #34/#33/#37、PRD v0.11 与原型 v2；基线 `811be27`。
本增量接通原生 App、SDK、Move 与生产 envd 的链上命令投递。完整 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40) 仍未完成。

## 实际能力

工作台「执行与继续」在原命令准备完成后增加「允许 Host 从链上接收这条命令」。用户另行确认投递存储费用，由原授权设备签名，将原签名命令的密文发布到该组织的 Host 队列。准备 Run、发布命令、Host 开始执行和 Human 验收是独立状态。

启用链上接收的 Host 自行读取 Sui，不需要 Coordinator 再发送这条命令。它使用原 Run 的权限、工具预算、固定实例和期限；没有新建 Run、增加预算或延长期限。下一 KR 的授权与独立 Human 验证、最终验收仍走原流程，因此这里只实现已授权命令的独立接收，尚未完成无人值守 OKR 循环。

原 Run 上的投递正文不可替换，精确重复发布不会追加第二个队列指针；队列与正文都是链上状态。App 查询到原投递后不会补发 Coordinator 命令。费用、签名或广播结果未知时先查原交易与原 Run，不能把正文暂不可读当作需要重发。

取消投递费用确认发生在签名／广播之前：界面保留原排队 Run，允许用户再次明确确认新报价。该分支不声称其他签名或网络错误也没有广播。

## 密文、权限与执行检查

- 原生 OS 密钥库使用已有组织密钥派生的单命令结果密钥，加密完整原签名命令；Host 只取得绑定于自身加密公钥的该命令密钥，不取得组织主密钥。
- 投递使用 `FME3` 和独立的 `fractalmind.command-delivery.v1` 上下文，绑定组织、能力、成员资格、原命令 intent 与密钥版本，区别于结果正文的加密域。
- 合约检查原 Human／授权设备、原能力／成员／实例／密钥授予、当前组织密钥版本、原 Run 状态与期限；新正文仅允许排队、未停止的原 Run。正文哈希与原始密文固定。
- Host 每轮核验当前链上成员资格，读取精确类型／归属的队列、Run 与密文；解密后严格核对 JSON、原签名、payload 哈希及全部原 Run 来源，再重查原状态。
- 执行沿同一生产 Executor、每次工具权限 hook、原 begin／finish 与预算结算。终态 Run、已停止或过期的 Run 不会成为新执行，结果继续加密保存到原链上记录。

密文上限 64 KiB，原命令正文最多 65,504 bytes。原运行器的命令期限仍为短期授权；本增量不提供持久无限任务、自动续签或另一套调度器。

## Host 配置

在已经完成链上成员接入、实际实例绑定和执行端配置的 Host 的 `sentinel.yaml` 中明确启用：

```yaml
runtime:
  chain_queue: true
```

默认关闭。它依赖已有 `runtime.enabled`、实际适配器／工作区绑定、Sui 部署与 Host 密钥配置，不能单独通过此开关完成接入。读取周期为 5 秒，每页最多 32 条；每轮重新读取当前 Host 成员资格。退出时先取消读取／执行并等待消费者结束，再释放链连接与密钥。

当前消费者串行处理原命令，扫描到队尾后从头读取；终态项不执行。大历史队列、分页中的坏项隔离和故障后的运营体验还需改进，尚无大规模吞吐证明。

投递有一笔独立 SUI 存储交易。R3 localnet 原投递实际费用 **23,837,620 MIST**，仅是该测试链及正文的观测值；Host 的结果交易、模型费用和实际工具预算分别计算。

## 验证证据

- [三包部署](evidence/v020-chain-command-delivery-deployment.json)：标准 validator 限制下新发布 core、OKR、direct-agent；core 模块总原始大小 **84,020 bytes**。这是新部署，不能代替现有 main 包升级验收。
- [R3 实际 OS＋Sui localnet＋生产 envd](evidence/v020-chain-command-delivery-localnet.json)：**13 项检查、18 笔 App 确认交易**。先取消链上投递费用，原 Run 仍排队、无投递正文、无 Coordinator 命令；再次明确确认后，Host 独立读链完成第一条实际文件 KR，第一条命令的 Coordinator 派发数为 **0**。第二 KR 经新的独立授权和原 HTTP 路径执行，整轮派发数为 **1**。两 KR 独立验证及最终验收通过，链上 ACHIEVED／游标 2，工具预算 **6 已用／0 预留**；Host 撤销、原历史解密及 OS 测试凭据清理通过。
- [回归](evidence/v020-chain-command-delivery-unit.json)：App **218/218**、SDK **155/155**、Move 三包 **147/147**、Rust 原生核心 **21/21**、Tauri origin guard **1/1**、Go 四包 race，App／SDK 构建和脚本严格类型均通过。合约单位测试使用明确 test-only 接入夹具；真实加入组织由原生联测单独证明。
- [原记录](evidence/v020-chain-command-delivery-prior.json)：保留 R2 正向原结果、R1 发布前构建失败及原生选项预检失败。R3 使用新的隔离身份，未重放旧请求，也未覆盖旧回执。
- [真实网页](evidence/v020-chain-command-delivery-browser.json)：中文白天／英文黑夜及原生解锁保护通过。私有计划之后的链上投递选择器、安装后费用弹窗和 IndexedDB 未作正向 UI 验收；原生控制器的取消费用分支已由 R3 验证。

## 尚未完成

联测使用原生子进程与实际 OS Human 密钥库、生产 Go Host／实际文件工具；Host 密钥与技术 journal 为隔离内存，Human 决定由测试脚本明确给出。未实际关闭 App 窗口或重启物理 Host，因此不把独立读链证明扩展成完整关闭／重启旅程。

后续 KR 的 Host 自主授权、真实模型与通用规划／多轮上下文、运行中停止确认、自动技能投影、首次直接纳管、安装后 Tauri IPC／IndexedDB 全旅程、云 TLS Host、手机、清缓存重启恢复及 main 包升级仍需实现或验收。本增量不关闭 #34/#40。
