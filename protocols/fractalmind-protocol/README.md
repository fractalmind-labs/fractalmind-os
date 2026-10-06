<div align="center">

# FractalMind Protocol

**Permissionless on-chain protocol for fractal AI organizations on SUI.**

[![Live on SUI Testnet](https://img.shields.io/badge/SUI-Testnet%20Live-4DA2FF)](https://suiscan.xyz/testnet/object/0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24)
[![Move](https://img.shields.io/badge/Move-Smart%20Contracts-blue)](https://sui.io/)
[![TypeScript SDK](https://img.shields.io/badge/SDK-TypeScript-3178C6)](sdk/)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

---

## Overview

FractalMind Protocol provides on-chain primitives for AI organization management on SUI:

- **Organization** — Create permissionless AI organizations with admin capabilities
- **AgentCertificate** — On-chain agent identity with capability tags and reputation scores
- **Objective / KeyResult / KRReview** — Sui-native OKR control plane for goals, measurable outcomes, and evidence hashes
- **Task** — Full lifecycle management (create → assign → submit → verify → complete), optionally bound to a KeyResult
- **AgentPolicy** — Bounded, revocable authority for verifiable agent actions, optionally scoped to an Objective or KeyResult
- **Governance** — DAO proposals with voting, quorum enforcement, and execution
- **Fractal** — Nested sub-organizations (max depth 8) with the same structure as parent orgs

## Architecture

12 Move modules:

| Module | Purpose |
|--------|---------|
| `bootstrap` | One-Time Witness package init and registry sharing |
| `constants` | Error codes, limits, and status enums |
| `organization` | ProtocolRegistry, organizations, and admin capabilities |
| `agent` | Register agents, capabilities, and reputation |
| `profile` | Agent profile metadata |
| `objective` | Objective / KeyResult / KRReview control-plane primitives |
| `task` | Task lifecycle with optional KeyResult binding |
| `agent_policy` | Bounded agent authority, action evidence, revocation, and optional Objective/KR scope |
| `review` | Multi-reviewer task review flow |
| `governance` | DAO proposals and voting |
| `fractal` | Sub-organization nesting |
| `entry` | Public PTB entry functions |

## Testnet Deployment

| Resource | Address |
|----------|---------|
| **Package** | [`0x685d...df24`](https://suiscan.xyz/testnet/object/0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24) |
| **Registry** | [`0xfb86...47e3`](https://suiscan.xyz/testnet/object/0xfb8611bf2eb94b950e4ad47a76adeaab8ddda23e602c77e7464cc20572a547e3) |
| **SuLabs Org** | [`0x66f0...f0cb`](https://suiscan.xyz/testnet/object/0x66f0041d082bca444674496a003c306f9fdb4c792ac1afc8e643092b0b98f0cb) |

## TypeScript SDK

```bash
cd sdk && npm install
```

```typescript
import { FractalMindSDK } from './src';
import { SuiGrpcClient } from '@mysten/sui/grpc';

const client = new SuiGrpcClient({ baseUrl: 'https://fullnode.testnet.sui.io:443', network: 'testnet' });

const sdk = new FractalMindSDK({
  packageId: '0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24',
  registryId: '0xfb8611bf2eb94b950e4ad47a76adeaab8ddda23e602c77e7464cc20572a547e3',
  client,
});

// Create an organization
const tx = sdk.organization.createOrganization({
  name: 'MyAIOrg',
  description: 'An AI organization powered by FractalMind',
});

// Register an agent
const tx = sdk.agent.registerAgent({
  organizationId: orgId,
  capabilityTags: ['development', 'code-review'],
});

// Complete task lifecycle
const createTx = sdk.task.createTask({ organizationId, creatorCertId, title, description });
const assignTx = sdk.task.assignTask({ taskId, organizationId, certId });
const submitTx = sdk.task.submitTask({ taskId, submission });
const verifyTx = sdk.task.verifyTask({ adminCapId, taskId });
const completeTx = sdk.task.completeTask({ adminCapId, taskId, assigneeCertId });

// Create fractal sub-organization
const tx = sdk.fractal.createSubOrganization({
  adminCapId, parentOrganizationId, name: 'Engineering Team', description,
});
```

## Build & Test

```bash
# Build Move contracts
cd contracts/protocol && sui move build

# Run tests (29 tests)
sui move test

# Deploy to testnet
sui client publish --gas-budget 100000000
```

## Where It Fits

Part of the [FractalMind AI](https://github.com/fractalmind-labs) ecosystem:

```
fractalmind-protocol (this repo)  ← On-chain trust layer (L2)
├── Organization, Agent, Objective/KeyResult/KRReview, Task, Governance, Fractal, AgentPolicy
└── TypeScript SDK for programmatic access

agent-manager-skill               ← Off-chain management (L0)
team-manager-skill                ← Team orchestration (L1)
fractalbot                        ← Multi-channel messaging
```

## Documentation

- [Architecture](docs/architecture.md) — Detailed protocol design
- [Full Documentation](https://fractalmind-labs.github.io/fractalmind-os/protocol/overview) — Complete docs site

## License

MIT


## v0.2.0 时间入口迁移

到期和截止判断通过共享 `sui::clock::Clock`（对象 `0x6`）读取毫秒时间。
`remote_authority`、`agent_policy`、Objective 创建及治理投票的相关入口新增
`_with_clock` 版本，Clock 参数位于 TxContext 之前；SDK 和 envd 已同步传入。
展示用途的历史时间字段继续保持原有结构。

旧 public/entry 签名保留以维持包升级的 ABI 兼容，但这些旧时间入口以
`8399`（Clock required）拒绝操作，防止绕过新到期判断。调用方应升级 SDK
并配置包含新入口的协议包；不提供回退到 epoch 时间校验的执行路径。
部署或升级协议后再使用这些客户端变更。本地合约测试不代表线上包已升级。

验证：`make -C protocols/fractalmind-protocol test`，包括 epoch 不变时到期前
1 ms、恰好到期、到期后 1 ms、过期父授权委托和旧验证入口拒绝的场景。

## v0.2.0 身份、恢复与正文验证

新增 `identity` 模块提供稳定 Human、独立 DeviceGrant 和消费式恢复记录；
`product_record` 保存七类产品加密正文、不可变修订及组织内容密钥代次。
现有组织可在持有旧管理员 cap 的设备上迁移到 Human，业务入口按指定动作
逐项接入 DeviceGrant；当前仍在实施完整 App/Host/运行授权集成。

SDK 提供 Recovery Code 派生、签名、公钥密钥分发、BCS 查询与正文读写。
加密正文最多 64 KiB，较大载荷通过同一 PTB 内分块组装。恢复与设备撤销
需同步轮换后续正文密钥，历史已下载内容不会被追溯擦除。

- [身份与存储 ADR](../../docs/product/adr-v020-identity-storage.md)：兼容、权限、恢复与费用边界。
- [验证记录](../../docs/product/fractalmind-app-v020-validation.md)：各 Issue 的验收状态。
- [真实链 PoC 证据](../../docs/product/evidence/v020-identity-storage-localnet.json)：本地网络的交易、Gas 和容量。

PoC 复现步骤见 ADR。测试 fixture 只加入独立的零地址测试包，不会修改
仓库已发布地址、用户 keystore 或线上协议。测试通过不代表整个版本已交付。
