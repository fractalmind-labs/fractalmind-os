# claude-code-go

本地 Go CLI 重写实现，当前已具备最小可运行入口、鉴权持久化、Anthropic 兼容请求链路，并开始按源仓库命令面持续补齐功能。

## 当前已实现

- `auth login --api-key <token>`：写入本地 `auth.json`
- `auth status`：展示当前登录态、auth 文件路径、API base、token 来源
- `auth logout`：删除本地 `auth.json`
- `config show`：打印当前配置解析结果（含 `model/max_tokens`）
- `doctor`：打印配置目录、auth 文件、token 来源、API base、`model/max_tokens` 与网络 reachability
- `auto-mode defaults`：打印最小兼容版 auto-mode 默认规则 JSON
- `auto-mode config`：打印有效 auto-mode 配置 JSON（读取 trusted settings，按 section 级 fallback 回默认值）
- `assistant [sessionId]`：提供最小 assistant 入口兼容面；无参数时输出 `discover-sessions`，传 `sessionId` 时输出 `attach-session`
- `server [--port <number>] [--host <string>] [--auth-token <token>] [--unix <path>] [--workspace <dir>] [--idle-timeout <ms>] [--max-sessions <n>]`：提供最小 direct-connect server 入口，真实监听 HTTP / Unix socket，响应最小 `POST /sessions`、`GET /sessions?resume=<sessionId>`、`GET /sessions/{sessionId}`、`DELETE /sessions/{sessionId}` 与 `/ws/{sessionId}` ready/control/message stream，并维护单实例 lockfile + session index
- `ssh <host> [dir] [--permission-mode <mode>] [--dangerously-skip-permissions] [--local]`：提供最小 ssh 入口兼容面，解析 host/dir 与官方参数并输出规范化后的连接摘要
- `open <cc-url> [-p|--print [prompt]] [--output-format <format>] [--resume-session <sessionId>] [--stop-session <sessionId>]`：提供最小 direct-connect 入口兼容面，解析 `cc://` / `cc+unix://` URL；默认发起最小 `POST /sessions` 会话创建请求，也支持基于已持久化 session index 的 `--resume-session` reconnect 与 `--stop-session` 单 session stop/cleanup；随后校验 ready/control/message websocket 流，`--print` 会先发送 1 条最小 `update_environment_variables{variables}`，再在同一 websocket 上连续完成 2 轮最小消息/工具执行闭环，并额外校验最小 `system:init`、`system:task_started`、`system:task_progress`、`system:api_retry`、`tool_progress`、`stream_event(message_start)`、`stream_event(content_block_start/tool_use)`、`stream_event(content_block_delta/text_delta)`、`stream_event(content_block_delta/thinking_delta)`、`stream_event(content_block_delta/signature_delta)`、`stream_event(content_block_delta/input_json_delta)`、`stream_event(content_block_stop/tool_use)`、`stream_event(message_delta)`、`stream_event(message_stop)`、top-level `attachment:structured_output`、assistant `thinking` block、assistant `tool_use` block、assistant `stop_reason/usage`、`result:success`、`system:task_notification`、`system:files_persisted`、`system:local_command_output`、`control_request:elicitation`、`control_request:hook_callback`、`control_request:channel_enable`、`system:elicitation_complete`、`system:post_turn_summary`、`system:compact_boundary`、`system:session_state_changed(running/requires_action/idle)`、`system:hook_started` 与 `system:hook_progress` / `system:hook_response` 事件，再输出规范化后的连接/会话摘要
- `setup-token [--token <token>] [--write-env-file <path>]`：输出 long-lived token 的最小兼容接线结果，可直接生成 `CLAUDE_CODE_OAUTH_TOKEN` 的 shell env 文件
- `mcp list`：按 `user/project/local` 三层来源汇总已配置 MCP servers，并打印 scope/type/基础连接字段
- `mcp get <name>`：查看指定 MCP server 的最小只读详情（scope/type/source/command|url/headers|oauth）
- `mcp add [--scope <scope>] [--transport <stdio|http|sse>] <name> <command-or-url> [args...]`：向 `local/user/project` 对应配置文件写入最小 MCP server 配置
- `mcp remove <name> [--scope <scope>]`：从可见配置源删除指定 MCP server；若同名 server 同时存在于多个 scope，会提示显式传 `--scope`
- `plugin list`：读取 `installed_plugins.json`，打印已安装 plugin 的 `id/scope/version/install_path` 与可见时间戳字段
- `plugin install <plugin> [--scope <user|project|local>] [--version <version>]`：向 `installed_plugins.json` 写入最小安装记录，并创建版本化 cache 目录与安装元数据文件
- `plugin uninstall <plugin> [--scope <user|project|local>]`：按 scope 删除安装记录并移除对应版本化 cache 目录
- `plugin marketplace add <source> [--scope <user|project|local>]`：解析 GitHub shorthand / URL / 本地路径来源，向对应 settings 的 `extraKnownMarketplaces` 写入 marketplace 声明，并同步 `known_marketplaces.json` 与最小 cache 目录
- `plugin marketplace list`：读取 `known_marketplaces.json`，打印已声明 marketplace 的 `name/source/install_path` 与来源字段
- `plugin marketplace remove <name>`：删除 `known_marketplaces.json` 中的 marketplace，并清理可见 settings 里的 `extraKnownMarketplaces` 声明与对应 cache 目录
- `agents [--setting-sources <sources>]`：列出已配置 agents，支持 `user,project,local` 三层来源合并
- `install [target] --dry-run`：打印当前平台、目标安装路径与覆盖保护提示，不执行真实写盘
- `install <target> --apply`：把当前 CLI 二进制复制到显式目标路径；若目标已存在，先生成时间戳备份再覆盖
- `update [target] (--source-binary <path> | --source-url <url>) [--apply]`：比较目标安装路径与候选二进制的摘要；支持从本地路径或远端 URL 下载候选二进制，若需要更新，可直接替换并复用 install 的备份保护
- `api payload`：打印最小 `/v1/messages` 请求模板
- `api ping`：向配置的 Anthropic 兼容接口发起最小真实请求

## 当前 token 解析优先级

1. `CLAUDE_CODE_API_KEY`
2. `ANTHROPIC_API_KEY`
3. `ANTHROPIC_AUTH_TOKEN`
4. `CLAUDE_CODE_OAUTH_TOKEN`
5. `auth.json`（默认位于 `~/Library/Application Support/claude-code-go/auth.json`）

## 当前请求参数配置方式

默认值：
- `api_base=https://api.anthropic.com`
- `model=claude-sonnet-4-5`
- `max_tokens=32`

可通过两种方式覆盖：

1. 环境变量
   - `CLAUDE_CODE_API_BASE`
   - `ANTHROPIC_BASE_URL`
   - `CLAUDE_CODE_MODEL`
   - `CLAUDE_CODE_MAX_TOKENS`
2. 命令参数
   - `--api-base`
   - `--model`
   - `--max-tokens`

## 当前 auto-mode 配置来源

- `~/.claude/settings.json`
- `./.claude/settings.local.json`
- 可选：`CLAUDE_CODE_GO_FLAG_SETTINGS_PATH`
- 可选：`CLAUDE_CODE_GO_POLICY_SETTINGS_PATH`

## 当前 plugin 配置来源

- `CLAUDE_CODE_PLUGIN_CACHE_DIR/installed_plugins.json`（显式覆盖）
- `CLAUDE_CONFIG_DIR/{plugins|cowork_plugins}/installed_plugins.json`
- 默认：`~/.claude/{plugins|cowork_plugins}/installed_plugins.json`

补充：
- `CLAUDE_CODE_USE_COWORK_PLUGINS=true` 时会切到 `cowork_plugins`
- 当前 `plugin list/install/uninstall/marketplace add/list/remove` 只实现最小读写基线；`plugin install` 会在 cache 目录下创建版本化占位安装目录与 `.claude-code-go-plugin-install.json` 元数据文件，`plugin uninstall` 会删除对应 scope 安装记录与该版本目录，`plugin marketplace add` 会写入 settings + `known_marketplaces.json` 并创建最小 marketplace 目录，`plugin marketplace list` 会读取并格式化当前 materialized marketplace 状态，`plugin marketplace remove` 会清理 visible settings 声明、`known_marketplaces.json` 与 marketplace cache 目录
- 尚未覆盖 `plugin marketplace update`、`--json`、`--available`、enabled 状态判定、真实 marketplace 下载与完整 marketplace 管理

## 当前 MCP 配置来源

- `~/.claude/settings.json`（user scope）
- 从仓库根到当前目录逐级查找的 `.mcp.json`（project scope，越近优先级越高）
- `./.claude/settings.local.json`（local scope）

补充：
- `mcp list/get` 的 project scope 会读取从仓库根到当前目录的可见 `.mcp.json` 链路
- `mcp add --scope project` / `mcp remove --scope project` 当前会直接写当前工作目录下的 `.mcp.json`

说明：
- 当前 `auto-mode` 只实现 `defaults/config` 两个只读子命令
- 当前 `setup-token` 只实现最小兼容接线路径：接收现成 token、打印 export 指令、可选写入 env 文件；尚未实现浏览器 OAuth 取 token
- 当前 `mcp` 仅实现 `list/get/add/remove` 的最小兼容路径，尚未覆盖 health check、desktop import、auth secret 存储等官方增强行为
- 当前 `assistant` 只实现最小入口与参数兼容面，尚未接入真实 session discovery、远端 attach、REPL viewer 或 daemon/bridge 行为
- 当前 `server` 已实现最小监听、`POST /sessions`、`GET /sessions?resume=`、`GET /sessions/{sessionId}`、`DELETE /sessions/{sessionId}`、`/ws/{sessionId}` ready/control/message stream，以及单实例 lockfile（启动写入、重复启动拦截、退出清理）+ session index 持久化；当前最小 lifecycle 状态已覆盖 `starting -> running -> detached -> stopped`，并补齐了最小 backend process lifecycle：session 首次 attach 会拉起真实 backend 子进程、detach/resume 期间保持存活、shutdown 后写回 `backend_status=stopped`；同时已补最小 tool execution / permission bridge，并可在同一 websocket 上连续完成 2 轮 `user -> system(session_state_changed:running) -> system(session_state_changed:requires_action) -> can_use_tool(control_request) -> control_response(updatedInput) -> control_cancel_request -> system(task_started) -> system(task_progress) -> system(api_retry) -> tool_progress -> rate_limit_event -> stream_event(message_start) -> stream_event(content_block_delta/text_delta) -> stream_event(content_block_delta/thinking_delta) -> stream_event(content_block_delta/signature_delta) -> stream_event(content_block_start/tool_use) -> stream_event(content_block_delta/input_json_delta) -> stream_event(content_block_stop/tool_use) -> stream_event(message_delta) -> stream_event(message_stop) -> streamlined_text -> assistant(thinking+tool_use+text+stop_reason+usage) -> tool_use_summary -> streamlined_tool_use_summary -> attachment(structured_output) -> result(success) -> prompt_suggestion -> system(task_notification) -> system(files_persisted) -> system(local_command_output) -> system(elicitation_complete) -> system(post_turn_summary) -> system(compact_boundary) -> system(session_state_changed:idle) -> system(hook_started) -> system(hook_progress) -> system(hook_response)` 闭环，且额外覆盖 1 轮 `behavior=deny -> result(error_during_execution)`、1 轮 `behavior=max_turns -> result(error_max_turns)`、1 轮 `behavior=max_budget_usd -> result(error_max_budget_usd)` 与 1 轮 `behavior=max_structured_output_retries -> result(error_max_structured_output_retries)` 的最小 result:error 分支；这些 result envelope 现在都额外带最小官方兼容 `fast_mode_state:"off"`。其中 raw success path 现在会在 `result` 前额外发出 1 条 top-level `attachment{type:"structured_output",data:{text:<same result>}}`，并继续保留 `result.structured_output`；当前仍不实现真实 token accounting、完整多 block transcript rebuild、planner 或 richer TUI render。
- 本轮额外收紧 error `result` 的 `usage`：`error_during_execution` / `error_max_turns` / `error_max_budget_usd` / `error_max_structured_output_retries` 现在都返回与上游 `EMPTY_USAGE` 对齐的零值 object，而不是空 map；这只保证 `usage` shape 稳定，不实现真实 token accounting、cost aggregation 或 iteration tracking。
- 本轮额外收紧 error `result` 的 `permission_denials`：deny 分支继续返回非空 denial entry，其余 `error_max_turns` / `error_max_budget_usd` / `error_max_structured_output_retries` 统一返回空数组 `[]`；这只保证 `permission_denials` shape 稳定，不实现真实 permission analytics 或 richer denial recovery。
- 本轮额外收紧 error `result` 的 `modelUsage`：四类 error result 统一返回 `modelUsage:{"claude-sonnet-4-5": {inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD, contextWindow}}` 的全 0 stub；这只保证 `modelUsage` shape 稳定，不实现真实 cost/model accounting。
- 当前 `ssh` 只实现最小入口与参数兼容面，尚未接入真实远端 probe/deploy、SSH 隧道、auth proxy 或 remote session lifecycle
- 当前 `open` 已实现最小 `POST /sessions` + `GET /sessions?resume=` reconnect + `DELETE /sessions/{sessionId}` stop/cleanup + websocket ready/control/message 校验链路，`--print` 会先发送并校验 1 条最小 `update_environment_variables{variables}`，再在同一 websocket 上连续验证 2 轮 `user -> system(session_state_changed:running) -> system(session_state_changed:requires_action) -> can_use_tool -> control_response(updatedInput) -> control_cancel_request -> system(task_started) -> system(task_progress) -> system(api_retry) -> tool_progress -> rate_limit_event -> stream_event(message_start) -> stream_event(content_block_delta/text_delta) -> stream_event(content_block_delta/thinking_delta) -> stream_event(content_block_delta/signature_delta) -> stream_event(content_block_start/tool_use) -> stream_event(content_block_delta/input_json_delta) -> stream_event(content_block_stop/tool_use) -> stream_event(message_delta) -> stream_event(message_stop) -> streamlined_text -> assistant(thinking+tool_use+text+stop_reason+usage) -> tool_use_summary -> streamlined_tool_use_summary -> attachment(structured_output) -> result(success) -> prompt_suggestion -> system(task_notification) -> system(files_persisted) -> system(local_command_output) -> system(elicitation_complete) -> system(post_turn_summary) -> system(compact_boundary) -> system(session_state_changed:idle) -> system(hook_started) -> system(hook_progress) -> system(hook_response)`。输出摘要新增 `assistant_message_start_validated=true` / `assistant_message_start_event=stream_event:message_start`、`assistant_message_delta_validated=true` / `assistant_message_delta_event=stream_event:message_delta`、`assistant_message_stop_validated=true` / `assistant_message_stop_event=stream_event:message_stop`、`assistant_stop_reason_validated=true` / `assistant_stop_reason_event=assistant:stop_reason` / `assistant_usage_validated=true` / `assistant_usage_event=assistant:usage`、`structured_output_attachment_validated=true` / `structured_output_attachment_event=attachment:structured_output`；该 path 只保证最小 official-compatible assistant finalize 与 structured-output attachment 对齐，不实现真实 JSON delta 拼接、真实 token accounting、完整 transcript rebuild 或 richer render，且 `streamlined_text` 仍只校验纯文本。
- 本轮额外新增统一 error-result `permission_denials` 校验位：`open --print` 现在会输出 `result_error_permission_denials_validated=true` 与 `result_error_permission_denials_event=result:error:permission_denials`，只验证四类 error result 的 `permission_denials` shape 是否稳定。
- 本轮额外新增统一 error-result `modelUsage` 校验位：`open --print` 现在会输出 `result_error_model_usage_validated=true` 与 `result_error_model_usage_event=result:error:modelUsage`，只验证四类 error result 的 `modelUsage` shape 是否稳定。
- 本轮额外新增统一 error-result `usage` 校验位：`open --print` 现在会输出 `result_error_usage_validated=true` 与 `result_error_usage_event=result:error:usage`，只验证四类 error result 的 `usage` 是否保持 `EMPTY_USAGE` 同形零值 shape。
- 本轮额外补了 success `result` 的最小 official-compatible `structured_output` shape：server 现固定返回 `structured_output:{text:<same result>}`，`open --print` 会额外输出 `result_structured_output_validated=true` 与 `result_structured_output_event=result:success:structured_output`；该字段只保证 shape 稳定、可验证，不实现上游完整 structured-output tool 语义、schema 驱动重试或 tool bridge。
- success `result` 的 `modelUsage` 本轮也收紧为显式校验路径：server 继续固定返回 `modelUsage:{"claude-sonnet-4-5": {inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD, contextWindow}}` 的全 0 stub，`open --print` 新增 `result_model_usage_validated=true` 与 `result_model_usage_event=result:success:modelUsage`；该字段只保证最小 official-compatible shape 稳定，不实现上游完整 cost/model accounting 语义。
- success `result` 的 `permission_denials` 本轮也收紧为显式校验路径：server 继续固定返回空数组 `permission_denials:[]`，`open --print` 新增 `result_permission_denials_validated=true` 与 `result_permission_denials_event=result:success:permission_denials`；该字段只保证最小 official-compatible shape 稳定，不实现上游完整 permission analytics 或 richer denial recovery 语义。
- success `result` 的 `usage` 本轮也收紧为显式校验路径：server 不再返回空 map，而是固定返回与上游 `EMPTY_USAGE` 对齐的零值对象，`open --print` 新增 `result_usage_validated=true` 与 `result_usage_event=result:success:usage`；该字段只保证最小 official-compatible shape 稳定，不实现上游完整 token accounting、cost aggregation 或 iteration tracking 语义。
- `project settings` 故意不参与 `auto-mode config` 合并，跟随源仓库的安全边界
- 默认规则集目前是 **最小兼容基线**，已对齐输出 JSON 形状与 section fallback 语义，但尚未逐字对齐官方模板文本

## 本地验证样例

```bash
go build ./cmd/claude-code-go
./claude-code-go auth login --api-key 'sk-ant-demo-1234567890'
./claude-code-go auth status
./claude-code-go doctor
./claude-code-go auto-mode defaults
./claude-code-go auto-mode config
./claude-code-go assistant
./claude-code-go assistant sess-123
./claude-code-go server --port 7777 --host 127.0.0.1 --auth-token demo-token --workspace /tmp/workspace --idle-timeout 0 --max-sessions 8
./claude-code-go open 'cc://127.0.0.1:7777?authToken=demo-token'
curl -H 'Authorization: Bearer demo-token' http://127.0.0.1:7777/sessions/<session-id>
./claude-code-go open 'cc://127.0.0.1:7777?authToken=demo-token' --resume-session sess-123
./claude-code-go open 'cc://127.0.0.1:7777?authToken=demo-token' --stop-session sess-123
./claude-code-go server --unix /tmp/claude.sock --auth-token demo-token
./claude-code-go open 'cc+unix://%2Ftmp%2Fclaude.sock?token=demo-token'
./claude-code-go open 'cc+unix://%2Ftmp%2Fclaude.sock?token=demo-token' --resume-session sess-123
./claude-code-go open 'cc+unix://%2Ftmp%2Fclaude.sock?token=demo-token' --stop-session sess-123
# `open` 输出会包含 `stream_validated=true` / `stream_event=session_ready` / `backend_validated=true`
# `open --print` 还会包含 `system_validated=true` / `auth_validated=true` / `status_validated=true` / `status_transition_validated=true` / `status_compacting_lifecycle_validated=true` / `compact_summary_validated=true` / `compact_summary_synthetic_validated=true` / `compact_summary_parent_tool_use_id_validated=true` / `replayed_user_message_validated=true` / `replayed_user_synthetic_validated=true` / `replayed_user_parent_tool_use_id_validated=true` / `replayed_queued_command_validated=true` / `replayed_queued_command_synthetic_validated=true` / `replayed_queued_command_parent_tool_use_id_validated=true` / `replayed_tool_result_validated=true` / `replayed_tool_result_synthetic_validated=true` / `replayed_tool_result_parent_tool_use_id_validated=true` / `replayed_assistant_message_validated=true` / `replayed_compact_boundary_validated=true` / `replayed_compact_boundary_preserved_segment_validated=true` / `replayed_local_command_breadcrumb_validated=true` / `replayed_local_command_breadcrumb_synthetic_validated=true` / `replayed_local_command_breadcrumb_parent_tool_use_id_validated=true` / `replayed_local_command_stderr_breadcrumb_validated=true` / `replayed_local_command_stderr_breadcrumb_synthetic_validated=true` / `replayed_local_command_stderr_breadcrumb_parent_tool_use_id_validated=true`（其中 replay 十八者仅 `--resume-session --print`）/ `keep_alive_validated=true` / `update_environment_variables_validated=true` / `control_cancel_validated=true` / `task_started_validated=true` / `task_progress_validated=true` / `task_notification_validated=true` / `files_persisted_validated=true` / `api_retry_validated=true` / `local_command_output_validated=true` / `local_command_output_assistant_validated=true` / `elicitation_validated=true` / `hook_callback_validated=true` / `channel_enable_validated=true` / `elicitation_complete_validated=true` / `stream_content_validated=true` / `thinking_delta_validated=true` / `thinking_signature_validated=true` / `tool_use_block_start_validated=true` / `tool_use_delta_validated=true` / `tool_use_block_stop_validated=true` / `assistant_message_start_validated=true` / `assistant_message_start_event=stream_event:message_start` / `assistant_message_delta_validated=true` / `assistant_message_delta_event=stream_event:message_delta` / `assistant_message_stop_validated=true` / `assistant_message_stop_event=stream_event:message_stop` / `assistant_thinking_validated=true` / `assistant_tool_use_validated=true` / `assistant_stop_reason_validated=true` / `assistant_stop_reason_event=assistant:stop_reason` / `assistant_usage_validated=true` / `assistant_usage_event=assistant:usage` / `structured_output_attachment_validated=true` / `structured_output_attachment_event=attachment:structured_output` / `streamlined_text_validated=true` / `streamlined_text_event=streamlined_text` / `streamlined_tool_use_summary_validated=true` / `streamlined_tool_use_summary_event=streamlined_tool_use_summary` / `prompt_suggestion_validated=true` / `prompt_suggestion_event=prompt_suggestion` / `tool_progress_validated=true` / `rate_limit_validated=true` / `tool_use_summary_validated=true` / `tool_use_summary_shape_validated=true` / `tool_use_summary_shape_event=tool_use_summary:shape` / `message_validated=true` / `validated_turns=2` / `multi_turn_validated=true` / `result_validated=true` / `result_fast_mode_state_validated=true` / `result_error_validated=true` / `result_error_permission_denials_validated=true` / `result_error_model_usage_validated=true` / `result_error_fast_mode_state_validated=true` / `result_error_max_turns_validated=true` / `result_error_max_turns_fast_mode_state_validated=true` / `result_error_max_budget_usd_validated=true` / `result_error_max_budget_usd_fast_mode_state_validated=true` / `result_error_max_structured_output_retries_validated=true` / `result_error_max_structured_output_retries_fast_mode_state_validated=true` / `control_validated=true` / `permission_validated=true` / `permission_denied_validated=true` / `session_state_changed_validated=true` / `session_state_requires_action_validated=true` / `tool_execution_validated=true` / `interrupt_validated=true` / `initialize_validated=true` / `set_model_validated=true` / `set_permission_mode_validated=true` / `set_max_thinking_tokens_validated=true` / `mcp_status_validated=true` / `get_context_usage_validated=true` / `mcp_message_validated=true` / `mcp_set_servers_validated=true` / `reload_plugins_validated=true` / `mcp_authenticate_validated=true` / `mcp_oauth_callback_url_validated=true` / `mcp_reconnect_validated=true` / `mcp_toggle_validated=true` / `seed_read_state_validated=true` / `rewind_files_validated=true` / `rewind_files_can_rewind=true` / `cancel_async_message_validated=true` / `stop_task_validated=true` / `apply_flag_settings_validated=true` / `get_settings_validated=true` / `generate_session_title_validated=true` / `side_question_validated=true` / `set_proactive_validated=true` / `bridge_state_validated=true` / `remote_control_validated=true` / `end_session_validated=true` / `compact_boundary_preserved_segment_validated=true`
# success path 现同时包含 `structured_output_attachment_validated=true` / `structured_output_attachment_event=attachment:structured_output` 与 `result_structured_output_validated=true` / `result_structured_output_event=result:success:structured_output`；server 对应 payload 固定为 `attachment:{type:"structured_output",data:{text:<same result>}}` 与 `structured_output:{text:<same result>}`
# success `result` 现还会包含 `result_model_usage_validated=true` / `result_model_usage_event=result:success:modelUsage`；server 对应字段 shape 固定为 `modelUsage:{"claude-sonnet-4-5": {all-zero counters}}`
# success `result` 现还会包含 `result_permission_denials_validated=true` / `result_permission_denials_event=result:success:permission_denials`；server 对应字段 shape 固定为 `permission_denials:[]`
# success `result` 现还会包含 `result_usage_validated=true` / `result_usage_event=result:success:usage`；server 对应字段 shape 固定为与上游 `EMPTY_USAGE` 对齐的零值 usage object
# 其中 direct-connect user message 现额外校验最小 `timestamp` shape：`compact_summary_timestamp_validated=true` 以及 `replayed_{user|queued_command|tool_result|local_command_breadcrumb|local_command_stderr_breadcrumb}_timestamp_validated=true`；仅保证字段存在，不恢复真实 transcript timeline / ordering / provenance
# fresh live direct-connect 首条 user turn 现额外校验最小 initial user ACK replay：`acked_initial_user_replay_validated=true` / `acked_initial_user_replay_event=user:initial_ack:isReplay`；该 ACK replay 仅补最近 1 条首条 user text 回放，不扩展为多条队列、完整 transcript rebuild 或 timeline 排序
# `server` 输出会包含 `lockfile_path=...` / `session_index_path=...`
# `GET /sessions/<session-id>` 可直接查看 `status=starting|running|detached|stopped` 与 `backend_status/backend_pid`
./claude-code-go ssh demo-host
./claude-code-go ssh demo-host /tmp/work --permission-mode auto --dangerously-skip-permissions --local
./claude-code-go open 'cc://127.0.0.1:7777?authToken=demo-token' --print 'hello world' --output-format json
./claude-code-go setup-token
./claude-code-go setup-token --token tok-demo-1234567890 --write-env-file ~/.config/claude-code-go/oauth-token.env
./claude-code-go mcp list
./claude-code-go mcp get github
./claude-code-go mcp add --scope local demo -- npx -y demo-mcp
./claude-code-go mcp add --scope user --transport http --header "Authorization: Bearer demo" sentry https://mcp.sentry.dev/mcp
./claude-code-go mcp remove demo --scope local
./claude-code-go plugin install demo@market --scope project --version 2.3.4
./claude-code-go plugin uninstall demo@market --scope project
./claude-code-go plugin list
./claude-code-go plugin marketplace add demo-owner/demo-market --scope user
./claude-code-go plugin marketplace list
./claude-code-go plugin marketplace remove demo-market
./claude-code-go agents
./claude-code-go install --dry-run
./claude-code-go install ./dist/claude-code-go --apply
./claude-code-go update ./dist/claude-code-go --source-binary ./claude-code-go
./claude-code-go update ./dist/claude-code-go --source-binary ./claude-code-go --apply
./claude-code-go update ./dist/claude-code-go --source-url http://127.0.0.1:18080/claude-code-go
./claude-code-go update ./dist/claude-code-go --source-url http://127.0.0.1:18080/claude-code-go --apply
./claude-code-go api payload --model claude-3-5-haiku-latest --max-tokens 8
./claude-code-go auth logout
```

## 当前限制

- 仍未接入完整 `claude-code` 命令面，当前正按 `agents -> auto-mode -> setup-token -> mcp -> plugin -> assistant -> server -> ssh -> open -> direct-connect session stop / cleanup path -> ...` 的顺序持续补齐；其中 `assistant` / `server` / `ssh` / `open` / `auto-mode` / `setup-token` / `mcp list|get|add|remove` / `plugin list|install|uninstall|marketplace add|list|remove` 均为最小兼容面
- `api ping` 目前只验证最小请求链路，不代表完整业务行为已对齐
