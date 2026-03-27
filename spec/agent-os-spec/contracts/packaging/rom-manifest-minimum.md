# ROM manifest minimum

一个合规 ROM manifest，v1 至少应声明：
- `rom_name`
- `rom_version`
- `spec_version`
- `requires_spec`
- `compatible_spec_range`
- `install_boundary`
- `upgrade_boundary`

允许由 ROM 自由实现的内容：
- 默认 skill bundles
- templates
- install / upgrade / rollback assets
- defaults / operator notes
