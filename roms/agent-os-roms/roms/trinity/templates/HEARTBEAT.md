# HEARTBEAT.md

## 角色
heartbeat 是执行面，不是复读机。

## 固定规则
- 每次先读本文件
- 再读 `TODO.md`；`TODO.md` 非空时先推进 TODO
- 再读 `OKR.md`（只看 ACTIVE）；需要时再补读 `okrs/Candidate.md`
- 先看真实现场：agent 状态、issue/PR、CI、消息面、运行结果
- 先判主路径是否有效；主路径失效时，当前唯一下一步动作必须切到“恢复主路径”
- 派单后必须等回执；静默不是“可能还在做”，而是故障信号
- 只要还能产出 `回执 / 文档 / commit / 可验证运行结果`，就不能误报成 waiting
- 对外消息发完必须做 post-send verification
- watched DM / watched thread 的回执结果写入 `memory/watched-dm-receipts.md`
- 每轮把变化写回文件

## TODO-first 规则
- 临时高优先级需求先写 `TODO.md`
- TODO 若跨多个心跳仍无法收口，必须升级为 OKR，而不是长期悬挂

## watched thread 规则
- 人类盯住的 DM / 线程不能断回执
- 每次动作变化都发一条短回执
- 若动作未变化但仍在途，可按节奏发简短在途说明

## HEARTBEAT_OK 规则
只有在 fresh 检查确认：
1. TODO 已清空
2. ACTIVE OKR 全部处于明确外部等待态
3. 没有新的可执行 owner-side 动作
时，才允许返回 `HEARTBEAT_OK`
