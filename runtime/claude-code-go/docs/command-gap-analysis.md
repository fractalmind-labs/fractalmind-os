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
- `server` 的最小直连服务链路：解析 `--port/--host/--auth-token/--unix/--workspace/--idle-timeout/--max-sessions` 官方参数，真实监听 HTTP / Unix socket，并响应最小 `POST /sessions` + `GET /sessions?resume=` + `GET /sessions/{sessionId}` + `/ws/{sessionId}` ready/control/message stream，同时维护单实例 lockfile + session index；session 首次 attach 会拉起最小 backend 子进程，detach/resume 期间保持存活，inspect endpoint 会暴露 `backend_status/backend_pid/backend_started_at`；当前还会在 websocket 中发出最小 `system:init`、`auth_status`、`system:status`、`keep_alive`、`can_use_tool` 权限请求，并接受最小 `update_environment_variables{variables}` message；在收到 `updatedInput` 后先发 `control_cancel_request`、再发 `system(task_started/task_progress/api_retry)`，最后把该输入交给 backend 执行；同一 websocket 已可连续完成 2 轮 `tool_progress -> rate_limit_event -> stream_event(content_block_delta/text_delta) -> assistant -> tool_use_summary -> result(success) -> system(task_notification) -> system(files_persisted) -> system(local_command_output) -> system(elicitation_complete) -> system(post_turn_summary) -> system(compact_boundary) -> system(session_state_changed:idle) -> system(hook_started) -> system(hook_progress) -> system(hook_response)` 最小闭环，并补了 `result{subtype=error_max_turns}` 与 `result{subtype=error_max_budget_usd}` 两条兼容错误路径
- `ssh <host> [dir]` 的最小入口链路：解析 `host/dir`、`--permission-mode`、`--dangerously-skip-permissions`、`--local`（支持 flags-before-host），并输出规范化后的连接摘要
- `open <cc-url>` 的最小直连链路：解析 `cc://` / `cc+unix://` connect URL、`-p|--print [prompt]`、`--output-format`、`--resume-session <sessionId>`、`--stop-session <sessionId>`；默认发起最小 `POST /sessions`，也支持通过 `GET /sessions?resume=` 基于持久化 session index 恢复指定 session，或通过 `DELETE /sessions/{sessionId}` 显式 stop/cleanup 单个 session，并进一步校验 ready/control/message websocket stream；`server` 现额外暴露 `GET /sessions/{sessionId}`，可读到最小 lifecycle 状态 `starting/running/detached/stopped` 与 `backend_status/backend_pid`；`--print` 会先校验 `system:init`、`auth_status`、`system:status`、`keep_alive`，然后先发送 1 条最小 `update_environment_variables{variables}`，再在同一 websocket 上连续完成 2 轮 `user -> can_use_tool(control_request) -> control_response(updatedInput) -> control_cancel_request -> system(task_started) -> system(task_progress) -> system(api_retry) -> tool_progress -> rate_limit_event -> stream_event(content_block_delta/text_delta) -> assistant -> tool_use_summary -> result(success) -> system(task_notification) -> system(files_persisted) -> system(local_command_output) -> system(elicitation_complete) -> system(post_turn_summary) -> system(compact_boundary) -> system(session_state_changed:idle) -> system(hook_started) -> system(hook_progress) -> system(hook_response)`，随后再验证 `behavior=deny -> result:error_during_execution`、`behavior=max_turns -> result:error_max_turns`、`behavior=max_budget_usd -> result:error_max_budget_usd` 与 `interrupt -> control_response -> initialize -> control_response -> elicitation -> control_response -> hook_callback -> control_response -> channel_enable -> control_response -> set_model -> control_response -> set_permission_mode -> control_response -> set_max_thinking_tokens -> control_response -> mcp_status -> control_response -> get_context_usage -> control_response -> mcp_message -> control_response -> mcp_set_servers -> control_response -> reload_plugins -> control_response -> mcp_authenticate -> control_response -> mcp_oauth_callback_url -> control_response -> mcp_reconnect -> control_response -> mcp_toggle -> control_response -> seed_read_state -> control_response -> rewind_files -> control_response -> cancel_async_message -> control_response -> stop_task -> control_response -> apply_flag_settings -> control_response -> get_settings -> control_response -> generate_session_title -> control_response -> side_question -> control_response -> set_proactive -> control_response -> remote_control -> system(bridge_state) -> control_response -> end_session -> control_response`，输出规范化后的 direct-connect 连接摘要（含 `stream_validated/stream_content_validated/system_validated/status_validated/auth_validated/keep_alive_validated/update_environment_variables_validated/control_cancel_validated/message_validated/validated_turns/multi_turn_validated/result_validated/result_error_max_turns_validated/result_error_max_budget_usd_validated/task_started_validated/task_progress_validated/task_notification_validated/files_persisted_validated/api_retry_validated/local_command_output_validated/elicitation_validated/hook_callback_validated/channel_enable_validated/elicitation_complete_validated/post_turn_summary_validated/compact_boundary_validated/session_state_changed_validated/hook_started_validated/hook_progress_validated/hook_response_validated/control_validated/permission_validated/tool_progress_validated/rate_limit_validated/tool_use_summary_validated/tool_execution_validated/interrupt_validated/initialize_validated/set_model_validated/set_permission_mode_validated/set_max_thinking_tokens_validated/mcp_status_validated/get_context_usage_validated/mcp_message_validated/mcp_set_servers_validated/reload_plugins_validated/mcp_authenticate_validated/mcp_oauth_callback_url_validated/mcp_reconnect_validated/mcp_toggle_validated/seed_read_state_validated/rewind_files_validated/cancel_async_message_validated/stop_task_validated/apply_flag_settings_validated/get_settings_validated/generate_session_title_validated/side_question_validated/set_proactive_validated/bridge_state_validated/remote_control_validated/end_session_validated/backend_validated`）；当前 `update_environment_variables` 仅走最小 envelope-compatible stub：只验证 `variables` 为 object/map 并继续流，不实现真实 structuredIO、环境变量注入、backend 进程环境刷新或持久化；`error_max_turns` 也只走最小 envelope-compatible stub：只验证 `result{subtype=error_max_turns}` 可被 CLI 接受，不实现真实 maxTurns 调度、budget 计算或 structured-output retry 上限治理；`error_max_budget_usd` 也只走最小 envelope-compatible stub：只验证 `result{subtype=error_max_budget_usd}` 可被 CLI 接受，不实现真实美元预算统计、预算阈值治理或任何花费控制；`initialize` 仅返回最小 schema-compatible success stub，不会真实应用 hooks/sdkMcpServers/agents/systemPrompt/bootstrap；`elicitation` 仅返回固定 `action=cancel` stub，用于验证 control request/response 兼容面，不实现真实 MCP elicitation UX；`hook_callback` 仅返回空 success stub，用于验证 callback envelope 兼容面，不实现真实 callback routing/execution；`channel_enable` 仅返回 `serverName` echo 的 success stub，用于验证 request envelope 兼容面，不实现真实 channel registry、plugin source 检测、notification handler 注册或 channel message routing；`mcp_authenticate` 仅返回最小兼容 error/success stub：未知 server 返回 `Server not found: ...`，`stdio` server 返回“不支持 OAuth authentication”，`http/sse` stub server 返回 `requiresUserAction=true + authUrl`；`mcp_oauth_callback_url` 仅返回最小兼容 error/success stub：没有 active flow 时返回 `No active OAuth flow for server: ...`，callback URL 缺少 `code/error` 参数时返回固定兼容错误，active flow + 合法 URL 时返回空 success；但不会真实提交 callback、等待 token exchange、写 token、刷新凭据或更新真实 MCP client / dynamic tool 状态；`bridge_state` 也仅对齐 remote_control stub 状态，不代表真实 bridge lifecycle 已接入

## 3. 未实现但已识别的高优先级命令

### Wave 1：正在补齐
- direct-connect 的更丰富 `system` 子类型 / 状态机（当前已补到 `update_environment_variables/result:error_max_turns/result:error_max_budget_usd/interrupt/initialize/channel_enable/mcp_authenticate/mcp_oauth_callback_url/set_model/set_permission_mode/set_max_thinking_tokens/mcp_status/get_context_usage/mcp_message/mcp_set_servers/reload_plugins/mcp_reconnect/mcp_toggle/seed_read_state/rewind_files/cancel_async_message/stop_task/apply_flag_settings/get_settings/generate_session_title/side_question/set_proactive/remote_control/bridge_state/end_session` 兼容 path；下一步聚焦其它 message 类型 / 更丰富 system 事件）

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
- `server/open` 已具备最小 websocket ready/control/message 闭环，且 server 已补单实例 lockfile + session index + reconnect + detached-state + backend process lifecycle + 最小 tool execution / permission bridge；当前 `GET /sessions/{sessionId}` 可直接读到 `starting/running/detached/stopped` 与 `backend_status/backend_pid`，`resume` 期间可复用同一 live backend pid，`open --print` 也已验证 `system_validated=true / auth_validated=true / status_validated=true / keep_alive_validated=true / update_environment_variables_validated=true / control_cancel_validated=true / task_started_validated=true / task_progress_validated=true / task_notification_validated=true / files_persisted_validated=true / api_retry_validated=true / local_command_output_validated=true / elicitation_validated=true / hook_callback_validated=true / channel_enable_validated=true / mcp_authenticate_validated=true / mcp_oauth_callback_url_validated=true / elicitation_complete_validated=true / stream_content_validated=true / tool_progress_validated=true / rate_limit_validated=true / tool_use_summary_validated=true / post_turn_summary_validated=true / compact_boundary_validated=true / session_state_changed_validated=true / hook_started_validated=true / hook_progress_validated=true / hook_response_validated=true / validated_turns=2 / multi_turn_validated=true / result_validated=true / result_error_validated=true / result_error_max_turns_validated=true / result_error_max_budget_usd_validated=true / permission_validated=true / permission_denied_validated=true / tool_execution_validated=true`。本轮已补最小 `result:error_max_budget_usd` path：server 会在显式 `behavior=max_budget_usd` 下返回兼容 `result{subtype=error_max_budget_usd}`，open 会把 `result_error_max_budget_usd_validated=true` 落到摘要；该 path 只验证 envelope，不实现真实美元预算统计、预算阈值治理或任何花费控制。此前的 `result:error_max_turns`、`update_environment_variables`、`control_request:mcp_oauth_callback_url`、`control_request:mcp_authenticate`、`control_request:channel_enable`、`control_request:hook_callback`、`control_request:elicitation`、`system:elicitation_complete`、`system:local_command_output`、`system:api_retry`、`system:files_persisted`、`system:task_started`、`system:task_progress`、`system:task_notification`、`system:session_state_changed`（running -> idle）、`system:post_turn_summary`、`system:compact_boundary`、`system:hook_started`、`system:hook_progress`、`system:hook_response`、multi-session / `max_sessions` guard + 单 session stop/cleanup 仍保持生效：server 允许在上限内创建/恢复多个 session，超额新建或超额恢复会返回 `429 max sessions reached`，已有 live session 仍可在上限内 resume；`DELETE /sessions/{sessionId}` 会显式停止 backend、回写 `stopped/backend_stopped_at` 并释放 slot，open 也已通过 `--stop-session` 暴露该路径。当前剩余缺口切到其它 message 类型 / 更丰富状态机
- 更接近官方安装体验的远端版本清单 / release 元数据发现（当前最小实现仅支持显式 `--source-url`）

这意味着当前 Go CLI 已具备“可启动 + 可鉴权 + 可发最小请求 + 最小安装/升级 + agents 配置枚举”的骨架，但距离完整官方体验仍有多块命令面差距。

## 5. 下一优先级结论

### 下一步要补的高频子路径：direct-connect 的更丰富 message / state machine path

选择理由：
1. `server ↔ open` 现在已经形成最小 `/sessions + websocket ready/control/message + lockfile + session index + reconnect + detached-state + backend process lifecycle + system:init + auth_status + system:status + keep_alive + update_environment_variables + control_cancel_request + control_request:elicitation + control_request:hook_callback + control_request:channel_enable + control_request:mcp_authenticate + control_request:mcp_oauth_callback_url + system(task_started/task_progress/task_notification/files_persisted/api_retry/local_command_output/elicitation_complete) + tool_progress + rate_limit_event + stream_event + tool_use_summary + result(success/error_during_execution/error_max_turns/error_max_budget_usd) + system(post_turn_summary) + system(compact_boundary) + system(session_state_changed) + system(hook_started) + system(hook_progress) + system(hook_response)` 闭环，并且 `max_sessions` 容量保护与单 session stop/cleanup 都已补齐
2. 当前下一批真实缺口已转到其它高频 message 形状与更丰富 state machine，而不是 task 三连事件本身
3. 继续沿 direct-connect 状态机主路径推进，比回到已收口的其它子命令组更符合当前 OKR 主路径

## 6. 结论

`claude-code-go` 当前已从空仓推进到“最小可运行 CLI + 已通过 1 轮真实 Anthropic-compatible 验证 + 开始按命令面对齐持续补齐”的阶段。  
在老板已明确要求“完全复刻目标所有功能”的前提下，当前主路径应保持为 **按命令面持续补齐**，而不是回到“原型收口”。
