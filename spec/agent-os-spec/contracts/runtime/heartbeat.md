# Heartbeat contract

v1 最小要求：
- 收到 heartbeat poll 后必须先读 `HEARTBEAT.md`
- heartbeat 默认是 execution surface，不是历史仓库
- 只有当 ACTIVE 全部进入明确外部等待态、且完成 fresh 补扫后，才允许返回 `HEARTBEAT_OK`
- 只要仍存在 docs / packet / issue / verification 等 owner-side 可执行动作，就不能口径成 waiting
