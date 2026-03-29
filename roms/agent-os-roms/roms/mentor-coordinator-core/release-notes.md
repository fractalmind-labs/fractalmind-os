# mentor-coordinator-core release notes

版本：0.1.0
日期：2026-03-29
状态：bootstrap draft

## 本版内容
- 基于当前 main OS 抽象出的第一版协调型 ROM 草案已落地
- 明确了 TODO-first heartbeat、surface-first、file-backed memory 这 3 个核心 contract
- 把当前 workspace 与 `agent-os-spec` v1 的主要 gap 收口为 install boundary 需要补齐的文件集合

## 当前范围
- 包含 `manifest.yaml`
- 包含最小 release notes
- 只保留模板占位说明，不引入大体量 installer / upgrade 脚本

## 设计重点
- 协调优先，而不是单兵 coding 优先
- 心跳默认是 execution surface，不允许把可执行动作误报成 waiting
- 发送成功不等于投递正确，要求 post-send verification
- 通过 `TODO.md` + `OKR.md` 明确区分短期推进面与目标面

## 当前已知差异
- 当前 workspace 还没有 `SYSTEM.md`
- 当前候选 OKR 路径是 `okr/candidates.md`，与 spec 示例 `okrs/Candidate.md` 不同
- 当前还未确认 upstream 提交流程（repo 仅见 `READ` 权限）

## 下一步
- 决定最终提交路径（fork/PR 或授权提交）
- 按 spec 需要补最小模板/安装占位时，再补 `templates/` 内容
- 如需基于该 ROM 生成新员工，再拆 worker/dev/qa 的 persona overlay
