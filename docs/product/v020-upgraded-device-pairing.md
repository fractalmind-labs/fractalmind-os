# v0.2.0：升级部署上的独立设备配对

依据 [#23](https://github.com/fractalmind-labs/fractalmind-os/issues/23)、[#38](https://github.com/fractalmind-labs/fractalmind-os/issues/38) 和总验收 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40)。基线 `716eb0f`，复用 [main R8 隔离升级部署](v020-main-upgrade.md)。本增量补齐配对夹具的升级配置及原摘要证据，没有改动生产 App／SDK／Move／Rust。

## 实际验证

[原生配对报告](evidence/v020-upgraded-device-pairing-localnet.json)：**14 项检查、10 笔交易，9 成功／1 预期失败，退出 0**。使用两个独立 `test-*` OS 设备配置和真实 Sui，自付 Gas；执行生产 IdentityCreation、DevicePairing、PrivateRecords 控制器及原生签名／封装／解密。

- 原 Human／组织创建、原摘要查询及空 journal 重建通过。恢复码仅用于生成材料的独立互操作检查，没有拿 JS 恢复签名器提交交易。
- 未批准请求不能授权设备；两端从链上重建同一公开指纹。批准默认限选定组织的 read 权限，不授予身份管理／审批权，也没有可解密内容密钥。
- 夹具明确丢弃批准响应并暂时使原回执查询不可用，首次返回 unknown；恢复查询后确认**同一 digest、广播 1 次**。广播入口实际核对原 pending 摘要已保存。已消费请求不能产生第二个 Grant。
- 独立确认、报价和交易后分享选定组织的数据钥；重载的原生设备实际解密链上历史正文。
- 用户明确改变组织范围权限后，夹具在下一次分享的原生签名期间轮换组织钥版本。原分享交易实际在 `product_record::assert_key_version` 以 **9102** 失败，原 Grant 封装／版本保持，失败 Gas 已记录。
- 独立撤销配对 Grant 后，原持钥验证及后续正文读取均拒绝；原管理设备仍通过当前审批资格验证。
- 所有本次测试配置的清理调用成功；额外的三次只读 OS 查询确认两个已初始化设备的签名钥及原恢复材料返回 `NotInitialized`。未删除为原生 UI 验收保留的其他配置。

[零广播只读复查](evidence/v020-upgraded-device-pairing-validation.json)确认：Organization 类型仍来自原发布包，Human／配对请求／Grant 来自当前调用包；原请求已批准并关联原 Grant，原 Grant 已撤销。保存对象版本和 BCS 哈希，没有另建身份或重发原交易。

## 夹具修正

配对脚本传递 core／OKR／direct 的当前与原包配置，并在充值／写入前核对精确 chain identifier。现有报告或进度路径直接拒绝启动；原技术摘要、费用和状态在每次 claim／replace 时保存，pending 保存完成后才由交易管理器广播。进度使用同步文件及原子替换，失败和 finally 清理结果也保存；完整报告只在本次验证与凭据清理全部成功后生成。

每个 journal 实例仍是独立内存缓存，丢弃缓存后的重建验证保持；文件是公开技术证据，不构成生产持久 journal 的替代品，也不提供自动重发或恢复签名能力。

## 验证与复现

配对控制器 **4/4**、夹具严格类型通过；重复原报告路径按预期退出 1，停在原生初始化前。源码、原始报告、日志和实际 helper 二进制的 SHA-256 均保存在上述证据中。生产源码本轮未改，没有将前轮 App **231/231** 或 SDK **161/161** 算作本轮全量重跑。

在 `apps/fractalmind-app`，使用含 `originalPackageId` 的公开升级部署 JSON 和新输出路径：

```sh
node --import tsx scripts/native-pairing-localnet.ts /tmp/upgraded-deployment.json /tmp/new-pairing-report.json
```

固定隔离 RPC `127.0.0.1:29000`、faucet `127.0.0.1:29123`；helper 使用独立测试 service，所有配置为 `test-*`。已有 `.progress.json` 时读取原摘要和状态，不替换报告再次启动。

## 证明范围

这是同一 Mac 的原生子进程与链上控制器验证，**没有证明安装后 WebView／Tauri IPC／IndexedDB、两台实体设备或手机 UI 配对旅程**。原生窗口仍待系统解锁／钥匙串授权；真实模型、云 TLS Host、手机沟通审批、完整清缓存恢复、Host 实际重启及公共部署升级仍待整体验收。前轮失败夹具遗留的 QUEUED Run 未由本次配对测试结清，完整 v0.2.0／#40 保持进行中。
