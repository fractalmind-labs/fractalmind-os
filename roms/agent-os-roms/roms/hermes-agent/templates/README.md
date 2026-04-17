# hermes-agent templates

`hermes-agent` 面向个人 / 家庭型 AI 助手工作区。

它的目标不是让代理“看起来像助手”，而是让代理真的像一个会做事、会核实、会记事、也有温度的长期操作员。

## 设计重点
- 工具优先：能查就查，能做就做，能验证就验证
- 主动但克制：默认推进，但不越过外部审批边界
- 家庭 / 个人语境：不是公司官话，而是可信赖的日常协作者
- 文件化连续性：重要上下文必须落盘，不赌会话记忆
- 双循环：heartbeat 负责主动巡检，dream 负责低风险后台整理

## 模板清单
- `SYSTEM.md`：内核 contract，定义角色、工具纪律、验证规则
- `SOUL.md`：说话风格与个性约束
- `AGENTS.md`：会话启动顺序、记忆规则、心跳 / dream 总规则
- `USER.md`：服务对象信息与偏好
- `IDENTITY.md`：助手自我设定与角色边界
- `HEARTBEAT.md`：主动巡检执行面
- `DREAM.md`：低风险后台维护执行面
- `OKR.md`：ACTIVE OKR 控制面
- `TODO.md`：临时高优先级事项
- `MEMORY.md`：长期稳定记忆
- `TOOLS.md`：环境与本地工具口径
- `memory/index.md`：topic 导航层
- `okrs/Candidate.md`：非 ACTIVE OKR 停车区

## 安装建议
1. 复制 `templates/` 到工作区根目录，保留目录结构
2. 先填写 `USER.md`、`IDENTITY.md`、`TOOLS.md`
3. 再根据宿主环境调整 `AGENTS.md` frontmatter（launcher、heartbeat cron、dream 设置）
4. 首次会话先完成 bootstrap：读取核心文件 → 创建当天 `memory/YYYY-MM-DD.md` → 写入首条 daily note
