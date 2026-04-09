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
- `server` 的最小直连服务链路：解析 `--port/--host/--auth-token/--unix/--workspace/--idle-timeout/--max-sessions` 官方参数，真实监听 HTTP / Unix socket，并响应最小 `POST /sessions` + `GET /sessions?resume=` + `GET /sessions/{sessionId}` + `/ws/{sessionId}` ready/control/message stream，同时维护单实例 lockfile + session index；session 首次 attach 会拉起最小 backend 子进程，detach/resume 期间保持存活，inspect endpoint 会暴露 `backend_status/backend_pid/backend_started_at`；当前还会在 websocket 中发出最小 `system:init`、`auth_status`、`system:status`、`keep_alive`，在权限请求窗口内额外发出 `system:session_state_changed{state=running}` 与 `system:session_state_changed{state=requires_action}`，随后发出 `can_use_tool` 权限请求，并接受最小 `update_environment_variables{variables}` message；在 `control_request:set_permission_mode` 成功后还会补发 1 条最小 live `system:status{status:"running", permissionMode:<new-mode>}`；这条 live status 仅是最小 envelope-compatible stub，不实现完整 app state / external metadata / UI subscription。在收到 `updatedInput` 后先发 `control_cancel_request`、再发 `system(task_started/task_progress/api_retry)`，最后把该输入交给 backend 执行；同一 websocket 已可连续完成 2 轮 `tool_progress -> rate_limit_event -> stream_event(message_start) -> stream_event(content_block_delta/text_delta) -> stream_event(content_block_delta/thinking_delta) -> stream_event(content_block_delta/signature_delta) -> stream_event(content_block_start/tool_use) -> stream_event(content_block_delta/input_json_delta) -> stream_event(content_block_stop/tool_use) -> stream_event(message_delta) -> stream_event(message_stop) -> streamlined_text -> assistant(thinking+tool_use+text+stop_reason+usage) -> tool_use_summary -> streamlined_tool_use_summary -> attachment(structured_output) -> result(success) -> prompt_suggestion -> system(task_notification) -> system(files_persisted) -> system(local_command_output) -> system(elicitation_complete) -> system(post_turn_summary) -> system(compact_boundary) -> system(session_state_changed:idle) -> system(hook_started) -> system(hook_progress) -> system(hook_response)` 最小闭环，并补了 `result{subtype=success|error_during_execution|error_max_turns|error_max_budget_usd|error_max_structured_output_retries, fast_mode_state:"off"}` 的最小官方兼容 shape；assistant finalize path 当前只保证最小官方兼容 envelope：先发 `message_start.message.usage` 作为 usage bootstrap，再用 `message_delta` 回写 `stop_reason="end_turn"` 与最终零值 `usage`，最后补 1 条 `message_stop` 作为流终止标记；同时 success path 新增 1 条最小 top-level `attachment{type:"structured_output",data:{text:<same result>}}` 与 `result.structured_output` 保持同形；但仍不实现真实 token accounting、多 block 聚合、planner 或 richer render
- 本轮进一步把四类 error `result` 的 `usage` 收紧成与上游 `EMPTY_USAGE` 对齐的零值 object；该字段当前只做 shape 对齐，不实现真实 token accounting、cost aggregation 或 iteration tracking。
- 本轮进一步把四类 error `result` 的 `permission_denials` 收紧成官方兼容 shape：deny 分支保留现有非空 denial entry，其余三类 error 统一返回空数组 `[]`；该字段当前只做 shape 对齐，不实现真实 permission analytics 或 richer denial recovery。
- 本轮进一步把四类 error `result` 的 `modelUsage` 收紧成官方兼容 shape：统一返回 `modelUsage:{"claude-sonnet-4-5": {inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD, contextWindow}}` 的全 0 stub；该字段当前只做 shape 对齐，不实现真实 cost/model accounting。
- `ssh <host> [dir]` 的最小入口链路：解析 `host/dir`、`--permission-mode`、`--dangerously-skip-permissions`、`--local`（支持 flags-before-host），并输出规范化后的连接摘要
- `open <cc-url>` 的最小直连链路：解析 `cc://` / `cc+unix://` connect URL、`-p|--print [prompt]`、`--output-format`、`--resume-session <sessionId>`、`--stop-session <sessionId>`；默认发起最小 `POST /sessions`，也支持通过 `GET /sessions?resume=` 基于持久化 session index 恢复指定 session，或通过 `DELETE /sessions/{sessionId}` 显式 stop/cleanup 单个 session，并进一步校验 ready/control/message websocket stream；`--print` 现额外校验 `thinking_delta_validated`、`thinking_signature_validated`、`tool_use_block_start_validated`、`tool_use_delta_validated`、`tool_use_block_stop_validated`、`assistant_message_start_validated`、`assistant_message_delta_validated`、`assistant_message_stop_validated`、`assistant_thinking_validated`、`assistant_tool_use_validated`、`assistant_stop_reason_validated` 与 `assistant_usage_validated` 十二个摘要位，分别对应 `stream_event:thinking_delta`、`stream_event:signature_delta`、`stream_event:content_block_start:tool_use`、`stream_event:input_json_delta`、`stream_event:content_block_stop:tool_use`、`stream_event:message_start`、`stream_event:message_delta`、`stream_event:message_stop`、`assistant:thinking`、`assistant:tool_use`、`assistant:stop_reason` 与 `assistant:usage`。这条 assistant finalize path 只保证最小 official-compatible shape：assistant 原始消息可含 `tool_use` block，stream 会先出现 `message_start.message.usage`，最终消息再回写稳定 `stop_reason/usage`；同样不实现真实 JSON delta 拼接、真实 token accounting、完整 transcript rebuild 或 richer render。
- `open --print` 本轮还新增统一 `result_error_permission_denials_validated/result_error_permission_denials_event` 摘要位，只验证四类 error result 的 `permission_denials` shape 是否稳定，不扩展真实 permission analytics 或 richer denial recovery。
- `open --print` 本轮还新增统一 `result_error_model_usage_validated/result_error_model_usage_event` 摘要位，只验证四类 error result 的 `modelUsage` shape 是否稳定，不扩展真实 cost/model accounting。
- 本轮 `open --print` 还新增了统一 `result_error_usage_validated/result_error_usage_event` 摘要位，只验证四类 error result 的 `usage` 是否保持 `EMPTY_USAGE` 同形零值 shape，不扩展真实 token/cost/iterations 统计。

- direct-connect user message 的 `timestamp` 当前只补最小稳定 shape：compact summary 与 replayed plain user / queued_command / tool_result / local-command stdout breadcrumb / local-command stderr breadcrumb 都要求非空 `timestamp`，并在 `open --print` 摘要中暴露对应 `*_timestamp_validated/event`；不扩展为真实 transcript timeline、ordering 或 provenance 还原

- fresh live direct-connect 现额外补最小 initial user ACK replay：只对首条 live user text 发 1 条 `{type:"user", isReplay:true, parent_tool_use_id:null, uuid, timestamp, session_id, message}` ACK 回放，并在 `open --print` 摘要中暴露 `acked_initial_user_replay_validated/event`；不扩展为多条队列、完整 transcript rebuild 或 timeline 排序增强

## 3. 未实现但已识别的高优先级命令

### Wave 1：正在补齐
- direct-connect 的更丰富 `message/system` 子类型（当前已补到 `streamlined_text/streamlined_tool_use_summary/prompt_suggestion/session_state_changed:requires_action/update_environment_variables/result:error_max_turns/result:error_max_budget_usd/result:error_max_structured_output_retries/interrupt/initialize/channel_enable/mcp_authenticate/mcp_oauth_callback_url/set_model/set_permission_mode/set_max_thinking_tokens/mcp_status/get_context_usage/mcp_message/mcp_set_servers/reload_plugins/mcp_reconnect/mcp_toggle/seed_read_state/rewind_files/cancel_async_message/stop_task/apply_flag_settings/get_settings/generate_session_title/side_question/set_proactive/remote_control/bridge_state/end_session/status(compacting->null)/user:isReplay/user:tool_result:isReplay/assistant:replay/assistant:thinking/assistant:tool_use/stream_event:thinking_delta/stream_event:signature_delta/stream_event:content_block_start:tool_use/stream_event:input_json_delta/stream_event:content_block_stop:tool_use/system:compact_boundary:replay/user:local_command_stdout:isReplay/user:local_command_stderr:isReplay` 兼容 path；下一步聚焦其它剩余高频 message 形状）

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
- `server/open` 已具备最小 websocket ready/control/message 闭环，且 server 已补单实例 lockfile + session index + reconnect + detached-state + backend process lifecycle + 最小 tool execution / permission bridge；当前 `GET /sessions/{sessionId}` 可直接读到 `starting/running/detached/stopped` 与 `backend_status/backend_pid`，`resume` 期间可复用同一 live backend pid。最新一轮又在现有 success path 上补了最小 official-compatible assistant finalize lifecycle：server 额外发出 `message_start{message.usage}`、`message_delta{delta.stop_reason,usage}` 与 `message_stop`，assistant 最终消息同步保留 `tool_use` block 并回写 `stop_reason/usage`，open 摘要则显式落 `assistant_message_start_validated=true / assistant_message_delta_validated=true / assistant_message_stop_validated=true / assistant_stop_reason_validated=true / assistant_usage_validated=true`；该 path 仅保证最小 shape 对齐，不实现真实 token accounting、planner 或 richer UI 语义。当前又额外补了最小 `attachment:structured_output`：server 在 success path 发出 top-level `attachment{type:"structured_output",data:{text:<same result>}}`，`open --print` 新增 `structured_output_attachment_validated=true / structured_output_attachment_event=attachment:structured_output`，并与既有 `result.structured_output` 同时校验。本轮继续补了最小 `attachment:queued_command`、`attachment:task_status`、`attachment:task_reminder`、`attachment:todo_reminder`、`attachment:critical_system_reminder`、`attachment:output_style`、`attachment:compaction_reminder`、`attachment:context_efficiency`、`attachment:auto_mode`、`attachment:auto_mode_exit`、`attachment:plan_mode`、`attachment:plan_mode_exit`、`attachment:plan_mode_reentry`、`attachment:date_change`、`attachment:ultrathink_effort`、`attachment:deferred_tools_delta`、`attachment:agent_listing_delta`、`attachment:mcp_instructions_delta`、`attachment:companion_intro`、`attachment:token_usage`、`attachment:output_token_usage`、`attachment:verify_plan_reminder`、`attachment:current_session_memory`、`attachment:nested_memory`、`attachment:teammate_shutdown_batch` 与 `attachment:bagel_console`：server 在 `system(task_notification)` 后依次发出 `attachment{type:"queued_command",prompt,commandMode:"task-notification"}`、`attachment{type:"task_status",taskId,taskType,status,description,deltaSummary,outputFilePath}`、`attachment{type:"task_reminder",content:[{id,status,subject}],itemCount}`、`attachment{type:"todo_reminder",content:[{content,status,activeForm}],itemCount}`，并在 `system(post_turn_summary)` 后依次发出 `attachment{type:"critical_system_reminder",content}`、`attachment{type:"output_style",style}`、`attachment{type:"compaction_reminder"}`、`attachment{type:"context_efficiency"}`、`attachment{type:"auto_mode",reminderType:"full"}`、`attachment{type:"auto_mode_exit"}`、`attachment{type:"plan_mode",reminderType:"full",planFilePath,planExists:false,isSubAgent:false}`、`attachment{type:"plan_mode_exit",planFilePath,planExists}`、`attachment{type:"plan_mode_reentry",planFilePath}`、`attachment{type:"date_change",newDate}`、`attachment{type:"ultrathink_effort",level:"high"}`、`attachment{type:"deferred_tools_delta",addedNames,addedLines,removedNames}`、`attachment{type:"agent_listing_delta",addedTypes,addedLines,removedTypes,isInitial,showConcurrencyNote}`、`attachment{type:"mcp_instructions_delta",addedNames,addedBlocks,removedNames}`、`attachment{type:"companion_intro",name,species}`、`attachment{type:"token_usage",used,total,remaining}`、`attachment{type:"output_token_usage",turn,session,budget}`、`attachment{type:"verify_plan_reminder"}`、`attachment{type:"current_session_memory",content,path,tokenCount}`、`attachment{type:"nested_memory",path,content,displayPath}` 与 `attachment{type:"teammate_shutdown_batch",count}`；`open --print` 新增 `queued_command_validated=true / queued_command_event=attachment:queued_command`、`task_status_attachment_validated=true / task_status_attachment_event=attachment:task_status`、`task_reminder_attachment_validated=true / task_reminder_attachment_event=attachment:task_reminder`、`todo_reminder_attachment_validated=true / todo_reminder_attachment_event=attachment:todo_reminder`、`critical_system_reminder_validated=true / critical_system_reminder_event=attachment:critical_system_reminder`、`output_style_validated=true / output_style_event=attachment:output_style`、`compaction_reminder_validated=true / compaction_reminder_event=attachment:compaction_reminder`、`context_efficiency_validated=true / context_efficiency_event=attachment:context_efficiency`、`auto_mode_validated=true / auto_mode_event=attachment:auto_mode`、`auto_mode_exit_validated=true / auto_mode_exit_event=attachment:auto_mode_exit`、`plan_mode_validated=true / plan_mode_event=attachment:plan_mode`、`plan_mode_exit_validated=true / plan_mode_exit_event=attachment:plan_mode_exit`、`plan_mode_reentry_validated=true / plan_mode_reentry_event=attachment:plan_mode_reentry`、`date_change_validated=true / date_change_event=attachment:date_change`、`ultrathink_effort_validated=true / ultrathink_effort_event=attachment:ultrathink_effort`、`deferred_tools_delta_validated=true / deferred_tools_delta_event=attachment:deferred_tools_delta`、`agent_listing_delta_validated=true / agent_listing_delta_event=attachment:agent_listing_delta`、`mcp_instructions_delta_validated=true / mcp_instructions_delta_event=attachment:mcp_instructions_delta`、`companion_intro_validated=true / companion_intro_event=attachment:companion_intro`、`token_usage_validated=true / token_usage_event=attachment:token_usage`、`output_token_usage_validated=true / output_token_usage_event=attachment:output_token_usage`、`verify_plan_reminder_validated=true / verify_plan_reminder_event=attachment:verify_plan_reminder`、`current_session_memory_validated=true / current_session_memory_event=attachment:current_session_memory`、`nested_memory_validated=true / nested_memory_event=attachment:nested_memory`、`teammate_shutdown_batch_validated=true / teammate_shutdown_batch_event=attachment:teammate_shutdown_batch` 与 `bagel_console_validated=true / bagel_console_event=attachment:bagel_console`，并要求它们在同 turn 命中；当前只保证固定 `commandMode="task-notification"`、稳定 task-notification XML prompt、`taskType=local_bash`、`status=completed`、稳定 `activeForm`、固定 critical-reminder 文案、固定非默认 `style="explanatory"`、固定 `reminderType="full"`、稳定 `planFilePath=.claude/plan.md`、`planExists=false`、`isSubAgent=false`、`newDate=2026-04-09`、`level="high"`、固定 `addedNames/addedLines/removedNames` 示例值，以及固定 `addedTypes=["explorer"]`、稳定单行 `addedLines`、`removedTypes=[]`、`isInitial=true`、`showConcurrencyNote=true`，还有固定 `addedNames=["chrome"]`、`addedBlocks=["## chrome\\nUse ToolSearch before browser actions."]`、`removedNames=[]`、固定 `name="Mochi"`、`species="otter"`、固定 `used=1024`、`total=200000`、`remaining=198976`、固定 `turn=256`、`session=512`、`budget=1024`、固定 `content="Remember: keep this session focused."`、`path="MEMORY.md"`、`tokenCount=7`、固定 nested-memory payload、固定 `count=2`，以及固定 `errorCount=1`、`warningCount=2`、`sample="bagel: sample warning"` 的最小 envelope，不实现真实 queued-command 队列管理、去重/批处理、richer task lifecycle、todo 管理、reminder 策略、critical-reminder 来源、动态注入策略、settings 读取、default suppression、OUTPUT_STYLE_CONFIG 渲染、feature gate、auto-compact 阈值、auto-mode classifier、turn 节流、sparse/full 轮换、plan-with-auto 状态机、真实 plan mode 生命周期、真实 plan reminder 调度、真实 plan re-entry 状态机、sub-agent plan orchestration、跨午夜 transcript flush、真实 snip pacing、token growth heuristic、richer reminder text、真实关键词触发、思考预算切换、真实 tools diff、scan context、dynamic discovery、真实 agent pool、动态过滤、订阅态判断、真实 MCP 连接池、动态 instructions 合并、断连回收、model/tool gate、真实 companion 开关、历史去重、气泡文案、user-addressed 行为、真实 token accounting、model-specific context window、env gate、动态 remaining 计算、真实 turn/session token accounting、`budget=null` 分支、动态预算计算、真实 memory 文件读取、动态 tokenCount 统计、个性化记忆注入、真实 task_status 折叠、multi-message collapse、真实 bagel console 聚合、日志采样、UI 渲染策略或 verify-plan 触发策略。此前的 `session_state_changed:requires_action`、`streamlined_text`、`streamlined_tool_use_summary`、`result:error_max_turns`、`result:error_max_budget_usd`、`result:error_max_structured_output_retries`、`update_environment_variables`、`control_request:mcp_oauth_callback_url`、`control_request:mcp_authenticate`、`control_request:channel_enable`、`control_request:hook_callback`、`control_request:elicitation`、`system:elicitation_complete`、`system:local_command_output`、`system:api_retry`、`system:files_persisted`、`system:task_started`、`system:task_progress`、`system:task_notification`、`system:session_state_changed`（running -> requires_action -> idle）、`system:post_turn_summary`、`system:compact_boundary`、`system:hook_started`、`system:hook_progress`、`system:hook_response`、multi-session / `max_sessions` guard + 单 session stop/cleanup 仍保持生效。
- 本轮继续补了最小 `attachment:team_context`：server 在 `attachment:bagel_console` 后、`system:compact_boundary` 前发出 `attachment{type:"team_context",agentId,agentName,teamName,teamConfigPath,taskListPath}`；`open --print` 新增 `team_context_validated=true / team_context_event=attachment:team_context`，并要求该 attachment 与其它 allow-turn attachment 同时命中。
- `team_context` 当前只保证固定 `agentId="agent-dev"`、`agentName="dev"`、`teamName="alpha"`、`teamConfigPath=".claude/team.yaml"`、`taskListPath=".claude/tasks.json"` 的最小 envelope，不实现真实 team coordination、mailbox 聚合、任务分发或 UI 渲染策略。
- 本轮继续补了最小 `attachment:teammate_mailbox`：server 在 `attachment:bagel_console` 后、`attachment:team_context` 前发出 `attachment{type:"teammate_mailbox",messages:[{from,text,timestamp,color,summary}]}`；`open --print` 新增 `teammate_mailbox_validated=true / teammate_mailbox_event=attachment:teammate_mailbox`，并要求该 attachment 与其它 allow-turn attachment 同时命中。
- `teammate_mailbox` 当前只保证固定单条消息 `from="team-lead"`、`text="Please pick up the next task."`、`timestamp="2026-04-09T12:00:00Z"`、`color="blue"`、`summary="next task"` 的最小 envelope，不实现真实 mailbox 聚合、格式化、消息去重或 UI 渲染策略。
- 本轮继续补了最小 `attachment:skill_discovery`：server 在 `attachment:team_context` 后、`attachment:dynamic_skill` 前发出 `attachment{type:"skill_discovery",skills:[{name,description,shortId}],signal,source}`；`open --print` 新增 `skill_discovery_validated=true / skill_discovery_event=attachment:skill_discovery`，并要求该 attachment 与其它 allow-turn attachment 同时命中。
- `skill_discovery` 当前只保证固定单条 skill `name="agent-manager"`、`description="Coordinate and track teammate work."`、`shortId="am"`，以及固定 `signal="user_input"`、`source="native"` 的最小 envelope，不实现真实 native/AKI skill search、prefetch、write-pivot detection、ranking 或 feature gate plumbing。
- 本轮继续补了最小 `attachment:dynamic_skill`：server 在 `attachment:skill_discovery` 后、`attachment:skill_listing` 前发出 `attachment{type:"dynamic_skill",skillDir,skillNames,displayPath}`；`open --print` 新增 `dynamic_skill_validated=true / dynamic_skill_event=attachment:dynamic_skill`，并要求该 attachment 与其它 allow-turn attachment 同时命中。
- `dynamic_skill` 当前只保证固定 `skillDir=".codex/skills/agent-manager"`、`skillNames=["agent-manager","use-fractalbot"]`、`displayPath=".codex/skills"` 的最小 envelope，不实现真实动态技能扫描、skill tool 加载或 richer UI 行为。
- 本轮继续补了最小 `attachment:skill_listing`：server 在 `attachment:dynamic_skill` 后、`system:compact_boundary` 前发出 `attachment{type:"skill_listing",content,skillCount,isInitial}`；`open --print` 新增 `skill_listing_validated=true / skill_listing_event=attachment:skill_listing`，并要求该 attachment 与其它 allow-turn attachment 同时命中。
- `skill_listing` 当前只保证固定 `content="agent-manager: Coordinate and track teammate work."`、`skillCount=1`、`isInitial=true` 的最小 envelope，不实现真实 skill catalog 枚举、动态发现、resume suppression 或 richer formatting。
- 本轮继续补了最小 `attachment:nested_memory`：server 在 `attachment:current_session_memory` 后、`attachment:teammate_shutdown_batch` 前发出 `attachment{type:"nested_memory",path,content,displayPath}`；`open --print` 新增 `nested_memory_validated=true / nested_memory_event=attachment:nested_memory`，并要求该 attachment 与其它 allow-turn attachment 同时命中。
- `nested_memory` 当前只保证固定 `path="memory/project.md"`、`displayPath="memory/project.md"` 与最小 `content={path:"memory/project.md",type:"memory_file",content:"Project memory: keep nested context stable."}` 的 envelope，不实现真实 memory 文件扫描、include 解析、LRU dedup 或 richer UI 行为。
- 本轮额外补了最小 `attachment:max_turns_reached`：server 在 `behavior=max_turns` path 先发 `attachment{type:"max_turns_reached",turnCount,maxTurns}`，再发既有 `result{subtype:"error_max_turns"}`；`open --print` 新增 `max_turns_reached_attachment_validated=true / max_turns_reached_attachment_event=attachment:max_turns_reached`，并要求该 attachment 与 `result_error_max_turns_validated=true` 同时命中。
- success `result` 当前继续保留最小 official-compatible `structured_output` shape：server 固定返回 `structured_output:{text:<same result>}`，`open --print` 继续输出 `result_structured_output_validated=true / result_structured_output_event=result:success:structured_output`；新增的 top-level `attachment:structured_output` 只保证 shape 稳定、可验证，不实现上游完整 structured-output tool 语义、schema 驱动重试或 tool bridge。
- success `result` 的 `modelUsage` 本轮也补最小 official-compatible shape 校验：server 固定返回 `modelUsage:{"claude-sonnet-4-5": {inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD, contextWindow}}` 的全 0 stub，`open --print` 新增 `result_model_usage_validated=true / result_model_usage_event=result:success:modelUsage`；该 path 只保证 shape 稳定、可验证，不实现上游完整 cost/model accounting 语义。
- success `result` 的 `permission_denials` 本轮也补最小 official-compatible shape 校验：server 固定返回空数组 `permission_denials:[]`，`open --print` 新增 `result_permission_denials_validated=true / result_permission_denials_event=result:success:permission_denials`；该 path 只保证 shape 稳定、可验证，不实现上游完整 permission analytics 或 richer denial recovery 语义。
- success `result` 的 `usage` 本轮也补最小 official-compatible shape 校验：server 不再返回空 map，而是固定返回与上游 `EMPTY_USAGE` 对齐的零值 usage object，`open --print` 新增 `result_usage_validated=true / result_usage_event=result:success:usage`；该 path 只保证 shape 稳定、可验证，不实现上游完整 token accounting、cost aggregation 或 iteration tracking 语义。
- 更接近官方安装体验的远端版本清单 / release 元数据发现（当前最小实现仅支持显式 `--source-url`）

这意味着当前 Go CLI 已具备“可启动 + 可鉴权 + 可发最小请求 + 最小安装/升级 + agents 配置枚举”的骨架，但距离完整官方体验仍有多块命令面差距。

## 5. 下一优先级结论

### 下一步要补的高频子路径：direct-connect 的更丰富 message / state machine path

选择理由：
1. `server ↔ open` 现在已经形成最小 `/sessions + websocket ready/control/message + lockfile + session index + reconnect + detached-state + backend process lifecycle + system:init + auth_status + system:status + keep_alive + update_environment_variables + system:session_state_changed(running/requires_action/idle) + control_cancel_request + control_request:elicitation + control_request:hook_callback + control_request:channel_enable + control_request:mcp_authenticate + control_request:mcp_oauth_callback_url + system(task_started/task_progress/task_notification/files_persisted/api_retry/local_command_output/elicitation_complete) + tool_progress + rate_limit_event + stream_event(message_start/text_delta/thinking_delta/signature_delta/content_block_start:tool_use/input_json_delta/content_block_stop:tool_use/message_delta/message_stop) + streamlined_text + assistant(thinking+tool_use+text+stop_reason+usage) + tool_use_summary + streamlined_tool_use_summary + attachment(structured_output) + result(success) + prompt_suggestion + result(error_during_execution/error_max_turns/error_max_budget_usd/error_max_structured_output_retries) + system(post_turn_summary) + system(compact_boundary) + system(session_state_changed) + system(hook_started) + system(hook_progress) + system(hook_response)` 闭环，并且 `max_sessions` 容量保护与单 session stop/cleanup 都已补齐
2. 当前下一批真实缺口已转到其它高频 message 形状与更丰富 state machine，而不是 task 三连事件本身
3. 继续沿 direct-connect 状态机主路径推进，比回到已收口的其它子命令组更符合当前 OKR 主路径


当前建议的下一个最小切片：剩余高频 attachment / richer task lifecycle surface
- 理由：`attachment:queued_command` / `attachment:task_status` / `attachment:task_reminder` / `attachment:todo_reminder` / `attachment:compaction_reminder` / `attachment:context_efficiency` / `attachment:auto_mode` / `attachment:auto_mode_exit` / `attachment:plan_mode` / `attachment:plan_mode_exit` / `attachment:plan_mode_reentry` / `attachment:date_change` / `attachment:ultrathink_effort` / `attachment:deferred_tools_delta` / `attachment:agent_listing_delta` / `attachment:mcp_instructions_delta` / `attachment:companion_intro` / `attachment:token_usage` / `attachment:output_token_usage` / `attachment:verify_plan_reminder` / `attachment:current_session_memory` / `attachment:teammate_shutdown_batch` / `attachment:bagel_console` 已补齐，下一批真实缺口会转到其它仍未覆盖的 attachment/message family，而不是继续重复 queued-command / task-family / todo-family / compaction-reminder / context-efficiency / auto-mode / auto-mode-exit / plan-mode / plan-mode-exit / plan-mode-reentry / date-change / ultrathink-effort / deferred-tools-delta / agent-listing-delta / mcp-instructions-delta / companion-intro / token-usage / output-token-usage / verify-plan-reminder / current-session-memory / teammate-shutdown-batch / bagel-console 的最小 shape。
- 理由：`attachment:queued_command` / `attachment:task_status` / `attachment:task_reminder` / `attachment:todo_reminder` / `attachment:compaction_reminder` / `attachment:context_efficiency` / `attachment:auto_mode` / `attachment:auto_mode_exit` / `attachment:plan_mode` / `attachment:plan_mode_exit` / `attachment:plan_mode_reentry` / `attachment:date_change` / `attachment:ultrathink_effort` / `attachment:deferred_tools_delta` / `attachment:agent_listing_delta` / `attachment:mcp_instructions_delta` / `attachment:companion_intro` / `attachment:token_usage` / `attachment:output_token_usage` / `attachment:verify_plan_reminder` / `attachment:current_session_memory` / `attachment:teammate_shutdown_batch` / `attachment:bagel_console` / `attachment:team_context` / `attachment:dynamic_skill` 已补齐，下一批真实缺口会转到其它仍未覆盖的 attachment/message family，而不是继续重复 queued-command / task-family / todo-family / compaction-reminder / context-efficiency / auto-mode / auto-mode-exit / plan-mode / plan-mode-exit / plan-mode-reentry / date-change / ultrathink-effort / deferred-tools-delta / agent-listing-delta / mcp-instructions-delta / companion-intro / token-usage / output-token-usage / verify-plan-reminder / current-session-memory / teammate-shutdown-batch / bagel-console / team-context / dynamic-skill 的最小 shape。
- 最小验收口径：继续沿 `server/open + open --print validated/event + go test/go build + fresh runtime` 的同一验证链路推进，但先把官方仍高频消费、且尚未覆盖的单一路径收紧成 1 个具体子类型。

## 6. 结论

`claude-code-go` 当前已从空仓推进到“最小可运行 CLI + 已通过 1 轮真实 Anthropic-compatible 验证 + 开始按命令面对齐持续补齐”的阶段。  
在老板已明确要求“完全复刻目标所有功能”的前提下，当前主路径应保持为 **按命令面持续补齐**，而不是回到“原型收口”。
