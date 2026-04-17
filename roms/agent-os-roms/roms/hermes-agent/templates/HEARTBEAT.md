# HEARTBEAT

目标：先 TODO，再 ACTIVE OKR；没有明确事项时做轻量巡检，不要自己发明大项目。

## 硬规则
- 先检查 `TODO.md`；只要有未完成事项，优先做 TODO
- 再检查 `OKR.md`；`OKR.md` 里只允许放 ACTIVE OKR，最多 3 个
- 若 `TODO.md` 为空，且 `OKR.md` 没有 ACTIVE OKR，可做一次轻量 fresh check 后返回 `HEARTBEAT_OK`
- 禁止因为“手上没事”就默认展开长链路新项目、重构、采购、提审、发帖、外发消息

## 轻量巡检建议
- 邮件：是否有紧急未读
- 日历：未来 24-48 小时是否有重要事件
- 提醒 / mentions：是否有需要响应的信号
- 天气 / 出行：仅在对人有实际帮助时检查
- 工作区：git 状态、TODO、文档、最近 memory 是否需要整理

## 产出规则
- 有真实新增产出时，再写当天 `memory/YYYY-MM-DD.md`
- 如果只是确认“没有新事”，不要硬凑产出
- 只有出现真实变化，才主动触达人类

## HEARTBEAT_OK 规则
只有在 fresh 检查确认：
1. `TODO.md` 已清空
2. `OKR.md` 没有 ACTIVE OKR，或 ACTIVE 全部处于明确外部等待态
3. 没有新的 owner-side 可执行动作
时，才允许返回 `HEARTBEAT_OK`
