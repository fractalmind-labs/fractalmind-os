# v0.2.0：真实 Ollama 模型与原生 App 闭环

对应 [#34](https://github.com/fractalmind-labs/fractalmind-os/issues/34)、[#43](https://github.com/fractalmind-labs/fractalmind-os/issues/43)、[#45](https://github.com/fractalmind-labs/fractalmind-os/issues/45) 与总验收 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40)，基线 `1bfcf64`。

## 实现

Host 的 `runtime.model.protocol` 现在明确选择 `anthropic-messages`（既有默认值）或 `ollama`。后者使用原生 [Chat API](https://docs.ollama.com/api/chat)：非流式请求、有限 token／超时／请求次数，文本问答与工具规划分开。远端仍要求 HTTPS 和显式环境变量凭据，本地可用 loopback HTTP；不跟随重定向，不自动重试或换执行器，不把错误正文或凭据写入结果。

真实模型暴露了两处输入问题：模型把早先的缺失文件观测当作当前状态，以及给读取动作附带写入哈希。现在保留完整历史，同时提供每个路径的最新 Host 观测，明确读、写和停止的格式；Ollama 使用 [JSON Schema 输出](https://docs.ollama.com/capabilities/structured-outputs)限制格式。模型仍自己选择动作、路径与内容，Host 继续核验原目标、范围、当前权限、版本、期限、冲突哈希和预算。只有实际读取产生测量证据。

示例配置（先单独安装模型）：

```yaml
runtime:
  adapter_kind: native-file-agent
  model:
    enabled: true
    protocol: ollama
    api_base: http://127.0.0.1:11434
    api_key_env: ""
    name: qwen2.5-coder:7b
    max_tokens: 2048
    timeout_seconds: 30
    max_requests: 12
```

还须沿原接入流程配置链、工作区、成员和实例授权；这些配置字段本身不授予执行资格。问答只发送原签名文字，返回待审阅建议，工具支出为零；外部提供方账单与 Sui Gas／工具账本分开。

## 真实模型验证

[R7 原生 App 联测](evidence/v020-ollama-model-localnet.json)：**18 项检查、56 笔 App 确认交易，退出 0**。使用隔离 loopback Ollama **0.12.9** 与官方 [Qwen2.5-Coder 7B](https://ollama.com/library/qwen2.5-coder:7b)，模型摘要、请求／原响应哈希和正文均有记录；观测代理原样转发，没有生成、修补或替换模型回复。

- 复用 main R8 升级链与混合类型部署；实际 OS Human 密钥库、正式 App 控制器、生产 envd／Coordinator 和真实文件工具联测。Host 身份使用隔离内存提供者，同机子进程执行。
- 模型真实选择两个 KR 的 **6 次读取／写入**；实际文件哈希成为测量证据，独立脚本 Human 分别验证 KR，再另行确认最终验收。OKR 达成，预算 **6 已用／0 预留**。
- 第 **7 次**真实模型请求为正式 App 的零工具问答。原 Run／加密回复从 Sui 重建，模型建议标记为未验证，没有再次请求模型或改变工具账本。提供方回执合计输入 **2,882**／输出 **243** token，未将其当作货币账单。
- 常驻权限、实际文件执行、单次超权审批、原结果重建、对话转 DRAFT 及来源保留均通过。最终常驻账本 **4／0**、累计单次审批 **6／0**；草稿没有 Run／模型请求或隐式派发。权限与 Host 最后撤销，生成的 Human 测试凭据清理确认。
- [独立零广播复查](evidence/v020-ollama-model-validation.json)确认两个原成功 KR、已验收 OKR、原问答成功 Run／零工具 claim、来源草稿零执行、完整 Agent 目录 **12 个 Run／0 个未结控制执行**及最终撤权／账本。Go 四包 race、当前夹具严格 TypeScript 与格式检查通过；App／SDK／Move／Rust 未计作本轮全量重跑。

## 失败与清理

[前序原记录](evidence/v020-ollama-model-prior.json)保留失败，未重发原命令：R1 漏 CLI 白名单，零交易；R2 的 1.5B 模型停止于缺失文件，原失败 Run **1／0**；R3 测试链进程退出，零交易／模型请求，测试身份清理；R4 的 1.5B、R5 的 7B 重复创建触发冲突，分别 **2／0、3／0**；R6 的 7B 给读取附带写入哈希，Host 拒绝，**2／0**。四轮原失败 Run 均已结清，分别独立撤销原 Host 并清理测试身份。R7 是修复后的独立场景。

测试链确认无进程和监听后，使用原目录恢复，没有重新生成 genesis；原链 ID、genesis 哈希、R2 原失败 Run 和独立撤权保持，复查广播为零。测试 Ollama 采用独立端口／模型缓存，结束后已停止；用户原服务的两个模型名称保持。测试模型缓存暂留用于后续目标验收。

## 证明范围

这次证明真实本地生成模型能在明确文本文件目标内选工具并完成原生控制器闭环；**没有证明一般自然语言项目规划、任意代码任务或模型整体质量**。Human 决定由脚本显式给出，尚未替代安装后 UI 操作。

云 Host、手机真实沟通审批、安装后 UI／清缓存重建、运行中 Host 重启续跑与 Coordinator 重连、公共旧部署升级仍待验收。旧原生 GUI 授权请求未被重启或替换，其他历史 QUEUED Run 不属于本轮清理。完整 v0.2.0／#40 保持进行中。
