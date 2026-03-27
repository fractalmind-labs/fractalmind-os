# Skill package minimum contract

一个符合 spec v1 的 skill package，最小需要声明：
- `name`
- `version`
- `entry`
- `dependencies`
- `compatible_spec_range`

## Purpose

skill package contract 用来冻结：
- 一个 skill 至少需要暴露哪些标识字段
- skill 如何声明对其他 skills / runtime capability 的依赖
- ROM 或 workspace 在安装 skill 时，最低限度要验证什么

## Minimum fields

### `name`
- stable skill name
- 在同一个 ROM manifest 内必须唯一

### `version`
- skill package 自身版本
- 推荐使用 semver

### `entry`
- skill 的入口说明
- 可以是 `SKILL.md`，也可以是等价入口文件

### `dependencies`
- 一个列表
- 每项至少声明依赖目标与最低兼容要求
- 若无依赖，必须显式写空列表，而不是省略

### `compatible_spec_range`
- skill package 可兼容的 spec 范围
- 若未声明，安装器应 fail-closed

## Dependency rules

### skill -> skill
- skill 可以依赖其他 skill
- 依赖必须显式声明，不能假设 workspace 默认安装某个 skill

### skill -> runtime
- 若 skill 需要特定 runtime capability（如 heartbeat / notifier / agent manager），必须通过依赖或注释显式说明
- 不允许把 runtime 前提隐藏在自然语言里

### skill -> workspace file contract
- 若 skill 依赖特定 workspace 文件路径或目录结构，必须与 `contracts/files/` 下的 contract 一致
- 不应自定义一套与 core file contract 冲突的路径约定

## Fail-closed behavior

以下情况默认 FAIL：
- 缺少最小字段
- `dependencies` 不是列表
- 未声明 `compatible_spec_range`
- skill 依赖的 contract 与当前 workspace/spec 不兼容

## v1 boundary

本 contract 当前只定义最小声明面，不定义：
- skill marketplace 分发协议
- 远程安装 transport
- 复杂 capability negotiation
