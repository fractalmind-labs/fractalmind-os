# Core file contract

一个合规 Agent OS workspace，v1 至少应包含：
- `SYSTEM.md`
- `SOUL.md`
- `AGENTS.md`
- `USER.md`
- `HEARTBEAT.md`
- `OKR.md`
- `okrs/Candidate.md`
- `memory/YYYY-MM-DD.md`
- `memory/index.md`

条件加载：
- `MEMORY.md`
- `TOOLS.md`
- `BOOTSTRAP.md`

结构不变量：
- `OKR.md` 仅保留 ACTIVE OKR，且最多 3 条
- `HEARTBEAT.md` 仅保留当前执行面与固定规则

FractalMind 链上组织启用时，遵循 [OKR 投影契约](okr-projection.md)。上述文件是可重建工作投影，编辑是未提交提案；不能通过文件授予权限或替代链上持久状态。
