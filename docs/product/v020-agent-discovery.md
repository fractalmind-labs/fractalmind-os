# v0.2.0：Host 内已有实例发现

基线：PRD v0.11 J11、FR-39，以及 `fractalmind-app-prototype-v2` 的团队与 Agents 入口。完整 v0.2.0 尚未验收。

## 实现

- 链连接模式下，envd 从已选择的 tmux server 读取已有 pane。保留 `EMP_`、`agent-`、`team-` 会话命名筛选；每个 pane 单独显示。只读取元数据和系统进程信息，不写 tmux options、不复制／重启进程、不建立本地业务注册表。
- 实例 ID 是域分离后服务器 PID／系统启动标识／原生进程创建时间、tmux pane ID、pane PID／原生创建时间的 SHA-256。Host 地址构成链上外层命名空间。名称改变不会重建身份；pane respawn、同名会话重建和 server 重建不会沿用原实例。该 ID 证明 Host 观测到的进程连续性，不证明独立 Agent 公钥或某个 AI 程序一直未改变。
- macOS 使用内核 `kern.proc.pid` 创建时间和 `kern.bootsessionuuid`；Linux 使用 `/proc/<pid>/stat` 的 starttime 和 boot_id。无法读取创建时间／工作目录时仅显示未核实项，不提供可导入 ID；其他 OS 明确报告适配器不支持。Windows 的后续原生适配器仍需实现。
- 两次读取 tmux 元数据并复核进程创建时间。列表变化／超量／失败返回 `unavailable` 且清空实例。每次扫描保留自己的时间；新心跳不会延长旧扫描的 60 秒期限。
- 工作区使用解析符号链接后的绝对路径及其 SHA-256。它标识此次观察到的路径，不证明内容、工具边界或任务检查点。读取不包含进程命令行、模型凭据或终端内容。
- 发现快照随 Host 签名心跳发送。App 经当前设备 Grant 和 Coordinator 签名响应读取后，独立核验 Host 原文／当前成员指针／入口版本，再校验扫描时间、实例／pane 唯一性和工作区指纹。单个扫描无效时不能显示实例，Host 资源观测可继续独立显示。
- “团队与 Agents”已接通发现视图，区分完成但无实例、读取失败、不支持、身份未核实、进程已结束和过期；展示 Host、pane、实例 ID、工作区／指纹及扫描时间。页面内存保存观测，到期、组织／设备资格变更或页面关闭后不能继续作为当前依据。

tmux 稳定内部 ID 与 pane 元数据的语义参照[官方手册](https://raw.githubusercontent.com/tmux/tmux/master/tmux.1)。工作区和进程信息均由已授权 Host 观测；本功能不验证远程操作系统是否诚实。

## 使用

链连接 Host 可显式选择已有 tmux socket；空值使用 tmux 默认 server：

```yaml
agents:
  scan_method: tmux
  tmux_socket: /absolute/path/to/existing/tmux.sock
  scan_interval: 10s
```

在安装后的 App 打开“团队与 Agents”，读取链上组织入口，再验证设备并读取观测。网页只有链目录浏览能力，不接收设备私钥，也不能签名读取。

扫描 tmux 出错（包括没有可读取 server）报告不可用，不把错误解释为“没有 Agent”。可读取的 server 中无匹配命名 pane 则明确报告空列表。

## 自测证据

- [Go race／App／构建记录](evidence/v020-agent-discovery-unit.json)：真实隔离 tmux socket，重新扫描与改名连续，拆分 pane、respawn、消失与同名重建被区分；元数据／创建时间竞态和读取失败清空快照。App 验证工作区篡改、伪造约束能力、重复实例／pane、旧扫描期限及失败状态。
- [真实 localnet 记录](evidence/v020-agent-discovery-localnet.json)：生成隔离测试身份，Go 正式扫描器读取实际 tmux pane／系统创建时间，Host 签名经真实 socket、设备权限、Coordinator 响应到生产 App 读取／验证函数。成员／设备撤销后旧签名仍被拒绝；未知交易继续只查询原摘要。
- [浏览器记录](evidence/v020-agent-discovery-browser.json)：真实链目录、发现入口、中文白天／英文黑夜，以及网页签名按钮禁用。[实际截图](evidence/v020-agent-discovery-browser-zh-light.jpg)。没有注入虚构可信实例；安装后实例卡片和原生 IPC 流程尚未验收。

重现本地链流程（已有正确部署文件及运行中的 localnet）：

```sh
# runtime/fractalmind-envd
go test -race ./internal/agent ./internal/heartbeat ./internal/ws ./internal/coordinator ./cmd/envd
go test -c ./cmd/envd -o /tmp/fm-envd-agent-discovery-tests

# apps/fractalmind-app；每次使用新的报告路径
FM_ENVD_JOIN_CLI_BIN=/tmp/fm-envd-agent-discovery-tests \
FM_ENVD_CHAIN_CONNECTION=1 FM_ENVD_AGENT_DISCOVERY=1 \
node --import tsx scripts/host-admission-localnet.ts DEPLOYMENT.json NEW_REPORT.json
```

## 尚未完成的验收

后续的[仅观察链上导入增量](v020-agent-import.md)已接通生产控制器、费用确认和原摘要重建；安装后 UI 仍待验收。以下是发现增量保存时的阶段记录。

发现是 J11 第一步，链上仅观察导入的报价／确认／幂等／重建界面，以及可接受约束适配器的安全检查点、旧执行停止、纳入 OKR 和明确继续仍需完成。tmux 不能取得这些能力；本增量不消耗或扩大 RemoteCapability。

真实 Linux 运行、Windows 原生发现、安装后 OS 密钥库与 IPC、云端 TLS Host 和五平台仍未验收。本地链使用生成的测试钥，不能代替原生身份验收。现有原生 App 的系统密钥库提示仍需用户处理；该阻塞不影响独立扫描及链路工作。

自主闭环、对话／介入、证据验收及完整发行目标保持原范围。
