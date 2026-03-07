# Quick Start

Get a basic AI agent management setup running in under 5 minutes.

## Prerequisites

- Node.js 18+
- Python 3.8+
- tmux
- An AI agent (Claude Code, OpenAI Codex, or similar)

## Install Core Skills

```bash
# Agent lifecycle management
npx openskills install fractalmind-ai/agent-manager-skill

# Team orchestration (optional)
npx openskills install fractalmind-ai/team-manager-skill

# OKR tracking (optional)
npx openskills install fractalmind-ai/okr-manager-skill
```

## Use in Your AI Agent

Load a skill in your agent's session:

```bash
npx openskills read agent-manager
```

This injects the skill's instructions into your agent's context. The agent can then manage other agents using natural language commands that the skill translates into tmux operations.

## Example: Start an Agent

Once the agent-manager skill is loaded, your AI agent can:

```
# Start a new agent in a tmux session
agent start --name my-worker --task "Review PR #123"

# Check agent status
agent list

# Monitor heartbeat
agent heartbeat check my-worker
```

## Example: Create a Team

With team-manager installed:

```
# Create a team with a lead and members
team create --name code-review --lead EMP_0001 --members EMP_0002,EMP_0003

# Assign a task to the team
team assign code-review --task "Review and test PR #456"

# Monitor progress
team status code-review
```

## On-chain Protocol (Advanced)

For on-chain organization management on SUI:

```bash
npm install @anthropic-ai/fractalmind-sdk
```

```typescript
import { FractalMindSDK } from '@anthropic-ai/fractalmind-sdk';
import { SuiClient } from '@mysten/sui/client';

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const sdk = new FractalMindSDK({
  packageId: '0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24',
  registryId: '0xfb8611bf2eb94b950e4ad47a76adeaab8ddda23e602c77e7464cc20572a547e3',
  client,
});

// Create an organization
const tx = sdk.organization.createOrganization({
  name: 'MyAIOrg',
  description: 'My first AI organization on SUI',
});

// Sign and execute with your keypair
const result = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
});
```

See the [Protocol SDK docs](/protocol/sdk) for the complete API reference.

## Next Steps

- Read the [Architecture Overview](/architecture/overview) to understand how components fit together
- Explore [Components](/components/overview) for detailed documentation on each tool
- Check the [Roadmap](/roadmap/) for upcoming features
