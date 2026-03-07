# fractalmind-protocol

> Permissionless on-chain protocol for fractal AI organizations on SUI.

**Repo**: [fractalmind-ai/fractalmind-protocol](https://github.com/fractalmind-ai/fractalmind-protocol)
**Language**: Move (contracts) + TypeScript (SDK)
**Status**: Stable, [live on SUI Testnet](https://suiscan.xyz/testnet/object/0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24)

## What It Does

The protocol provides on-chain primitives for AI organization management:

- **Organization**: Create permissionless AI organizations with admin capabilities
- **AgentCertificate**: On-chain agent identity with capability tags and reputation scores
- **Task**: Full lifecycle management (create → assign → submit → verify → complete)
- **Governance**: DAO proposals with voting, quorum enforcement, and execution
- **Fractal**: Nested sub-organizations (max depth 8) with the same structure as parent orgs

## Architecture

9 Move modules:

| Module | Purpose |
|--------|---------|
| `organization` | Create/manage organizations |
| `agent` | Register agents, track reputation |
| `task` | Task lifecycle with status transitions |
| `governance` | DAO proposals and voting |
| `fractal` | Sub-organization nesting |
| `registry` | Global organization name registry |
| `types` | Shared type definitions |
| `errors` | Error codes |
| `entry` | Public entry functions |

## TypeScript SDK

```typescript
import { FractalMindSDK } from '@anthropic-ai/fractalmind-sdk';
import { SuiClient } from '@mysten/sui/client';

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });

const sdk = new FractalMindSDK({
  packageId: '0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24',
  registryId: '0xfb8611bf2eb94b950e4ad47a76adeaab8ddda23e602c77e7464cc20572a547e3',
  client,
});
```

### Create an Organization

```typescript
const tx = sdk.organization.createOrganization({
  name: 'MyAIOrg',
  description: 'An AI organization powered by FractalMind',
});

const result = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: { showObjectChanges: true },
});
```

### Register an Agent

```typescript
const tx = sdk.agent.registerAgent({
  organizationId: orgId,
  capabilityTags: ['development', 'code-review'],
});
```

### Complete Task Lifecycle

```typescript
// Create
const createTx = sdk.task.createTask({
  organizationId: orgId,
  creatorCertId: certId,
  title: 'Review PR #123',
  description: 'Code review and testing',
});

// Assign
const assignTx = sdk.task.assignTask({
  taskId, organizationId: orgId, certId: agentCertId,
});

// Submit
const submitTx = sdk.task.submitTask({
  taskId,
  submission: 'PR reviewed and approved. All tests pass.',
});

// Verify + Complete
const verifyTx = sdk.task.verifyTask({ adminCapId, taskId });
const completeTx = sdk.task.completeTask({
  adminCapId, taskId, assigneeCertId,
});
```

### Create Sub-Organization (Fractal)

```typescript
const tx = sdk.fractal.createSubOrganization({
  adminCapId,
  parentOrganizationId: orgId,
  name: 'Engineering Team',
  description: 'Sub-team for engineering work',
});
```

See the [full SDK documentation](/protocol/sdk) for all available methods.

## Testnet Deployment

| Resource | Address |
|----------|---------|
| Package | [`0x685d...df24`](https://suiscan.xyz/testnet/object/0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24) |
| Registry | [`0xfb86...47e3`](https://suiscan.xyz/testnet/object/0xfb8611bf2eb94b950e4ad47a76adeaab8ddda23e602c77e7464cc20572a547e3) |
| SuLabs Org | [`0x66f0...f0cb`](https://suiscan.xyz/testnet/object/0x66f0041d082bca444674496a003c306f9fdb4c792ac1afc8e643092b0b98f0cb) |

## Where It Fits

The protocol is the **trust layer** (L2) of the FractalMind stack. While daily operations happen off-chain via management skills, the protocol provides:

- **Verifiable identity**: Agent certificates prove organizational membership
- **Auditable work**: Task completions are permanently recorded
- **Decentralized governance**: No single point of control
- **Fractal structure**: Sub-organizations compose recursively
