# Skill source contract

ROM manifest 或 workspace 在引用 skill 时，必须声明 source type。

## Source types

### git

从远程 git 仓库获取 skill 内容。

必填字段：
- `repo`：git 仓库 URL
- `ref`：tag / branch / commit hash（推荐使用 tag 以保证可重复性）

可选字段：
- `path`：仓库内子路径，默认为仓库根目录

示例：
```yaml
skills:
  - name: agent-manager
    source:
      type: git
      repo: https://github.com/fractalmind-ai/agent-manager-skill.git
      ref: v1.0.0
      path: agent-manager
```

### embedded

skill 内容直接内嵌在 ROM templates 或 workspace 文件树中，无需外部拉取。

必填字段：
- `path`：skill 相对于 ROM 或 workspace 根目录的路径

示例：
```yaml
skills:
  - name: core-tools
    source:
      type: embedded
      path: .agent/skills/core-tools
```

## 安装行为

- `git` source：安装器负责 clone / checkout 到 workspace 的 skill 安装目录
- `embedded` source：安装器直接复制，无网络依赖
- 若 skill 引用中 `source` 或 `source.type` 未声明，安装器应 fail-closed
- 同一 workspace 内允许混合使用 git 和 embedded source

## v1 boundary

本 contract 当前不定义：
- skill marketplace / registry 协议
- 自动更新 / 版本升级策略
- skill 内容签名或完整性验证
- 多 source 降级或 fallback 机制
