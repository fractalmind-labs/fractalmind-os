# claude-code → claude-code-go 命令面对照（v0.1）

更新时间：2026-04-05 CST  
当前分支：`feat/bootstrap-cli-skeleton`

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
- `api payload`
- `api ping`

### 已实现的支撑能力
- 本地 `auth.json` 写入/读取/删除
- `CLAUDE_CODE_API_KEY` / `ANTHROPIC_API_KEY` / `auth.json` 三层 token 来源解析
- `api_key_source` 可见化
- `api_base / model / max_tokens` 默认值 + 环境变量覆盖
- `api payload|ping --api-base/--model/--max-tokens` 命令级覆盖
- `/v1/messages` 最小请求构造与真实 HTTP 命中验证

## 3. 未实现但已识别的高优先级命令

### P1：应尽快补齐
- `doctor`
  - 原因：源仓库有独立顶层命令，且对 CLI 可用性/环境自检价值高
  - 建议最小实现：检查配置目录、auth 文件、token 来源、API base、网络 reachability
- `install [target]`
  - 原因：源仓库显式提供安装入口，Go 重写也需要安装/升级路径
  - 建议最小实现：先输出当前平台、目标版本、安装目标路径，必要时做 dry-run
- `update`
  - 原因：与 install 成对出现，是 CLI 生命周期管理的基础命令面
  - 建议最小实现：先做版本检查/stub，不急着实现自动升级

### P2：后续再补
- `mcp`
- `plugin`
- `agents`
- `auto-mode`
- `assistant`
- `server`
- `ssh`
- `open`
- `setup-token`

### 明确不放在首轮原型
- ant-only：`up` / `rollback` / `log` / `error` / `export` / `task`
- bridge / remote-control / IDE / TUI 全量行为

## 4. 当前差异总结

### 已对齐的最小主路径
- 有可构建的 Go 二进制入口
- 有 auth 基础命令组
- 有 config 可见化
- 有最小请求构造和真实接口命中证据
- 有本地凭证持久化闭环

### 仍缺的关键用户向命令
- `doctor`
- `install`
- `update`

这意味着当前原型已经具备“可启动 + 可鉴权 + 可发最小请求”的骨架，但还不具备“可自诊断 + 可安装/升级”的基本 CLI 运营能力。

## 5. 下一优先级结论

### 下一步要补的高频子命令：`doctor`

选择理由：
1. 在源仓库里是明确的顶层命令，不是边缘能力
2. 比 `install/update` 风险更低，不涉及实际升级动作
3. 能直接复用当前已实现的配置/Auth/API base 检查逻辑
4. 一旦落地，可作为后续 install/update/mcp 排障入口

### 建议的最小 `doctor` 输出
- config 目录是否存在
- auth 文件是否存在
- token 来源（env / auth_file / none）
- API base
- `/v1/messages` reachability（可先只做轻量请求或探活）
- 当前 model / max_tokens

## 6. 结论

`claude-code-go` 当前已从空仓推进到“最小可运行 CLI 原型”，但仍处于 **KR2 进行中**。  
如果按“用户最容易感知价值 + 最低实现风险”排序，下一步最应该补的是 **`doctor`**，不是更重的 `mcp/plugin/server`。
