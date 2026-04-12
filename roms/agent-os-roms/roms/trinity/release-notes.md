# trinity release notes

版本：0.1.0
日期：2026-04-12
状态：initial draft

## 本版内容
- 新增 `trinity` ROM，目标是把当前 main 的工作方式抽象成可复用的 AI 员工内核
- 固化 4 个高优先级 contract：`coordinator-first`、`TODO-first heartbeat`、`file-backed memory`、`post-send verification`
- 将 watched DM / watched thread 的短回执纪律写入模板，而不是依赖“会话里记住”
- 补齐最小模板集：`SYSTEM / SOUL / AGENTS / USER / HEARTBEAT / TODO / OKR / Candidate / MEMORY / TOOLS / memory index`

## 这版保留了什么
- 结果导向而不是步骤导向
- 派单优先、main 兜底
- 只有 `回执 / 文档落盘 / commit / 可验证运行结果` 才算推进
- ACTIVE OKR ≤ 3，非 ACTIVE 全部移到 `okrs/Candidate.md`
- 被老板盯住的线程不能静默：每次动作变化都要短回执
- 外发消息必须做 post-send verification，不能把“发送成功”当成“送达正确”

## 当前范围
- ROM 仓内只提供模板与 manifest，不附带安装脚本
- 默认面向 owner-facing / Slack-heavy / multi-agent 工作流
- 不绑定特定老板姓名、频道或公司，但保留相同的执行纪律

## 已知边界
- `memory/YYYY-MM-DD.md` 仍需安装器或首次运行时按当天日期创建
- 具体消息渠道命令需由本地 skill / gateway 实现承接
- 不直接覆盖各团队自定义 skill bundle，仅给出推荐默认项

## 下一步
- 如 installer contract 稳定，可继续补 `install/upgrade` 资产
- 可在 `trinity` 之上再叠 worker/dev/qa persona overlay
- 后续可把“watched DM 规则”“老板通过 IM 发任务先回收到”等行为进一步抽成可配置策略
