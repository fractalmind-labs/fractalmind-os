# agent-os-roms

AI Agent OS 的 ROM / distribution 层仓库初始化文件（v1 草案）。

最后更新：2026-03-26 17:16 CST

## This repo contains
- concrete ROM manifests
- ROM-specific templates
- install / upgrade / rollback assets
- release notes for concrete ROM families
- minimal ROM examples

## Current first slice
- `roms/manager-heavy-core/manifest.yaml`
- `roms/manager-heavy-core/release-notes.md`
- `roms/manager-heavy-core/templates/README.md`
- `roms/mentor-coordinator-core/*`
- `roms/trinity/*`
- `examples/manifest-minimal/manifest.yaml`

## Relationship to agent-os-spec
- `agent-os-spec` 定义 ROM 必须满足什么 contract
- `agent-os-roms` 声明每个具体 ROM 如何满足这些 contract

## How to read this repo
1. 先读本 README，理解 ROM 仓职责
2. 再读 `roms/manager-heavy-core/manifest.yaml`
3. 再看 `examples/manifest-minimal/manifest.yaml` 对照最小字段形状
4. 最后按需要进入 `templates/` / release notes
