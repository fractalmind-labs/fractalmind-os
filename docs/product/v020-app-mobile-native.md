# v0.2.0：移动端原生入口与密钥提供者

对应 [#23](https://github.com/fractalmind-labs/fractalmind-os/issues/23)、[#38](https://github.com/fractalmind-labs/fractalmind-os/issues/38)、[#45](https://github.com/fractalmind-labs/fractalmind-os/issues/45) 和总验收 [#40](https://github.com/fractalmind-labs/fractalmind-os/issues/40)，基线 `9454530`。此前手机只有响应式界面，原生壳仅有桌面 binary，密钥库也未声明 iOS／Android 依赖，不能完成实际手机签名审批。

## 实现

- 按 [Tauri 的移动端入口要求](https://v2.tauri.app/start/migrate/from-tauri-1/#preparing-for-mobile)，原壳移动至 `src-tauri/src/lib.rs`，提供 `run` 和移动端入口；输出 `staticlib`／`cdylib`／`rlib`，桌面 `main.rs` 调用同一库。原来源校验、窗口、CSP、命令权限和原生签名／加密处理保持。
- iOS 使用固定 `keyring 3.6.3` 的 `apple-native`，实际选择其 iOS Keychain 实现；Mac／Windows／Linux 保留既有提供者及服务／账号命名。
- Android 使用固定的 `android-native-keyring-store 1.0.0` 和 `keyring-core 1.0.0`。原生侧根据固定 service 创建具名存储，再直接构造账号条目；生产／测试 service 选择不同存储。它的 [提供者](https://docs.rs/android-native-keyring-store/1.0.0/android_native_keyring_store/)以 Android Keystore 加密 SharedPreferences，依赖 Tauri Mobile 初始化的 NDK context。没有设置或调用 keyring-core 的全局默认存储，没有选择 mock／sample 提供者。
- device／onboarding／recovery 条目名称及现有二进制格式不变，仍由原生侧保管密钥；WebView 不接收提供者／service／路径参数。持钥证明、当前链上授权及独立费用确认沿用现有控制器。
- 增加 Android／iOS 初始化、开发和构建命令；更新中英文浏览器提示为原生 App。CI 的 macOS 原生核心任务增加两个移动目标的密钥库检查。

## 验证

[当前源码、锁文件与原始日志](evidence/v020-app-mobile-native-validation.json)：

| 项目 | 当前实际结果 |
| --- | --- |
| macOS 原生核心 | **21/21**，包括签名域、交易／命令边界、恢复、加密及组织密钥范围 |
| 共享 Tauri 壳 | **1/1** 来源保护测试，桌面入口及共享库编译通过 |
| Android 密钥库 | `cargo check --locked --target aarch64-linux-android` 通过，实际编译 Android 提供者／JNI 路径 |
| iOS 密钥库 | `cargo check --locked --target aarch64-apple-ios` 通过，实际编译 iOS Keychain 路径 |
| 当前桌面执行文件 | `npm run desktop:build -- --debug` 通过，包含最终前端与共享库，未生成／覆盖原运行中的 `.app` |
| 前端与配置 | TypeScript／Vite 构建、Rust 格式及 CI YAML 解析通过；移动 CLI 参数已核对 |

编译检查没有执行手机凭据库，也没有验证移动壳的完整构建／链接、JNI 初始化、系统锁定与备份行为、安装后 IPC、扫码／配对、真实签名、通信审批或蜂窝网络。SDK／Move／Go 生产源码未改，未计作本轮全量重跑。原桌面 UI 的待授权请求没有被重启或替换。

## 开发方式与剩余门禁

依照 [Tauri 平台前置条件](https://v2.tauri.app/start/prerequisites/)准备工具链。先构建本仓库 SDK，在 `apps/fractalmind-app`：

```sh
npm run android:init
npm run android:build -- --debug --target aarch64
```

iOS 在具有完整 Xcode 和测试签名配置的 Mac 上：

```sh
npm run ios:init
npm run ios:build -- --debug
```

平台工程生成在忽略的 `src-tauri/gen/`。本轮本机只有 Command Line Tools，`iphonesimulator` SDK／`simctl` 不可用；Java 和 Android NDK 也尚未安装。两个 Rust 目标已安装，密钥库的类型检查不需要完成安装包链接；尚无本轮 APK／IPA。

手机真机须使用可达的 HTTPS RPC／Coordinator，手机 loopback 不能指向桌面主机。完整 v0.2.0 仍须完成桌面安装后旅程、手机真实沟通审批、云 Host、实际模型和链上清缓存重建等 #40 验收。
