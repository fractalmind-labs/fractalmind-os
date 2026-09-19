# hermes-agent release notes

版本：0.1.0
日期：2026-04-16
状态：initial release

## 本版内容
- 新增 `hermes-agent` ROM，提炼当前 Hermes 主会话里的个人 / 家庭助手工作方式
- 固化 5 个核心 contract：`warm household operator`、`act-don't-ask`、`tool-first verification`、`heartbeat`、`dream low-risk maintenance`
- 补齐 spec v1 所需核心文件模板：`SYSTEM / SOUL / AGENTS / USER / HEARTBEAT / OKR / TODO / MEMORY / TOOLS / memory/index / okrs/Candidate`
- 额外提供 `IDENTITY.md` 与 `DREAM.md`，保留当前 OS 的角色感与低风险后台维护面

## 这版保留了什么
- 不是“会聊天的机器人”，而是会主动做事、会核实结果的个人操作助手
- 先查文件、先看现场、先用工具，再决定是否提问
- 默认简洁直接，不用开场废话
- 外部动作谨慎，内部动作果断
- heartbeat 负责轻量主动巡检；dream 只做低风险、低打扰的内务维护

## 当前范围
- ROM 仓仅提供 manifest 与模板，不绑定具体宿主平台
- 不内置任何必需技能；消息、日历、智能家居等能力由宿主工具链或技能系统承接
- 默认面向中文家庭 / 个人助手场景，但模板可按本地需要改写

## 已知边界
- `memory/YYYY-MM-DD.md` 仍需由安装器、首次会话或 heartbeat 在运行时按日期创建
- 具体“当前事实”能力依赖宿主工具（shell、browser、API、skill）
- `IDENTITY.md` / `DREAM.md` 属于 ROM 扩展文件，不是 spec v1 强制字段

## 下一步
- 如后续稳定，可再拆分 personal / household / executive assistant overlay
- 若形成可复用技能 bundle，可在后续版本增加 `optional_skills`
- 可补充 install / upgrade automation，减少手工 bootstrap 成本
