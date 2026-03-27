# agent-os-spec

AI Agent OS 的标准层仓库初始化文件（v1 草案）。

最后更新：2026-03-26 17:01 CST

## This repo defines
- file contract
- skill contract
- runtime contract
- packaging contract
- compatibility contract

## This repo does not contain
- 具体 ROM manifests
- 某个发行版的 install / upgrade assets
- manager-heavy / coding / trading / personal 的 release notes

## Relationship to agent-os-roms
- `agent-os-spec` 定义必须满足什么
- `agent-os-roms` 声明具体发行版如何满足这些 contract

## Getting started
1. 先读 `docs/glossary.md`
2. 再读 `contracts/files/core-files.md`
3. 再读 `contracts/runtime/heartbeat.md`
4. 最后对照 `contracts/packaging/rom-manifest-minimum.md` 准备 ROM manifest
