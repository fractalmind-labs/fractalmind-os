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
- `open <cc-url> [-p|--print [prompt]] [--output-format <format>] [--resume-session <sessionId>] [--stop-session <sessionId>]`：提供最小 direct-connect 入口兼容面，解析 `cc://` / `cc+unix://` URL；默认发起最小 `POST /sessions` 会话创建请求，也支持基于已持久化 session index 的 `--resume-session` reconnect 与 `--stop-session` 单 session stop/cleanup；随后校验 ready/control/message websocket 流，`--print` 会先发送 1 条最小 `update_environment_variables{variables}`，再在同一 websocket 上连续完成 2 轮最小消息/工具执行闭环，并额外校验最小 `system:init`、`system:task_started`、`system:task_progress`、`system:api_retry`、`tool_progress`、`stream_event(content_block_delta)`、`result:success`、`system:task_notification`、`system:files_persisted`、`system:local_command_output`、`control_request:elicitation`、`control_request:hook_callback`、`control_request:channel_enable`、`system:elicitation_complete`、`system:post_turn_summary`、`system:compact_boundary`、`system:session_state_changed`、`system:hook_started` 与 `system:hook_progress` / `system:hook_response` 事件，再输出规范化后的连接/会话摘要
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
- 当前 `server` 已实现最小监听、`POST /sessions`、`GET /sessions?resume=`、`GET /sessions/{sessionId}`、`DELETE /sessions/{sessionId}`、`/ws/{sessionId}` ready/control/message stream，以及单实例 lockfile（启动写入、重复启动拦截、退出清理）+ session index 持久化；当前最小 lifecycle 状态已覆盖 `starting -> running -> detached -> stopped`，并补齐了最小 backend process lifecycle：session 首次 attach 会拉起真实 backend 子进程、detach/resume 期间保持存活、shutdown 后写回 `backend_status=stopped`；同时已补最小 tool execution / permission bridge，并可在同一 websocket 上连续完成 2 轮 `user -> can_use_tool(control_request) -> control_response(updatedInput) -> control_cancel_request -> system(task_started) -> system(task_progress) -> system(api_retry) -> tool_progress -> rate_limit_event -> stream_event(content_block_delta/text_delta) -> assistant -> tool_use_summary -> result(success) -> system(task_notification) -> system(files_persisted) -> system(local_command_output) -> system(elicitation_complete) -> system(post_turn_summary) -> system(compact_boundary) -> system(session_state_changed:idle) -> system(hook_started) -> system(hook_progress) -> system(hook_response)` 闭环，且额外覆盖 1 轮 `behavior=deny -> result(error_during_execution)`、1 轮 `behavior=max_turns -> result(error_max_turns)` 与 1 轮 `behavior=max_budget_usd -> result(error_max_budget_usd)` 的最小 result:error 分支；连接建立后也会额外发出最小 `system:init`、`auth_status`、`system:status` 与 `keep_alive`，并接受最小 `update_environment_variables` / `control_request:interrupt` / `control_request:initialize` / `control_request:elicitation` / `control_request:hook_callback` / `control_request:channel_enable` / `control_request:set_model` / `control_request:set_permission_mode` / `control_request:set_max_thinking_tokens` / `control_request:mcp_status` / `control_request:get_context_usage` / `control_request:mcp_message` / `control_request:mcp_set_servers` / `control_request:reload_plugins` / `control_request:mcp_authenticate` / `control_request:mcp_oauth_callback_url` / `control_request:mcp_reconnect` / `control_request:mcp_toggle` / `control_request:seed_read_state` / `control_request:rewind_files` / `control_request:cancel_async_message` / `control_request:stop_task` / `control_request:apply_flag_settings` / `control_request:get_settings` / `control_request:generate_session_title` / `control_request:side_question` / `control_request:set_proactive` / `control_request:remote_control` / `control_request:end_session` 成功或兼容错误响应；其中 `update_environment_variables` 当前只校验 `variables` 为 object/map 形状并继续流，不实现真实 structuredIO、环境变量注入、backend 进程环境刷新或任何持久化副作用；`error_max_turns` 当前也只是最小 envelope-compatible stub：只根据显式 `behavior=max_turns` 直接返回兼容 `result{subtype=error_max_turns}`，不实现真实 maxTurns 调度、turn budget 统计、structured-output retries 或预算控制；`error_max_budget_usd` 当前同样只是最小 envelope-compatible stub：只根据显式 `behavior=max_budget_usd` 直接返回兼容 `result{subtype=error_max_budget_usd}`，不实现真实美元预算统计、预算阈值治理或任何花费控制；`initialize` 当前只返回最小 schema-compatible stub：`commands=[]`、`agents=[]`、`output_style=text`、`available_output_styles=[text]`、`models=[]`、`account` 最小占位信息与 `pid`，不实现真实 hooks/sdkMcpServers/agents/systemPrompt/bootstrap；`elicitation` 当前也仅返回稳定 stub `action=cancel`，明确表示 direct-connect 只验证 control request/response 兼容面，不实现真实 MCP user-input collection / form / URL bridge；`hook_callback` 当前同样只返回空 success stub，用于验证 `callback_id/input/tool_use_id` 形状可被 direct-connect 接受，不实现真实 hook callback 注册、路由或副作用执行；`channel_enable` 当前走稳定 success stub，仅回显请求里的 `serverName` 以验证 envelope 兼容面，不实现真实 channel registry、marketplace plugin 检测、notification handler 注册或 channel message routing；`mcp_authenticate` 当前也仅做最小 OAuth envelope stub：会读取 `serverName`，对未知 server 返回 `Server not found: ...`，对 `stdio` server 返回不支持认证错误，对 `http/sse` stub server 返回 `requiresUserAction=true` + 固定 `authUrl`；`mcp_oauth_callback_url` 当前会读取 `serverName` 与 `callbackUrl`，若没有 active OAuth flow 返回 `No active OAuth flow for server: ...`，若 callback URL 缺少 `code/error` 参数返回固定兼容错误，若命中最小 active flow 且 URL 合法则返回空 success；但不会真正提交 callback、等待 token exchange、存 token、刷新凭据、更新动态 tool 状态或做真实 reconnect；`mcp_set_servers` 当前走稳定空配置兼容面并返回 `added=[]/removed=[]/errors={}`，`reload_plugins` 返回稳定最小 `commands/agents/plugins/mcpServers=[] + error_count=0`，`mcp_reconnect` 走固定 `serverName` success 兼容面，`mcp_toggle` 走固定 `serverName+enabled=true` success 兼容面，`seed_read_state` 按上游口径对 ENOENT 等情况忽略但仍返回 success，`rewind_files` 则走稳定的 `dry_run` 兼容面并返回固定最小 `canRewind/filesChanged/insertions/deletions` payload 供 CLI 校验；`stop_task` 当前走最小 `task_id` success 兼容面，仅验证 direct-connect control request/response 闭环；`apply_flag_settings` 当前按上游最小 `settings: record` success 兼容面实现，不扩展真实 flag 持久化；`get_settings` 当前返回最小兼容 payload：`effective={}`、`sources=[]`、`applied={model:\"claude-sonnet-4-5\", effort:null}`；`generate_session_title` 当前返回稳定标题 `title=\"Direct Connect Session\"`，仅验证 control request/response 闭环；`side_question` 当前按上游最小 `question -> response` 兼容面实现，返回稳定 `response=\"Direct Connect Side Answer\"`；`set_proactive` 因 `controlSchemas.ts` 无定义，本轮按 `print.ts` 分支口径实现最小 `{ enabled: boolean } -> success` 闭环；`remote_control` 也因 `controlSchemas.ts` 无定义，本轮按 `print.ts` 分支口径实现稳定 stub：`enabled=true` 返回最小 `session_url/connect_url/environment_id` 并发出 `system:bridge_state{state=connected,detail=\"stub remote control enabled\"}`，`enabled=false` 返回 success、清理 stub 状态并发出 `system:bridge_state{state=disconnected,detail=\"stub remote control disabled\"}`；这里的 `bridge_state` 仅是 stub 状态回显，不伪装成真实 bridge lifecycle 已接入；`max_sessions` 现已生效：上限内允许创建多个 session，超额新建/恢复会直接返回 `429 max sessions reached`，已存在的 live session 仍可 resume，而 `DELETE /sessions/{sessionId}` 会显式 stop backend 并释放容量；session inspect endpoint 现可直接读取 `backend_status/backend_pid/backend_started_at/backend_stopped_at`；当前下一缺口切到其它 message 类型 / 更丰富 state machine
- 当前 `ssh` 只实现最小入口与参数兼容面，尚未接入真实远端 probe/deploy、SSH 隧道、auth proxy 或 remote session lifecycle
- 当前 `open` 已实现最小 `POST /sessions` + `GET /sessions?resume=` reconnect + `DELETE /sessions/{sessionId}` stop/cleanup + websocket ready/control/message 校验链路，`--print` 会先发送并校验 1 条最小 `update_environment_variables{variables}`，再在同一 websocket 上连续验证 2 轮 `user -> can_use_tool -> control_response(updatedInput) -> control_cancel_request -> system(task_started) -> system(task_progress) -> system(api_retry) -> tool_progress -> rate_limit_event -> stream_event(content_block_delta/text_delta) -> assistant -> tool_use_summary -> result(success) -> system(task_notification) -> system(files_persisted) -> system(local_command_output) -> system(elicitation_complete) -> system(post_turn_summary) -> system(compact_boundary) -> system(session_state_changed:idle) -> system(hook_started) -> system(hook_progress) -> system(hook_response)`，并额外验证 1 轮 `behavior=deny -> result(error_during_execution)`、1 轮 `behavior=max_turns -> result(error_max_turns)` 与 1 轮 `behavior=max_budget_usd -> result(error_max_budget_usd)` 的最小 result:error 分支；同时也会校验 `system:init`、`auth_status`、`system:status`、`keep_alive`、`interrupt -> control_response`、`initialize -> control_response`、`elicitation -> control_response`、`hook_callback -> control_response`、`channel_enable -> control_response`、`set_model -> control_response`、`set_permission_mode -> control_response`、`set_max_thinking_tokens -> control_response`、`mcp_status -> control_response`、`get_context_usage -> control_response`、`mcp_message -> control_response`、`mcp_set_servers -> control_response`、`reload_plugins -> control_response`、`mcp_authenticate -> control_response`、`mcp_oauth_callback_url -> control_response`、`mcp_reconnect -> control_response`、`mcp_toggle -> control_response`、`seed_read_state -> control_response`、`rewind_files -> control_response`、`cancel_async_message -> control_response`、`stop_task -> control_response`、`apply_flag_settings -> control_response`、`get_settings -> control_response`、`generate_session_title -> control_response`、`side_question -> control_response`、`set_proactive -> control_response`、`remote_control -> control_response`、`end_session -> control_response` 与 `GET /sessions/{sessionId}` 的 `backend_status/backend_pid`；输出中现包含 `validated_turns=2` / `multi_turn_validated=true` / `system_validated=true` / `auth_validated=true` / `status_validated=true` / `keep_alive_validated=true` / `update_environment_variables_validated=true` / `control_cancel_validated=true` / `task_started_validated=true` / `task_progress_validated=true` / `task_notification_validated=true` / `files_persisted_validated=true` / `api_retry_validated=true` / `local_command_output_validated=true` / `elicitation_validated=true` / `hook_callback_validated=true` / `channel_enable_validated=true` / `elicitation_complete_validated=true` / `stream_content_validated=true` / `tool_progress_validated=true` / `rate_limit_validated=true` / `tool_use_summary_validated=true` / `post_turn_summary_validated=true` / `compact_boundary_validated=true` / `session_state_changed_validated=true` / `hook_started_validated=true` / `hook_progress_validated=true` / `hook_response_validated=true` / `interrupt_validated=true` / `initialize_validated=true` / `set_model_validated=true` / `set_permission_mode_validated=true` / `set_max_thinking_tokens_validated=true` / `mcp_status_validated=true` / `get_context_usage_validated=true` / `mcp_message_validated=true` / `mcp_set_servers_validated=true` / `reload_plugins_validated=true` / `mcp_authenticate_validated=true` / `mcp_oauth_callback_url_validated=true` / `mcp_reconnect_validated=true` / `mcp_toggle_validated=true` / `seed_read_state_validated=true` / `rewind_files_validated=true` / `rewind_files_can_rewind=true` / `cancel_async_message_validated=true` / `stop_task_validated=true` / `apply_flag_settings_validated=true` / `get_settings_validated=true` / `generate_session_title_validated=true` / `side_question_validated=true` / `set_proactive_validated=true` / `bridge_state_validated=true` / `remote_control_validated=true` / `end_session_validated=true` / `result_validated=true` / `result_error_validated=true` / `result_error_max_turns_validated=true` / `result_error_max_budget_usd_validated=true` / `permission_denied_validated=true`，以及最小 permission bridge / tool execution 闭环（`permission_validated=true`、`tool_execution_validated=true`）；其中 `update_environment_variables` 当前也只是最小 envelope-compatible stub：仅验证 `variables` 为 object/map 并继续流，不会做真实 structuredIO、环境变量注入、backend 进程环境刷新或持久化；`error_max_turns` 也只是最小 envelope-compatible stub：仅验证 `result{subtype=error_max_turns}` 兼容面，不会执行真实 maxTurns 调度、turn budget 统计、structured-output retries 或预算治理；`error_max_budget_usd` 也只是最小 envelope-compatible stub：仅验证 `result{subtype=error_max_budget_usd}` 兼容面，不会执行真实美元预算统计、预算阈值治理或任何花费控制；命中 `max_sessions` 时现在会把 `429 + max sessions reached` 明确透传给 CLI，`--stop-session` 也会回显 `stopped/backend_status/backend_stopped_at`；但 `initialize` 仍是稳定 success stub，不会真实应用 hooks/sdkMcpServers/systemPrompt/agents/bootstrap，`elicitation` 也仍是固定 `action=cancel` stub，不会接真实用户输入桥接，`hook_callback` 也仍是空 success stub，不会触发真实 hook callback 执行，`channel_enable` 也仍仅校验 `serverName` echo，不会注册真实 channel / plugin / notification handler，`mcp_authenticate` 也仍只校验 error/success envelope，不会真正执行 OAuth flow、打开浏览器、写 token 或更新真实认证状态，`mcp_oauth_callback_url` 也仍只校验 active flow 和 callback URL 参数，不会真正提交 callback、等待 token exchange 或更新真实动态工具状态，`remote_control` 与 `bridge_state` 也仍是 stub；整体仍未接入完整 headless/connect runner与更丰富的 message/state 类型
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
# `open --print` 还会包含 `system_validated=true` / `auth_validated=true` / `status_validated=true` / `keep_alive_validated=true` / `update_environment_variables_validated=true` / `control_cancel_validated=true` / `task_started_validated=true` / `task_progress_validated=true` / `task_notification_validated=true` / `files_persisted_validated=true` / `api_retry_validated=true` / `local_command_output_validated=true` / `elicitation_validated=true` / `hook_callback_validated=true` / `channel_enable_validated=true` / `elicitation_complete_validated=true` / `stream_content_validated=true` / `tool_progress_validated=true` / `rate_limit_validated=true` / `tool_use_summary_validated=true` / `message_validated=true` / `validated_turns=2` / `multi_turn_validated=true` / `result_validated=true` / `result_error_validated=true` / `result_error_max_turns_validated=true` / `result_error_max_budget_usd_validated=true` / `control_validated=true` / `permission_validated=true` / `permission_denied_validated=true` / `session_state_changed_validated=true` / `tool_execution_validated=true` / `interrupt_validated=true` / `initialize_validated=true` / `set_model_validated=true` / `set_permission_mode_validated=true` / `set_max_thinking_tokens_validated=true` / `mcp_status_validated=true` / `get_context_usage_validated=true` / `mcp_message_validated=true` / `mcp_set_servers_validated=true` / `reload_plugins_validated=true` / `mcp_authenticate_validated=true` / `mcp_oauth_callback_url_validated=true` / `mcp_reconnect_validated=true` / `mcp_toggle_validated=true` / `seed_read_state_validated=true` / `rewind_files_validated=true` / `rewind_files_can_rewind=true` / `cancel_async_message_validated=true` / `stop_task_validated=true` / `apply_flag_settings_validated=true` / `get_settings_validated=true` / `generate_session_title_validated=true` / `side_question_validated=true` / `set_proactive_validated=true` / `bridge_state_validated=true` / `remote_control_validated=true` / `end_session_validated=true`
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
