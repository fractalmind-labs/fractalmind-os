# v0.2.0：两个候选设备并发恢复同一身份

2026-10-03 在已有 localnet 和当前 core 部署上完成一次隔离竞争，补充 #24 的并发恢复证据。
[公开报告](evidence/v020-recovery-race-localnet.json)保留原始摘要、失败原因、实际费用和检查结果。
这次没有重新部署合约、启动另一条链，或使用现有 Human、组织、Android 设备及 Host 的凭据。

## 结果

新测试 Human `0x21f6c50b2f1ed863491dfe54e2102f30e6bd47c22b7249b27ab3793931ea04d9` 的两个候选恢复均提前模拟成功、完成原生签名，
随后在同一个 `Promise.allSettled` 屏障中各广播一次。两次客户端提交调用记录在同一毫秒；这不表示链上同时执行。

| 请求 | 原摘要 | 结果 | 实际 Gas（MIST） |
| --- | --- | --- | ---: |
| 创建隔离 Human | `5zAWpG2rJiYgqoGewAQVtEtTtuj5GT9tBxKYDJTPKwuy` | confirmed | 18,772,548 |
| 候选 A | `9KycxR7rdnZSCzx1dqTJct94jpnpjgRf3Bx5ottwmZct` | confirmed | 13,672,688 |
| 候选 B | `7JuXidb7AuGfyuQwjUW1dhX96GyTKnx4W5fYLGTjXDZy` | Move abort 9005 | 1,525,520 |

链上和原生核验均通过：

- Human ID 保持相同，`generation`、`recovery_version` 都恰好从 1 变成 2。
- 原 RecoveryRecord 的 `active` 变为 false，原恢复码定位被拒绝，新的恢复地址属于 A。
- Human 的 grants 从 1 个变成 2 个，只有 A 的新 Grant 属于当前代次；旧 Grant 因代次不符失效。
- B 没有出现在 Human grants 中，设备地址目录也不存在；没有第二个活动 DeviceGrant。
- A 使用新原生设备密钥完成正式 `DeviceIdentityVerifier` 核验；原隔离设备得到 `invalid_grant`。
- 三个新建 `test-*` 原生配置均已通过 helper 的测试专用清理接口删除。

## 方法与隔离范围

1. 使用 `NativeRecoverySigner.create` 和 `NativeDeviceSigner.load` 新建测试配置，测试密钥库服务为
   `org.fractalmind.app.device.test`。用 localnet faucet 仅给新的恢复地址提供测试 SUI，再通过 SDK `createIdentity` 创建测试 Human。
2. 新建两个独立候选配置，用 `NativeImportedRecoverySigner.import` 导入同一个本次生成的恢复码，
   分别通过 `prepareStage` 准备不同的新设备、新恢复凭据和加密备份。来源指纹、Human、原 RecoveryRecord、代次完全相同。
3. 两笔 PTB 都依次调用 SDK `assertRecoverySnapshot`、`recoverIdentity`。两笔独立模拟成功、原生签名完成后才允许广播。
   正式 Native signer 要求 sender 与 Gas owner 都是原恢复地址；因此使用该地址下两枚不同 Gas coin，避免 Gas object 冲突掩盖身份竞争。
4. 广播前保存两个原摘要与 Gas object ID；各调用 `executeTransaction` 一次。按摘要、sender、Gas owner、预算及 effects 检查原回执，
   计算 `computationCost + storageCost - storageRebate`，成功与失败交易的费用都保留。
5. 按原回执只读等待对象可见，再读 Human、RecoveryRecord、grants 和设备目录，执行旧码定位与新旧原生设备授权核验。

这个新 Human 没有组织，不涉及组织内容密钥轮换。共享 IdentityRegistry 增加了隔离测试条目；现有 Human、组织、Grant、Host 和原生配置没有用作交易输入或签名者。

## 失败回执说明

B 的原始回执是当前 core 包 `0x4ebfe2e81449cedf6adeb5876f682c05257ed0702887ccd1fc5ce85269379521`
中 `identity::assert_current_recovery` 的 `E_RECOVERY_USED = 9005`，位于 PTB 第一个命令。
`assert_recovery_snapshot` 首先调用恢复签名／当前记录检查；A 消费旧记录后，B 在这一检查上被拒绝，尚未执行新的恢复和设备授权。
失败回执及其实际 Gas 被保留，没有将失败当作网络未知，也没有重新签名或重放 B。

本次没有发生 setup snapshot 变化、响应丢失或未知结果。夹具的未知结果分支仅在有界时间内查询原摘要，
不会再次广播；该分支本次未覆盖。[已有正式恢复控制器证据](v020-app-recovery.md)另行记录来源变化与原请求核实。
localnet 以后可能裁剪交易查询历史；公开报告记录的是本次收到并核对过的原回执，不把后续 `notFound` 解释为没有提交。

## 工具与证据边界

准备阶段通过 strict TypeScript 检查，并用 `cargo build --locked --manifest-path apps/fractalmind-app/native/Cargo.toml --example device-test-helper --target-dir /tmp/fm-v020-recovery-race-native`
编译正式 native 核心的隔离测试传输。夹具无执行参数时只输出设计，不创建凭据、不请求 faucet、不写链；获得执行授权后只运行一次。

- 原始临时夹具：`/tmp/fm-v020-recovery-race-r1.mts`，SHA-256 `b996e9b9428461362d97743dbbff907dd1f3df36a1efce07d7cac1497698ebcd`。
- Native helper SHA-256：`21b853f80c3c4f560e09f889ebe42feb4c73c42c924477986abac128bcf7e0ad`。
- 运行源码版本：`9ba4dfc16b752ba324c8565c032ae0de964221d8`。
- 公开报告不含恢复码、私钥、签名、交易字节或解密后的密钥环。

这证明当前部署合约对同一 Human／RecoveryRecord 的双候选竞争能原子地只接受一次，且与正式原生签名和 SDK PTB 互通。
它使用测试子进程传输与单次广播夹具，没有运行两个安装版恢复 UI／控制器，也没有覆盖实体手机、组织轮换或全部 v0.2.0 门禁。
