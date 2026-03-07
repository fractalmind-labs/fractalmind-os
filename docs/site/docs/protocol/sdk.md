# TypeScript SDK

The FractalMind SDK provides a TypeScript interface for interacting with the on-chain protocol.

## Installation

```bash
npm install @anthropic-ai/fractalmind-sdk
```

## Setup

```typescript
import { FractalMindSDK } from '@anthropic-ai/fractalmind-sdk';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const client = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
const keypair = Ed25519Keypair.deriveKeypair(mnemonic);

const sdk = new FractalMindSDK({
  packageId: '0x685d6fb6ed8b0e679bb467ea73111819ec6ff68b1466d24ca26b400095dcdf24',
  registryId: '0xfb8611bf2eb94b950e4ad47a76adeaab8ddda23e602c77e7464cc20572a547e3',
  client,
});
```

## API Reference

### Organization

```typescript
// Create a new organization
const tx = sdk.organization.createOrganization({
  name: 'MyOrg',
  description: 'An AI organization',
});

// Read organization data
const org = await sdk.organization.getOrganization(orgId);
// Returns: { name, description, admin, isActive, agentCount, depth, ... }

// Update description
const tx = sdk.organization.updateDescription({
  adminCapId,
  organizationId: orgId,
  newDescription: 'Updated description',
});
```

### Agent

```typescript
// Register an agent in an organization
const tx = sdk.agent.registerAgent({
  organizationId: orgId,
  capabilityTags: ['development', 'testing'],
});

// Read agent certificate
const cert = await sdk.agent.getAgentCertificate({
  certificateId: certId,
});
// Returns: { organizationId, owner, capabilityTags, tasksCompleted, reputationScore }

// Update capabilities
const tx = sdk.agent.updateCapabilities({
  certificateId: certId,
  newCapabilities: ['development', 'testing', 'deployment'],
});
```

### Task

```typescript
// Create a task
const tx = sdk.task.createTask({
  organizationId: orgId,
  creatorCertId: certId,
  title: 'Review PR #123',
  description: 'Code review and testing',
});

// Assign to an agent
const tx = sdk.task.assignTask({
  taskId,
  organizationId: orgId,
  certId: agentCertId,
});

// Submit work
const tx = sdk.task.submitTask({
  taskId,
  submission: 'PR reviewed. All tests pass.',
});

// Verify submission (admin only)
const tx = sdk.task.verifyTask({
  adminCapId,
  taskId,
});

// Complete task (admin only, updates reputation)
const tx = sdk.task.completeTask({
  adminCapId,
  taskId,
  assigneeCertId,
});

// Reject submission (admin only)
const tx = sdk.task.rejectTask({
  adminCapId,
  taskId,
  reason: 'Tests not passing',
});

// Read task data
const task = await sdk.task.getTask(taskId);
// Returns: { title, description, status, assignee, submission, ... }
```

### Fractal

```typescript
// Create a sub-organization
const tx = sdk.fractal.createSubOrganization({
  adminCapId,
  parentOrganizationId: orgId,
  name: 'Engineering Team',
  description: 'Sub-team for engineering',
});

// Detach a sub-organization
const tx = sdk.fractal.detachSubOrganization({
  adminCapId,
  parentOrganizationId: orgId,
  childOrganizationId: childOrgId,
});
```

### Governance

```typescript
// Create a proposal
const tx = sdk.governance.createProposal({
  organizationId: orgId,
  certId: agentCertId,
  title: 'Upgrade agent permissions',
  description: 'Proposal to add deployment capability',
  votingPeriodMs: 86400000, // 24 hours
});

// Vote on a proposal
const tx = sdk.governance.vote({
  proposalId,
  certId: agentCertId,
  inFavor: true,
});
```

## Transaction Pattern

All SDK methods return a `Transaction` object. You need to sign and execute it:

```typescript
const tx = sdk.organization.createOrganization({ name: 'MyOrg', description: '...' });

const result = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: { showObjectChanges: true, showEffects: true },
});

// Wait for finality
await client.waitForTransaction({ digest: result.digest });

// Extract created objects from result.objectChanges
const created = result.objectChanges?.filter(c => c.type === 'created');
```

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 1001 | E_NOT_ADMIN | Caller is not the organization admin |
| 2001 | E_NOT_ORG_MEMBER | Agent is not a member of the organization |
| 3002 | E_ORG_NAME_TAKEN | Organization name already registered |
| 4001 | E_AGENT_ALREADY_REGISTERED | Address already registered in this org |
| 5001 | E_INVALID_TASK_STATUS | Task is not in the expected status |

## Source Code

Full SDK source: [fractalmind-ai/fractalmind-protocol/sdk](https://github.com/fractalmind-ai/fractalmind-protocol/tree/main/sdk)
