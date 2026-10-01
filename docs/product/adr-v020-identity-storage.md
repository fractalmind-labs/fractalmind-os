# ADR：v0.2.0 Human 身份、恢复与加密正文

状态：身份与正文基础实现已实测；App、Host 和运行授权的入口集成仍在进行。本文不代表整个 v0.2.0 已完成。

范围：[#23](https://github.com/fractalmind-labs/fractalmind-os/issues/23)、[#24](https://github.com/fractalmind-labs/fractalmind-os/issues/24)、[#26](https://github.com/fractalmind-labs/fractalmind-os/issues/26)。产品范围以 PRD 和里程碑 #40 为准。

## 1. 身份与设备

HumanIdentity 是共享链上对象，ID 不随设备、钱包或恢复码更换。DeviceGrant 记录设备地址、组织范围、read/operate/approve/manage_hosts、毫秒期限、撤销、版本和授权代次。组织角色与设备授权取交集；成员即使持有自己身份的 root 设备授权，也不能审批组织。

首次设备获得身份管理授权。常规新增设备默认当前组织、7 天、只读；授予 root 设备是单独的显式操作。每个设备用独立 Ed25519 交易密钥与 X25519 加密密钥。恢复签名地址不能登记为设备地址，已登记设备地址也不能作为恢复地址。

公开链上数据无法按 DeviceGrant 隐藏。read 权限在客户端决定是否继续访问组织；真正的数据访问依赖加密密钥分发。已取得的密钥与已下载内容不因撤销自动消失。

### 组织管理员兼容

保持既有 Organization、OrgAdminCap 的布局与旧 public 签名。新增组织把 admin 地址设为稳定 Human 对象地址；OrgAdminCap 存入 Human 的私有 Table。迁移旧组织同时要求有效 root DeviceGrant、原管理员地址和原 OrgAdminCap，迁移后旧设备不再持有管理员 cap。

cap 不通过 public 函数借出。每个新受保护业务入口必须先检查指定 DeviceGrant 动作，再在 package 内调用相应旧能力。不能把统一 cap 暴露给“只通过某一个动作检查”的调用方，否则会扩大授权。

已绑定 Human 的组织，不能直接套用仍要求 sender == Organization.admin 的旧业务入口。OKR、邀请、审批、运行授权等入口会随各 Issue 接入，当前未完成全量入口迁移。SDK 的 packageId 用于调用，originalPackageId 用于升级包的类型与动态字段地址。

## 2. 一份恢复码

恢复码格式为 `FM1:<network>:<256-bit entropy>:<checksum>`。校验和用于发现录入错误。HKDF-SHA256 使用独立域分离派生 Ed25519 签名种子和 X25519 加密秘密；不会用短口令代替随机熵。

恢复签名地址定位 IdentityRegistry 的 RecoveryLocation，再读取并核对 RecoveryRecord 与 Human 的当前版本、网络和记录 ID。恢复码不能数学推导随机 Human 对象 ID，但可以单独定位它；用户不必另外抄录 ID。定位本身不授予设备权限。

IdentityRegistry 通过已配置 ProtocolRegistry 的私有动态字段绑定，不能相信任意声称属于某个恢复地址的对象。支持在已有包升级后初始化；初始化不依赖不会重跑的 bootstrap。

### 恢复交易

恢复交易由本地派生的恢复签名密钥签署，Sui 交易签名证明持有权。参数仅包含公开新验证材料、目标设备地址和加密备份。恢复码、熵与私钥不进入参数、事件或报告。

交易原子地消费当前记录、轮换恢复码、递增 Human 授权代次，并授权新设备。所有旧代次设备立即失效，无需遍历每个 DeviceGrant；同一共享 Human/RecoveryRecord 串行化竞争操作，旧记录重放被拒。更换恢复码而不恢复设备时保留当前设备代次。

选择授权代次而非逐项撤销，是为了让恢复成本不随设备数量增长。旧设备对象保留，便于重建和历史审计；运行端必须同时检查 Human 的当前代次，不能只检查 DeviceGrant.revoked。

恢复仍需 Gas。创建和恢复可由新的本地设备支付 Gas，并由恢复密钥签业务授权：这是用户自己两把密钥的联合签名，不需要赞助服务或业务后端。App 需要明确余额、充值、预计费用及新恢复码保存步骤。

## 3. 数据密钥和撤销

正文采用 AES-256-GCM：`FME1 + nonce(12) + ciphertext + tag(16)`，随机 nonce，AAD 绑定组织、种类、逻辑 ID、修订和密钥代次。不同记录、代次或密钥下替换正文会解密失败。执行器新结果采用下述 FME2 命令专用密钥格式。

### Host 命令结果密钥

Host 成员资格不授予读取整个组织的权限。设备从组织内容密钥按组织 ID、命令签名意图 SHA-256 和 key_version，经 HKDF-SHA256 派生 32 字节结果密钥；盐域为 `fractalmind.command-result-key.v1`。使用 HostMembership 的 X25519 公钥封装，AAD 再绑定 capability、Host 成员与代次，存入 capability 私有动态字段。

密钥登记和命令准备可在同一 PTB 原子完成；登记验证当前设备/组织/Host/能力权限及当前内容代次。复制签发请求、错误代次被拒；精确重试保留原密钥封装。FME2 checkpoint 正文须有对应命令结果密钥登记，旧命令不能靠事后登记静默转换密钥方案。

FME2 保留 AES-GCM 正文容量及 AAD 规则，但明确采用命令派生密钥。SDK 解密时从恢复 keyring 中对应代次的组织密钥重派生；不另存每条命令的恢复密钥。Host 只解封自己的命令密钥，不能由它推导组织根密钥或其他命令密钥。旧 FME1 根密钥结果可由管理设备读取，Host 执行器不回退获取组织根密钥。

Go 执行器在调用适配器前确认结果密钥、资金和本次链上启动归属，正文及密钥不写本地结果文件。生产 OS 安全存储与工厂接线仍待完成；组织轮换后在途命令需要新的明确结果密钥授权，目前缺失时拒绝写入并保持未知，不能使用旧代次或重新执行。测试证据见 [命令结果存储](evidence/v020-runtime-result-store-localnet.json)，其中子进程和费用均为合成 fixture。

设备和恢复备份采用临时 X25519 + HKDF-SHA256 + AES-GCM：`FMW1 + ephemeral public key + salt + encrypted keyring`。只需要恢复公钥就可以更新加密备份，日常密钥轮换不需要用户输入离线恢复码。

组织内容索引保存当前 key_version，新正文必须匹配它。撤销流程在同一 PTB 内撤销 DeviceGrant、递增组织 key_version，并更新存活设备与恢复备份的 keyring；加密失败或版本冲突使整个交易失败。恢复自身管理的组织时，可在同一恢复 PTB 内验证恢复签名并轮换组织密钥；不会绕过其他组织的管理员角色。

历史密钥保留在存活设备与新恢复备份的 keyring 中，保证历史正文可恢复。旧设备可以继续解密之前得到密钥的历史内容，不能获得后续的新密钥。组织成员恢复自己的身份不能擅自轮换他人组织的密钥，需要该组织管理员完成轮换与分发；App 必须显示这个访问边界，不能宣称撤销可擦除历史数据。

合约能约束密钥代次，不能证明密文本身确实用随机新密钥加密。客户端生成新密钥并校验备份解密、分发对象和代次；执行端拒绝失效授权。设备私钥仍需接入系统安全存储，当前 SDK 不是完整安全存储实现。

## 4. 正文存储决策

采用“组织索引 + 不可变 EncryptedRecord 修订”。固定支持 OKR、执行约定、审批、证据摘要、Run 检查点、直接消息和备份正文。正文真实字节在 Sui 上，不能用哈希或外部 URL 替代。

索引保存当前记录 ID、修订与密钥代次；每个不可变记录保存 previous，旧正文继续存在于当前链状态。修订使用 expected_revision 防止覆盖他人更新。业务审批、证据可信度、预算或 Run 状态仍由相应业务合约控制，保存正文不会自动取得这些权限。

候选对比：直接把当前正文存入可变组织动态字段，成本较低，但覆盖后不能仅靠当前对象状态恢复旧修订；不可变修订付出索引/元数据成本，保留审计与恢复所需正文。候选 fixture 仅复制到隔离测试包，生产合约不包含它。

### 容量与频率

- 密文最大 65,536 字节；FME1 正文最大明文 65,504 字节。更大正文应在 App 明确拒绝或采用后续经验证的完整分片方案，不能静默截断或只存哈希。
- 实测 Sui 单个 pure 参数最大 16,384 字节。SDK 把较大密文分为至多 16,000 字节片段，在同一 PTB 内拼接，不创建持久中转对象，不拆为多笔部分提交。
- 日常正文建议紧凑：OKR/约定通常约 1–4 KiB，证据保存完整可审阅摘要及必要事实。容量上限不是默认目标大小。
- 仅把状态转换、审批、测量证据、用户/Agent 显式消息和持久检查点上链；逐行日志、屏幕帧、实时资源和可重建观测不逐条上链。
- SDK/App 仍需模拟当前网络 Gas、预留预算并显示实际确认费用。以下是独立本地网测量，不能作为 mainnet 固定报价。

### 本地网测量

净 Gas = computationCost + storageCost − storageRebate，MIST 转 SUI 除以 10⁹。首条索引记录含一次性索引初始化；样本按各记录不同正文规模写入。

| 明文字节 | 不可变记录 BCS 字节 | 索引 + 不可变修订 / SUI | 可变动态字段 / SUI |
| ---: | ---: | ---: | ---: |
| 256 | 495 | 0.011325 | 0.006286 |
| 1,024 | 1,268 | 0.014627 | 0.012161 |
| 4,096 | 4,340 | 0.037974 | 0.035508 |
| 8,192 | 8,436 | 0.069104 | 0.066638 |
| 16,384 | 16,631 | 0.131421 | 0.128930 |
| 32,768 | 33,012 | 0.342274 | 0.339615 |
| 65,504 | 65,747 | 0.971452 | 0.968801 |

按该本地配置估算，100 次约 4 KiB 新修订约 3.7974 SUI；100 次约 32 KiB 新修订约 34.2274 SUI。长期保留不可变正文会持续增加存储成本，不能按高频遥测设计持久检查点。此估算不包含模型、主机、其他授权交易或充值转账费用。

## 5. 验证与复现

证据见 `evidence/v020-identity-storage-localnet.json`，包含本地链 ID、包/对象 ID、交易 digest、状态、容量与 Gas；不包含私钥、恢复码或真实用户数据。

执行于 `protocols/fractalmind-protocol/sdk`，先安装 SDK 依赖。独立网络示例（不会改变用户 Sui client/keystore）：

```sh
mkdir -p /tmp/fractalmind-v020-localnet
sui genesis --working-dir /tmp/fractalmind-v020-localnet --with-faucet --committee-size 1 --epoch-duration-ms 60000
sui start --network.config /tmp/fractalmind-v020-localnet --with-faucet=127.0.0.1:29123 --fullnode-rpc-port 29000
```

另一个终端：

```sh
fm_test_package=$(python3 scripts/prepare-localnet-package.py --storage-candidate)
sui move build --path "$fm_test_package" --dump-bytecode-as-base64 > /tmp/fractalmind-v020-bytecode.json
FM_STORAGE_CANDIDATE=1 node --import tsx scripts/identity-localnet.ts /tmp/fractalmind-v020-bytecode.json /tmp/fractalmind-v020-report.json
```

脚本只接受 localhost RPC/faucet，生成独立测试签名器，等待交易确认再读对象。负向交易真实提交给验证节点，包含只读设备越权、修订冲突、恢复后的旧设备和消费记录重放。还验证分页索引重建、两种正文读回、历史修订、多设备解密、撤销后的新密钥及恢复后的新正文不可由丢失设备旧密钥解密。

仍待最终验收：并发恢复集成场景、已发布包实际升级兼容、App 安全存储与恢复页面、Host/运行授权入口接入，以及全产品闭环。局部通过不能替代这些门槛。
