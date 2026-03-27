# Spec-ROM compatibility contract

spec 与 ROM 的兼容关系，v1 至少需要声明：
- `spec_version`
- `requires_spec`
- `compatible_spec_range`
- breaking signal

## Version terms

### `spec_version`
- spec 仓库当前发布的版本
- 由 `agent-os-spec` 维护

### `requires_spec`
- 某个 ROM 安装时最低要求的 spec 版本或范围
- 由 ROM manifest 声明

### `compatible_spec_range`
- ROM 已验证兼容的 spec 范围
- 若未声明，应 fail-closed

## Compatibility decision

v1 兼容判定最少分 3 种：
- `pass`: 当前 spec 在 ROM 的兼容范围内，可直接使用
- `migration_required`: 可以识别，但需要人工或自动迁移
- `fail`: 超出兼容范围，不应继续安装/升级

## Breaking signal

以下情况应视为 breaking change：
- 删除已发布 contract 字段
- 改变 manifest 必填字段语义
- 改变 runtime contract 的默认 fail-closed 行为
- 改变 core file contract 的结构不变量

若出现 breaking signal：
- spec 应 bump 兼容语义
- ROM 必须更新 `compatible_spec_range` 或显式拒绝该 spec

## Readback contract

最小 readback 至少要能交叉验证：
- spec 侧 `SPEC_VERSION`
- ROM manifest 中的 `requires_spec`
- ROM manifest 中的 `compatible_spec_range`

若三者不一致，兼容判定默认 fail-closed。

## v1 boundary

本 contract 当前不定义：
- 自动迁移脚本格式
- 多 ROM 组合兼容矩阵
- release train / channel policy
