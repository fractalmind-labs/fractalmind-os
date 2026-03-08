# Quick Start

Get a working AI agent team running in under 5 minutes.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 18+ | `node -v` |
| Python | 3.8+ | `python3 --version` |
| tmux | any | `tmux -V` |
| AI API key | — | Claude, OpenAI, or similar |

::: tip Don't have tmux?
```bash
# macOS
brew install tmux

# Ubuntu / Debian
sudo apt install tmux
```
:::

## Step 1: Install Agent Manager

```bash
npx openskills install fractalmind-ai/agent-manager-skill
```

Expected output:

```
✓ Installed agent-manager-skill v1.2.0
  → ~/.openskills/fractalmind-ai/agent-manager-skill/
```

## Step 2: Start Your First Agent

Load the skill into your AI agent's session, then tell it to start a worker:

```bash
# Load the skill
npx openskills read agent-manager
```

Now your agent can manage other agents. Ask it to start one:

```
> Start an agent named "researcher" to investigate SUI Move patterns
```

The agent-manager creates a tmux session:

```
[agent-manager] Starting agent "researcher" in tmux session...
[agent-manager] Session: researcher
[agent-manager] Status: running
[agent-manager] PID: 48291
```

Verify it's running:

```bash
tmux list-sessions
```

```
researcher: 1 windows (created Sat Mar  8 14:30:22 2026)
```

## Step 3: Install Team Manager

```bash
npx openskills install fractalmind-ai/team-manager-skill
```

```
✓ Installed team-manager-skill v1.1.0
  → ~/.openskills/fractalmind-ai/team-manager-skill/
```

## Step 4: Create a Team

Load the skill and create a team with your agent as lead:

```bash
npx openskills read team-manager
```

```
> Create a team called "code-review" with researcher as a member
```

```
[team-manager] Created team "code-review"
  Lead: EMP_0001 (you)
  Members: researcher
  Status: active
```

Assign a task to the team:

```
> Assign the code-review team to review PR #42
```

```
[team-manager] Task assigned to team "code-review"
  Task: Review PR #42
  Assigned to: researcher
  Status: in_progress
```

## Step 5: Check Results

Monitor your team's progress:

```
> Show team status for code-review
```

```
[team-manager] Team: code-review
  Lead: EMP_0001
  ┌──────────┬────────────┬─────────────┐
  │ Member   │ Task       │ Status      │
  ├──────────┼────────────┼─────────────┤
  │ researcher│ Review #42│ in_progress │
  └──────────┴────────────┴─────────────┘
```

Check agent heartbeat:

```
> Check heartbeat for researcher
```

```
[agent-manager] Heartbeat: researcher
  Status: running
  Uptime: 4m 32s
  Last activity: 12s ago
```

## Optional: Add More Skills

```bash
# OKR tracking for goal management
npx openskills install fractalmind-ai/okr-manager-skill

# Multi-channel messaging (Telegram, Slack, etc.)
npx openskills install fractalmind-ai/use-fractalbot-skill

# File-backed team chat
npx openskills install fractalmind-ai/team-chat-skill
```

## Optional: On-Chain Protocol

For on-chain organization management on SUI:

```bash
npm install @anthropic-ai/fractalmind-sdk
```

```typescript
import { FractalMindSDK } from '@anthropic-ai/fractalmind-sdk'
import { SuiClient } from '@mysten/sui/client'

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' })
const sdk = new FractalMindSDK({
  packageId: '0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24',
  registryId: '0xfb8611bf2eb94b950e4ad47a76adeaab8ddda23e602c77e7464cc20572a547e3',
  client,
})

// Create an organization
const tx = sdk.organization.createOrganization({
  name: 'MyAIOrg',
  description: 'My first AI organization on SUI',
})

const result = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
})
```

See the [Protocol SDK docs](/protocol/sdk) for the complete API reference.

## Troubleshooting

### `npx openskills` command not found

Make sure Node.js 18+ is installed and `npx` is in your PATH:

```bash
node -v    # Should show v18.x or higher
npx -v     # Should show 10.x or higher
```

### tmux session not starting

Check that tmux is installed and no session with the same name exists:

```bash
tmux -V                    # Verify installed
tmux list-sessions         # Check existing sessions
tmux kill-session -t name  # Kill conflicting session
```

### Agent not responding / no heartbeat

- Check the agent's tmux session: `tmux attach -t researcher`
- Verify the API key is set in the agent's environment
- Check logs: the agent-manager writes to `~/.openskills/logs/`

### Team manager can't find agents

Ensure agent-manager is installed and agents are running before creating teams. Team manager discovers agents via tmux session names.

## Next Steps

- [Architecture Overview](/architecture/overview) — How components fit together
- [Components](/components/overview) — Detailed docs for each module
- [envd Quick Start](/guide/envd-quickstart) — Remote agent management setup
- [Protocol SDK](/protocol/sdk) — On-chain organization management
- [Roadmap](/roadmap/) — Upcoming features
