# ROM manifest minimum

一个合规 ROM manifest，v1 至少应声明：
- `rom_name`
- `rom_version`
- `spec_version`
- `requires_spec`
- `compatible_spec_range`
- `install_boundary`
- `upgrade_boundary`

## install_boundary 职责

`install_boundary` 仅声明 OS 核心工作区文件和目录，不包含技能实现文件。
技能的安装由 `included_skills` / `optional_skills` 的 source 声明驱动（见 `contracts/skills/skill-install.md`）。

## 技能声明

manifest 中的技能分为两类：
- `included_skills`：OS 必需技能，安装器必须安装
- `optional_skills`：推荐技能，由操作者选择安装

每个技能条目必须包含 `name` 和 `source`（见 `contracts/skills/skill-source.md`）。

允许由 ROM 自由实现的内容：
- templates
- install / upgrade / rollback assets
- defaults / operator notes
