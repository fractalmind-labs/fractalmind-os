# FractalMind App：原生恢复凭据与组织密钥轮换

这是完整恢复流程的原生核心增量。客户端继续以[原型 v2](fractalmind-app-prototype-v2/README.md)为界面基准；
**欢迎页恢复入口、正式恢复交易控制器与 Tauri 恢复命令尚未接通**，不能据此宣称用户已经能在 App 中完成恢复。

## 原生能力

`apps/fractalmind-app/native/src/recovery.rs` 提供以下接口；当前通过隔离子进程验收，没有公开秘密导出接口：

1. `import_recovery` 原生校验 `FM1` 恢复码的格式、校验和及网络。恢复码派生原来的公开恢复地址；
   新设备的签名／加密钥独立随机生成。已有设备、创建凭据或恢复凭据的配置均拒绝导入，不复用旧设备钥。
2. `recovery_imported_public` 只返回网络和设备／旧恢复公钥；加载不返回原码。
3. `prepare_recovery` 用旧恢复 X25519 钥认证解封链上备份，保留历史内容密钥，按组织准备独立的新内容密钥，
   生成新的恢复凭据，将密钥环分别加密给新设备与新恢复公钥。新恢复码仅这次返回供用户备份。
4. `recovery_prepared_public` 从系统密钥库重建公钥、密文、轮换计划和来源指纹，不再次显示新码，也不重新生成身份／内容钥。
5. `sign_recovery_transaction` 用旧／新恢复钥签名规范 Sui PTB；sender 和 Gas owner 必须属于所选恢复地址。
   它沿用现有交易字节大小、BCS 规范性与签名约束，不接受通用个人消息。

原生凭据保存在系统密钥库的 `recovery-v1-<profile>` 条目：导入态为 `FMR1`，准备态为 `FMR2`。
准备态保留旧熵用于原交易核实，以及新熵／内容密钥环／来源指纹；没有秘密文件降级。
创建与恢复共用跨进程配置锁，拒绝同一配置被两个流程混用。
部分密钥库写入失败后不覆盖残留条目；安装后失败诊断／清理与新尝试界面仍需接线。

## 来源与链上职责

原生准备请求包含公开链标识、IdentityRegistry／Human／RecoveryRecord ID、恢复版本／备份版本／代次、
链上加密备份，以及组织 ID、当前 key version 和是否轮换。规范序列化的请求产生 SHA-256 来源指纹，
用于正式控制器在准备／报价／确认前比较来源。再次准备不会覆盖已保存的准备态。

**原生接口只处理密码学，不自行读取 Sui 或证明组织权限。** 正式控制器仍须验证共享对象来源／UID、网络、
公开地址目录、当前活动 RecoveryRecord、公钥、Human 代次、组织活动状态和归属，以及当前内容 key version。
组织的轮换资格不能由调用方的 `rotate` 标志证明。

合约最终校验恢复签名和恢复码是否仍有效，消费旧记录、推进 Human 代次并授权新设备。
仅属于该 Human 且活动的组织可用 `rotate_key_for_recovery`；须在同一个 PTB 中先轮换组织、再调用 `recover_identity`。
外部成员组织或非活动组织不能靠恢复取得所有者权限，需保留其原密钥并明确显示未完成的轮换。

## 密钥环与历史

- 保留原 `format:1/contentKey/historicalKeys` 的读取兼容性。
- 新 `format:2/organizations` 将每个组织的 `currentVersion/contentKey/historicalKeys` 分开。
  读取只查指定组织及指定历史版本，缺少组织／版本时失败，不回退到别的组织或最新钥。
- 每个需轮换的组织生成独立随机钥，当前版本递增；历史钥保留，其他组织不自动轮换。
- 当前版本与历史项必须一致。重复来源、非规范版本、溢出、超过历史项数或链上密文大小上限均拒绝准备。
- 加密备份含 FMW1 后不超过 64 KiB；不宣称支持无限组织／历史项或自动分块备份。

恢复能阻止旧设备通过新代次授权并用原有钥读取未来的新版本正文；
已经持有的历史钥或明文不会因此被物理抹除。新组织的独立钥配置、多人重新分发与所有业务入口的轮换仍需实现。

## 实际验证

- Rust 核心 **12/12**：恢复码网络／校验和／公开身份一致性、格式／边界、独立组织轮换、历史保留、
  缺少组织／版本、重复来源、过期备份与版本溢出拒绝。
- App 原有 **43/43**、桌面来源限制 **1/1** 通过；当前桌面测试没有增加恢复 IPC。
- [真实 localnet 报告](evidence/v020-app-native-recovery-localnet.json)：**15 项检查、6 笔交易**，
  使用新生成的 `test-*` 凭据和独立测试密钥库，所有测试凭据已清理。

实际链旅程：原生创建 Human／组织 → 原生加密并保存 v1 正文 → 原生导入旧码 → 新码／组织钥准备 →
旧恢复地址自付签名、原子组织轮换与恢复 → 原设备核验拒绝、旧码重用拒绝、新设备读取 v1 正文 →
新设备写入 v2 正文，旧设备原有密钥不能解密 → 用新码执行第二次恢复 → v1／v2 正文仍可读取，准备 v3 钥。
最后只凭再一次的新码和公开部署资料，从全新原生配置定位同一个稳定 Human，无需输入 Human ID。

测试用正式自付交易管理器及测试签名适配器；新恢复地址零余额时阻止报价，夹具显式注入测试 SUI 后才能继续。
每笔提交后按原摘要查询；目录索引延迟使用只读等待，不重发写入。
独立 JS 派生／解封只用于验证主动备份码的互通性，不是提交交易的私钥签名路径；公开报告没有原码、私钥或明文密钥环。

## 复现与剩余门禁

从仓库根目录：

```sh
cargo test --offline --manifest-path apps/fractalmind-app/native/Cargo.toml
cargo build --offline --manifest-path apps/fractalmind-app/native/Cargo.toml --example device-test-helper
```

在 `apps/fractalmind-app` 中，使用隔离 localnet 的公开部署报告：

```sh
node --import tsx scripts/native-recovery-localnet.ts <isolated-deployment-report.json> <public-output-report.json>
```

上述旅程没有验证安装后恢复页面、Tauri IPC、IndexedDB 恢复日志、并发来源变化／其他恢复胜出、
响应丢失后的正式恢复控制器、新码未备份／备份丢失的交互、五平台原生验收或真实云 Host。
这些门禁与其他 v0.2.0 要求仍保留在[实现验证记录](fractalmind-app-v020-validation.md)。
