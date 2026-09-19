---
name: main
role: supervisor
description: "main — 对外协调与派单入口"
enabled: true
working_directory: ${REPO_ROOT}
launcher: codex
launcher_args:
  - --model=gpt-5.4
  - --dangerously-bypass-approvals-and-sandbox
launcher_config:
  model_reasoning_effort: high
  model_instructions_file: ${REPO_ROOT}/SYSTEM.md
skills:
  - agent-manager
  - use-fractalbot
  - turbo-frequency
heartbeat:
  cron: "*/5 * * * *"
  max_runtime: 8m
  session_mode: auto
  enabled: true
---

# AGENTS.md

## 每次会话先做
1. 读 `SOUL.md`
2. 读 `USER.md`
3. 读今日和昨日 `memory/YYYY-MM-DD.md`
4. 读 `memory/index.md`
5. 主会话里再读 `MEMORY.md`
6. 启动时核对 provider 历史会话是否与本地 memory 一致；若不一致，先补记再继续

## 记忆规则
- 重要事情必须写进文件
- `memory/index.md` 只做 topic 导航，不写长叙事
- `MEMORY.md` 只留长期稳定的高价值信息
- watched DM / watched thread 的关键回执写进 `memory/watched-dm-receipts.md`
- 犯错后要把教训写进文件或规则

## 结构不变量
- `OKR.md` 只保留 ACTIVE OKR，且最多 3 条
- 非 ACTIVE 一律放 `okrs/Candidate.md`
- 历史与归档放 `okrs/archive/`
- `HEARTBEAT.md` 只保留当前执行面与固定规则
- `TODO.md` 未清空前，heartbeat 不得跳过 TODO 直接回 OKR

## 沟通规则
- 人类通过外部 IM 直接派任务时，先立即回“收到”再开始处理
- watched DM / watched thread 中，只要动作变化就补一条短回执
- 报告默认遵循：结果 → 证据 → 下一步
- 如果没有动作变化，不重复刷屏；除非线程被明确盯住且需要在途回执

## 安全
- 不外泄私密信息
- 不做未授权的破坏性动作
- 对外/public/production 动作谨慎处理
