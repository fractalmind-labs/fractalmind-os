# skills catalog（已归档）

这里保留的是原 `fractalmind-ai/skills` 聚合仓库的历史目录。该仓库曾用 git submodule
按 **category -> skill** 收录各个独立 skill 仓库。

合并进 `fractalmind-labs/fractalmind-os` 之后，各 skill 的源码直接位于 monorepo 的
`skills/<category>/` 下，不再需要 submodule、inventory 生成器或 catalog release 校验脚本，
这些内容已移除。安装方式见 [`skills/README.md`](../../README.md)：

```bash
npx skills add fractalmind-labs/fractalmind-os --skill agent-manager
```

## 原收录清单与当前位置

| 原 catalog 路径 | 当前位置 |
| --- | --- |
| `coordination/agent-manager` | [`skills/coordination/agent-manager-skill`](../../coordination/agent-manager-skill) |
| `coordination/team-manager` | [`skills/coordination/team-manager-skill`](../../coordination/team-manager-skill) |
| `coordination/okr-manager` | [`skills/coordination/okr-manager-skill`](../../coordination/okr-manager-skill) |
| `coordination/use-github-okr` | [`skills/coordination/use-github-okr-skill`](../../coordination/use-github-okr-skill) |
| `coordination/five-step-workflow` | [`skills/coordination/five-step-workflow-skill`](../../coordination/five-step-workflow-skill) |
| `coordination/turbo-frequency` | [`skills/coordination/turbo-frequency-skill`](../../coordination/turbo-frequency-skill) |
| `coordination/agent-calendar` | [`skills/coordination/agent-calendar-skill`](../../coordination/agent-calendar-skill) |
| `interfaces/agent-browser` | [`skills/interfaces/agent-browser-skill`](../../interfaces/agent-browser-skill) |
| `interfaces/team-chat` | [`skills/interfaces/team-chat-skill`](../../interfaces/team-chat-skill) |
| `interfaces/use-codex-app` | [`skills/interfaces/use-codex-app-skill`](../../interfaces/use-codex-app-skill) |
| `interfaces/use-claude-desktop` | [`skills/interfaces/use-claude-desktop-skill`](../../interfaces/use-claude-desktop-skill) |
| `interfaces/use-fractalbot` | [`skills/interfaces/use-fractalbot-skill`](../../interfaces/use-fractalbot-skill) |
| `interfaces/use-phone` | [`skills/interfaces/use-phone-skill`](../../interfaces/use-phone-skill) |
| `validation/web3-wallet-mock-skill` | [`skills/validation/web3-wallet-mock-skill`](../../validation/web3-wallet-mock-skill) |
| `development/plan-dog` | [`skills/development/plan-dog-skill`](../../development/plan-dog-skill) |
| `development/predict-contracts` | [`skills/development/predict-contracts-skill`](../../development/predict-contracts-skill) |
| `development/golang-web3-service` | [`skills/development/golang-web3-service-skill`](../../development/golang-web3-service-skill) |
| `development/golang-integration-test` | [`skills/development/golang-integration-test-skill`](../../development/golang-integration-test-skill) |
| `development/react-frontend-dev` | [`skills/development/react-frontend-dev-skill`](../../development/react-frontend-dev-skill) |
| `development/high-fidelity-ui-replication` | [`skills/development/high-fidelity-ui-replication-skill`](../../development/high-fidelity-ui-replication-skill) |

## 保留的历史内容

- 各 category 的 `DESCRIPTION.md`：说明该类 skill 的用途边界与适用场景。
- `releases/use-fractalbot/v0.1.0.json`：迁移前发布的不可变 release 清单，其中的仓库地址和
  commit 指向原独立仓库，保持原样。
- submodule 指针、inventory 和校验脚本可在迁移前的 git 历史中查到。
