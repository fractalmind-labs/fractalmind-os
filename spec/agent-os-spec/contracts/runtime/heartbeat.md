# Heartbeat contract

v1 最小要求：
- 收到 heartbeat poll 后必须先读 `HEARTBEAT.md`
- heartbeat 默认是 execution surface，不是历史仓库
- 只有当 ACTIVE 全部进入明确外部等待态、且完成 fresh 补扫后，才允许返回 `HEARTBEAT_OK`
- 只要仍存在 docs / packet / issue / verification 等 owner-side 可执行动作，就不能口径成 waiting

FractalMind 链上组织启用时，当前执行面增加 [OKR 投影契约](../files/okr-projection.md) 的结构化观测字段。只在当前约定和执行授权内推进；需要审批、结果未知或缺少新观测时分别报告其依据。心跳文件不授予权限，不自动提交链上状态，不把 KR 测量替代验证或人工验收。
