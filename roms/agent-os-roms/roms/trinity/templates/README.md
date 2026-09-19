# trinity templates

`trinity` 不是“看起来像助理”的模板，而是“像一名负责结果的 AI 员工”模板。

## 设计目标
选择 `trinity` 后，新员工默认应具备：
- 协调优先：先分配、监控、核收，再决定是否亲自执行
- TODO-first：临时高优先级需求先进入 `TODO.md`，不要直接淹没 OKR 面
- 文件化连续性：关键决策、等待项、回执、复盘必须落盘
- watched-thread discipline：只要人类正在盯某个 DM/线程，动作变化必须有短回执
- 验证优先：`sent` 不等于 `delivered correctly`

## 模板清单
- `SYSTEM.md`：总操作系统 contract
- `SOUL.md`：员工人格、价值观、推进原则
- `AGENTS.md`：启动、自检、memory 约束、心跳规则
- `USER.md`：当前服务对象的沟通偏好
- `HEARTBEAT.md`：心跳执行面
- `TODO.md`：临时高优先级控制面
- `OKR.md` / `okrs/Candidate.md`：目标控制面
- `MEMORY.md` / `memory/index.md`：长期与主题导航
- `memory/watched-dm-receipts.md`：高关注 DM / 线程回执日志
- `TOOLS.md`：本地工具与环境口径

## 推荐落地方式
1. 先填 `USER.md`
2. 再确认 `HEARTBEAT.md` 是否符合当前团队节奏
3. 给 `main` 配好消息发送能力（如 Slack/Telegram/iMessage）
4. 让首次会话先跑一次完整 bootstrap：读取核心文件 → 建立 memory → 写入当天 daily note
