import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  FractalMindSDK,
  canonicalNodeCommandSigningBytes,
  capabilityReference,
  capabilityReferenceWire,
  projectEnvdCapabilityState,
  verifyParentCheckpoint,
} from '../src';
import { toBigInt } from '../src/client';
import type { NodeCommandSigningInput, RemoteCapabilityData } from '../src';

const PACKAGE_ID = '0x123';
const ENTRY_PREFIX =
  '0x0000000000000000000000000000000000000000000000000000000000000123::entry::';
const MAX_U64 = 18_446_744_073_709_551_615n;

class MockSuiClient {
  constructor(private readonly objectMap: Record<string, unknown> = {}) {}

  async getObject(params: { id: string }): Promise<unknown> {
    return this.objectMap[params.id] ?? { data: null };
  }
}

function sdk(client: MockSuiClient = new MockSuiClient()): FractalMindSDK {
  return new FractalMindSDK({ packageId: PACKAGE_ID, client: client as never });
}

function moveTarget(tx: { getData: () => unknown }): string {
  const command = (tx.getData() as { commands: Array<{ MoveCall: Record<string, string> }> })
    .commands[0].MoveCall;
  return command.target ?? `${command.package}::${command.module}::${command.function}`;
}

test('remote authority builders target the Phase 0 entry wrappers', () => {
  const fm = sdk();
  const shape = {
    organizationId: '0x1',
    delegate: '0x2',
    targetKind: 3 as const,
    nodeId: 'node-1',
    agentId: 'agent-1',
    actions: ['deploy'],
    scope: 'lifecycle',
    maxUses: MAX_U64,
    budgetAsset: 'MIST',
    maxBudget: MAX_U64,
    expiresAtMs: MAX_U64,
  };

  assert.equal(
    moveTarget(fm.remoteAuthority.createCapability(shape)),
    `${ENTRY_PREFIX}create_remote_capability`,
  );
  assert.equal(
    moveTarget(fm.remoteAuthority.delegateCapability({ ...shape, parentCapabilityId: '0x3' })),
    `${ENTRY_PREFIX}delegate_remote_capability`,
  );
  assert.equal(
    moveTarget(fm.remoteAuthority.revokeCapability({ capabilityId: '0x3', organizationId: '0x1' })),
    `${ENTRY_PREFIX}revoke_remote_capability`,
  );
  assert.equal(
    moveTarget(fm.remoteAuthority.claimAuthorityUse({
      capabilityId: '0x3',
      action: 'deploy',
      scope: 'lifecycle',
      targetKind: 3,
      nodeId: 'node-1',
      agentId: 'agent-1',
      commandId: 'cmd-1',
      nonce: 'nonce-1',
      idempotencyKey: 'idem-1',
      budgetAsset: 'MIST',
      budgetAmount: MAX_U64,
      intentHash: Array.from({ length: 32 }, (_, index) => index),
    })),
    `${ENTRY_PREFIX}claim_remote_authority_use`,
  );
});

test('getCapability parses max-u64 fields and delegated parent option', async () => {
  const client = new MockSuiClient({
    '0x400': {
      data: {
        objectId: '0x400',
        type: '0x123::remote_authority::RemoteCapability',
        content: {
          dataType: 'moveObject',
          fields: {
            schema_version: '1',
            org_id: '0xaaa',
            issuer: '0xbbb',
            delegate: '0xccc',
            parent_id: { vec: ['0x399'] },
            parent_revocation_version: '7',
            reservation_scope: '2',
            target_kind: '3',
            node_id: 'node-1',
            agent_id: 'agent-1',
            actions: ['status', 'deploy'],
            scope: 'lifecycle',
            max_uses: MAX_U64.toString(),
            uses_claimed: '1',
            uses_delegated: '2',
            budget_asset: 'MIST',
            max_budget: MAX_U64.toString(),
            budget_claimed: '3',
            budget_delegated: '4',
            expires_at_ms: MAX_U64.toString(),
            revocation_version: MAX_U64.toString(),
            revoked: false,
          },
        },
      },
    },
  });

  const capability = await sdk(client).remoteAuthority.getCapability('0x400');
  assert.equal(capability.targetKind, 3);
  assert.equal(capability.reservationScope, 'node');
  assert.equal(capability.parentId?.endsWith('0399'), true);
  assert.equal(capability.maxUses, MAX_U64);
  assert.equal(capability.revocationVersion, MAX_U64);
});

test('getCapability rejects unknown schema versions', async () => {
  const client = new MockSuiClient({
    '0x401': {
      data: {
        objectId: '0x401',
        type: '0x123::remote_authority::RemoteCapability',
        content: {
          dataType: 'moveObject',
          fields: {
            schema_version: '2',
            target_kind: '1',
            reservation_scope: '1',
          },
        },
      },
    },
  });

  await assert.rejects(
    () => sdk(client).remoteAuthority.getCapability('0x401'),
    /unsupported schema_version 2/,
  );
});

test('projects a delegated capability into envd CapabilityState', () => {
  const parent = capability({
    objectId: address('10'),
    targetKind: 1,
    reservationScope: 'authority',
    nodeId: '',
    agentId: '',
    parentId: null,
    maxUses: 10n,
    maxBudget: 100n,
    expiresAtMs: 2_000n,
    revocationVersion: 7n,
  });
  const child = capability({
    objectId: address('11'),
    parentId: parent.objectId,
    parentRevocationVersion: 7n,
    maxUses: 4n,
    usesClaimed: 1n,
    maxBudget: 40n,
    budgetClaimed: 10n,
    expiresAtMs: 1_500n,
  });

  const state = projectEnvdCapabilityState(child, {
    checkpointObservedAtMs: 1_100n,
    nowMs: 1_000n,
    parent,
  });
  assert.deepEqual(state.target, {
    organizationId: child.orgId,
    nodeId: 'node-1',
    agentId: 'agent-1',
  });
  assert.deepEqual(state.authorizedSigners, [child.delegate]);
  assert.deepEqual(state.actions, ['deploy', 'status']);
  assert.deepEqual(state.scopes, ['lifecycle']);
  assert.equal(state.remainingUses, 3n);
  assert.deepEqual(state.remainingBudget, { asset: 'MIST', amount: 30n });
  assert.deepEqual(capabilityReference(child), { id: child.objectId, revocationVersion: 1n });
});

test('authority projection preserves pre-validation ceilings after an exact claim', () => {
  const root = capability({
    targetKind: 1,
    reservationScope: 'authority',
    nodeId: '',
    agentId: '',
    maxUses: 1n,
    usesClaimed: 1n,
    maxBudget: 42n,
    budgetClaimed: 42n,
  });
  const state = projectEnvdCapabilityState(root, {
    checkpointObservedAtMs: 2n,
    nowMs: 1n,
  });

  assert.equal(state.remainingUses, 1n);
  assert.deepEqual(state.remainingBudget, { asset: 'MIST', amount: 42n });
});

test('delegated projection fails closed on parent checkpoint defects', () => {
  const parent = capability({
    objectId: address('10'),
    targetKind: 1,
    reservationScope: 'authority',
    nodeId: '',
    agentId: '',
    parentId: null,
    maxUses: 10n,
    maxBudget: 100n,
    expiresAtMs: 2_000n,
    revocationVersion: 7n,
  });
  const child = capability({
    objectId: address('11'),
    parentId: parent.objectId,
    parentRevocationVersion: 7n,
    maxUses: 4n,
    maxBudget: 40n,
    expiresAtMs: 1_500n,
  });

  assert.throws(
    () => projectEnvdCapabilityState(child, { checkpointObservedAtMs: 1_000n, nowMs: 900n }),
    /requires its parent/,
  );
  assert.throws(() => verifyParentCheckpoint(child, { ...parent, revoked: true }, 900n), /revoked/);
  assert.throws(() => verifyParentCheckpoint(child, parent, 2_000n), /expired/);
  assert.throws(
    () => verifyParentCheckpoint({ ...child, parentRevocationVersion: 6n }, parent, 900n),
    /stale/,
  );
  assert.throws(
    () => verifyParentCheckpoint({ ...child, actions: ['terminal'] }, parent, 900n),
    /exceeds its parent/,
  );
  assert.throws(
    () => verifyParentCheckpoint({ ...child, budgetAsset: 'USDC' }, parent, 900n),
    /budget asset/,
  );
});

test('projection rejects malformed tokens, duplicate actions, and counter underflow', () => {
  assert.throws(
    () => capabilityReference(capability({ schemaVersion: 2 })),
    /Unsupported RemoteCapability schema version/,
  );
  assert.throws(
    () => projectEnvdCapabilityState(capability({ schemaVersion: 2 }), {
      checkpointObservedAtMs: 1n,
      nowMs: 1n,
    }),
    /Unsupported RemoteCapability schema version/,
  );
  assert.throws(
    () => projectEnvdCapabilityState(capability({ nodeId: 'node one' }), {
      checkpointObservedAtMs: 1n,
      nowMs: 1n,
    }),
    /non-canonical/,
  );
  assert.throws(
    () => projectEnvdCapabilityState(capability({ actions: ['deploy', 'deploy'] }), {
      checkpointObservedAtMs: 1n,
      nowMs: 1n,
    }),
    /duplicates/,
  );
  assert.throws(
    () => projectEnvdCapabilityState(capability({ maxUses: 1n, usesClaimed: 2n }), {
      checkpointObservedAtMs: 1n,
      nowMs: 1n,
    }),
    /counters exceed/,
  );
});

test('u64 conversion preserves max-u64 and rejects unsafe or noncanonical inputs', () => {
  assert.equal(toBigInt(MAX_U64), MAX_U64);
  assert.equal(toBigInt(MAX_U64.toString()), MAX_U64);
  assert.throws(() => toBigInt(Number.MAX_SAFE_INTEGER + 1), /safe integers/);
  assert.throws(() => toBigInt('-1'), /unsigned decimal/);
  assert.throws(() => toBigInt('+1'), /unsigned decimal/);
  assert.throws(() => toBigInt('01'), /unsigned decimal/);
  assert.throws(() => toBigInt(MAX_U64 + 1n), /outside the range/);
  assert.deepEqual(capabilityReferenceWire({ id: 'cap-1', revocationVersion: MAX_U64 }), {
    id: 'cap-1',
    revocation_version: MAX_U64.toString(),
  });
});

test('canonical signing bytes exactly match the envd v1 golden fixture', () => {
  const golden = JSON.parse(readFileSync(
    join(__dirname, '..', '..', 'fixtures', 'node-command', 'v1-golden.json'),
    'utf8',
  )) as {
    command: Record<string, any>;
    signing_bytes_hex: string;
  };
  const command = golden.command;
  const input: NodeCommandSigningInput = {
    version: command.version,
    commandId: command.command_id,
    signer: command.signer,
    target: {
      organizationId: command.target.organization_id,
      nodeId: command.target.node_id,
      agentId: command.target.agent_id,
    },
    action: command.action,
    scope: command.scope,
    capability: {
      id: command.capability.id,
      revocationVersion: command.capability.revocation_version,
    },
    nonce: command.nonce,
    issuedAtMs: command.issued_at_ms,
    expiresAtMs: command.expires_at_ms,
    idempotencyKey: command.idempotency_key,
    budget: {
      asset: command.budget.asset,
      amount: command.budget.amount,
    },
    payloadHash: command.payload_hash,
  };

  assert.equal(Buffer.from(canonicalNodeCommandSigningBytes(input)).toString('hex'), golden.signing_bytes_hex);
  assert.throws(
    () => canonicalNodeCommandSigningBytes({ ...input, issuedAtMs: Number.MAX_SAFE_INTEGER + 1 }),
    /safe integer/,
  );
});

test('canonical signing bytes mirror Go omitempty behavior', () => {
  const bytes = canonicalNodeCommandSigningBytes({
    version: '1',
    commandId: 'cmd-1',
    signer: 'signer-1',
    target: { organizationId: 'org-1', nodeId: 'node-1', agentId: '' },
    action: 'status',
    scope: 'lifecycle',
    capability: { id: 'cap-1', revocationVersion: 7n },
    nonce: 'nonce-1',
    issuedAtMs: 1,
    expiresAtMs: 2,
    idempotencyKey: 'idem-1',
    payloadHash: '0'.repeat(64),
  });
  const json = Buffer.from(bytes).toString('utf8');
  assert.equal(json.includes('agent_id'), false);
  assert.equal(json.includes('budget'), false);
});

function address(suffix: string): string {
  return `0x${suffix.padStart(64, '0')}`;
}

function capability(overrides: Partial<RemoteCapabilityData> = {}): RemoteCapabilityData {
  return {
    objectId: address('1'),
    type: `${address('123')}::remote_authority::RemoteCapability`,
    schemaVersion: 1,
    orgId: address('2'),
    issuer: address('3'),
    delegate: address('4'),
    parentId: null,
    parentRevocationVersion: 0n,
    reservationScope: 'node',
    targetKind: 3,
    nodeId: 'node-1',
    agentId: 'agent-1',
    actions: ['status', 'deploy'],
    scope: 'lifecycle',
    maxUses: 5n,
    usesClaimed: 0n,
    usesDelegated: 0n,
    budgetAsset: 'MIST',
    maxBudget: 50n,
    budgetClaimed: 0n,
    budgetDelegated: 0n,
    expiresAtMs: 10_000n,
    revocationVersion: 1n,
    revoked: false,
    ...overrides,
  };
}
