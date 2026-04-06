# claude-code → claude-code-go 命令面对照（v0.4）

更新时间：2026-04-06 CST  
当前分支：`feat/bootstrap-cli-skeleton` / `工作区未提交实现中`

## 1. 对照口径

### 源仓库
- 路径：`workspace/claude-code`
- 主要入口：`src/main.tsx`
- 首轮直接可见的顶层命令：
  - `mcp`
  - `server`
  - `ssh <host> [dir]`
  - `open <cc-url>`
  - `auth`
  - `plugin`
  - `setup-token`
  - `agents`
  - `auto-mode`
  - `assistant [sessionId]`
  - `doctor`
  - `update`
  - `install [target]`
  - ant-only：`up` / `rollback` / `log` / `error` / `export` / `task`

### 目标仓库
- 路径：`workspace/claude-code-go`
- 当前 CLI 入口：`cmd/claude-code-go/main.go`

## 2. 已实现命令面

### 已可运行
- `auth login --api-key <token>`
- `auth status`
- `auth logout`
- `config show`
- `doctor`
- `agents [--setting-sources <sources>]`
- `auto-mode defaults`
- `auto-mode config`
- `setup-token [--token <token>] [--write-env-file <path>]`
- `mcp list`
- `mcp get <name>`
- `mcp add [--scope <scope>] [--transport <stdio|http|sse>] <name> <command-or-url> [args...]`
- `mcp remove <name> [--scope <scope>]`
- `plugin list`
- `plugin install <plugin> [--scope <scope>] [--version <version>]`
- `plugin uninstall <plugin> [--scope <scope>]`
- `plugin marketplace add <source> [--scope <scope>]`
- `plugin marketplace list`
- `plugin marketplace remove <name>`
- `assistant [sessionId]`
- `server`
- `open <cc-url>`
- `install [target] --dry-run`
- `install <target> --apply`
- `update [target] (--source-binary <path> | --source-url <url>) [--apply]`
- `api payload`
- `api ping`

### 已实现的支撑能力
- 本地 `auth.json` 写入/读取/删除
- `agents` 的 `user/project/local` 三层配置来源合并
- `CLAUDE_CODE_API_KEY` / `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` / `auth.json` 五层 token 来源解析
- `api_key_source` 可见化
- `api_base / model / max_tokens` 默认值 + 环境变量覆盖
- `api payload|ping --api-base/--model/--max-tokens` 命令级覆盖
- `/v1/messages` 最小请求构造与真实 HTTP 命中验证
- `install --dry-run` 的平台/路径探测与覆盖保护提示
- `install --apply` 的显式目标复制路径与时间戳备份覆盖保护
- `update` 的候选二进制摘要比较、是否需要替换判断、远端 URL 下载与 apply 替换路径
- `plugin list` 对 `installed_plugins.json` 的最小发现与多安装记录可见化
- `plugin install` 的最小写盘链路：创建版本化 cache 目录、安装元数据文件，并写入/更新 `installed_plugins.json`
- `plugin uninstall` 的最小删除链路：按 scope 删除 `installed_plugins.json` 记录并移除对应版本目录
- `plugin marketplace add` 的最小声明链路：解析 GitHub shorthand / URL / 本地路径来源，写入对应 settings 的 `extraKnownMarketplaces`，同步 `known_marketplaces.json`，并创建最小 marketplace cache 目录
- `plugin marketplace list` 的最小只读链路：读取 `known_marketplaces.json`，按 name 排序打印 source/install_path/last_updated 与来源字段
- `plugin marketplace remove` 的最小删除链路：删除 `known_marketplaces.json` 中的 marketplace，同步清理 user/project/local 可见 settings 的 `extraKnownMarketplaces` 声明，并移除对应 marketplace cache 目录
- `assistant [sessionId]` 的最小入口链路：无参数时输出 `discover-sessions`，传 sessionId 时输出 `attach-session`，先把顶层命令面与参数口径补齐
- `server` 的最小直连服务链路：解析 `--port/--host/--auth-token/--unix/--workspace/--idle-timeout/--max-sessions` 官方参数，真实监听 HTTP / Unix socket，并响应最小 `POST /sessions` + `GET /sessions?resume=` + `GET /sessions/{sessionId}` + `/ws/{sessionId}` ready/control/message stream，同时维护单实例 lockfile + session index；session 首次 attach 会拉起最小 backend 子进程，detach/resume 期间保持存活，inspect endpoint 会暴露 `backend_status/backend_pid/backend_started_at`；当前还会在 websocket 中发出最小 `system:init`、`auth_status`、`system:status`、`keep_alive`、`can_use_tool` 权限请求，并在收到 `updatedInput` 后先发 `control_cancel_request` 再把该输入交给 backend 执行；同一 websocket 已可连续完成 2 轮 `tool_progress -> rate_limit_event -> stream_event(content_block_delta/text_delta) -> assistant -> tool_use_summary -> result(success)` 最小闭环
- `ssh <host> [dir]` 的最小入口链路：解析 `host/dir`、`--permission-mode`、`--dangerously-skip-permissions`、`--local`（支持 flags-before-host），并输出规范化后的连接摘要
- `open <cc-url>` 的最小直连链路：解析 `cc://` / `cc+unix://` connect URL、`-p|--print [prompt]`、`--output-format`、`--resume-session <sessionId>`；默认发起最小 `POST /sessions`，也支持通过 `GET /sessions?resume=` 基于持久化 session index 恢复指定 session，并进一步校验 ready/control/message websocket stream；`server` 现额外暴露 `GET /sessions/{sessionId}`，可读到最小 lifecycle 状态 `starting/running/detached/stopped` 与 `backend_status/backend_pid`；`--print` 会先校验 `system:init`、`auth_status`、`system:status`、`keep_alive`，再在同一 websocket 上连续完成 2 轮 `user -> can_use_tool(control_request) -> control_response(updatedInput) -> control_cancel_request -> tool_progress -> rate_limit_event -> stream_event(content_block_delta/text_delta) -> assistant -> tool_use_summary -> result(success)`，随后再验证 `interrupt -> control_response`，输出规范化后的 direct-connect 连接摘要（含 `stream_validated/stream_content_validated/system_validated/status_validated/auth_validated/keep_alive_validated/control_cancel_validated/message_validated/validated_turns/multi_turn_validated/result_validated/control_validated/permission_validated/tool_progress_validated/rate_limit_validated/tool_use_summary_validated/tool_execution_validated/interrupt_validated/backend_validated`）

## 3. 未实现但已识别的高优先级命令

### Wave 1：正在补齐
- direct-connect 的最小 permission-denial / result:error path

### 后续批次
- `assistant`
- `server`
- `ssh`
- `open`

### 暂不进入当前批次
- ant-only：`up` / `rollback` / `log` / `error` / `export` / `task`
- bridge / remote-control / IDE / TUI 全量行为

## 4. 当前差异总结

### 已对齐的最小主路径
- 有可构建的 Go 二进制入口
- 有 auth 基础命令组
- 有 config 可见化
- 有 doctor 自检入口（config/auth/api base/model/max_tokens/reachability）
- 有 install dry-run 入口（平台/默认安装路径/覆盖保护提示）
- 有 update 检查入口（安装目标解析/版本检查占位提示）
- 有最小请求构造和真实接口命中证据
- 有本地凭证持久化闭环

### 仍缺的关键用户向命令
- `server/open` 已具备最小 websocket ready/control/message 闭环，且 server 已补单实例 lockfile + session index + reconnect + detached-state + backend process lifecycle + 最小 tool execution / permission bridge；当前 `GET /sessions/{sessionId}` 可直接读到 `starting/running/detached/stopped` 与 `backend_status/backend_pid`，`resume` 期间可复用同一 live backend pid，`open --print` 也已验证 `system_validated=true / auth_validated=true / status_validated=true / keep_alive_validated=true / control_cancel_validated=true / stream_content_validated=true / tool_progress_validated=true / rate_limit_validated=true / tool_use_summary_validated=true / validated_turns=2 / multi_turn_validated=true / result_validated=true / permission_validated / tool_execution_validated`。但 backend 目前仍只是最小 echo worker，尚未接入更完整的 permission-denial / result:error / richer message 类型与更完整的状态机
- 更接近官方安装体验的远端版本清单 / release 元数据发现（当前最小实现仅支持显式 `--source-url`）

这意味着当前 Go CLI 已具备“可启动 + 可鉴权 + 可发最小请求 + 最小安装/升级 + agents 配置枚举”的骨架，但距离完整官方体验仍有多块命令面差距。

## 5. 下一优先级结论

### 下一步要补的高频子路径：direct-connect 的最小 permission-denial / result:error path

选择理由：
1. `server ↔ open` 现在已经形成最小 `/sessions + websocket ready/control/message + lockfile + session index + reconnect + detached-state + backend process lifecycle + system:init + auth_status + system:status + keep_alive + control_cancel_request + tool_progress + rate_limit_event + stream_event + tool_use_summary + result(success) + 两轮持续 loop` 闭环，下一段自然是补更接近官方错误/拒绝分支
2. permission-denial / result:error path 是 direct-connect 从“已能表达 happy-path 运行态事件”升级到“能表达失败态与拒绝态”的关键缺口
3. 继续沿 direct-connect 主路径推进，比回到已收口的其它子命令组更符合当前 OKR 主路径

## 6. 结论

`claude-code-go` 当前已从空仓推进到“最小可运行 CLI + 已通过 1 轮真实 Anthropic-compatible 验证 + 开始按命令面对齐持续补齐”的阶段。  
在老板已明确要求“完全复刻目标所有功能”的前提下，当前主路径应保持为 **按命令面持续补齐**，而不是回到“原型收口”。
