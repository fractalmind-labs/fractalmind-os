# fractalmind-ai/skills

`fractalmind-ai/skills` 是 `fractalmind-ai` 组织的 skills 聚合入口仓库。

这个仓库使用 **git submodule** 收录各个独立 skill 仓库，并按 **category -> skill** 的形式组织；它不是把所有 skill 内容直接并进来的 monorepo。

## 目录结构

```text
skills/
  coordination/
    DESCRIPTION.md
    agent-manager/
    team-manager/
    okr-manager/
    five-step-workflow/
    turbo-frequency/
  interfaces/
    DESCRIPTION.md
    agent-browser/
    team-chat/
    use-fractalbot/
    use-phone/
  validation/
    DESCRIPTION.md
    custodial-wallet-e2e/
  development/
    DESCRIPTION.md
    predict-contracts/
    custodial-wallet-service/
```

每个 category 目录下都有一个 `DESCRIPTION.md`，用于说明这一类 skill 的用途边界与适用场景。

## 克隆与初始化

### 方式 1：直接递归克隆

```bash
git clone --recurse-submodules git@github.com:fractalmind-ai/skills.git
```

### 方式 2：先克隆，再初始化 submodule

```bash
git clone git@github.com:fractalmind-ai/skills.git
cd skills
git submodule update --init --recursive
```

## 当前收录清单

### coordination
- `coordination/agent-manager` -> `fractalmind-ai/agent-manager-skill`
- `coordination/team-manager` -> `fractalmind-ai/team-manager-skill`
- `coordination/okr-manager` -> `fractalmind-ai/okr-manager-skill`
- `coordination/five-step-workflow` -> `fractalmind-ai/five-step-workflow-skill`
- `coordination/turbo-frequency` -> `fractalmind-ai/turbo-frequency-skill`

### interfaces
- `interfaces/agent-browser` -> `fractalmind-ai/agent-browser-skill`
- `interfaces/team-chat` -> `fractalmind-ai/team-chat-skill`
- `interfaces/use-fractalbot` -> `fractalmind-ai/use-fractalbot-skill`
- `interfaces/use-phone` -> `fractalmind-ai/use-phone-skill`

### validation
- `validation/custodial-wallet-e2e` -> `fractalmind-ai/custodial-wallet-e2e-skill`

### development
- `development/predict-contracts` -> `fractalmind-ai/predict-contracts-skill`
- `development/custodial-wallet-service` -> `fractalmind-ai/custodial-wallet-service-skill`

## 如何新增一个 skill

1. 先判断该 skill 的主用途，选择合适的 category
2. 如有必要，先补充该 category 的 `DESCRIPTION.md`
3. 在对应目录下添加 submodule，例如：

```bash
git submodule add git@github.com:fractalmind-ai/<repo>.git <category>/<skill-name>
```

4. 更新本 README 的目录结构与收录清单
5. 运行以下检查：

```bash
git submodule status
git status --short
git submodule update --init --recursive
```

## 当前边界

- 当前只纳入 `fractalmind-ai` 组织内 public `*-skill` 仓库
- 当前采用 category + `DESCRIPTION.md` 的组织形式
- 当前仍保留每个 skill 仓库独立维护；本仓库只做聚合入口，不改写各 skill 内部结构
