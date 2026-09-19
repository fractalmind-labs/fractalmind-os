# Skill installation contract

技能安装与 OS 核心安装是独立的关注点。

## 职责分离

### install_boundary

`install_boundary` 只负责 OS 核心工作区文件：
- 契约文件（SYSTEM.md、SOUL.md、AGENTS.md 等）
- 目录结构（memory/、okrs/ 等）
- 不列举技能实现文件

### 技能安装

技能安装由 manifest 中的 `included_skills` 和 `optional_skills` 驱动：
- 安装器根据每个 skill 的 `source` 声明获取内容
- `source.type: git` → 安装器负责 clone/checkout 到 workspace 的技能目录
- `source.type: embedded` → 安装器从 ROM templates 中复制 `source.path` 指定的目录

## Skill 分类

### included_skills

OS 正常运行所必需的技能。安装器必须安装这些技能，缺失任一则安装不完整。

### optional_skills

推荐但非必需的技能。安装器应展示给操作者，由操作者决定是否安装。
- 每个条目应包含 `description` 字段说明用途
- 安装器不安装 optional_skills 时，OS 核心功能不受影响

## 安装行为

- 安装器先完成 `install_boundary` 的核心文件安装
- 再按 `included_skills` 安装必需技能
- 最后提示操作者选择 `optional_skills`
- 技能安装失败不应阻塞 OS 核心安装（但必须报告错误）
- 若 `included_skills` 中某技能安装失败，安装器应标记为不完整安装

## 技能目录约定

- 技能默认安装到 `.agent/skills/<skill-name>/`
- 每个技能目录必须包含 `SKILL.md` 作为入口
- 技能的 `source.path` 指定在 ROM templates 或 git 仓库中的相对路径

## v1 boundary

本 contract 当前不定义：
- 技能安装顺序或依赖解析
- 技能卸载或禁用机制
- 技能版本冲突解决策略
- 技能安装后的验证/健康检查
