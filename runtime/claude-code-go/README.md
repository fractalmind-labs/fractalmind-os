# claude-code-go

本地 Go CLI 原型，当前用于快速对齐 `claude-code` 的最小命令入口、鉴权持久化与 Anthropic 兼容请求链路。

## 当前已实现

- `auth login --api-key <token>`：写入本地 `auth.json`
- `auth status`：展示当前登录态、auth 文件路径、API base、token 来源
- `auth logout`：删除本地 `auth.json`
- `config show`：打印当前配置解析结果（含 `model/max_tokens`）
- `api payload`：打印最小 `/v1/messages` 请求模板
- `api ping`：向配置的 Anthropic 兼容接口发起最小真实请求

## 当前 token 解析优先级

1. `CLAUDE_CODE_API_KEY`
2. `ANTHROPIC_API_KEY`
3. `auth.json`（默认位于 `~/Library/Application Support/claude-code-go/auth.json`）

## 当前请求参数配置方式

默认值：
- `api_base=https://api.anthropic.com`
- `model=claude-sonnet-4-5`
- `max_tokens=32`

可通过两种方式覆盖：

1. 环境变量
   - `CLAUDE_CODE_API_BASE`
   - `CLAUDE_CODE_MODEL`
   - `CLAUDE_CODE_MAX_TOKENS`
2. 命令参数
   - `--api-base`
   - `--model`
   - `--max-tokens`

## 本地验证样例

```bash
go build ./cmd/claude-code-go
./claude-code-go auth login --api-key 'sk-ant-demo-1234567890'
./claude-code-go auth status
./claude-code-go api payload --model claude-3-5-haiku-latest --max-tokens 8
./claude-code-go auth logout
```

## 当前限制

- 仍是最小原型，尚未接入完整 `claude-code` 命令面
- `api ping` 目前只验证最小请求链路，不代表完整业务行为已对齐
