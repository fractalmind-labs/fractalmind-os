# v0.2.0：原生有界文件 Agent 的发现与仅观察导入

依据 PRD v0.11 J11／FR-39 与 `fractalmind-app-prototype-v2`。此前发现仅包含 tmux；本增量将已经实现的原生文件 Agent 适配器接入发现、仅观察导入及显式重新关联。完整 v0.2.0 仍未完成。

## 实例与能力

- `runtime.adapter_kind: native-file-agent` 和 `runtime.workspaces` 配置已有绝对目录；原生适配器初始化时核对目录、固定规范路径和物理目录身份。每个绑定属于当前 envd 内的文件 Agent，不代表另一个被扫描到的 AI 进程。
- `native-*` 实例 ID 使用 envd 的 PID、系统启动／进程创建身份与绑定标识派生。绑定名称和 PID 单独不能确定实例；PID 重用或 envd 重启会产生新 ID。相同名称不同 Host 仍由链目录的 Host 地址区分。
- 适配器生成实际库存，Executor 只读转发，生产扫描循环附加独立的 `native_discovery`。它与 tmux `discovery` 分开签名核验，扫描失败不能更新旧实例期限。当前原生进程连续性支持 macOS／Linux；其他系统明确不支持，不能据此关闭 Windows 或五平台运行门禁。
- 原生文件适配器支持 1–3 个明确文本文件目标、有界读写、实测内容证据及逐工具链权限／预算／停止检查。这个能力说明不等于已接管原任务、已授权执行或完成通用模型规划。
- 发现的实例 ID 映射到固定物理工作区，供后续执行授权使用。发现与导入本身不执行文件目标。别名执行尚未真实链联测，不能由映射测试推断它已经完成。

## App 与链上关系

1. App 独立验证 Host 签名和当前成员指针，再分别解析两种扫描来源、各自的原扫描期限、连续性类型、实例前缀及工作区指纹。tmux 会话不能通过更改运行时标签进入原生来源。
2. 团队与 Agents 分别展示 tmux 与原生文件 Agent，说明可用能力。选择后先确认 Host／实例／工作区及费用，始终提交 `control_confirmed=false`。
3. 链上原生记录使用 `bounded-process-v1`，但仍是仅观察；一致重复导入返回原记录，不新报价或付费。实例丢失、扫描过期或类型变化阻止报价与提交。
4. 仅观察记录可在审阅版本后显式重新关联，保留原记录 ID。旧可控记录仍要求安全交接，不能通过本流程降级或继续旧授权。未知结果只查询原摘要，不重放。

合约及 SDK 接口未改动，使用既有导入接口与 `rebind_agent_at_version`。生产 App 的运行时来自核验后的源扫描，并进入报价／签名前后的来源固定值；用户输入的运行时标签不能授予能力。

## 物理目录保护

原生扫描保存目录的 OS 文件身份，发现原路径被新目录替换时，返回失败并清空实例。配置中的符号链接后来转向另一个目录，不改变已绑定的规范路径。

原生别名执行在开始前检查仍存在的实例，文件工具打开根目录后核对实际句柄的文件身份，关闭“检查路径后打开了替换目录”的时间差。每次工具调用继续核对该物理目录与当前链授权。目录身份与扫描仅存内存，没有新增业务磁盘数据库。

## 验证

- [原生实例实际链报告](evidence/v020-native-agent-localnet.json)：**16 项检查、12 笔确认交易**。实际实例化的原生适配器／工作区和 envd 内核进程创建时间，经 Go Host 原文签名、设备 HTTP 挑战及 App 独立核验；仅观察导入、原摘要单次广播恢复、重复无新付款与撤销拒绝通过。
- [显式重新关联实际链报告](evidence/v020-native-agent-rebind-localnet.json)：**19 项检查、16 笔成功、1 笔预期 Move 失败**。原生记录保留 ID、推进版本，旧报价及实际合约 `9208` 并发版本拒绝通过。负向原交易使用独立生成的测试 Gas 付款者，生产 App 仍为设备自付。
- [测试与构建](evidence/v020-native-agent-unit.json)：App **90/90**、Go 五包 race、类型／生产构建及链脚本类型通过。覆盖真实内核进程、PID 生命周期、目录替换、规范路径、实际工具根身份、签名来源隔离、原生源过期／丢失与禁止通过 tmux 提升能力。初次沙箱运行的真实 tmux 连续性失败，随后允许真实内核访问的 race 运行通过；没有重启现有应用或链来避开等待。
- [实际浏览器](evidence/v020-native-agent-browser.json)从上述报告读取真实原生登记 v1，中英文及明暗主题、完整 ID、仅观察与未知运行状态均核对。网页设备鉴权及交易恢复按钮禁用。[中文白天](evidence/v020-native-agent-light.png)与[英文黑夜](evidence/v020-native-agent-dark.png)截图保存；没有注入假签名实例。这不是安装后对话框或已授权扫描卡片的验收。

链夹具使用生成的设备／Host 钥和注入 App 原生传输，App 技术 journal 为内存；envd 使用真实磁盘摘要 journal，同进程重建 runner。没有验收 OS 密钥库、实际云 Host 或安装后重启。

## 重现

保留现有 localnet／faucet 和包含版本条件接口的隔离部署。在 `runtime/fractalmind-envd` 构建：

```sh
go test -c -o /tmp/fm-envd-native-discovery-tests ./cmd/envd
go test -race ./internal/agent ./internal/runtimeadapter ./internal/heartbeat ./internal/boundedrun ./cmd/envd
```

在 `apps/fractalmind-app` 使用新报告路径：

```sh
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-native-discovery-tests \
FM_ENVD_CHAIN_CONNECTION=1 FM_ENVD_AGENT_DISCOVERY=1 \
FM_ENVD_AGENT_IMPORT=1 FM_ENVD_NATIVE_DISCOVERY=1 \
FM_ENVD_HOST_REJOIN=0 \
node --import tsx scripts/host-admission-localnet.ts DEPLOYMENT.json NEW_REPORT.json
```

显式重新关联验收增加 `FM_ENVD_AGENT_REBIND=1`，使用另一个新报告路径。此辅助程序的原生分支尚未组合 Host 重新接入场景；此前同 worker 重新接入的 tmux 验收不能替代它。原交易未知时保留该摘要并继续查询。

## 剩余范围

仍需把原生别名执行、安全检查点与旧执行停止、适配器约束确认、ACTIVE OKR 授权和用户明确继续接通 App。直接对话／介入、持续自主达成与人类验证闭环、真实云 TLS Host、身份全旅程及五平台安装运行仍未完成。原生 App 的系统密钥库授权保持等待，未使用替代存储或重启绕过。完整 v0.2.0 范围不变。
